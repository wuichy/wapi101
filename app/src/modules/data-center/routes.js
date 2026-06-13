// Data Center — endpoints REST
//
// GET    /api/data-center/available    — qué cards mostrar para este tenant
// POST   /api/data-center/analyze      — analiza archivo, devuelve {format, headers, mapping, conflicts}
// POST   /api/data-center/preview      — aplica mapeo y muestra primeros N como quedarían
// POST   /api/data-center/import       — ejecuta el import (puede ser background si grande)
// GET    /api/data-center/export/:entity — genera export (CSV/JSON/XLSX según query ?format=)

const express = require('express');
const svc = require('./service');
const { checkLimit } = require('../billing/limits');

module.exports = (db) => {
  const router = express.Router();

  // ─── Gate de ADMIN ────────────────────────────────────────────────
  // El Data Center importa/exporta TODA la base (contactos, leads, asesores,
  // bots, config). Es una operación de administrador, no de asesor, y NUNCA
  // de un token de máquina. Sin esto, un asesor o un OAuth token podía
  // importar asesores con rol arbitrario (escalación de privilegios).
  router.use((req, res, next) => {
    if (req.appAuth) return res.status(403).json({ error: 'Los tokens de app no pueden usar el Data Center' });
    if (req.advisor?._viaMachineToken) return res.status(403).json({ error: 'Los tokens de máquina no pueden usar el Data Center' });
    if (req.advisor?.role !== 'admin') return res.status(403).json({ error: 'Solo administradores pueden importar/exportar datos' });
    next();
  });

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
        case 'contacts':      return res.json(await _importContacts(db, req.tenantId, req.advisor, req.body));
        case 'leads':         return res.json(await _importLeads(db, req.tenantId, req.advisor, req.body));
        case 'templates':     return res.json(await _importTemplates(db, req.tenantId, req.body));
        case 'tags':          return res.json(await _importTags(db, req.tenantId, req.body));
        case 'pipelines':     return res.json(await _importPipelines(db, req.tenantId, req.body));
        case 'bots':          return res.json(await _importBots(db, req.tenantId, req.body));
        case 'chats':         return res.json(await _importChats(db, req.tenantId, req.body));
        case 'advisors':      return res.json(await _importAdvisors(db, req.tenantId, req.body));
        case 'business_hours':return res.json(await _importBusinessHours(db, req.tenantId, req.body));
        case 'appointments':  return res.json(await _importAppointments(db, req.tenantId, req.body));
        case 'tasks':         return res.json(await _importTasks(db, req.tenantId, req.body));
        case 'custom_fields': return res.json(await _importCustomFields(db, req.tenantId, req.body));
        case 'webhooks':      return res.json(await _importWebhooks(db, req.tenantId, req.body));
        case 'reports':       return res.json(await _importReports(db, req.tenantId, req.body));
        case 'woo_config':    return res.json(await _importWooConfig(db, req.tenantId, req.body));
        case 'ai_knowledge':  return res.json(await _importAiKnowledge(db, req.tenantId, req.body));
        case 'comments':      return res.json(await _importSocialComments(db, req.tenantId, req.body));
        default:
          return res.status(501).json({ error: `Import de "${entity}" pendiente de implementar` });
      }
    } catch (e) {
      console.error('[data-center] import error:', e);
      res.status(400).json({ error: e.message });
    }
  });

  // GET /export/relations — lista de relaciones disponibles por entidad
  router.get('/export/relations', (req, res) => {
    res.json(getAvailableRelations());
  });

  // GET /export/:entity — descarga
  // Acepta:
  //   ?format=csv|json|zip
  //   ?include=leads,appointments,...  (relations separadas por coma)
  router.get('/export/:entity', (req, res) => {
    try {
      const entity = req.params.entity;
      const format = String(req.query.format || 'csv').toLowerCase();
      const include = String(req.query.include || '').split(',').map(s => s.trim()).filter(Boolean);

      if (include.length > 0) {
        return _exportWithRelations(db, req.tenantId, entity, format, include, req.query, res);
      }
      _exportEntity(db, req.tenantId, entity, format, req.query, res);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // GET /backup/full — Backup completo del tenant en un JSON gigante
  // Incluye todas las entidades exportables. NO incluye media ni mensajes
  // (los mensajes pueden agregarse con ?includeMessages=1).
  router.get('/backup/full', (req, res) => {
    try {
      const includeMessages = req.query.includeMessages === '1';
      const backup = _buildFullBackup(db, req.tenantId, { includeMessages });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="wapi101-backup-${req.tenant.slug || req.tenantId}-${Date.now()}.json"`);
      res.end(JSON.stringify(backup, null, 2));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};

// ─── Backup completo ──────────────────────────────────────────────────

function _buildFullBackup(db, tenantId, { includeMessages = false } = {}) {
  const q = (sql, ...args) => { try { return db.prepare(sql).all(tenantId, ...args); } catch { return []; } };
  const qOne = (sql, ...args) => { try { return db.prepare(sql).get(tenantId, ...args); } catch { return null; } };

  // Pipelines + stages
  const pipelines = q('SELECT id, name, sort_order, color, icon FROM pipelines WHERE tenant_id=? ORDER BY sort_order');
  for (const p of pipelines) {
    p.stages = q('SELECT id, name, sort_order, color, kind FROM stages WHERE pipeline_id=? AND tenant_id=? ORDER BY sort_order', p.id);
  }

  // Bots con steps parseados
  const bots = q('SELECT id, name, enabled, trigger_type, trigger_value, steps, sort_order FROM salsbots WHERE tenant_id=?')
    .map(b => ({ ...b, steps: (() => { try { return JSON.parse(b.steps); } catch { return []; } })() }));

  // Custom fields
  const customFields = q('SELECT id, entity, label, field_type, options, sort_order FROM custom_field_defs WHERE tenant_id=?')
    .map(f => ({ ...f, options: f.options ? (() => { try { return JSON.parse(f.options); } catch { return null; } })() : null }));

  const out = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    tenant: qOne('SELECT id, slug, display_name, plan, status FROM tenants WHERE id=?'),
    counts: {},
    data: {
      contacts:       q('SELECT id, first_name, last_name, phone, email, datetime(created_at,"unixepoch") AS created_at FROM contacts WHERE tenant_id=?'),
      leads:          q('SELECT e.id, e.name, e.value, e.pipeline_id, e.stage_id, e.contact_id, datetime(e.created_at,"unixepoch") AS created_at FROM expedients e WHERE e.tenant_id=?'),
      pipelines,
      bots,
      templates:      q('SELECT id, name, type, wa_status, body FROM message_templates WHERE tenant_id=?'),
      tags:           q('SELECT id, name, color FROM bot_tags WHERE tenant_id=?'),
      advisors:       q('SELECT id, name, username, email, role, active FROM advisors WHERE tenant_id=?'),
      business_hours: q('SELECT day_of_week, opens_at, closes_at, is_open FROM business_hours WHERE tenant_id=?'),
      appointments:   q('SELECT id, contact_id, starts_at, duration_min, status, notes FROM appointments WHERE tenant_id=?'),
      tasks:          q('SELECT id, title, description, due_at, completed FROM tasks WHERE tenant_id=?'),
      custom_fields:  customFields,
      webhooks:       q('SELECT id, name, url, events, active FROM outgoing_webhooks WHERE tenant_id=?'),
      reports:        q('SELECT id, name, config, datetime(created_at,"unixepoch") AS created_at FROM reports WHERE tenant_id=?'),
      ai_knowledge:   q('SELECT id, title, content, source_type FROM ai_knowledge_sources WHERE tenant_id=?'),
      products:       q('SELECT id, retailer_id, name, description, price_amount, price_currency, image_url, availability FROM whatsapp_products WHERE tenant_id=? AND is_active=1'),
      orders:         q('SELECT id, woo_id, status, total, currency, customer_phone FROM woo_orders WHERE tenant_id=? ORDER BY id DESC LIMIT 10000'),
    },
  };

  for (const k of Object.keys(out.data)) {
    out.counts[k] = (out.data[k] || []).length;
  }

  if (includeMessages) {
    // CUIDADO: puede pesar mucho. Solo metadata + body (sin media URLs descargadas)
    out.data.conversations = q(`SELECT id, contact_id, provider, external_id, last_message_at FROM conversations WHERE tenant_id=? ORDER BY last_message_at DESC LIMIT 10000`);
    out.data.messages      = q(`SELECT id, conversation_id, direction, body, status, created_at, imported_from FROM messages WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100000`);
    out.counts.conversations = out.data.conversations.length;
    out.counts.messages = out.data.messages.length;
  }

  return out;
}

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
  const result = { created: 0, updated: 0, skipped: 0, errors: 0, skippedByLimit: 0 };
  const newContactIds = [];
  const allTargetIds = []; // tanto creados como actualizados (para crear leads en ambos casos si user pidió)

  // Límite de plan: el import NO puede saltarse el cap de contactos. Se calcula
  // el cupo una sola vez (eficiente para imports grandes) y se frena al llegar.
  const { getLimits } = require('../billing/limits');
  const _tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(tenantId) || {};
  const _contactCap = getLimits(_tenant.plan).contacts; // null = ilimitado
  const _contactBase = _contactCap === null ? 0 : (db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?').get(tenantId)?.n || 0);

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

        // Tope de plan alcanzado → no crear más (cuenta como skippedByLimit)
        if (_contactCap !== null && (_contactBase + result.created) >= _contactCap) {
          result.skippedByLimit++;
          continue;
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

  let created = 0, skipped = 0, errors = 0, skippedByLimit = 0;
  const contactStrategy = options.contactStrategy || 'phone'; // phone | email | name | always_new

  // Tope de plan (leads) — calculado una vez, frena el import al llegar.
  const { getLimits: _getLimits } = require('../billing/limits');
  const _tnt = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(tenantId) || {};
  const _leadCap = _getLimits(_tnt.plan).leads; // null = ilimitado
  const _leadBase = _leadCap === null ? 0 : (db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE tenant_id = ?').get(tenantId)?.n || 0);

  const txn = db.transaction(() => {
    for (const row of rows) {
      try {
        if (_leadCap !== null && (_leadBase + created) >= _leadCap) { skippedByLimit++; continue; }
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

  return { ok: true, created, skipped, errors, skippedByLimit };
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

// ─── Importers: equipo (advisors, business_hours, appointments, tasks) ──

async function _importAdvisors(db, tenantId, body) {
  const { content, options = {} } = body;
  const crypto = require('crypto');
  const advisorsSvc = require('../advisors/service');
  const arr = JSON.parse(content);
  const items = Array.isArray(arr) ? arr : (arr.advisors || arr.items || []);
  const sendInvites = options.sendInvites !== false;
  const tenant = db.prepare('SELECT plan, extra_users FROM tenants WHERE id = ?').get(tenantId) || {};

  const result = { created: 0, skipped: 0, invitesSent: 0, errors: 0, skippedByLimit: 0 };
  for (const a of items) {
    if (!a.username || !a.email) { result.skipped++; continue; }
    try {
      const existing = db.prepare('SELECT id FROM advisors WHERE (username=? OR email=?) AND tenant_id=?')
        .get(a.username, a.email, tenantId);
      if (existing) { result.skipped++; continue; }
      // Límite de plan: NO permitir saltarse el cap de usuarios vía import.
      const limitErr = checkLimit(db, tenantId, tenant.plan, 'users', tenant.extra_users);
      if (limitErr) { result.skippedByLimit++; continue; }
      // Crear vía el servicio canónico: hash correcto (salt:hash por usuario) y
      // rol FORZADO a 'asesor' — nunca confiar en a.role del archivo importado
      // (evita que un import cree un admin). Password temporal aleatorio.
      const tempPass = crypto.randomBytes(24).toString('hex');
      const created = advisorsSvc.create(db, tenantId, {
        name: a.name || a.username, username: a.username, email: a.email,
        password: tempPass, role: 'asesor',
        permissions: { write: true, delete: false, view_reports: false, manage_advisors: false },
      });
      result.created++;
      if (sendInvites && created?.id) {
        try {
          // password_reset_tokens real: (advisor_id, tenant_id, token_hash, expires_at)
          const token = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          db.prepare('INSERT INTO password_reset_tokens (advisor_id, tenant_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, unixepoch())')
            .run(created.id, tenantId, tokenHash, Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
          // Mailer puede no estar configurado — intentar suave
          try {
            const mailer = require('../mailer');
            if (mailer && mailer.send) {
              await mailer.send({
                to: a.email,
                subject: 'Te invitaron a Wapi101',
                text: `Te dieron acceso a Wapi101. Crea tu contraseña aquí:\nhttps://wapi101.com/reset-password?token=${token}`,
              });
              result.invitesSent++;
            }
          } catch (_) { /* mailer opcional */ }
        } catch (e) { console.warn('[dc] invite error:', e.message); }
      }
    } catch (e) {
      result.errors++;
      console.warn('[dc] advisor import:', e.message);
    }
  }
  return { ok: true, ...result };
}

