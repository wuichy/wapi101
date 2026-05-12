#!/usr/bin/env node
// Migración Kommo → Wapi101
// Importa leads del pipeline WHATSAPP en etapas ELMINAR + OTROS al pipeline
// WHATSAPP de Wapi101, preservando: nombre del lead, fecha de creación,
// contacto vinculado (con dedup por teléfono normalizado), tags útiles del
// contacto y valor del deal.
//
// Uso:
//   node scripts/migrate-kommo-whatsapp.js              (DRY RUN — no escribe)
//   node scripts/migrate-kommo-whatsapp.js --apply      (ESCRIBE en DB)
//
// Defensa: nunca crea un expediente si el contacto ya tiene uno en el pipeline
// WHATSAPP de Wapi101. Skip seguro.

const fs = require('fs');
const https = require('https');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const TENANT_ID = 1;

// ── Config ────────────────────────────────────────────────────
const KOMMO_PIPELINE_ID = 6242887;            // WHATSAPP en Kommo
const KOMMO_STATUS_ELMINAR = 104545403;
const KOMMO_STATUS_OTROS   = 104544515;

const WAPI_PIPELINE_ID = 3;                   // WHATSAPP en Wapi101
const WAPI_STAGE_ELMINAR = 18;
const WAPI_STAGE_OTROS   = 19;

// Traemos TODAS las tags del contacto (sin filtro) según pedido del usuario.
// Tags del lead se ignoran completamente (son basura: IDs, JSON corrupto).

const DB_PATH = '/root/.wapi101/data/wapi101.sqlite';
const STATE_PATH = '/root/.wapi101/data/app-state.json';

// ── Kommo client ──────────────────────────────────────────────
const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
const TOKEN = state.kommo.tokens.access_token;
const HOST = state.kommo.subdomain + '.kommo.com';

function kommoGetOnce(p) {
  return new Promise((res, rej) => {
    const req = https.request({ hostname: HOST, path: p, headers: { Authorization: 'Bearer ' + TOKEN }, timeout: 15000 }, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        if (r.statusCode === 429) return rej({ retry: true, status: 429, msg: 'rate-limited' });
        if (r.statusCode === 502 || r.statusCode === 503 || r.statusCode === 504) return rej({ retry: true, status: r.statusCode });
        if (r.statusCode === 204 || !b) return res({});
        try { res(JSON.parse(b)); } catch (e) { rej({ retry: false, status: r.statusCode, msg: b.slice(0, 200) }); }
      });
    });
    req.on('error', e => rej({ retry: true, msg: e.message }));
    req.on('timeout', () => { req.destroy(); rej({ retry: true, msg: 'timeout' }); });
    req.end();
  });
}

async function kommoGet(p, attempt = 1) {
  try {
    return await kommoGetOnce(p);
  } catch (e) {
    if (e?.retry && attempt < 4) {
      await new Promise(r => setTimeout(r, 500 * attempt + Math.random() * 500));
      return kommoGet(p, attempt + 1);
    }
    throw e;
  }
}

// ── DB ────────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

// ── Helpers ───────────────────────────────────────────────────
function normPhone(p) {
  if (!p) return null;
  const s = String(p).replace(/[^0-9]/g, '');
  if (s.length < 10) return null;
  return s.length === 10 ? '521' + s : s; // MX default
}

function splitName(full) {
  const s = String(full || '').trim();
  if (!s) return { first: '(sin nombre)', last: null };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function findContactByPhone(phone) {
  const norm = normPhone(phone);
  if (!norm) return null;
  // Buscamos por phone tal cual + variantes comunes
  const variants = [norm, '+' + norm, '+52' + norm.slice(3), norm.slice(3)];
  for (const v of variants) {
    const row = db.prepare('SELECT id FROM contacts WHERE phone = ? AND tenant_id = ?').get(v, TENANT_ID);
    if (row) return row.id;
  }
  // Fallback: LIKE con últimos 10 dígitos
  const last10 = norm.slice(-10);
  const row = db.prepare("SELECT id FROM contacts WHERE phone LIKE ? AND tenant_id = ?").get('%' + last10, TENANT_ID);
  return row?.id || null;
}

function expedientExistsInPipeline(contactId, pipelineId) {
  const row = db.prepare(
    'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? LIMIT 1'
  ).get(contactId, pipelineId, TENANT_ID);
  return !!row;
}

function getContactTags(contactId) {
  const rows = db.prepare(
    'SELECT tag FROM contact_tags WHERE contact_id = ? AND tenant_id = ?'
  ).all(contactId, TENANT_ID);
  return new Set(rows.map(r => r.tag));
}

// ── Inserts (solo se llaman si APPLY) ─────────────────────────
const insContact = db.prepare(`
  INSERT INTO contacts (first_name, last_name, phone, email, created_at, updated_at, tenant_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insExpedient = db.prepare(`
  INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, value, created_at, updated_at, name_is_auto, tenant_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insTag = db.prepare(`
  INSERT OR IGNORE INTO contact_tags (contact_id, tag, tenant_id) VALUES (?, ?, ?)
`);

// ── Pull all leads from ELMINAR + OTROS ───────────────────────
async function pullLeads(statusId) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await kommoGet(`/api/v4/leads?filter[pipeline_id]=${KOMMO_PIPELINE_ID}&filter[statuses][0][pipeline_id]=${KOMMO_PIPELINE_ID}&filter[statuses][0][status_id]=${statusId}&with=contacts&limit=250&page=${page}`);
    const items = r._embedded?.leads || [];
    all.push(...items);
    if (items.length < 250) break;
    page++;
    if (page > 30) break;
  }
  return all;
}

