// Bot execution engine.
// Runs bot steps sequentially for a given contact/conversation context.
// Timers use setTimeout — suitable for seconds/minutes. For hours/days the
// process must stay alive (acceptable for the current single-process setup).

const convoSvc     = require('../conversations/service');
const expedientSvc = require('../expedients/service');
const activitySvc  = require('../expedients/activity');
const { sendMessage } = require('../conversations/sender');

const MS = { segundos: 1000, minutos: 60_000, horas: 3_600_000, 'días': 86_400_000 };

// ─── Run signal registry ───────────────────────────────────────────────────
// Each active run registers { kill: false, pause: false } here.
// Timer steps check every second; the step loop checks between each step.
const _signals = new Map();

// ─── In-memory diagnostic log (last 200 entries) ───
const _logs = [];
function _log(level, ...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const entry = { ts: new Date().toISOString(), level, msg };
  _logs.push(entry);
  if (_logs.length > 200) _logs.shift();
  if (level === 'error') console.error('[bot engine]', msg);
  else console.log('[bot engine]', msg);
}
function getLogs() { return [..._logs]; }
function clearLogs() { _logs.length = 0; }

// ─── Public signal controls ───────────────────────────────────────────────
function killRun(db, runId) {
  const sig = _signals.get(runId);
  if (sig) {
    sig.kill = true;
    sig.pause = false;
  }
  // Force DB update in case the async chain is stuck in a long timer or already gone
  try {
    if (db) {
      db.prepare(
        "UPDATE bot_runs SET status='killed', finished_at=unixepoch() WHERE id=? AND status IN ('running','paused')"
      ).run(runId);
    }
  } catch (_) {}
}

function pauseRun(db, runId) {
  const sig = _signals.get(runId);
  if (sig) sig.pause = true;
  try {
    if (db) db.prepare("UPDATE bot_runs SET status='paused' WHERE id=? AND status='running'").run(runId);
  } catch (_) {}
}

function resumeRun(db, runId) {
  const sig = _signals.get(runId);
  if (sig) sig.pause = false;
  try {
    if (db) db.prepare("UPDATE bot_runs SET status='running' WHERE id=? AND status='paused'").run(runId);
  } catch (_) {}
}

// ─── Public API ───

/**
 * triggerMessage  — call after an incoming message is stored.
 * Fires bots with trigger_type = 'keyword' or 'always'.
 */
function triggerMessage(db, { convoId, contactId, messageBody, provider, integrationId }) {
  const bots = enabledBots(db);
  for (const bot of bots) {
    if (bot.trigger_type === 'always') {
      runAsync(db, bot, { convoId, contactId, messageBody, provider, integrationId });
    } else if (bot.trigger_type === 'keyword') {
      const kw = (bot.trigger_value || '').toLowerCase().trim();
      if (kw && (messageBody || '').toLowerCase().includes(kw)) {
        runAsync(db, bot, { convoId, contactId, messageBody, provider, integrationId });
      }
    }
  }
}

/**
 * triggerPipelineStage — call when an expedient enters a stage.
 * Fires bots with trigger_type = 'pipeline_stage' whose trigger_value = stageId.
 */
function triggerPipelineStage(db, { expedientId, contactId, pipelineId, stageId }) {
  _log('info', `triggerPipelineStage → expediente=${expedientId} contacto=${contactId} etapa=${stageId} (tipo=${typeof stageId})`);
  const bots = enabledBots(db);
  _log('info', `bots habilitados: ${bots.length} → ${bots.map(b => `${b.name}(trigger=${b.trigger_type},value=${b.trigger_value})`).join(', ')}`);
  for (const bot of bots) {
    if (bot.trigger_type !== 'pipeline_stage') continue;
    const targetStageId = Number(bot.trigger_value);
    const match = targetStageId === stageId;
    _log('info', `bot "${bot.name}" (id=${bot.id}): trigger_value="${bot.trigger_value}" → targetStage=${targetStageId}(${typeof targetStageId}) vs stageId=${stageId}(${typeof stageId}) → match=${match}`);
    if (targetStageId && match) {
      // Find conversation for this contact (any provider)
      const convoRow = db.prepare(
        'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1'
      ).get(contactId);
      _log('info', `conversación encontrada: ${convoRow ? `id=${convoRow.id} provider=${convoRow.provider}` : 'ninguna'}`);

      // Resetear bot_paused para que stop_bot de una ejecución anterior no bloquee esta nueva
      if (convoRow) {
        db.prepare('UPDATE conversations SET bot_paused = 0 WHERE id = ?').run(convoRow.id);
        _log('info', `bot_paused reseteado en conversación ${convoRow.id}`);
      }

      runAsync(db, bot, {
        convoId:       convoRow?.id       || null,
        contactId,
        messageBody:   '',
        provider:      convoRow?.provider || null,
        integrationId: convoRow?.integration_id || null,
        expedientId,
        pipelineId,
        stageId,
      });
    }
  }
}

