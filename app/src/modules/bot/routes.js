const express  = require('express');
const service  = require('./service');
const engine   = require('./engine');
const activity = require('../expedients/activity');

module.exports = function createBotRouter(db) {
  const router = express.Router();

  // ── Diagnóstico ──────────────────────────────────────────────────────────────
  // GET  /api/bots/logs              → últimas entradas del log del engine
  // DELETE /api/bots/logs            → limpiar logs
  // POST /api/bots/diagnose          → simular trigger + ver resultado detallado
  // POST /api/bots/test-trigger      → disparar trigger real para un expediente

  router.get('/logs', (_req, res) => {
    res.json({ logs: engine.getLogs() });
  });

  router.delete('/logs', (_req, res) => {
    engine.clearLogs();
    res.json({ ok: true });
  });

  // Diagnóstico sin ejecutar: inspecciona DB y compara trigger_value con stageId
  router.post('/diagnose', (req, res) => {
    try {
      const { expedientId, stageId: rawStageId, contactId: rawContactId } = req.body || {};
      const result = { checks: [], warnings: [], errors: [] };

      // 1. Bots activos
      const bots = db.prepare('SELECT * FROM salsbots WHERE enabled = 1').all();
      result.activeBots = bots.map(b => ({
        id: b.id, name: b.name,
        triggerType: b.trigger_type, triggerValue: b.trigger_value,
        triggerValueAsNumber: Number(b.trigger_value),
      }));
      result.checks.push(`Bots habilitados: ${bots.length}`);

      const stageBots = bots.filter(b => b.trigger_type === 'pipeline_stage');
      result.checks.push(`Bots con trigger pipeline_stage: ${stageBots.length}`);

      // 2. Expediente (si se pasa)
      if (expedientId) {
        const exp = db.prepare(`
          SELECT e.*, s.id AS s_id, s.name AS s_name FROM expedients e
          LEFT JOIN stages s ON s.id = e.stage_id
          WHERE e.id = ?
        `).get(Number(expedientId));

        if (!exp) {
          result.errors.push(`Expediente ${expedientId} no encontrado`);
        } else {
          result.expedient = {
            id: exp.id, name: exp.name,
            contactId: exp.contact_id,
            pipelineId: exp.pipeline_id,
            stageId: exp.stage_id, stageName: exp.s_name,
          };
          result.checks.push(`Expediente encontrado: "${exp.name}", etapa actual=${exp.stage_id} ("${exp.s_name}")`);

          // Comparar cada bot de stage
          const targetStageId = rawStageId != null ? Number(rawStageId) : exp.stage_id;
          result.targetStageId = targetStageId;
          result.checks.push(`Comparando contra stageId=${targetStageId}`);

          result.botMatches = stageBots.map(b => {
            const tv = Number(b.trigger_value);
            const match = tv === targetStageId;
            if (!match) result.checks.push(`Bot "${b.name}": trigger_value=${b.trigger_value} (→${tv}) ≠ ${targetStageId}`);
            else result.checks.push(`✓ Bot "${b.name}": COINCIDE (${tv} === ${targetStageId})`);
            return { id: b.id, name: b.name, triggerValue: b.trigger_value, asNumber: tv, targetStageId, match };
          });

          // Conversación del contacto
          const convo = db.prepare(
            'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1'
          ).get(exp.contact_id);
          result.conversation = convo || null;
          if (!convo) result.warnings.push(`No hay conversación para contacto ${exp.contact_id} — mensajes del bot no se enviarán`);
        }
      } else if (rawStageId != null && rawContactId != null) {
        const targetStageId = Number(rawStageId);
        result.targetStageId = targetStageId;
        result.botMatches = stageBots.map(b => {
          const tv = Number(b.trigger_value);
          return { id: b.id, name: b.name, triggerValue: b.trigger_value, asNumber: tv, targetStageId, match: tv === targetStageId };
        });
      } else {
        result.warnings.push('Pasa expedientId (o stageId + contactId) en el body para ver el análisis completo');
      }

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message, stack: e.stack });
    }
  });

  // Disparar trigger real (igual que cuando se arrastra en el kanban)
  router.post('/test-trigger', (req, res) => {
    try {
      const { expedientId } = req.body || {};
      if (!expedientId) return res.status(400).json({ error: 'expedientId requerido' });

      engine.clearLogs();

      const exp = db.prepare(`
        SELECT e.*, s.id AS s_id FROM expedients e
        LEFT JOIN stages s ON s.id = e.stage_id
        WHERE e.id = ?
      `).get(Number(expedientId));

      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

      engine.triggerPipelineStage(db, {
        expedientId: exp.id,
        contactId:   exp.contact_id,
        pipelineId:  exp.pipeline_id,
        stageId:     exp.stage_id,
      });

      // Esperar 500ms para capturar logs síncronos (el timer async sigue corriendo)
      setTimeout(() => {
        res.json({
          triggered: true,
          expedientId: exp.id,
          stageId: exp.stage_id,
          contactId: exp.contact_id,
          logs: engine.getLogs(),
        });
      }, 500);
    } catch (e) {
      res.status(500).json({ error: e.message, stack: e.stack });
    }
  });

  // ── Control de ejecuciones ───────────────────────────────────────────────────
  router.post('/runs/:runId/kill', (req, res) => {
    try {
      const runId = Number(req.params.runId);
      const run = db.prepare('SELECT * FROM bot_runs WHERE id = ?').get(runId);
      engine.killRun(db, runId);
      if (run?.expedient_id) {
        activity.log(db, {
          expedientId: run.expedient_id,
          contactId:   run.contact_id,
          type:        'bot_killed',
          description: `Bot "${run.bot_name}" terminado manualmente`,
          advisorId:   req.advisor?.id,
          advisorName: req.advisor?.name,
        });
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/runs/:runId/pause', (req, res) => {
    try {
      const runId = Number(req.params.runId);
      const run = db.prepare('SELECT * FROM bot_runs WHERE id = ?').get(runId);
      engine.pauseRun(db, runId);
      if (run?.expedient_id) {
        activity.log(db, {
          expedientId: run.expedient_id,
          contactId:   run.contact_id,
          type:        'bot_paused_manual',
          description: `Bot "${run.bot_name}" pausado`,
          advisorId:   req.advisor?.id,
          advisorName: req.advisor?.name,
        });
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/runs/:runId/resume', (req, res) => {
    try {
      const runId = Number(req.params.runId);
      const run = db.prepare('SELECT * FROM bot_runs WHERE id = ?').get(runId);
      engine.resumeRun(db, runId);
      if (run?.expedient_id) {
        activity.log(db, {
          expedientId: run.expedient_id,
          contactId:   run.contact_id,
          type:        'bot_resumed',
          description: `Bot "${run.bot_name}" reanudado`,
          advisorId:   req.advisor?.id,
          advisorName: req.advisor?.name,
        });
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  router.get('/', (_req, res) => res.json({ items: service.list(db) }));

  router.post('/', (req, res) => {
    try {
      res.status(201).json({ item: service.create(db, req.body) });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/:id', (req, res) => {
    try {
      res.json({ item: service.getById(db, req.params.id) });
    } catch (err) { res.status(404).json({ error: err.message }); }
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json({ item: service.update(db, req.params.id, req.body) });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res) => {
    try {
      service.remove(db, req.params.id, { deletedBy: req.advisor || null });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
};
