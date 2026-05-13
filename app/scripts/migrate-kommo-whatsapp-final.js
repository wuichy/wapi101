#!/usr/bin/env node
// Migración Kommo → Wapi101 — pipeline WHATSAPP / etapa FINAL
// Lee dump pre-pulled (porque el IP del droplet está bloqueado por Kommo).
//
// Origen Kommo: pipeline 6242887 / status 100678935 (FINAL)
// Destino Wapi101: pipeline 3 / stage 17 (FINAL)
//
// Reglas (confirmadas por wuichy 2026-05-13):
//   • Dedup contacto por teléfono normalizado.
//   • NO existe → crear contacto + expediente FINAL + tags Kommo.
//   • YA existe → Kommo gana en nombre (overwrite), tags MERGE,
//     expediente en pipeline 3 se mueve a FINAL (o se crea si no hay).
//
// Uso:
//   node scripts/migrate-kommo-whatsapp-final.js              (DRY RUN)
//   node scripts/migrate-kommo-whatsapp-final.js --apply      (ESCRIBE)
//
// Requisito: /tmp/kommo-final-dump.json (creado con /tmp/kommo-pull-final.sh
// desde local Mac, donde el IP no está bloqueado).

const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const TENANT_ID = 1;
const WAPI_PIPELINE_ID = 3;     // WHATSAPP
const WAPI_STAGE_FINAL = 17;    // FINAL

const DB_PATH   = '/root/.wapi101/data/wapi101.sqlite';
const DUMP_PATH = '/tmp/kommo-final-dump.json';

// ── Load dump ─────────────────────────────────────────────────
if (!fs.existsSync(DUMP_PATH)) {
  console.error(`❌ No existe ${DUMP_PATH}. Corre /tmp/kommo-pull-final.sh primero desde local Mac.`);
  process.exit(1);
}
const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));
const { leads, contacts: contactsById } = dump;

// ── DB ────────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

// ── Helpers ────────────────────────────────────────────────────
function normPhone(p) {
  if (!p) return null;
  const s = String(p).replace(/[^0-9]/g, '');
  if (s.length < 10) return null;
  return s.length === 10 ? '521' + s : s;
}