/**
 * triggerNewContact — call when a new contact is created.
 * Fires bots with trigger_type = 'new_contact'.
 */
function triggerNewContact(db, { contactId }) {
  const bots = enabledBots(db);
  for (const bot of bots) {
    if (bot.trigger_type === 'new_contact') {
      runAsync(db, bot, { contactId, convoId: null, messageBody: '', provider: null, integrationId: null });
    }
  }
}

// ─── Internal helpers ───

function enabledBots(db) {
  const rows = db.prepare('SELECT * FROM salsbots WHERE enabled = 1').all();
  return rows.map(r => ({ ...r, steps: JSON.parse(r.steps || '[]') }));
}

function runAsync(db, bot, ctx) {
  // Kill any existing active runs for this bot+contact to avoid duplicates
  if (ctx.contactId && bot.id) {
    try {
      const active = db.prepare(
        "SELECT id FROM bot_runs WHERE bot_id=? AND contact_id=? AND status IN ('running','paused')"
      ).all(bot.id, ctx.contactId);
      for (const row of active) {
        _log('info', `matando ejecución duplicada run=${row.id} bot=${bot.id} contacto=${ctx.contactId}`);
        killRun(db, row.id);
      }
    } catch (e) {
      _log('warn', `no se pudo limpiar runs activos: ${e.message}`);
    }
  }
  execute(db, bot, ctx).catch(err => {
    _log('error', `bot ${bot.id} "${bot.name}" error: ${err.message}\n${err.stack}`);
  });
}

