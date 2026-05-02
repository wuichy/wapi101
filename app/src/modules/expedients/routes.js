const express = require('express');
const service  = require('./service');
const activity = require('./activity');
const botEngine = require('../bot/engine');

module.exports = function createExpedientsRouter(db) {
  const router = express.Router();

  // Búsqueda de contactos para el selector del modal
  router.get('/contacts-search', (req, res, next) => {
    try { res.json({ items: service.searchContacts(db, req.query.q || '') }); }
    catch (e) { next(e); }
  });

  // Definiciones de campos personalizados
  router.get('/field-defs', (_req, res, next) => {
    try { res.json({ items: service.listFieldDefs(db, 'expedient') }); }
    catch (e) { next(e); }
  });
  router.post('/field-defs', (req, res, next) => {
    try { res.status(201).json({ item: service.createFieldDef(db, req.body || {}) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.patch('/field-defs/:id', (req, res, next) => {
    try { res.json({ item: service.updateFieldDef(db, Number(req.params.id), req.body || {}) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.delete('/field-defs/:id', (req, res, next) => {
    try {
      const ok = service.removeFieldDef(db, Number(req.params.id));
      if (!ok) return res.status(404).json({ error: 'Campo no encontrado' });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // Tags
  router.get('/tags', (_req, res, next) => {
    try { res.json({ items: service.listTags(db) }); }
    catch (e) { next(e); }
  });

  // CRUD de expedientes
  router.get('/', (req, res, next) => {
    try {
      const { search, page, pageSize, sortBy, sortDir, tags: rawTags, fieldFilters: rawFieldFilters } = req.query;
      const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : [];
      let fieldFilters = {};
      if (rawFieldFilters) {
        try { fieldFilters = JSON.parse(rawFieldFilters); } catch (_) { fieldFilters = {}; }
      }
      res.json(service.list(db, { search, page, pageSize, sortBy, sortDir, tags, fieldFilters }));
    }
    catch (e) { next(e); }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const item = service.getById(db, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Expediente no encontrado' });
      res.json({ item });
    } catch (e) { next(e); }
  });

  router.post('/', (req, res, next) => {
    try {
      const item = service.create(db, req.body || {});
      activity.log(db, {
        expedientId: item.id,
        contactId:   item.contactId,
        type:        'created',
        description: `Expediente creado en "${item.pipelineName || ''}" · ${item.stageName || ''}`,
        advisorId:   req.advisor?.id,
        advisorName: req.advisor?.name,
      });
      res.status(201).json({ item });
    }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.patch('/:id', (req, res, next) => {
    let prev, item;
    try {
      prev = service.getById(db, Number(req.params.id));
      item = service.update(db, Number(req.params.id), req.body || {});
      if (!item) return res.status(404).json({ error: 'Expediente no encontrado' });
      res.json({ item });
    } catch (e) { return res.status(400).json({ error: e.message }); }

    // Registrar cambios como actividad
    try {
      const base = {
        expedientId: item.id,
        contactId:   item.contactId,
        advisorId:   req.advisor?.id,
        advisorName: req.advisor?.name,
      };

      // Cambio de etapa
      if (prev.stageId !== item.stageId) {
        activity.log(db, { ...base, type: 'stage_change',
          description: `Etapa: "${prev.stageName || prev.stageId}" → "${item.stageName || item.stageId}"` });
      }

      // Cambio de pipeline
      if (prev.pipelineId !== item.pipelineId) {
        activity.log(db, { ...base, type: 'pipeline_change',
          description: `Pipeline: "${prev.pipelineName || prev.pipelineId}" → "${item.pipelineName || item.pipelineId}"` });
      }

      // Cambio de nombre del expediente
      if (prev.name !== item.name && !item.nameIsAuto) {
        activity.log(db, { ...base, type: 'name_change',
          description: `Nombre: "${prev.name}" → "${item.name}"` });
      }

      // Cambio de nombre del contacto
      if (prev.contactName !== item.contactName) {
        activity.log(db, { ...base, type: 'contact_name_change',
          description: `Nombre del contacto: "${prev.contactName || ''}" → "${item.contactName || ''}"` });
      }

      // Cambio de teléfono — comparar via contacts table
      if (req.body.phone !== undefined) {
        const prevPhone = db.prepare('SELECT phone FROM contacts WHERE id = ?').get(prev.contactId)?.phone;
        if (prevPhone !== req.body.phone) {
          activity.log(db, { ...base, type: 'phone_change',
            description: `Teléfono: "${prevPhone || ''}" → "${req.body.phone || ''}"` });
        }
      }

      // Cambio de etiquetas
      const prevTags = new Set(prev.tags || []);
      const nextTags = new Set(item.tags || []);
      for (const t of nextTags) {
        if (!prevTags.has(t)) activity.log(db, { ...base, type: 'tag_add', description: `Etiqueta añadida: "${t}"` });
      }
      for (const t of prevTags) {
        if (!nextTags.has(t)) activity.log(db, { ...base, type: 'tag_remove', description: `Etiqueta eliminada: "${t}"` });
      }
    } catch (e) {
      console.error('[expedients] error registrando actividad:', e.message);
    }

    // Trigger bots si cambia la etapa
    try {
      const newStageId = item.stageId;
      if (newStageId && prev && newStageId !== prev.stageId) {
        botEngine.triggerPipelineStage(db, {
          expedientId: item.id,
          contactId:   item.contactId,
          pipelineId:  item.pipelineId,
          stageId:     newStageId,
        });
      }
    } catch (e) {
      console.error('[expedients] error disparando bot:', e.message);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const ok = service.remove(db, Number(req.params.id), req.advisor);
      if (!ok) return res.status(404).json({ error: 'Expediente no encontrado' });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // ── Actividad del expediente ──
  router.get('/:id/activity', (req, res, next) => {
    try {
      const exp = service.getById(db, Number(req.params.id));
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      const items = activity.list(db, exp.id);
      res.json({ items });
    } catch (e) { next(e); }
  });

  // ── Bots del expediente (por contacto) ──
  router.get('/:id/bots', (req, res, next) => {
    try {
      const exp = service.getById(db, Number(req.params.id));
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

      const bots = db.prepare('SELECT * FROM salsbots WHERE enabled = 1 ORDER BY name').all()
        .map(b => {
          const pause = db.prepare(
            'SELECT paused FROM contact_bot_pauses WHERE contact_id = ? AND bot_id = ?'
          ).get(exp.contactId, b.id);
          const steps = (() => { try { return JSON.parse(b.steps || '[]'); } catch { return []; } })();
          return {
            id:           b.id,
            name:         b.name,
            triggerType:  b.trigger_type,
            triggerValue: b.trigger_value,
            stepCount:    steps.length,
            paused:       pause ? !!pause.paused : false,
          };
        });

      res.json({ items: bots, contactId: exp.contactId });
    } catch (e) { next(e); }
  });

  // GET /api/expedients/:id/bot-runs
  router.get('/:id/bot-runs', (req, res, next) => {
    try {
      const exp = service.getById(db, Number(req.params.id));
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      const runs = db.prepare(`
        SELECT * FROM bot_runs WHERE contact_id = ?
        ORDER BY started_at DESC LIMIT 30
      `).all(exp.contactId);
      res.json({ items: runs, hasRunning: runs.some(r => r.status === 'running' || r.status === 'paused') });
    } catch (e) { next(e); }
  });

  // PATCH /api/expedients/:id/bots/:botId
  router.patch('/:id/bots/:botId', (req, res, next) => {
    try {
      const exp = service.getById(db, Number(req.params.id));
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      const botId  = Number(req.params.botId);
      const paused = req.body.paused ? 1 : 0;
      db.prepare(`
        INSERT INTO contact_bot_pauses (contact_id, bot_id, paused, updated_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT (contact_id, bot_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at
      `).run(exp.contactId, botId, paused);
      res.json({ ok: true, paused: !!paused });
    } catch (e) { next(e); }
  });

  return router;
};