function splitName(full) {
  const s = String(full || '').trim();
  if (!s) return { first: '(sin nombre)', last: null };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function extractFromCustomFields(contact, fieldCode) {
  const cfvs = contact?.custom_fields_values || [];
  for (const cf of cfvs) {
    if (cf?.field_code === fieldCode && Array.isArray(cf.values)) {
      for (const v of cf.values) {
        if (v?.value) return v.value;
      }
    }
  }
  return null;
}

function findContactByPhone(phoneRaw) {
  const norm = normPhone(phoneRaw);
  if (!norm) return null;
  const variants = [norm, '+' + norm, '+52' + norm.slice(3), norm.slice(3)];
  for (const v of variants) {
    const row = db.prepare('SELECT id, first_name, last_name FROM contacts WHERE phone = ? AND tenant_id = ?').get(v, TENANT_ID);
    if (row) return row;
  }
  const last10 = norm.slice(-10);
  const row = db.prepare("SELECT id, first_name, last_name FROM contacts WHERE phone LIKE ? AND tenant_id = ?").get('%' + last10, TENANT_ID);
  return row || null;
}

function getContactTags(contactId) {
  const rows = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? AND tenant_id = ?').all(contactId, TENANT_ID);
  return new Set(rows.map(r => r.tag));
}

function findExpedientInPipeline(contactId, pipelineId) {
  const row = db.prepare(
    'SELECT id, stage_id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? LIMIT 1'
  ).get(contactId, pipelineId, TENANT_ID);
  return row || null;
}

// ── Prepared ──────────────────────────────────────────────────
const insContact = db.prepare(`
  INSERT INTO contacts (first_name, last_name, phone, email, created_at, updated_at, tenant_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const updContactName = db.prepare(`
  UPDATE contacts SET first_name = ?, last_name = ?, updated_at = unixepoch()
  WHERE id = ? AND tenant_id = ?
`);
const insExpedient = db.prepare(`
  INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, value, created_at, updated_at, name_is_auto, tenant_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updExpedientStage = db.prepare(`
  UPDATE expedients SET stage_id = ?, updated_at = unixepoch()
  WHERE id = ? AND tenant_id = ?
`);
const insTag = db.prepare(`
  INSERT OR IGNORE INTO contact_tags (contact_id, tag, tenant_id) VALUES (?, ?, ?)
`);

// ── Main ──────────────────────────────────────────────────────
console.log(`\n${APPLY ? '⚠️  APPLY MODE — escribiendo en DB' : '👁  DRY RUN — no se escribe nada'}`);
console.log('─'.repeat(70));

const stats = {
  leadsTotal: leads.length,
  skippedNoContact: 0,
  skippedNoPhone: 0,
  contactsCreated: 0,
  namesOverwritten: 0,
  namesUnchanged: 0,
  tagsAdded: 0,
  expedientsCreated: 0,
  expedientsMoved: 0,
  expedientsAlreadyFinal: 0,
  errors: 0,
};

console.log(`\n→ Procesando ${leads.length} leads del dump...\n`);

const samples = [];
const now = Math.floor(Date.now() / 1000);

const tx = db.transaction(() => {
  for (const lead of leads) {
    try {
      const linked = lead._embedded?.contacts || [];
      if (!linked.length) {
        stats.skippedNoContact++;
        continue;
      }
      const main = linked.find(c => c.is_main) || linked[0];
      const kommoContact = contactsById[String(main.id)];
      if (!kommoContact) {
        stats.skippedNoContact++;
        continue;
      }

      const phoneRaw = extractFromCustomFields(kommoContact, 'PHONE');
      if (!phoneRaw) { stats.skippedNoPhone++; continue; }
      const phoneNorm = normPhone(phoneRaw);
      if (!phoneNorm) { stats.skippedNoPhone++; continue; }

      const kommoName = kommoContact.name || lead.name || '';
      const { first, last } = splitName(kommoName);
      const email = extractFromCustomFields(kommoContact, 'EMAIL');
      const kommoTags = (kommoContact._embedded?.tags || []).map(t => t.name).filter(Boolean);
      const createdAt = lead.created_at || now;

      const existing = findContactByPhone(phoneRaw);
      const sample = {
        leadId: lead.id,
        leadName: lead.name,
        kommoContactName: kommoName,
        phoneNorm,
        email,
        kommoTags,
        existingName: existing ? `${existing.first_name || ''} ${existing.last_name || ''}`.trim() : null,
        action: [],
      };

      let wapiContactId;

      if (!existing) {
        if (APPLY) {
          const r = insContact.run(first, last, phoneNorm, email, createdAt, now, TENANT_ID);
          wapiContactId = r.lastInsertRowid;
          insExpedient.run(wapiContactId, WAPI_PIPELINE_ID, WAPI_STAGE_FINAL,
            String(lead.id), lead.price || 0, createdAt, now, 1, TENANT_ID);
          for (const tag of kommoTags) {
            insTag.run(wapiContactId, tag, TENANT_ID);
            stats.tagsAdded++;
          }
        } else {
          wapiContactId = '(nuevo)';
          stats.tagsAdded += kommoTags.length;
        }
        stats.contactsCreated++;
        stats.expedientsCreated++;
        sample.action.push('CREATE contact + expediente FINAL');

      } else {
        wapiContactId = existing.id;

        // Nombre — Kommo gana siempre (overwrite)
        const sameName = existing.first_name === first && (existing.last_name || null) === (last || null);
        if (!sameName) {
          if (APPLY) updContactName.run(first, last, wapiContactId, TENANT_ID);
          stats.namesOverwritten++;
          sample.action.push(`UPDATE nombre "${existing.first_name} ${existing.last_name || ''}".trim() → "${first} ${last || ''}".trim()`);
        } else {
          stats.namesUnchanged++;
        }

        // Tags MERGE (no borrar las que ya tiene)
        const wapiTags = getContactTags(wapiContactId);
        let newTagsForThisContact = 0;
        for (const tag of kommoTags) {
          if (!wapiTags.has(tag)) {
            if (APPLY) insTag.run(wapiContactId, tag, TENANT_ID);
            stats.tagsAdded++;
            newTagsForThisContact++;
          }
        }
        if (newTagsForThisContact > 0) sample.action.push(`+${newTagsForThisContact} tags`);

        // Expediente
        const exp = findExpedientInPipeline(wapiContactId, WAPI_PIPELINE_ID);
        if (!exp) {
          if (APPLY) {
            insExpedient.run(wapiContactId, WAPI_PIPELINE_ID, WAPI_STAGE_FINAL,
              String(lead.id), lead.price || 0, createdAt, now, 1, TENANT_ID);
          }
          stats.expedientsCreated++;
          sample.action.push('CREATE expediente FINAL');
        } else if (exp.stage_id !== WAPI_STAGE_FINAL) {
          if (APPLY) updExpedientStage.run(WAPI_STAGE_FINAL, exp.id, TENANT_ID);
          stats.expedientsMoved++;
          sample.action.push(`MOVE expediente stage ${exp.stage_id} → ${WAPI_STAGE_FINAL}`);
        } else {
          stats.expedientsAlreadyFinal++;
          sample.action.push('expediente ya en FINAL');
        }
      }

      sample.wapiContactId = wapiContactId;
      samples.push(sample);

    } catch (e) {
      console.error(`✗ Error en lead ${lead.id}:`, e?.message || String(e));
      stats.errors++;
    }
  }
});

if (APPLY) tx();
else { tx(); /* dry run sin escribir gracias a if(APPLY) en cada step */ }

// Reporte
console.log('─'.repeat(70));
console.log('\n📋 Resumen por lead:\n');
for (const s of samples) {
  const flag = s.existingName ? '🔄 existente' : '✨ nuevo';
  console.log(`  ${flag} | "${s.kommoContactName}" (${s.phoneNorm})`);
  if (s.email) console.log(`            email: ${s.email}`);
  if (s.existingName) console.log(`            wapi actual: "${s.existingName}"`);
  if (s.kommoTags.length) console.log(`            tags Kommo: ${s.kommoTags.join(', ')}`);
  console.log(`            → ${s.action.join(' | ')}`);
  console.log('');
}

console.log('─'.repeat(70));
console.log('\n📊 STATS\n');
console.log(`  Leads en dump:              ${stats.leadsTotal}`);
console.log(`  Skipped (sin contacto):     ${stats.skippedNoContact}`);
console.log(`  Skipped (sin phone):        ${stats.skippedNoPhone}`);
console.log(`  Contactos NUEVOS creados:   ${stats.contactsCreated}`);
console.log(`  Nombres sobreescritos:      ${stats.namesOverwritten}`);
console.log(`  Nombres sin cambio:         ${stats.namesUnchanged}`);
console.log(`  Tags agregadas (merge):     ${stats.tagsAdded}`);
console.log(`  Expedientes creados:        ${stats.expedientsCreated}`);
console.log(`  Expedientes movidos a FIN:  ${stats.expedientsMoved}`);
console.log(`  Expedientes ya en FINAL:    ${stats.expedientsAlreadyFinal}`);
console.log(`  Errores:                    ${stats.errors}`);
console.log('');
console.log(APPLY ? '✅ APLICADO' : '👁  DRY RUN — corre con --apply para escribir');
