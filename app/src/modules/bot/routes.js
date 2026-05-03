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

  // Reorder manual: body { orderedIds: [3, 1, 2, ...] }
  router.post('/reorder', (req, res) => {
    try {
      const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : null;
      if (!orderedIds) return res.status(400).json({ error: 'orderedIds requerido (array)' });
      service.reorder(db, orderedIds);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

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

  // GET /api/bot/:id/stats — métricas + historial de ejecuciones
  router.get('/:id/stats', (req, res) => {
    try {
      const botId = Number(req.params.id);
      const bot = db.prepare('SELECT id, name, trigger_type, trigger_value FROM salsbots WHERE id = ?').get(botId);
      if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

      // Conteo total y por estado
      const counts = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'running' OR status = 'paused' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'killed'  THEN 1 ELSE 0 END) AS killed,
          MIN(started_at) AS first_run,
          MAX(started_at) AS last_run
        FROM bot_runs WHERE bot_id = ?
      `).get(botId);

      // Tasa de conversión: # leads que cambiaron de stage_id DESPUÉS de que el
      // bot corrió / # total de runs. Heurística: si el expedient tiene
      // expedient_activity tipo 'stage_change' después de bot_run.started_at,
      // contamos como "conversión".
      const conversions = db.prepare(`
        SELECT COUNT(DISTINCT br.id) AS converted
        FROM bot_runs br
        WHERE br.bot_id = ?
          AND br.expedient_id IS NOT NULL
          AND br.status IN ('done', 'running', 'paused')
          AND EXISTS (
            SELECT 1 FROM expedient_activity ea
            WHERE ea.expedient_id = br.expedient_id
              AND ea.type = 'stage_change'
              AND ea.created_at > br.started_at
          )
      `).get(botId);

      const conversionRate = counts.total > 0
        ? (conversions.converted / counts.total) * 100
        : 0;

      // Runs por día (últimos 14 días) para sparkline
      const dailyRows = db.prepare(`
        SELECT
          CAST(strftime('%s', date(started_at, 'unixepoch'), '+0 days') AS INTEGER) AS day,
          COUNT(*) AS n
        FROM bot_runs
        WHERE bot_id = ? AND started_at >= unixepoch() - 14 * 86400
        GROUP BY day
        ORDER BY day ASC
      `).all(botId);

      // Últimos 50 runs con detalles del contacto
      const history = db.prepare(`
        SELECT br.id, br.status, br.current_step, br.total_steps, br.error_msg,
               br.started_at, br.finished_at,
               c.first_name, c.last_name, c.phone,
               e.name AS expedient_name
        FROM bot_runs br
        LEFT JOIN contacts c   ON c.id = br.contact_id
        LEFT JOIN expedients e ON e.id = br.expedient_id
        WHERE br.bot_id = ?
        ORDER BY br.started_at DESC
        LIMIT 50
      `).all(botId);

      res.json({
        bot: { id: bot.id, name: bot.name, trigger_type: bot.trigger_type },
        metrics: {
          totalRuns: counts.total || 0,
          activeRuns: counts.active || 0,
          completedRuns: counts.completed || 0,
          failedRuns: counts.failed || 0,
          killedRuns: counts.killed || 0,
          conversionRate: Number(conversionRate.toFixed(1)),
          convertedCount: conversions.converted || 0,
          firstRunAt: counts.first_run,
          lastRunAt: counts.last_run,
        },
        daily: dailyRows.map(d => ({ day: d.day, count: d.n })),
        history: history.map(r => ({
          id: r.id,
          status: r.status,
          currentStep: r.current_step,
          totalSteps: r.total_steps,
          errorMsg: r.error_msg,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          contactName: [r.first_name, r.last_name].filter(Boolean).join(' ') || '—',
          contactPhone: r.phone || null,
          expedientName: r.expedient_name || null,
        })),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
