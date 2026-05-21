// Data Center — endpoints REST
//
// GET    /api/data-center/available    — qué cards mostrar para este tenant
// POST   /api/data-center/analyze      — analiza archivo, devuelve {format, headers, mapping, conflicts}
// POST   /api/data-center/preview      — aplica mapeo y muestra primeros N como quedarían
// POST   /api/data-center/import       — ejecuta el import (puede ser background si grande)
// GET    /api/data-center/export/:entity — genera export (CSV/JSON/XLSX según query ?format=)

const express = require('express');
const svc = require('./service');

module.exports = (db) => {
  const router = express.Router();

  // GET /available — qué cards mostrar
  router.get('/available', (req, res) => {
    try {
      const out = svc.getAvailableEntities(db, req.tenantId);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /analyze — { entity, filename, content (text) } → análisis
  router.post('/analyze', express.json({ limit: '20mb' }), (req, res) => {
    try {
      const { entity, filename, content } = req.body || {};
      if (!entity || !content) return res.status(400).json({ error: 'entity y content requeridos' });
      const out = svc.analyzeFile(db, req.tenantId, entity, { filename, content });
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // POST /import — delegado a módulos específicos por entidad
  //   { entity, content, mapping, options: { dedupPolicy, createLeads, pipelineId, stageId } }
  router.post('/import', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const { entity } = req.body || {};
      if (!entity) return res.status(400).json({ error: 'entity requerida' });

      switch (entity) {
        case 'contacts':  return res.json(await _importContacts(db, req.tenantId, req.advisor, req.body));
        case 'leads':     return res.json(await _importLeads(db, req.tenantId, req.advisor, req.body));
        case 'templates': return res.json(await _importTemplates(db, req.tenantId, req.body));
        case 'tags':      return res.json(await _importTags(db, req.tenantId, req.body));
        case 'pipelines': return res.json(await _importPipelines(db, req.tenantId, req.body));
        case 'bots':      return res.json(await _importBots(db, req.tenantId, req.body));
        case 'chats':     return res.json(await _importChats(db, req.tenantId, req.body));
        default:
          return res.status(501).json({ error: `Import de "${entity}" pendiente de implementar` });
      }
    } catch (e) {
      console.error('[data-center] import error:', e);
      res.status(400).json({ error: e.message });
    }
  });

  // GET /export/:entity — descarga
  router.get('/export/:entity', (req, res) => {
    try {
      const entity = req.params.entity;
      const format = String(req.query.format || 'csv').toLowerCase();
      _exportEntity(db, req.tenantId, entity, format, req.query, res);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return router;
};

// ─── Importers específicos ────────────────────────────────────────────

async function _importContacts(db, tenantId, advisor, body) {
  const { content, filename, mapping = {}, options = {} } = body;
  const customers = require('../customers/service');
  const expedients = require('../expedients/service');

  const { headers, rows } = svc.parseFile({ filename: filename || 'data.csv', content });
  const dedupPolicy = options.dedupPolicy || 'skip'; // skip | overwrite | merge

  // Construir rows de objetos según mapping. Si el archivo tiene "Nombre" como
  // un solo campo (sin Apellido separado), lo partimos en primer/último.
  const items = rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const dest = mapping[h];
      if (!dest) return;
      const val = (row[i] || '').toString().trim();
      if (dest === 'firstName' && !obj.lastName) {
        const parts = val.split(/\s+/);
        if (parts.length > 1 && !mapping[headers.find(hh => mapping[hh] === 'lastName')]) {
          obj.firstName = parts[0];
          obj.lastName = parts.slice(1).join(' ');
          return;
        }
      }
      if (dest === 'tags') {
        obj.tags = val.split(',').map(t => t.trim()).filter(Boolean);
        return;
      }
      obj[dest] = val;
    });
    return obj;
  }).filter(o => o.firstName || o.lastName || o.phone || o.email);

  // Procesar uno por uno para capturar los IDs creados (necesarios para leads)
  const result = { created: 0, updated: 0, skipped: 0, errors: 0 };
  const newContactIds = [];
  const allTargetIds = []; // tanto creados como actualizados (para crear leads en ambos casos si user pidió)

  const txn = db.transaction(() => {
    for (const r of items) {
      try {
        const phone = r.phone ? customers.normalizePhone(r.phone) : null;
        const dupe = (phone || r.email)
          ? customers.findDuplicate(db, tenantId, { phone, email: r.email })
          : null;

        if (dupe) {
          if (dedupPolicy === 'skip') { result.skipped++; continue; }
          if (dedupPolicy === 'overwrite' || dedupPolicy === 'merge') {
            // overwrite: pisa todo. merge: solo rellena lo vacío.
            const updates = dedupPolicy === 'overwrite'
              ? { firstName: r.firstName || dupe.first_name, lastName: r.lastName || dupe.last_name, phone: phone || dupe.phone, email: r.email || dupe.email }
              : { firstName: dupe.first_name || r.firstName, lastName: dupe.last_name || r.lastName, phone: dupe.phone || phone, email: dupe.email || r.email };
            customers.update(db, tenantId, dupe.id, { ...updates, tags: undefined });
            // Tags se mergean siempre (UNION)
            if (Array.isArray(r.tags)) {
              for (const t of r.tags) {
                db.prepare('INSERT OR IGNORE INTO contact_tags (tenant_id, contact_id, tag) VALUES (?, ?, ?)').run(tenantId, dupe.id, t);
              }
            }
            result.updated++;
            allTargetIds.push(dupe.id);
            continue;
          }
        }

        // Crear nuevo
        const created = customers.create(db, tenantId, {
          firstName: r.firstName || '(Sin nombre)',
          lastName: r.lastName || '',
          phone, email: r.email || null,
          tags: Array.isArray(r.tags) ? r.tags : [],
        });
        result.created++;
        newContactIds.push(created.id);
        allTargetIds.push(created.id);
      } catch (e) {
        result.errors++;
        console.warn('[data-center] contact row error:', e.message);
      }
    }
  });
  txn();

  // Crear leads si pidió
  let leadsCreated = 0;
  if (options.createLeads && options.pipelineId && options.stageId) {
    // Política: solo para nuevos (mantener comportamiento del wizard)
    const txn2 = db.transaction(() => {
      for (const cid of newContactIds) {
        try {
          expedients.create(db, tenantId, {
            contactId: cid,
            pipelineId: Number(options.pipelineId),
            stageId: Number(options.stageId),
            name: null,
            value: 0,
          });
          leadsCreated++;
        } catch (e) {
          console.warn('[data-center] lead create error:', e.message);
        }
      }
    });
    txn2();
  }

  return { ok: true, ...result, leadsCreated };
}

async function _importLeads(db, tenantId, advisor, body) {
  const { content, filename, mapping = {}, options = {} } = body;
  const customers = require('../customers/service');
  const expedients = require('../expedients/service');

  const { headers, rows } = svc.parseFile({ filename: filename || 'data.csv', content });

  const pipelineId = Number(options.pipelineId);
  const stageId = Number(options.stageId);
  if (!pipelineId || !stageId) {
    throw new Error('pipelineId y stageId son requeridos');
  }

  let created = 0, skipped = 0, errors = 0;
  const contactStrategy = options.contactStrategy || 'phone'; // phone | email | name | always_new

  const txn = db.transaction(() => {
    for (const row of rows) {
      try {
        const obj = {};
        headers.forEach((h, i) => {
          const dest = mapping[h];
          if (dest) obj[dest] = row[i];
        });

        // Resolver/crear contacto
        let contactId = null;
        if (contactStrategy === 'phone' && obj.contactPhone) {
          const phone = customers.normalizePhone(obj.contactPhone);
          if (phone) {
            const existing = db.prepare('SELECT id FROM contacts WHERE phone = ? AND tenant_id = ?')
              .get(phone, tenantId);
            if (existing) contactId = existing.id;
          }
        }
        if (!contactId && obj.contactPhone) {
          const created = customers.create(db, tenantId, {
            firstName: obj.contactName || '(Sin nombre)',
            lastName: '',
            phone: obj.contactPhone,
            email: obj.contactEmail || null,
            tags: ['Importado'],
          });
          contactId = created.id;
        }

        if (!contactId) { skipped++; continue; }

        expedients.create(db, tenantId, {
          contactId,
          pipelineId,
          stageId,
          name: obj.name || null,
          value: Number(obj.value) || 0,
        });
        created++;
      } catch (e) {
        errors++;
        console.warn('[data-center] lead import row error:', e.message);
      }
    }
  });
  txn();

  return { ok: true, created, skipped, errors };
}

// ─── Importers: templates ─────────────────────────────────────────────

async function _importTemplates(db, tenantId, body) {
  const { content, filename, mapping = {}, options = {} } = body;
  const conflictPolicy = options.conflictPolicy || 'skip'; // skip | overwrite | rename

  // Soporta JSON (export nativo de wapi) o CSV (mapeo de columnas)
  const isJSON = (filename || '').toLowerCase().endsWith('.json');
  let items = [];

  if (isJSON) {
    const arr = JSON.parse(content);
    items = (Array.isArray(arr) ? arr : (arr.items || [])).map(t => ({
      name: t.name, type: t.type || 'text', body: t.body || '',
      wa_status: t.wa_status || 'pending', header: t.header || null,
      footer: t.footer || null, buttons: t.buttons || null,
    }));
  } else {
    const { headers, rows } = svc.parseFile({ filename, content });
    items = rows.map(row => {
      const o = {};
      headers.forEach((h, i) => { if (mapping[h]) o[mapping[h]] = row[i]; });
      return { name: o.name, type: o.type || 'text', body: o.body || '', wa_status: o.wa_status || 'pending' };
    });
  }

  const result = { created: 0, skipped: 0, renamed: 0, errors: 0 };
  const txn = db.transaction(() => {
    for (const t of items) {
      if (!t.name?.trim() || !t.body?.trim()) { result.errors++; continue; }
      const existing = db.prepare('SELECT id FROM message_templates WHERE name = ? AND tenant_id = ?').get(t.name, tenantId);
      let name = t.name;
      if (existing) {
        if (conflictPolicy === 'skip') { result.skipped++; continue; }
        if (conflictPolicy === 'overwrite') {
          db.prepare('UPDATE message_templates SET body=?, type=?, wa_status=?, updated_at=unixepoch() WHERE id=?')
            .run(t.body, t.type, t.wa_status, existing.id);
          result.created++; // counts as success
          continue;
        }
        if (conflictPolicy === 'rename') {
          name = `${t.name} (Importada)`;
          let n = 2;
          while (db.prepare('SELECT 1 FROM message_templates WHERE name=? AND tenant_id=?').get(name, tenantId)) {
            name = `${t.name} (Importada ${n++})`;
          }
          result.renamed++;
        }
      }
      db.prepare(`INSERT INTO message_templates (tenant_id, name, type, body, wa_status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run(tenantId, name, t.type, t.body, t.wa_status);
      result.created++;
    }
  });
  txn();
  return { ok: true, ...result };
}

// ─── Importers: tags ─────────────────────────────────────────────────

async function _importTags(db, tenantId, body) {
  const { content, filename } = body;
  const isJSON = (filename || '').toLowerCase().endsWith('.json');
  let items = [];

  if (isJSON) {
    const arr = JSON.parse(content);
    items = (Array.isArray(arr) ? arr : (arr.items || []));
  } else {
    const { headers, rows } = svc.parseFile({ filename, content });
    const nameIdx = headers.findIndex(h => /^(nombre|name|tag|etiqueta)$/i.test(h));
    const colorIdx = headers.findIndex(h => /^(color|hex)$/i.test(h));
    items = rows.map(r => ({
      name: r[nameIdx]?.trim(),
      color: r[colorIdx]?.trim() || '#94a3b8',
    })).filter(t => t.name);
  }

  // Solo importamos a bot_tags (la tabla más estructurada). contact_tags
  // se llenan implícitamente cuando se usan.
  const result = { created: 0, skipped: 0 };
  const txn = db.transaction(() => {
    for (const t of items) {
      const existing = db.prepare('SELECT id FROM bot_tags WHERE name=? AND tenant_id=?').get(t.name, tenantId);
      if (existing) { result.skipped++; continue; }
      db.prepare('INSERT INTO bot_tags (tenant_id, name, color, created_at) VALUES (?, ?, ?, unixepoch())')
        .run(tenantId, t.name, t.color || '#94a3b8');
      result.created++;
    }
  });
  txn();
  return { ok: true, ...result };
}

// ─── Importers: pipelines ────────────────────────────────────────────

async function _importPipelines(db, tenantId, body) {
  const { content, options = {} } = body;
  const data = JSON.parse(content);
  const pipelines = Array.isArray(data) ? data : (data.pipelines || data.items || []);
  if (!pipelines.length) throw new Error('No se encontraron pipelines en el JSON');

  const result = { pipelinesCreated: 0, stagesCreated: 0, skipped: 0 };
  const skipDuplicates = options.skipDuplicates !== false;

  const txn = db.transaction(() => {
    for (const p of pipelines) {
      if (!p.name?.trim()) continue;
      if (skipDuplicates) {
        const existing = db.prepare('SELECT id FROM pipelines WHERE name=? AND tenant_id=?').get(p.name, tenantId);
        if (existing) { result.skipped++; continue; }
      }
      const ins = db.prepare(`INSERT INTO pipelines (tenant_id, name, color, icon, sort_order, created_at)
                              VALUES (?, ?, ?, ?, ?, unixepoch())`);
      const r = ins.run(tenantId, p.name, p.color || '#2563eb', p.icon || null, p.sort_order ?? 99);
      const pid = r.lastInsertRowid;
      result.pipelinesCreated++;

      const stages = Array.isArray(p.stages) ? p.stages : [];
      for (const s of stages) {
        if (!s.name?.trim()) continue;
        db.prepare(`INSERT INTO stages (tenant_id, pipeline_id, name, color, sort_order, kind, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, unixepoch())`)
          .run(tenantId, pid, s.name, s.color || '#94a3b8', s.sort_order ?? 10, s.kind || 'in_progress');
        result.stagesCreated++;
      }
    }
  });
  txn();
  return { ok: true, ...result };
}

// ─── Importers: bots ─────────────────────────────────────────────────

async function _importBots(db, tenantId, body) {
  const { content, options = {} } = body;
  const data = JSON.parse(content);
  const bots = Array.isArray(data) ? data : (data.bots || data.items || []);
  if (!bots.length) throw new Error('No se encontraron bots en el JSON');

  // Política: skip si existe nombre igual, o renombrar
  const conflictPolicy = options.conflictPolicy || 'skip';
  const result = { created: 0, skipped: 0, renamed: 0 };

  const txn = db.transaction(() => {
    for (const b of bots) {
      if (!b.name?.trim()) continue;
      const existing = db.prepare('SELECT id FROM salsbots WHERE name=? AND tenant_id=?').get(b.name, tenantId);
      let name = b.name;
      if (existing) {
        if (conflictPolicy === 'skip') { result.skipped++; continue; }
        name = `${b.name} (Importado)`;
        let n = 2;
        while (db.prepare('SELECT 1 FROM salsbots WHERE name=? AND tenant_id=?').get(name, tenantId)) {
          name = `${b.name} (Importado ${n++})`;
        }
        result.renamed++;
      }
      // ATENCIÓN: trigger_value puede apuntar a un stage_id que no existe en
      // este tenant. Lo importamos tal cual pero el validador lo marcará
      // como 'missing_trigger_stage'. El user puede arreglarlo después.
      db.prepare(`INSERT INTO salsbots (tenant_id, name, enabled, trigger_type, trigger_value, steps, created_at, updated_at)
                  VALUES (?, ?, 0, ?, ?, ?, unixepoch(), unixepoch())`)
        .run(tenantId, name, b.trigger_type || 'keyword',
             b.trigger_value || '', JSON.stringify(b.steps || []));
      result.created++;
    }
  });
  txn();
  return { ok: true, ...result };
}

// ─── Importers: chats (Modo A histórico + Modo C knowledge IA) ──────

async function _importChats(db, tenantId, body) {
  const { content, filename, options = {} } = body;
  const mode = options.mode || 'both'; // 'history' | 'knowledge' | 'both'
  const source = options.source || 'import';
  const contactStrategy = options.contactStrategy || 'phone';

  // Parser: aceptamos JSON nativo (más común) y CSV con columnas mapeadas.
  // Estructura JSON esperada:
  //   { conversations: [
  //       { external_id, contact_phone, contact_name, messages: [
  //           { direction: 'incoming'|'outgoing', body, created_at (unix), media_url? }
  //       ]}
  //   ]}
  // O array directo de conversations.
  const isJSON = (filename || '').toLowerCase().endsWith('.json');
  let conversations = [];

  if (isJSON) {
    const data = JSON.parse(content);
    conversations = Array.isArray(data) ? data
                  : Array.isArray(data.conversations) ? data.conversations
                  : Array.isArray(data.items) ? data.items
                  : [];
  } else {
    // CSV plano agrupado por contact_phone
    const { headers, rows } = svc.parseFile({ filename, content });
    const phoneIdx = headers.findIndex(h => /phone|tel|telefono|celular/i.test(h));
    const nameIdx = headers.findIndex(h => /name|nombre|contacto/i.test(h));
    const dirIdx = headers.findIndex(h => /direction|direccion|sender|tipo/i.test(h));
    const bodyIdx = headers.findIndex(h => /body|message|mensaje|texto|content/i.test(h));
    const timeIdx = headers.findIndex(h => /time|date|fecha|created_at|timestamp/i.test(h));
    if (phoneIdx === -1 || bodyIdx === -1) {
      throw new Error('CSV debe tener al menos columnas de teléfono y mensaje');
    }
    const byPhone = new Map();
    for (const row of rows) {
      const phone = (row[phoneIdx] || '').toString().trim();
      if (!phone) continue;
      if (!byPhone.has(phone)) {
        byPhone.set(phone, {
          contact_phone: phone,
          contact_name: nameIdx !== -1 ? row[nameIdx] : null,
          messages: [],
        });
      }
      const dirRaw = dirIdx !== -1 ? String(row[dirIdx] || '').toLowerCase() : 'incoming';
      const direction = /out|sale|saliente|agent|sent/i.test(dirRaw) ? 'outgoing' : 'incoming';
      const ts = timeIdx !== -1 ? _parseTimestamp(row[timeIdx]) : Math.floor(Date.now() / 1000);
      byPhone.get(phone).messages.push({
        direction, body: row[bodyIdx] || '', created_at: ts,
      });
    }
    conversations = Array.from(byPhone.values());
  }

  // Resolver contactos (estrategia por phone o email)
  const customers = require('../customers/service');
  const result = {
    conversationsProcessed: 0,
    messagesImported: 0,
    chunksCreated: 0,
    contactsCreated: 0,
    skipped: 0,
  };

  const txn = db.transaction(() => {
    for (const conv of conversations) {
      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      if (messages.length === 0) { result.skipped++; continue; }

      // Encontrar o crear el contacto
      let contactId = null;
      if (contactStrategy === 'phone' && conv.contact_phone) {
        const phone = customers.normalizePhone(conv.contact_phone);
        if (phone) {
          const existing = db.prepare('SELECT id FROM contacts WHERE phone=? AND tenant_id=?').get(phone, tenantId);
          if (existing) contactId = existing.id;
          else if (options.createMissingContacts !== false) {
            const created = customers.create(db, tenantId, {
              firstName: conv.contact_name || phone, lastName: '',
              phone, email: null, tags: ['Importado de chat'],
            });
            contactId = created.id;
            result.contactsCreated++;
          }
        }
      }

      // Encontrar o crear la conversación (solo Modo A — para Modo C puro no necesitamos convo)
      let conversationId = null;
      if (mode !== 'knowledge' && contactId) {
        // Usar la convo más reciente del contacto si existe, o crear una nueva
        const existingConvo = db.prepare(`
          SELECT id, integration_id FROM conversations
          WHERE contact_id=? AND tenant_id=? ORDER BY last_message_at DESC LIMIT 1
        `).get(contactId, tenantId);
        if (existingConvo) {
          conversationId = existingConvo.id;
        } else {
          // Crear conversación virtual (sin integration_id real, marcada como imported)
          const r = db.prepare(`
            INSERT INTO conversations (tenant_id, contact_id, provider, external_id, last_message_at, created_at)
            VALUES (?, ?, 'imported', ?, ?, ?)
          `).run(tenantId, contactId,
                 conv.external_id || `imp-${Date.now()}-${contactId}`,
                 messages[messages.length - 1]?.created_at || Math.floor(Date.now()/1000),
                 Math.floor(Date.now()/1000));
          conversationId = r.lastInsertRowid;
        }
      }

      result.conversationsProcessed++;

      // ─── Modo A: insertar mensajes a tabla messages ─────────────────
      if ((mode === 'history' || mode === 'both') && conversationId) {
        const ins = db.prepare(`
          INSERT INTO messages (
            tenant_id, conversation_id, direction, provider, body,
            status, created_at, imported_from, imported_at, external_id
          ) VALUES (?, ?, ?, 'imported', ?, 'sent', ?, ?, unixepoch(), ?)
          ON CONFLICT(provider, external_id) DO NOTHING
        `);
        let idx = 0;
        for (const m of messages) {
          if (!m.body || !m.body.trim()) continue;
          try {
            ins.run(
              tenantId, conversationId, m.direction || 'incoming',
              m.body.slice(0, 4000),
              m.created_at || Math.floor(Date.now()/1000),
              source,
              m.external_id || `${source}-${conv.external_id || contactId}-${idx++}`,
            );
            result.messagesImported++;
          } catch (e) {
            // ignorar duplicados / errores de constraint
          }
        }
      }

      // ─── Modo C: generar chunks Q+A para el copiloto ────────────────
      if (mode === 'knowledge' || mode === 'both') {
        // Recorrer mensajes secuencialmente buscando pares incoming→outgoing
        const chunkIns = db.prepare(`
          INSERT OR IGNORE INTO ai_chat_chunks (
            tenant_id, source, source_chat_id, contact_id, contact_phone, contact_name,
            customer_message, agent_response, context_before,
            created_at_original
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < messages.length - 1; i++) {
          const cur = messages[i], next = messages[i + 1];
          if (cur.direction !== 'incoming' || next.direction !== 'outgoing') continue;
          if (!cur.body?.trim() || !next.body?.trim()) continue;
          if (cur.body.length < 3 || next.body.length < 3) continue; // muy cortos para entrenar

          // Contexto: 2 mensajes anteriores al cur
          const ctxBefore = messages.slice(Math.max(0, i - 2), i)
            .map(m => ({ direction: m.direction, body: m.body }));

          try {
            chunkIns.run(
              tenantId, source,
              conv.external_id || `${source}-${contactId}`,
              contactId, conv.contact_phone || null, conv.contact_name || null,
              cur.body.slice(0, 1000), next.body.slice(0, 2000),
              JSON.stringify(ctxBefore),
              cur.created_at || Math.floor(Date.now()/1000)
            );
            result.chunksCreated++;
          } catch (e) {
            // skip duplicates
          }
        }
      }
    }
  });
  txn();
  return { ok: true, ...result };
}

function _parseTimestamp(raw) {
  if (!raw) return Math.floor(Date.now() / 1000);
  if (/^\d+$/.test(String(raw))) {
    const n = Number(raw);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const d = new Date(raw);
  return isNaN(d) ? Math.floor(Date.now() / 1000) : Math.floor(d.getTime() / 1000);
}

// ─── Exporters ────────────────────────────────────────────────────────

function _exportEntity(db, tenantId, entity, format, query, res) {
  let rows, filename;
  switch (entity) {
    case 'contacts':
      rows = db.prepare(`
        SELECT id, first_name AS firstName, last_name AS lastName, phone, email,
               datetime(created_at,'unixepoch') AS created_at,
               datetime(updated_at,'unixepoch') AS updated_at
        FROM contacts WHERE tenant_id = ? ORDER BY id
      `).all(tenantId);
      filename = `contactos-${Date.now()}`;
      break;
    case 'leads':
      rows = db.prepare(`
        SELECT e.id, e.name, e.value, p.name AS pipeline, s.name AS stage,
               c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
               c.phone AS contact_phone,
               datetime(e.created_at,'unixepoch') AS created_at,
               datetime(e.updated_at,'unixepoch') AS updated_at
        FROM expedients e
        JOIN pipelines p ON p.id = e.pipeline_id
        JOIN stages s ON s.id = e.stage_id
        JOIN contacts c ON c.id = e.contact_id
        WHERE e.tenant_id = ? ORDER BY e.id
      `).all(tenantId);
      filename = `leads-${Date.now()}`;
      break;
    case 'templates':
      rows = db.prepare(`
        SELECT id, name, type, wa_status, body
        FROM message_templates WHERE tenant_id = ? ORDER BY id
      `).all(tenantId);
      filename = `plantillas-${Date.now()}`;
      break;
    case 'pipelines':
      // Pipelines + stages como JSON anidado (CSV sería plano y feo)
      const pipes = db.prepare(`SELECT id, name, sort_order, color, icon FROM pipelines WHERE tenant_id = ? ORDER BY sort_order`).all(tenantId);
      for (const p of pipes) {
        p.stages = db.prepare(`SELECT id, name, sort_order, color, kind FROM stages WHERE pipeline_id = ? AND tenant_id = ? ORDER BY sort_order`).all(p.id, tenantId);
      }
      rows = pipes;
      filename = `pipelines-${Date.now()}`;
      break;
    default:
      return res.status(400).json({ error: `Export de "${entity}" no soportado todavía` });
  }

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.end(JSON.stringify(rows, null, 2));
  }
  // CSV (default)
  if (!rows.length) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.end('');
  }
  // Para pipelines (que es anidado) caemos a JSON aunque pidan CSV
  if (entity === 'pipelines') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.end(JSON.stringify(rows, null, 2));
  }

  const headers = Object.keys(rows[0]);
  const csvRows = [headers.join(',')];
  for (const r of rows) {
    csvRows.push(headers.map(h => _csvCell(r[h])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.end('﻿' + csvRows.join('\n'));
}

function _csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