async function _importBusinessHours(db, tenantId, body) {
  const { content } = body;
  const data = JSON.parse(content);
  const hours = Array.isArray(data) ? data : (data.hours || data.items || []);
  let inserted = 0;
  const txn = db.transaction(() => {
    // Limpiamos las del tenant (solo hay business_hours por tenant, no por user)
    db.prepare('DELETE FROM business_hours WHERE tenant_id=?').run(tenantId);
    const ins = db.prepare(`INSERT INTO business_hours (tenant_id, day_of_week, opens_at, closes_at, is_open)
                            VALUES (?, ?, ?, ?, ?)`);
    for (const h of hours) {
      if (h.day_of_week == null) continue;
      ins.run(tenantId, h.day_of_week, h.opens_at || '09:00', h.closes_at || '18:00', h.is_open != null ? (h.is_open ? 1 : 0) : 1);
      inserted++;
    }
  });
  try { txn(); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, inserted };
}

async function _importAppointments(db, tenantId, body) {
  const { content, filename } = body;
  const isJSON = (filename || '').toLowerCase().endsWith('.json');
  let items = [];
  if (isJSON) {
    const data = JSON.parse(content);
    items = Array.isArray(data) ? data : (data.appointments || data.items || []);
  } else {
    const { headers, rows } = svc.parseFile({ filename, content });
    items = rows.map(row => {
      const o = {};
      headers.forEach((h, i) => {
        const key = h.toLowerCase();
        if (/phone|tel/.test(key)) o.contact_phone = row[i];
        else if (/name|nombre/.test(key)) o.contact_name = row[i];
        else if (/start|fecha/.test(key)) o.starts_at = _parseTimestamp(row[i]);
        else if (/dur/.test(key)) o.duration_min = Number(row[i]) || 30;
        else if (/note|nota/.test(key)) o.notes = row[i];
        else if (/status|estado/.test(key)) o.status = row[i];
      });
      return o;
    });
  }
  const customers = require('../customers/service');
  const result = { created: 0, skipped: 0, errors: 0 };
  const txn = db.transaction(() => {
    for (const a of items) {
      if (!a.starts_at) { result.skipped++; continue; }
      let contactId = null;
      if (a.contact_phone) {
        const phone = customers.normalizePhone(a.contact_phone);
        const ex = phone ? db.prepare('SELECT id FROM contacts WHERE phone=? AND tenant_id=?').get(phone, tenantId) : null;
        if (ex) contactId = ex.id;
        else if (phone) {
          const c = customers.create(db, tenantId, { firstName: a.contact_name || phone, lastName: '', phone, email: null, tags: [] });
          contactId = c.id;
        }
      }
      const dur = Number(a.duration_min) || 30;
      const endsAt = a.ends_at || (a.starts_at + dur * 60);
      try {
        db.prepare(`INSERT INTO appointments
          (tenant_id, contact_id, starts_at, ends_at, duration_min, status, notes, created_via, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'import', unixepoch())`)
          .run(tenantId, contactId, a.starts_at, endsAt, dur, a.status || 'scheduled', a.notes || null);
        result.created++;
      } catch (e) { result.errors++; }
    }
  });
  txn();
  return { ok: true, ...result };
}

