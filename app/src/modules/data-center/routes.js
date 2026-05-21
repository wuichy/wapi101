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
        case 'contacts':
          return res.json(await _importContacts(db, req.tenantId, req.advisor, req.body));
        case 'leads':
          return res.json(await _importLeads(db, req.tenantId, req.advisor, req.body));
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

  // Construir rows de objetos según mapping
  const items = rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const dest = mapping[h];
      if (dest) obj[dest] = row[i];
    });
    return obj;
  });

  // Delegamos al importer existente (que ya tiene dedup + tags)
  const result = customers.importBulk(db, tenantId, items, {
    dupePolicy: options.dedupPolicy || 'skip',
    bulkTag: options.bulkTag || null,
  });

  // Si pidió crear leads, recorrer los contactos creados y crear leads
  let leadsCreated = 0;
  if (options.createLeads && options.pipelineId && options.stageId) {
    const newContactIds = result.created || [];
    const txn = db.transaction(() => {
      for (const cid of newContactIds) {
        expedients.create(db, tenantId, {
          contactId: cid,
          pipelineId: Number(options.pipelineId),
          stageId: Number(options.stageId),
          name: null,
          value: 0,
        });
        leadsCreated++;
      }
    });
    try { txn(); } catch (e) { console.warn('[data-center] error creando leads:', e.message); }
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