// Cache de tags por contacto (Kommo) — minimizar requests
const tagsCache = new Map();
async function getKommoContactTags(contactId) {
  if (tagsCache.has(contactId)) return tagsCache.get(contactId);
  const r = await kommoGet('/api/v4/contacts/' + contactId + '/tags?limit=250');
  const tags = (r._embedded?.tags || []).map(t => t.name);
  tagsCache.set(contactId, tags);
  return tags;
}

const contactCache = new Map();
async function getKommoContact(contactId) {
  if (contactCache.has(contactId)) return contactCache.get(contactId);
  const c = await kommoGet('/api/v4/contacts/' + contactId);
  contactCache.set(contactId, c);
  return c;
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log(`\n${APPLY ? '⚠️  APPLY MODE — escribiendo en DB' : '👁  DRY RUN — no se escribe nada'}`);
  console.log('─'.repeat(70));

  // Stats counters
  const stats = {
    leadsPulled: 0,
    skippedNoContact: 0,
    skippedExistsInPipeline: 0,
    contactsReused: 0,
    contactsCreated: 0,
    expedientsCreated: 0,
    tagsAdded: 0,
    errors: 0,
  };

  console.log('\n→ Pulling leads de Kommo WHATSAPP/ELMINAR...');
  const elminarLeads = await pullLeads(KOMMO_STATUS_ELMINAR);
  console.log('  ' + elminarLeads.length + ' leads en ELMINAR');

  console.log('→ Pulling leads de Kommo WHATSAPP/OTROS...');
  const otrosLeads = await pullLeads(KOMMO_STATUS_OTROS);
  console.log('  ' + otrosLeads.length + ' leads en OTROS');

  const allLeads = [
    ...elminarLeads.map(l => ({ ...l, _wapiStage: WAPI_STAGE_ELMINAR, _stageName: 'ELMINAR' })),
    ...otrosLeads.map(l => ({ ...l, _wapiStage: WAPI_STAGE_OTROS, _stageName: 'OTROS' })),
  ];
  stats.leadsPulled = allLeads.length;

  console.log('\n→ Procesando ' + allLeads.length + ' leads...');

  // Para el reporte: muestrame los primeros 10 ejemplos
  const samples = [];

  const insertTx = db.transaction(() => {
    for (const lead of allLeads) {
      const kommoContactId = lead._embedded?.contacts?.[0]?.id;
      if (!kommoContactId) {
        stats.skippedNoContact++;
        continue;
      }

      // ⚠️ FETCH del contacto se hace SIEMPRE — incluso en dry-run necesitamos info
      // pero en sync (la transacción solo escribe si APPLY)
      // Para dry-run, ya prefetched abajo. Aquí solo lookup en cache.
      const c = contactCache.get(kommoContactId);
      if (!c || !c.id) {
        stats.errors++;
        continue;
      }

      const phoneCf = (c.custom_fields_values || []).find(f => f.field_code === 'PHONE');
      const phone = phoneCf?.values?.[0]?.value;
      const email = (c.custom_fields_values || []).find(f => f.field_code === 'EMAIL')?.values?.[0]?.value || null;

      // Dedup: buscar contacto por teléfono
      let wapiContactId = phone ? findContactByPhone(phone) : null;
      let isNewContact = false;

      if (!wapiContactId) {
        // Crear contacto
        const { first, last } = splitName(c.name);
        const phoneNorm = normPhone(phone);
        if (APPLY) {
          const r = insContact.run(first, last, phoneNorm || null, email, c.created_at || Math.floor(Date.now()/1000), c.updated_at || Math.floor(Date.now()/1000), TENANT_ID);
          wapiContactId = r.lastInsertRowid;
        } else {
          wapiContactId = -1; // placeholder en dry-run
        }
        stats.contactsCreated++;
        isNewContact = true;
      } else {
        stats.contactsReused++;
      }

      // Dedup: el contacto ya tiene expediente en pipeline WHATSAPP?
      if (!isNewContact && expedientExistsInPipeline(wapiContactId, WAPI_PIPELINE_ID)) {
        stats.skippedExistsInPipeline++;
        if (samples.length < 5) samples.push({ action: 'SKIP', reason: 'expedient ya existe en pipe WHATSAPP', lead: lead.id, contact: wapiContactId, name: c.name });
        continue;
      }

      // Crear expediente
      const expName = lead.name || ('Lead #' + lead.id);
      const expValue = Number(lead.price) || 0;
      const expCreated = lead.created_at || Math.floor(Date.now()/1000);

      if (APPLY) {
        const r = insExpedient.run(wapiContactId, WAPI_PIPELINE_ID, lead._wapiStage, expName, expValue, expCreated, lead.updated_at || expCreated, 0, TENANT_ID);
        if (samples.length < 5) samples.push({ action: 'CREATED', expedient: r.lastInsertRowid, lead: lead.id, contact: wapiContactId, name: c.name, stage: lead._stageName });
      } else {
        if (samples.length < 5) samples.push({ action: 'WOULD CREATE', lead: lead.id, name: c.name, stage: lead._stageName, expName, expValue });
      }
      stats.expedientsCreated++;
    }
  });

  // ── Prefetch contactos (paralelo controlado) ──
  console.log('\n→ Prefetching contactos de Kommo (con tags)...');
  const uniqueContactIds = [...new Set(allLeads.map(l => l._embedded?.contacts?.[0]?.id).filter(Boolean))];
  console.log('  ' + uniqueContactIds.length + ' contactos únicos a fetchar');

  const CONCURRENCY = 3;
  let done = 0;
  const failedIds = [];
  for (let i = 0; i < uniqueContactIds.length; i += CONCURRENCY) {
    const batch = uniqueContactIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async id => {
      try {
        await getKommoContact(id);
        await getKommoContactTags(id);
      } catch (e) {
        failedIds.push(id);
      }
      done++;
      if (done % 50 === 0) process.stdout.write('  ' + done + '/' + uniqueContactIds.length + '\r');
    }));
    // Pequeño throttle entre batches para no saturar
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('  ' + done + '/' + uniqueContactIds.length + ' contactos prefetcheados');
  if (failedIds.length) {
    console.log('  ⚠️  ' + failedIds.length + ' fallaron tras 3 retries — IDs ejemplo: ' + failedIds.slice(0, 10).join(','));
  }

  // ── Ejecutar inserts (con transacción si APPLY) ──
  console.log('\n→ Procesando inserts...');
  if (APPLY) {
    insertTx();
  } else {
    // En dry-run, ejecutar la lógica sin transaction wrap (los inserts no corren)
    insertTx();
  }

  // ── Tags del contacto ──
  console.log('\n→ Procesando tags del contacto (whitelist)...');
  for (const lead of allLeads) {
    const kommoContactId = lead._embedded?.contacts?.[0]?.id;
    if (!kommoContactId) continue;
    const c = contactCache.get(kommoContactId);
    if (!c) continue;
    const phoneCf = (c.custom_fields_values || []).find(f => f.field_code === 'PHONE');
    const phone = phoneCf?.values?.[0]?.value;
    const wapiContactId = phone ? findContactByPhone(phone) : null;
    if (!wapiContactId) continue;
    const kommoTags = await getKommoContactTags(kommoContactId);
    const existingTags = getContactTags(wapiContactId);
    for (const t of kommoTags) {
      if (!TAG_WHITELIST.has(t)) continue;
      if (existingTags.has(t)) continue;
      if (APPLY) {
        try { insTag.run(wapiContactId, t, TENANT_ID); stats.tagsAdded++; } catch (e) { /* ignore */ }
      } else {
        stats.tagsAdded++;
      }
    }
  }

  // ── Report ──
  console.log('\n' + '═'.repeat(70));
  console.log(APPLY ? '✅ COMPLETADO — escrito en DB' : '👁  DRY RUN — no se escribió nada');
  console.log('═'.repeat(70));
  console.log('Leads pulled (Kommo)         : ' + stats.leadsPulled);
  console.log('  └─ ELMINAR                 : ' + elminarLeads.length);
  console.log('  └─ OTROS                   : ' + otrosLeads.length);
  console.log('Skipped (lead sin contacto)  : ' + stats.skippedNoContact);
  console.log('Skipped (ya en pipe WHATSAPP): ' + stats.skippedExistsInPipeline);
  console.log('Contactos reutilizados       : ' + stats.contactsReused);
  console.log('Contactos creados            : ' + stats.contactsCreated);
  console.log('Expedientes creados          : ' + stats.expedientsCreated);
  console.log('Tags añadidas (whitelist)    : ' + stats.tagsAdded);
  console.log('Errors                       : ' + stats.errors);
  if (samples.length) {
    console.log('\nMuestras (primeras 5):');
    for (const s of samples) console.log('  ' + JSON.stringify(s));
  }
  console.log('═'.repeat(70));

  if (!APPLY) {
    console.log('\n💡 Si los números se ven bien, corre:');
    console.log('   node scripts/migrate-kommo-whatsapp.js --apply\n');
  }

  db.close();
})().catch(e => { console.error('ERR:', e); process.exit(1); });