async function execute(db, bot, ctx) {
  if (ctx.contactId) {
    const pause = db.prepare(
      'SELECT paused FROM contact_bot_pauses WHERE contact_id = ? AND bot_id = ?'
    ).get(ctx.contactId, bot.id);
    if (pause?.paused) {
      _log('warn', `bot ${bot.id} pausado para contacto ${ctx.contactId}, omitiendo.`);
      return;
    }
  }

  const totalSteps = bot.steps?.length || 0;
  _log('info', `ejecutando bot ${bot.id} "${bot.name}" para contacto ${ctx.contactId} (${totalSteps} pasos)`);

  // Actividad: bot inició
  if (ctx.expedientId) {
    activitySvc.log(db, {
      expedientId: ctx.expedientId,
      contactId:   ctx.contactId,
      type:        'bot_start',
      description: `Bot "${bot.name}" iniciado`,
    });
  }

  // Registrar inicio de ejecución
  let runId = null;
  try {
    const r = db.prepare(`
      INSERT INTO bot_runs (bot_id, bot_name, contact_id, expedient_id, trigger_type, status, current_step, total_steps)
      VALUES (?, ?, ?, ?, ?, 'running', 0, ?)
    `).run(bot.id, bot.name, ctx.contactId || null, ctx.expedientId || null, bot.trigger_type, totalSteps);
    runId = r.lastInsertRowid;
    _signals.set(runId, { kill: false, pause: false });
  } catch (e) {
    _log('warn', `no se pudo crear bot_run: ${e.message}`);
  }

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(ctx.contactId);
  const fullCtx = { ...ctx, contact, runId };

  let finalStatus = 'done';
  let errorMsg = null;

  for (let i = 0; i < (bot.steps || []).length; i++) {
    // Check kill signal before each step
    const sig = runId ? _signals.get(runId) : null;
    if (sig?.kill) {
      _log('info', `run ${runId} killed antes de paso ${i + 1}, deteniendo.`);
      finalStatus = 'killed';
      break;
    }

    // Pause: wait in 500ms chunks until resumed or killed
    if (sig?.pause) {
      _log('info', `run ${runId} en pausa antes de paso ${i + 1}...`);
      while (sig.pause && !sig.kill) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (sig.kill) { finalStatus = 'killed'; break; }
      _log('info', `run ${runId} reanudado.`);
    }

    const step = bot.steps[i];
    _log('info', `paso ${i + 1}/${totalSteps}: tipo="${step.type}"`);

    // Actualizar step actual en DB
    if (runId) {
      try { db.prepare('UPDATE bot_runs SET current_step = ? WHERE id = ?').run(i + 1, runId); } catch (_) {}
    }

    try {
      const shouldStop = await executeStep(db, step, fullCtx);
      _log('info', `paso ${i + 1} completado, shouldStop=${shouldStop}`);
      if (shouldStop) break;
    } catch (stepErr) {
      _log('error', `paso ${i + 1} ("${step.type}") lanzó error: ${stepErr.message}`);
      finalStatus = 'error';
      errorMsg = `Paso ${i + 1} (${step.type}): ${stepErr.message}`;
      break;
    }
  }

  // Marcar ejecución como terminada (solo si no fue marcada ya por killRun)
  if (runId) {
    try {
      db.prepare(`
        UPDATE bot_runs SET status = ?, error_msg = ?, finished_at = unixepoch(),
          current_step = CASE WHEN ? = 'done' THEN total_steps ELSE current_step END
        WHERE id = ? AND status NOT IN ('killed')
      `).run(finalStatus, errorMsg, finalStatus, runId);
    } catch (_) {}
    _signals.delete(runId);
  }

  // Actividad: bot terminó
  if (ctx.expedientId && finalStatus !== 'killed') {
    activitySvc.log(db, {
      expedientId: ctx.expedientId,
      contactId:   ctx.contactId,
      type:        finalStatus === 'done' ? 'bot_done' : 'bot_error',
      description: finalStatus === 'done'
        ? `Bot "${bot.name}" completado (${totalSteps} pasos)`
        : `Bot "${bot.name}" falló: ${errorMsg}`,
    });
  }

  _log('info', `bot ${bot.id} "${bot.name}" terminó (${finalStatus}).`);
}