async function _importTasks(db, tenantId, body) {
  const { content, filename } = body;
  const isJSON = (filename || '').toLowerCase().endsWith('.json');
  let items = [];
  if (isJSON) {
    const data = JSON.parse(content);
    items = Array.isArray(data) ? data : (data.tasks || data.items || []);
  } else {
    const { headers, rows } = svc.parseFile({ filename, content });
    items = rows.map(row => {
      const o = {};
      headers.forEach((h, i) => {
        const key = h.toLowerCase();
        if (/title|titulo|task|tarea/.test(key)) o.title = row[i];
        else if (/desc/.test(key)) o.description = row[i];
        else if (/due|vencimiento|fecha/.test(key)) o.due_at = _parseTimestamp(row[i]);
        else if (/complet/.test(key)) o.completed = /si|yes|1|true/i.test(row[i]) ? 1 : 0;
      });
      return o;
    });
  }
  const result = { created: 0, skipped: 0 };
  const txn = db.transaction(() => {
    for (const t of items) {
      if (!t.title || !t.due_at) { result.skipped++; continue; }
      db.prepare(`INSERT INTO tasks (tenant_id, title, description, due_at, completed, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run(tenantId, t.title, t.description || null, t.due_at, t.completed ? 1 : 0);
      result.created++;
    }
  });
  txn();
  return { ok: true, ...result };
}

// ─── Importers: configuración estructural ────────────────────────────

async function _importCustomFields(db, tenantId, body) {
  const data = JSON.parse(body.content);
  const items = Array.isArray(data) ? data : (data.fields || data.items || []);
  const result = { created: 0, skipped: 0 };
  const txn = db.transaction(() => {
    for (const f of items) {
      if (!f.label?.trim()) { result.skipped++; continue; }
      const existing = db.prepare('SELECT id FROM custom_field_defs WHERE label=? AND entity=? AND tenant_id=?')
        .get(f.label, f.entity || 'expedient', tenantId);
      if (existing) { result.skipped++; continue; }
      db.prepare(`INSERT INTO custom_field_defs (tenant_id, entity, label, field_type, options, sort_order, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, unixepoch())`)
        .run(tenantId, f.entity || 'expedient', f.label, f.field_type || 'text',
             f.options ? JSON.stringify(f.options) : null, f.sort_order || 0);
      result.created++;
    }
  });
  txn();
  return { ok: true, ...result };
}

async function _importWebhooks(db, tenantId, body) {
  const data = JSON.parse(body.content);
  const items = Array.isArray(data) ? data : (data.webhooks || data.items || []);
  const result = { created: 0, skipped: 0 };
  for (const w of items) {
    if (!w.url) { result.skipped++; continue; }
    try {
      db.prepare(`INSERT INTO outgoing_webhooks (tenant_id, name, url, events, active, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run(tenantId, w.name || 'Webhook', w.url,
             JSON.stringify(w.events || ['message.received']), w.active !== false ? 1 : 0);
      result.created++;
    } catch (e) { result.skipped++; }
  }
  return { ok: true, ...result };
}

async function _importReports(db, tenantId, body) {
  const data = JSON.parse(body.content);
  const items = Array.isArray(data) ? data : (data.reports || data.items || []);
  let created = 0;
  for (const r of items) {
    if (!r.name) continue;
    try {
      db.prepare(`INSERT INTO reports (tenant_id, name, config, created_at)
                  VALUES (?, ?, ?, unixepoch())`)
        .run(tenantId, r.name, JSON.stringify(r.config || {}));
      created++;
    } catch (_) {}
  }
  return { ok: true, created };
}

async function _importWooConfig(db, tenantId, body) {
  const data = JSON.parse(body.content);
  try {
    db.prepare(`INSERT INTO woo_config (tenant_id, config_json, updated_at)
                VALUES (?, ?, unixepoch())
                ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json, updated_at=unixepoch()`)
      .run(tenantId, JSON.stringify(data));
  } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true };
}

// ─── Importers: auxiliares (ai_knowledge, comments, email) ───────────

async function _importAiKnowledge(db, tenantId, body) {
  const data = JSON.parse(body.content);
  const items = Array.isArray(data) ? data : (data.sources || data.items || []);
  let created = 0;
  for (const s of items) {
    if (!s.title || !s.content) continue;
    try {
      db.prepare(`INSERT INTO ai_knowledge_sources (tenant_id, title, content, source_type, created_at, updated_at)
                  VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run(tenantId, s.title, s.content, s.source_type || 'text');
      created++;
    } catch (_) {}
  }
  return { ok: true, created };
}

async function _importSocialComments(db, tenantId, body) {
  // Similar a chats Modo A — solo histórico
  const data = JSON.parse(body.content);
  const items = Array.isArray(data) ? data : (data.comments || data.items || []);
  let created = 0;
  for (const c of items) {
    if (!c.body && !c.text) continue;
    try {
      db.prepare(`INSERT OR IGNORE INTO social_comments
        (tenant_id, provider, post_id, comment_id, parent_id, author_name, body, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?)`)
        .run(tenantId, c.provider || 'imported',
             c.post_id || null, c.comment_id || `imp-${Date.now()}-${created}`,
             c.parent_id || null, c.author_name || null,
             c.body || c.text, _parseTimestamp(c.created_at));
      created++;
    } catch (_) {}
  }
  return { ok: true, created };
}

// ─── Relaciones declaradas: qué se puede "incluir" al exportar cada entidad ──
// Cada relación define cómo extraer la data adicional dado un set de IDs base.
// La función recibe (db, tenantId, baseIds) y devuelve filas planas linkeables.
const EXPORT_RELATIONS = {
  contacts: {
    leads: {
      label: 'Sus leads (con pipeline + etapa)',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT e.id, e.contact_id, e.name, e.value,
                 p.name AS pipeline, s.name AS stage,
                 datetime(e.created_at,'unixepoch') AS created_at
          FROM expedients e
          JOIN pipelines p ON p.id = e.pipeline_id
          JOIN stages s ON s.id = e.stage_id
          WHERE e.tenant_id = ? AND e.contact_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    conversations: {
      label: 'Sus conversaciones (metadata)',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, contact_id, provider, external_id,
                 datetime(last_message_at,'unixepoch') AS last_message_at,
                 unread_count, bot_paused
          FROM conversations
          WHERE tenant_id = ? AND contact_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    messages: {
      label: 'Sus mensajes históricos (puede pesar)',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        // JOIN con conversations para sacar contact_id
        return db.prepare(`
          SELECT m.id, c.contact_id, m.conversation_id, m.direction, m.body,
                 datetime(m.created_at,'unixepoch') AS created_at, m.imported_from
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE m.tenant_id = ? AND c.contact_id IN (${ph})
          ORDER BY m.created_at DESC LIMIT 50000
        `).all(tenantId, ...ids);
      },
    },
    appointments: {
      label: 'Sus citas agendadas',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, contact_id, datetime(starts_at,'unixepoch') AS starts_at,
                 duration_min, status, notes
          FROM appointments WHERE tenant_id = ? AND contact_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    tasks: {
      label: 'Sus tareas',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, contact_id, title, description,
                 datetime(due_at,'unixepoch') AS due_at, completed
          FROM tasks WHERE tenant_id = ? AND contact_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    tags: {
      label: 'Sus etiquetas',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT contact_id, tag FROM contact_tags
          WHERE tenant_id = ? AND contact_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    products_sent: {
      label: 'Productos del catálogo enviados',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT s.id, s.contact_id, p.name AS product_name, p.price_amount,
                 datetime(s.sent_at,'unixepoch') AS sent_at, s.sent_via
          FROM whatsapp_product_sends s
          JOIN whatsapp_products p ON p.id = s.product_id
          WHERE s.tenant_id = ? AND s.contact_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
  },

  leads: {
    contact: {
      label: 'Su contacto asociado',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT c.id AS contact_id, c.first_name, c.last_name, c.phone, c.email,
                 e.id AS lead_id
          FROM expedients e JOIN contacts c ON c.id = e.contact_id
          WHERE e.tenant_id = ? AND e.id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    tags: {
      label: 'Sus etiquetas',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT expedient_id AS lead_id, tag FROM expedient_tags
          WHERE tenant_id = ? AND expedient_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    custom_fields: {
      label: 'Custom fields del lead',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT cfv.record_id AS lead_id, cfd.label AS field_label, cfv.value
          FROM custom_field_values cfv
          JOIN custom_field_defs cfd ON cfd.id = cfv.field_id
          WHERE cfv.entity = 'expedient' AND cfv.tenant_id = ? AND cfv.record_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    appointments: {
      label: 'Citas vinculadas al lead',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, expedient_id AS lead_id, datetime(starts_at,'unixepoch') AS starts_at, status
          FROM appointments WHERE tenant_id = ? AND expedient_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
  },

  pipelines: {
    leads: {
      label: 'Leads en cada etapa',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, pipeline_id, stage_id, name, value, contact_id
          FROM expedients WHERE tenant_id = ? AND pipeline_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
  },

  advisors: {
    leads_assigned: {
      label: 'Leads asignados',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, assigned_advisor_id AS advisor_id, name, stage_id, pipeline_id
          FROM expedients WHERE tenant_id = ? AND assigned_advisor_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
    appointments: {
      label: 'Citas que creó / le asignaron',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, advisor_id, datetime(starts_at,'unixepoch') AS starts_at, status
          FROM appointments WHERE tenant_id = ? AND advisor_id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
  },

  appointments: {
    contact: {
      label: 'Contacto de la cita',
      fetch: (db, tenantId, ids) => {
        if (!ids.length) return [];
        const ph = ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT a.id AS appointment_id, c.id AS contact_id, c.first_name, c.last_name, c.phone
          FROM appointments a JOIN contacts c ON c.id = a.contact_id
          WHERE a.tenant_id = ? AND a.id IN (${ph})
        `).all(tenantId, ...ids);
      },
    },
  },
};

// Devuelve la lista de relaciones disponibles para el frontend
function getAvailableRelations() {
  const out = {};
  for (const [ent, rels] of Object.entries(EXPORT_RELATIONS)) {
    out[ent] = Object.entries(rels).map(([key, def]) => ({ key, label: def.label }));
  }
  return out;
}

// ─── Exporters ────────────────────────────────────────────────────────

function _exportEntity(db, tenantId, entity, format, query, res) {
  let rows, filename, isNested = false;
  switch (entity) {
    case 'contacts':
      rows = db.prepare(`SELECT id, first_name AS firstName, last_name AS lastName, phone, email,
        datetime(created_at,'unixepoch') AS created_at FROM contacts WHERE tenant_id=? ORDER BY id`).all(tenantId);
      filename = `contactos-${Date.now()}`;
      break;
    case 'leads':
      rows = db.prepare(`SELECT e.id, e.name, e.value, p.name AS pipeline, s.name AS stage,
        c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name, c.phone AS contact_phone,
        datetime(e.created_at,'unixepoch') AS created_at FROM expedients e
        JOIN pipelines p ON p.id=e.pipeline_id JOIN stages s ON s.id=e.stage_id
        JOIN contacts c ON c.id=e.contact_id WHERE e.tenant_id=? ORDER BY e.id`).all(tenantId);
      filename = `leads-${Date.now()}`;
      break;
    case 'templates':
      rows = db.prepare(`SELECT id, name, type, wa_status, body FROM message_templates WHERE tenant_id=? ORDER BY id`).all(tenantId);
      filename = `plantillas-${Date.now()}`;
      break;
    case 'tags':
      rows = db.prepare(`SELECT id, name, color FROM bot_tags WHERE tenant_id=? ORDER BY name`).all(tenantId);
      filename = `etiquetas-${Date.now()}`;
      break;
    case 'pipelines':
      isNested = true;
      const pipes = db.prepare(`SELECT id, name, sort_order, color, icon FROM pipelines WHERE tenant_id=? ORDER BY sort_order`).all(tenantId);
      for (const p of pipes) {
        p.stages = db.prepare(`SELECT id, name, sort_order, color, kind FROM stages WHERE pipeline_id=? AND tenant_id=? ORDER BY sort_order`).all(p.id, tenantId);
      }
      rows = pipes;
      filename = `pipelines-${Date.now()}`;
      break;
    case 'bots':
      isNested = true;
      rows = db.prepare(`SELECT id, name, enabled, trigger_type, trigger_value, steps, sort_order FROM salsbots WHERE tenant_id=? ORDER BY id`).all(tenantId)
        .map(b => ({ ...b, steps: (() => { try { return JSON.parse(b.steps); } catch { return []; } })() }));
      filename = `bots-${Date.now()}`;
      break;
    case 'chats':
      // Export chats como JSON anidado conversación + mensajes (de los últimos N o todos)
      isNested = true;
      const limit = Math.min(Number(query.limit) || 1000, 10000);
      const convos = db.prepare(`SELECT c.id, c.external_id, c.provider, ct.phone AS contact_phone,
        ct.first_name || ' ' || COALESCE(ct.last_name,'') AS contact_name
        FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
        WHERE c.tenant_id=? ORDER BY c.last_message_at DESC LIMIT ?`).all(tenantId, limit);
      for (const cv of convos) {
        cv.messages = db.prepare(`SELECT direction, body, created_at, provider FROM messages WHERE conversation_id=? AND tenant_id=? ORDER BY created_at`).all(cv.id, tenantId);
      }
      rows = convos;
      filename = `chats-${Date.now()}`;
      break;
    case 'advisors':
      rows = db.prepare(`SELECT id, name, username, email, role, active,
        datetime(created_at,'unixepoch') AS created_at FROM advisors WHERE tenant_id=? ORDER BY id`).all(tenantId);
      filename = `asesores-${Date.now()}`;
      break;
    case 'business_hours':
      rows = db.prepare(`SELECT day_of_week, opens_at, closes_at, is_open FROM business_hours WHERE tenant_id=? ORDER BY day_of_week`).all(tenantId);
      filename = `horarios-${Date.now()}`;
      break;
    case 'appointments':
      rows = db.prepare(`SELECT a.id, c.phone AS contact_phone, c.first_name AS contact_name,
        datetime(a.starts_at,'unixepoch') AS starts_at, a.duration_min, a.status, a.notes
        FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.tenant_id=? ORDER BY a.starts_at DESC`).all(tenantId);
      filename = `citas-${Date.now()}`;
      break;
    case 'tasks':
      rows = db.prepare(`SELECT id, title, description, datetime(due_at,'unixepoch') AS due_at, completed
        FROM tasks WHERE tenant_id=? ORDER BY due_at`).all(tenantId);
      filename = `tareas-${Date.now()}`;
      break;
    case 'custom_fields':
      rows = db.prepare(`SELECT id, entity, label, field_type, options, sort_order FROM custom_field_defs WHERE tenant_id=? ORDER BY entity, sort_order`).all(tenantId)
        .map(f => ({ ...f, options: f.options ? (() => { try { return JSON.parse(f.options); } catch { return null; } })() : null }));
      filename = `campos-custom-${Date.now()}`;
      isNested = true;
      break;
    case 'webhooks':
      rows = db.prepare(`SELECT id, name, url, events, active FROM outgoing_webhooks WHERE tenant_id=? ORDER BY id`).all(tenantId);
      filename = `webhooks-${Date.now()}`;
      break;
    case 'reports':
      rows = db.prepare(`SELECT id, name, config, datetime(created_at,'unixepoch') AS created_at FROM reports WHERE tenant_id=? ORDER BY id`).all(tenantId);
      filename = `reportes-${Date.now()}`;
      isNested = true;
      break;
    case 'woo_config':
      const wc = db.prepare(`SELECT config_json FROM woo_config WHERE tenant_id=?`).get(tenantId);
      rows = wc ? [JSON.parse(wc.config_json || '{}')] : [];
      filename = `woo-config-${Date.now()}`;
      isNested = true;
      break;
    case 'ai_knowledge':
      rows = db.prepare(`SELECT id, title, content, source_type, datetime(created_at,'unixepoch') AS created_at
        FROM ai_knowledge_sources WHERE tenant_id=? ORDER BY id`).all(tenantId);
      filename = `conocimiento-ia-${Date.now()}`;
      break;
    case 'comments':
      rows = db.prepare(`SELECT id, provider, post_id, comment_id, parent_id, author_name, body, status,
        datetime(created_at,'unixepoch') AS created_at FROM social_comments WHERE tenant_id=? ORDER BY created_at DESC LIMIT 5000`).all(tenantId);
      filename = `comentarios-${Date.now()}`;
      break;
    case 'orders':
      rows = db.prepare(`SELECT id, woo_id, status, total, currency, customer_phone, customer_email,
        datetime(created_at,'unixepoch') AS created_at FROM woo_orders WHERE tenant_id=? ORDER BY id DESC LIMIT 5000`).all(tenantId);
      filename = `pedidos-${Date.now()}`;
      break;
    default:
      return res.status(400).json({ error: `Export de "${entity}" no soportado` });
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
  // Para entidades anidadas (con sub-arrays) caemos a JSON aunque pidan CSV
  if (isNested) {
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

// ─── Export con relaciones (JSON anidado o CSV en ZIP) ─────────────────
function _exportWithRelations(db, tenantId, entity, format, includes, query, res) {
  // Cargar la entidad base
  let baseRows = _fetchEntityRows(db, tenantId, entity);
  if (!baseRows || baseRows.length === 0) {
    return res.status(404).json({ error: 'No hay datos para exportar' });
  }

  // Validar relaciones
  const allRelations = EXPORT_RELATIONS[entity] || {};
  const validIncludes = includes.filter(k => allRelations[k]);
  if (validIncludes.length === 0) {
    // Sin relaciones válidas — caer al export normal
    return _exportEntity(db, tenantId, entity, format, query, res);
  }

  // IDs base para hacer los JOINs
  const baseIds = baseRows.map(r => r.id);

  // Cargar cada relación pedida
  const relData = {};
  for (const key of validIncludes) {
    relData[key] = allRelations[key].fetch(db, tenantId, baseIds);
  }

  const tsFile = `${entity}-con-relaciones-${Date.now()}`;

  if (format === 'json') {
    // JSON anidado: cada fila base lleva sus relaciones como sub-arrays.
    // Indexamos las relaciones por el FK (contact_id, lead_id, etc.)
    const fkByEntity = {
      contacts: 'contact_id',
      leads: 'lead_id',          // expedient_id en algunos casos
      pipelines: 'pipeline_id',
      advisors: 'advisor_id',
      appointments: 'appointment_id',
    };
    const fk = fkByEntity[entity];
    const indexed = {};
    for (const [key, rows] of Object.entries(relData)) {
      indexed[key] = {};
      for (const r of rows) {
        // Detectar la columna FK que usó la query
        const fkVal = r[fk] || r.contact_id || r.expedient_id || r.lead_id || r.pipeline_id || r.advisor_id;
        if (fkVal == null) continue;
        (indexed[key][fkVal] = indexed[key][fkVal] || []).push(r);
      }
    }
    const nested = baseRows.map(row => {
      const enriched = { ...row };
      for (const key of validIncludes) {
        enriched[key] = indexed[key]?.[row.id] || [];
      }
      return enriched;
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${tsFile}.json"`);
    return res.end(JSON.stringify(nested, null, 2));
  }

  // CSV → ZIP con un archivo por entidad
  const archiver = require('archiver');
  const archive = archiver('zip', { zlib: { level: 9 } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${tsFile}.zip"`);
  archive.pipe(res);

  // Archivo principal: la entidad base
  archive.append(_rowsToCsv(baseRows), { name: `${entity}.csv` });

  // Archivos por cada relación
  for (const key of validIncludes) {
    const rows = relData[key] || [];
    if (rows.length === 0) continue;
    archive.append(_rowsToCsv(rows), { name: `${key}.csv` });
  }

  // README breve con la estructura
  const readme = [
    `Wapi101 — Export de ${entity} con relaciones`,
    `Generado: ${new Date().toISOString()}`,
    ``,
    `Archivos:`,
    `  • ${entity}.csv — datos principales (${baseRows.length} filas)`,
    ...validIncludes.map(k => `  • ${k}.csv — ${(relData[k] || []).length} filas, FK enlazado`),
    ``,
    `Cómo usar en Excel:`,
    `  1. Abre cada CSV en Excel`,
    `  2. Usa VLOOKUP(id, otro_archivo!A:Z, columna, FALSE) para cruzar por ID`,
  ].join('\n');
  archive.append(readme, { name: 'README.txt' });

  archive.finalize();
}

// Helper: fila base de cualquier entidad (reusable). Espejo simplificado
// de _exportEntity pero solo para sacar las filas, sin pintar response.
function _fetchEntityRows(db, tenantId, entity) {
  const q = (sql) => { try { return db.prepare(sql).all(tenantId); } catch { return []; } };
  switch (entity) {
    case 'contacts':
      return q(`SELECT id, first_name AS firstName, last_name AS lastName, phone, email FROM contacts WHERE tenant_id=?`);
    case 'leads':
      return q(`SELECT e.id, e.name, e.value, e.pipeline_id, e.stage_id, e.contact_id FROM expedients e WHERE e.tenant_id=?`);
    case 'pipelines':
      return q(`SELECT id, name, color FROM pipelines WHERE tenant_id=?`);
    case 'advisors':
      return q(`SELECT id, name, email, role FROM advisors WHERE tenant_id=?`);
    case 'appointments':
      return q(`SELECT id, contact_id, starts_at, status FROM appointments WHERE tenant_id=?`);
    default:
      return [];
  }
}

function _rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => _csvCell(r[h])).join(','));
  }
  return '﻿' + lines.join('\n');
}