// Returns true if execution should stop (stop_bot step).
async function executeStep(db, step, ctx) {
  const c = step.config || {};

  switch (step.type) {

    case 'message': {
      const text = replaceVars(c.text || '', ctx);
      if (!text.trim()) return false;

      let targetConvoId = ctx.convoId;

      // If a specific channel is requested, find or create a conversation on that channel
      if (c.channelId && c.channelId !== 'auto' && ctx.contactId) {
        const intRow = db.prepare(
          'SELECT id, provider FROM integrations WHERE id = ?'
        ).get(Number(c.channelId));
        if (intRow) {
          const existing = db.prepare(
            'SELECT id FROM conversations WHERE contact_id = ? AND integration_id = ? LIMIT 1'
          ).get(ctx.contactId, intRow.id);
          targetConvoId = existing?.id || null;
        }
      }

      if (!targetConvoId) {
        _log('warn', `mensaje: no hay conversación para contacto ${ctx.contactId}`);
        return false;
      }

      try {
        const convo = convoSvc.getById(db, targetConvoId);
        if (!convo) return false;
        _log('info', `enviando mensaje a conversación ${targetConvoId} (${convo.provider}): "${text.slice(0, 80)}"`);
        const externalId = await sendMessage(db, convo, text);
        convoSvc.addMessage(db, targetConvoId, {
          externalId,
          direction: 'outgoing',
          provider:  convo.provider,
          body:      text,
          status:    'sent',
        });
        _log('info', `mensaje enviado OK, externalId=${externalId}`);
      } catch (err) {
        _log('error', `error enviando mensaje: ${err.message}`);
      }
      return false;
    }

    case 'timer': {
      let ms;
      if (c.days !== undefined || c.hours !== undefined || c.minutes !== undefined || c.seconds !== undefined) {
        ms = ((Number(c.days)||0) * 86400 + (Number(c.hours)||0) * 3600 + (Number(c.minutes)||0) * 60 + (Number(c.seconds)||0)) * 1000;
      } else {
        ms = (Number(c.amount) || 1) * (MS[c.unit] || MS.minutos);
      }
      _log('info', `timer: esperando ${ms}ms`);
      if (ms > 0) {
        const chunk = 1000;
        let elapsed = 0;
        while (elapsed < ms) {
          const sig = ctx.runId ? _signals.get(ctx.runId) : null;
          if (sig?.kill) { _log('info', `timer interrumpido por kill (run ${ctx.runId})`); return false; }
          // While paused, hold without consuming timer budget
          while (sig?.pause && !sig?.kill) {
            await new Promise(r => setTimeout(r, 500));
          }
          if (sig?.kill) { _log('info', `timer interrumpido por kill tras pausa (run ${ctx.runId})`); return false; }
          await new Promise(r => setTimeout(r, Math.min(chunk, ms - elapsed)));
          elapsed += chunk;
        }
      }
      return false;
    }

    case 'stage': {
      const pipelineId = Number(c.pipelineId);
      const stageId    = Number(c.stageId);
      if (!pipelineId || !stageId || !ctx.contactId) return false;

      try {
        const exp = db.prepare(
          'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? LIMIT 1'
        ).get(ctx.contactId, pipelineId);

        if (exp) {
          expedientSvc.update(db, exp.id, { stageId, pipelineId });
          _log('info', `expediente ${exp.id} movido a etapa ${stageId}`);
        } else {
          const created = expedientSvc.create(db, {
            contactId:  ctx.contactId,
            pipelineId,
            stageId,
          });
          _log('info', `expediente creado (${created.id}) en pipeline ${pipelineId} etapa ${stageId}`);
        }
      } catch (err) {
        _log('error', `error en step stage: ${err.message}`);
      }
      return false;
    }

    case 'tag': {
      const tag = (c.tag || '').trim();
      if (!tag || !ctx.contactId) return false;
      try {
        const row = db.prepare('SELECT tags FROM contacts WHERE id = ?').get(ctx.contactId);
        if (row) {
          const tags = (() => { try { return JSON.parse(row.tags || '[]'); } catch { return []; } })();
          if (!tags.includes(tag)) {
            tags.push(tag);
            db.prepare('UPDATE contacts SET tags = ? WHERE id = ?').run(JSON.stringify(tags), ctx.contactId);
          }
          _log('info', `etiqueta "${tag}" en contacto ${ctx.contactId} (tags=${JSON.stringify(tags)})`);
        }
      } catch (err) {
        _log('error', `error en step tag: ${err.message}`);
      }
      return false;
    }

    case 'stop_bot': {
      if (ctx.convoId) {
        convoSvc.setBotPaused(db, ctx.convoId, true);
        _log('info', `bot pausado para conversación ${ctx.convoId}`);
      }
      return true;
    }

    case 'condition': {
      // Basic condition: if false, skip remaining steps
      const passes = evaluateCondition(db, c, ctx);
      return !passes; // return true (stop) if condition fails
    }

    default:
      return false;
  }
}

function evaluateCondition(db, c, ctx) {
  try {
    if (c.field === 'message') {
      return (ctx.messageBody || '').toLowerCase().includes((c.value || '').toLowerCase());
    }
    if (c.field === 'tag') {
      const row = db.prepare('SELECT tags FROM contacts WHERE id = ?').get(ctx.contactId);
      const tags = (() => { try { return JSON.parse(row?.tags || '[]'); } catch { return []; } })();
      return tags.includes(c.value || '');
    }
    if (c.field === 'pipeline') {
      const exp = db.prepare(
        'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? LIMIT 1'
      ).get(ctx.contactId, Number(c.value));
      return !!exp;
    }
  } catch (err) {
    console.error('[bot engine] evaluateCondition error:', err.message);
  }
  return true;
}

function replaceVars(text, ctx) {
  const c = ctx.contact || {};
  return text
    .replace(/\{nombre\}/gi,    c.name    || '')
    .replace(/\{apellido\}/gi,  c.last_name || '')
    .replace(/\{telefono\}/gi,  c.phone   || '')
    .replace(/\{email\}/gi,     c.email   || '');
}

module.exports = { triggerMessage, triggerPipelineStage, triggerNewContact, getLogs, clearLogs, killRun, pauseRun, resumeRun };
