// Bot execution engine.
// Runs bot steps sequentially for a given contact/conversation context.
// Timers use setTimeout — suitable for seconds/minutes. For hours/days the
// process must stay alive (acceptable for the current single-process setup).

const convoSvc     = require('../conversations/service');
const expedientSvc = require('../expedients/service');
const activitySvc  = require('../expedients/activity');
const { sendMessage, sendWhatsAppTemplate } = require('../conversations/sender');
const apptSvc      = require('../appointments/service');
const aiSvc        = require('../ai/service');

const MS = { segundos: 1000, minutos: 60_000, horas: 3_600_000, 'días': 86_400_000 };

// ─── Resolución de tenant ───
// El engine corre fuera del request HTTP (webhook, timer, expedient stage change),
// así que no tiene req.tenantId. Lo deriva del contactId al inicio de cada
// trigger; el resultado se propaga vía ctx.tenantId a todas las queries internas.
function _tenantFromContact(db, contactId) {
  if (!contactId) return null;
  return db.prepare('SELECT tenant_id FROM contacts WHERE id = ?').get(contactId)?.tenant_id || null;
}

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
      // Cancelar waits persistentes (timer / wait_response) — sin esto el poller los seguiría disparando.
      db.prepare(
        "UPDATE bot_run_waits SET status='cancelled' WHERE run_id=? AND status='waiting'"
      ).run(runId);
    }
  } catch (_) {}
}

function pauseRun(db, runId) {
  const sig = _signals.get(runId);
  if (sig) sig.pause = true;
  try {
    if (!db) return;
    // Marcar pausa MANUAL: paused_manually=1, paused_at=now
    db.prepare(
      "UPDATE bot_runs SET status='paused', paused_manually=1, paused_at=unixepoch() WHERE id=? AND status IN ('running','paused')"
    ).run(runId);
    // Si hay un wait activo (timer/wait_response), congelar el contador:
    // guardar segundos restantes en paused_remaining.
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE bot_run_waits SET paused_remaining = CASE WHEN expires_at > ? THEN expires_at - ? ELSE 0 END WHERE run_id = ? AND status = 'waiting' AND paused_remaining IS NULL"
    ).run(now, now, runId);
  } catch (_) {}
}

function resumeRun(db, runId) {
  const sig = _signals.get(runId);
  if (sig) sig.pause = false;
  try {
    if (!db) return;
    // Reanudar timer: si había paused_remaining, recalcular expires_at = now + remaining
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE bot_run_waits SET expires_at = ? + paused_remaining, paused_remaining = NULL WHERE run_id = ? AND status = 'waiting' AND paused_remaining IS NOT NULL"
    ).run(now, runId);
    // Quitar flag manual. El status vuelve a 'paused' (natural wait) si hay wait activo,
    // o a 'running' si no había wait.
    const stillWaiting = db.prepare(
      "SELECT 1 FROM bot_run_waits WHERE run_id = ? AND status = 'waiting' LIMIT 1"
    ).get(runId);
    const newStatus = stillWaiting ? 'paused' : 'running';
    db.prepare(
      "UPDATE bot_runs SET status=?, paused_manually=0, paused_at=NULL WHERE id=?"
    ).run(newStatus, runId);
  } catch (_) {}
}

// ─── Public API ───

/**
 * triggerMessage  — call after an incoming message is stored.
 * Fires bots with trigger_type = 'keyword' or 'always'.
 */
function triggerMessage(db, { convoId, contactId, messageBody, provider, integrationId }) {
  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerMessage: contacto ${contactId} sin tenant — abortando`); return; }
  const bots = enabledBots(db, tenantId);
  for (const bot of bots) {
    if (bot.trigger_type === 'always') {
      runAsync(db, bot, { convoId, contactId, messageBody, provider, integrationId, tenantId });
    } else if (bot.trigger_type === 'keyword') {
      // trigger_value puede ser una sola keyword o varias separadas por
      // \n, | o coma. Dispara si el mensaje contiene CUALQUIERA. El keyword
      // que matched se pasa en ctx.matchedKeyword para que steps lo usen.
      const raw = (bot.trigger_value || '').trim();
      const keywords = raw
        .split(/[\n|,]/)
        .map(k => k.toLowerCase().trim())
        .filter(Boolean);
      if (!keywords.length) continue;
      const body = (messageBody || '').toLowerCase();
      const matched = keywords.find(k => body.includes(k));
      if (matched) {
        runAsync(db, bot, {
          convoId, contactId, messageBody, provider, integrationId, tenantId,
          matchedKeyword: matched,
        });
      }
    }
  }
}

/**
 * triggerPipelineStage — call when an expedient enters a stage.
 * Fires bots with trigger_type = 'pipeline_stage' whose trigger_value = stageId.
 */
// Límite de profundidad para encadenamiento entre bots (bot A mueve a etapa →
// dispara bot B → mueve a etapa → dispara bot C → …). Sin esto, bots con
// triggers cíclicos hacen bucles infinitos.
const MAX_BOT_CHAIN_DEPTH = 20;

function triggerPipelineStage(db, { expedientId, contactId, pipelineId, stageId, chainDepth = 0 }) {
  _log('info', `triggerPipelineStage → expediente=${expedientId} contacto=${contactId} etapa=${stageId} (tipo=${typeof stageId}, chain=${chainDepth})`);

  if (chainDepth > MAX_BOT_CHAIN_DEPTH) {
    _log('error', `chain depth ${chainDepth} excede el máximo (${MAX_BOT_CHAIN_DEPTH}). Posible bucle de bots — abortando.`);
    return;
  }

  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerPipelineStage: contacto ${contactId} sin tenant — abortando`); return; }

  const bots = enabledBots(db, tenantId);
  _log('info', `bots habilitados: ${bots.length} → ${bots.map(b => `${b.name}(trigger=${b.trigger_type},value=${b.trigger_value})`).join(', ')}`);
  for (const bot of bots) {
    if (bot.trigger_type !== 'pipeline_stage') continue;
    const targetStageId = Number(bot.trigger_value);
    const match = targetStageId === stageId;
    _log('info', `bot "${bot.name}" (id=${bot.id}): trigger_value="${bot.trigger_value}" → targetStage=${targetStageId}(${typeof targetStageId}) vs stageId=${stageId}(${typeof stageId}) → match=${match}`);
    if (targetStageId && match) {
      const convoRow = db.prepare(
        'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 1'
      ).get(contactId, tenantId);
      _log('info', `conversación encontrada: ${convoRow ? `id=${convoRow.id} provider=${convoRow.provider}` : 'ninguna'}`);

      if (convoRow) {
        db.prepare('UPDATE conversations SET bot_paused = 0 WHERE id = ? AND tenant_id = ?').run(convoRow.id, tenantId);
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
        chainDepth,
        tenantId,
      });
    }
  }
}

/**
 * triggerNewContact — call when a new contact is created.
 * Fires bots with trigger_type = 'new_contact'.
 */
function triggerNewContact(db, { contactId }) {
  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerNewContact: contacto ${contactId} sin tenant — abortando`); return; }
  const bots = enabledBots(db, tenantId);
  for (const bot of bots) {
    if (bot.trigger_type === 'new_contact') {
      runAsync(db, bot, { contactId, convoId: null, messageBody: '', provider: null, integrationId: null, tenantId });
    }
  }
}

/**
 * triggerPipelineStageLeave — fires when a lead LEAVES a stage (mirror of triggerPipelineStage).
 * trigger_value = the stageId being abandoned.
 */
function triggerPipelineStageLeave(db, { expedientId, contactId, pipelineId, stageId, chainDepth = 0 }) {
  _log('info', `triggerPipelineStageLeave → expediente=${expedientId} contacto=${contactId} etapa-saliente=${stageId} (chain=${chainDepth})`);
  if (chainDepth > MAX_BOT_CHAIN_DEPTH) {
    _log('error', `chain depth ${chainDepth} excede el máximo. Posible bucle — abortando.`);
    return;
  }
  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerPipelineStageLeave: contacto ${contactId} sin tenant — abortando`); return; }
  const bots = enabledBots(db, tenantId);
  for (const bot of bots) {
    if (bot.trigger_type !== 'pipeline_stage_leave') continue;
    if (Number(bot.trigger_value) !== stageId) continue;
    const convoRow = db.prepare(
      'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 1'
    ).get(contactId, tenantId);
    runAsync(db, bot, {
      convoId:       convoRow?.id || null,
      contactId,
      messageBody:   '',
      provider:      convoRow?.provider || null,
      integrationId: convoRow?.integration_id || null,
      expedientId, pipelineId, stageId, chainDepth, tenantId,
    });
  }
}

/**
 * triggerAssigneeChanged — fires when a lead's assigned_advisor_id changes.
 * trigger_value: optional advisor_id; empty = fires on ANY change.
 */
function triggerAssigneeChanged(db, { expedientId, contactId, oldAdvisorId, newAdvisorId }) {
  _log('info', `triggerAssigneeChanged → exp=${expedientId} ${oldAdvisorId} → ${newAdvisorId}`);
  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerAssigneeChanged: contacto ${contactId} sin tenant — abortando`); return; }
  const bots = enabledBots(db, tenantId);
  for (const bot of bots) {
    if (bot.trigger_type !== 'assignee_changed') continue;
    const filterId = (bot.trigger_value || '').trim();
    // Si trigger_value vacío → cualquier cambio. Si tiene valor → solo cuando ese advisor entra como nuevo.
    if (filterId && Number(filterId) !== Number(newAdvisorId)) continue;
    const convoRow = db.prepare(
      'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 1'
    ).get(contactId, tenantId);
    runAsync(db, bot, {
      convoId:       convoRow?.id || null,
      contactId,
      messageBody:   '',
      provider:      convoRow?.provider || null,
      integrationId: convoRow?.integration_id || null,
      expedientId,
      oldAdvisorId, newAdvisorId,
      tenantId,
    });
  }
}

/**
 * triggerMessageRead — fires when an outgoing WhatsApp message turns ✓✓ blue.
 * trigger_value: empty (always fires when a sent message is read).
 */
function triggerMessageRead(db, { messageId, conversationId, contactId }) {
  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerMessageRead: contacto ${contactId} sin tenant — abortando`); return; }
  const bots = enabledBots(db, tenantId);
  if (!bots.some(b => b.trigger_type === 'message_read')) return;
  const convoRow = db.prepare(
    'SELECT id, provider, integration_id FROM conversations WHERE id = ? AND tenant_id = ?'
  ).get(conversationId, tenantId);
  for (const bot of bots) {
    if (bot.trigger_type !== 'message_read') continue;
    runAsync(db, bot, {
      convoId:       convoRow?.id || null,
      contactId,
      messageBody:   '',
      provider:      convoRow?.provider || null,
      integrationId: convoRow?.integration_id || null,
      messageId,
      tenantId,
    });
  }
}

/**
 * triggerNoResponse — fires when the last message in a conversation is outgoing
 * and was sent more than N minutes ago. Called from poller, deduped by table
 * bot_no_response_fires (evita disparar 2 veces al mismo outgoing message).
 */
function triggerNoResponse(db, { tenantId, contactId, conversationId, lastOutgoingId, minutesSince }) {
  const bots = enabledBots(db, tenantId);
  const candidates = bots.filter(b => b.trigger_type === 'no_response');
  if (!candidates.length) return;

  const convoRow = db.prepare(
    'SELECT id, provider, integration_id FROM conversations WHERE id = ? AND tenant_id = ?'
  ).get(conversationId, tenantId);

  for (const bot of candidates) {
    const requiredMin = Number(bot.trigger_value || 0);
    if (!requiredMin || minutesSince < requiredMin) continue;

    // Dedup: ¿ya disparamos para este bot+conversación+outgoing actual?
    const prev = db.prepare(
      'SELECT last_outgoing_id FROM bot_no_response_fires WHERE bot_id = ? AND conversation_id = ?'
    ).get(bot.id, conversationId);
    if (prev && prev.last_outgoing_id === lastOutgoingId) continue;

    db.prepare(`
      INSERT INTO bot_no_response_fires (tenant_id, bot_id, conversation_id, last_outgoing_id, fired_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(bot_id, conversation_id) DO UPDATE SET
        last_outgoing_id = excluded.last_outgoing_id,
        fired_at         = unixepoch()
    `).run(tenantId, bot.id, conversationId, lastOutgoingId);

    runAsync(db, bot, {
      convoId:       convoRow?.id || null,
      contactId,
      messageBody:   '',
      provider:      convoRow?.provider || null,
      integrationId: convoRow?.integration_id || null,
      tenantId,
    });
  }
}

/**
 * triggerTagAdded — fires when a tag is added to an expedient (lead).
 * trigger_value: exact tag name to match. Empty = matches any tag added.
 */
function triggerTagAdded(db, { expedientId, contactId, tag }) {
  _log('info', `triggerTagAdded → exp=${expedientId} tag="${tag}"`);
  const tenantId = _tenantFromContact(db, contactId);
  if (!tenantId) { _log('warn', `triggerTagAdded: contacto ${contactId} sin tenant — abortando`); return; }
  const bots = enabledBots(db, tenantId);
  for (const bot of bots) {
    if (bot.trigger_type !== 'tag_added') continue;
    const filterTag = (bot.trigger_value || '').trim();
    if (filterTag && filterTag.toLowerCase() !== String(tag).trim().toLowerCase()) continue;
    const convoRow = db.prepare(
      'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 1'
    ).get(contactId, tenantId);
    runAsync(db, bot, {
      convoId:       convoRow?.id || null,
      contactId,
      messageBody:   '',
      provider:      convoRow?.provider || null,
      integrationId: convoRow?.integration_id || null,
      expedientId, tag,
      tenantId,
    });
  }
}

// ─── Internal helpers ───

function enabledBots(db, tenantId) {
  const rows = db.prepare('SELECT * FROM salsbots WHERE enabled = 1 AND tenant_id = ?').all(tenantId);
  return rows.map(r => ({ ...r, steps: JSON.parse(r.steps || '[]') }));
}

// Walks a path array through nested step structures. Returns
// { step, containerArr, idxInContainer, topLevelIdx } or null.
// Path encodings:
//   [0]                                → top-level steps[0]
//   [0, 'cases', 4, 'steps', 1]       → branch case 4 substep 1
//   [0, 'default', 2]                 → branch default substep 2
//   [0, 'reminders', 1, 'steps', 0]   → reminder_timer reminder 1 substep 0
function _walkStepPath(rootSteps, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let containerArr = rootSteps;
  let idxInContainer = path[0];
  let step = containerArr?.[idxInContainer];
  let i = 1;
  while (i < path.length && step) {
    const seg = path[i];
    if (seg === 'cases') {
      const caseIdx = path[i + 1];
      const cs = step.config?.cases?.[caseIdx];
      if (!cs) return null;
      containerArr = cs.steps;
      idxInContainer = path[i + 3];
      step = containerArr?.[idxInContainer];
      i += 4;
    } else if (seg === 'default') {
      const subIdx = path[i + 1];
      containerArr = step.config?.default;
      idxInContainer = subIdx;
      step = containerArr?.[idxInContainer];
      i += 2;
    } else if (seg === 'reminders') {
      const remIdx = path[i + 1];
      const rem = step.config?.reminders?.[remIdx];
      if (!rem) return null;
      containerArr = rem.steps;
      idxInContainer = path[i + 3];
      step = containerArr?.[idxInContainer];
      i += 4;
    } else {
      return null;
    }
  }
  return { step, containerArr, idxInContainer, topLevelIdx: path[0] };
}

// Verifica si el mensaje del contexto matchea algún case del PRIMER branch
// del bot (la "puerta de entrada" del flujo). Si es así, el mensaje es un
// intent de re-entrada y debe cancelar el wait activo en lugar de alimentarlo.
function _messageMatchesFirstBranch(db, bot, ctx) {
  const firstBranch = (bot.steps || []).find(s => s.type === 'branch');
  if (!firstBranch?.config?.cases?.length) return false;
  for (const c of firstBranch.config.cases) {
    if (!c.rules?.length) continue;
    const op = c.rules_op === 'or' ? 'some' : 'every';
    try {
      const matched = c.rules[op](rule => evaluateRule(db, rule, ctx));
      if (matched) return true;
    } catch (_) {}
  }
  return false;
}

function runAsync(db, bot, ctx) {
  if (ctx.contactId && bot.id) {
    try {
      // Si hay un wait_response suspendido para este bot+contacto, verificar
      // si el mensaje es un "re-entry" (matchea el primer branch del bot).
      // Si sí → cancelar el wait viejo y arrancar run fresco.
      // Si no → dejar que resumeWaitsForContact lo maneje (flujo normal).
      const pendingWait = db.prepare(
        "SELECT id FROM bot_run_waits WHERE bot_id=? AND contact_id=? AND tenant_id=? AND status='waiting' LIMIT 1"
      ).get(bot.id, ctx.contactId, ctx.tenantId);
      if (pendingWait) {
        const isReEntry = _messageMatchesFirstBranch(db, bot, ctx);
        if (isReEntry) {
          // Mensaje de re-entrada: cancelar wait + matar runs activos → arrancar fresco
          db.prepare(
            "UPDATE bot_run_waits SET status='cancelled' WHERE bot_id=? AND contact_id=? AND tenant_id=? AND status='waiting'"
          ).run(bot.id, ctx.contactId, ctx.tenantId);
          const stale = db.prepare(
            "SELECT id FROM bot_runs WHERE bot_id=? AND contact_id=? AND tenant_id=? AND status IN ('running','paused')"
          ).all(bot.id, ctx.contactId, ctx.tenantId);
          for (const r of stale) killRun(db, r.id);
          _log('info', `bot ${bot.id}: re-entrada detectada — wait cancelado, arrancando run fresco para contacto ${ctx.contactId}`);
          // Continúa y arranca nuevo run abajo
        } else {
          _log('info', `bot ${bot.id} tiene wait suspendido para contacto ${ctx.contactId} — no se inicia nuevo run`);
          return;
        }
      } else {
        // Sin wait pendiente: matar runs activos para evitar duplicados.
        const active = db.prepare(
          "SELECT id FROM bot_runs WHERE bot_id=? AND contact_id=? AND tenant_id=? AND status IN ('running','paused')"
        ).all(bot.id, ctx.contactId, ctx.tenantId);
        for (const row of active) {
          _log('info', `matando ejecución duplicada run=${row.id} bot=${bot.id} contacto=${ctx.contactId}`);
          killRun(db, row.id);
        }
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
      'SELECT paused FROM contact_bot_pauses WHERE contact_id = ? AND bot_id = ? AND tenant_id = ?'
    ).get(ctx.contactId, bot.id, ctx.tenantId);
    if (pause?.paused) {
      // Pausa manual vía UI (handover/asesor) — respetar siempre.
      _log('warn', `bot ${bot.id} pausado para contacto ${ctx.contactId}, omitiendo.`);
      return;
    }
  }
  if (ctx.convoId) {
    const convoPause = db.prepare(
      'SELECT bot_paused FROM conversations WHERE id = ? AND tenant_id = ?'
    ).get(ctx.convoId, ctx.tenantId);
    if (convoPause?.bot_paused) {
      _log('warn', `bot ${bot.id}: conversación ${ctx.convoId} tiene bot_paused=1, omitiendo.`);
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
      INSERT INTO bot_runs (tenant_id, bot_id, bot_name, contact_id, expedient_id, trigger_type, status, current_step, total_steps)
      VALUES (?, ?, ?, ?, ?, ?, 'running', 0, ?)
    `).run(ctx.tenantId, bot.id, bot.name, ctx.contactId || null, ctx.expedientId || null, bot.trigger_type, totalSteps);
    runId = r.lastInsertRowid;
    _signals.set(runId, { kill: false, pause: false });
  } catch (e) {
    _log('warn', `no se pudo crear bot_run: ${e.message}`);
  }

  const contact = ctx.contactId
    ? db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(ctx.contactId, ctx.tenantId)
    : null;
  const fullCtx = { ...ctx, contact, runId, _botId: bot.id, _botName: bot.name };

  let finalStatus = 'done';
  let errorMsg = null;

  // Ejecutar la lista de steps secuencialmente. Si algún step devuelve
  // 'suspend' (wait_response), el run queda en estado 'paused' y la fila en
  // bot_run_waits se encarga del seguimiento. resumeRun() lo continúa después.
  let suspended = false;
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
      // Pasamos el índice y runId al ctx para que el step wait_response pueda
      // persistir su posición en bot_run_waits.
      fullCtx._stepIndex = i;
      fullCtx._runId = runId;
      fullCtx._stepPath = [i];
      const result = await executeStep(db, step, fullCtx);
      _log('info', `paso ${i + 1} completado, result=${result}`);
      if (result === 'suspend') { suspended = true; break; }
      if (result === true || result === 'stop') break;
    } catch (stepErr) {
      _log('error', `paso ${i + 1} ("${step.type}") lanzó error: ${stepErr.message}`);
      finalStatus = 'error';
      errorMsg = `Paso ${i + 1} (${step.type}): ${stepErr.message}`;
      break;
    }
  }

  // Si quedó suspendido, marcar como paused y salir sin finalizar
  if (suspended) {
    if (runId) {
      try { db.prepare(`UPDATE bot_runs SET status = 'paused' WHERE id = ?`).run(runId); } catch (_) {}
    }
    _log('info', `bot ${bot.id} "${bot.name}" suspendido esperando respuesta (run ${runId}).`);
    return;
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
          'SELECT id, provider FROM integrations WHERE id = ? AND tenant_id = ?'
        ).get(Number(c.channelId), ctx.tenantId);
        if (intRow) {
          const existing = db.prepare(
            'SELECT id FROM conversations WHERE contact_id = ? AND integration_id = ? AND tenant_id = ? LIMIT 1'
          ).get(ctx.contactId, intRow.id, ctx.tenantId);
          targetConvoId = existing?.id || null;
        }
      }

      if (!targetConvoId) {
        _log('warn', `mensaje: no hay conversación para contacto ${ctx.contactId}`);
        return false;
      }

      try {
        const convo = convoSvc.getById(db, null, targetConvoId);
        if (!convo) return false;
        _log('info', `enviando mensaje a conversación ${targetConvoId} (${convo.provider}): "${text.slice(0, 80)}"`);
        const externalId = await sendMessage(db, convo, text);
        convoSvc.addMessage(db, null, targetConvoId, {
          externalId,
          direction: 'outgoing',
          provider:  convo.provider,
          body:      text,
          status:    'sent',
        });
        _log('info', `mensaje enviado OK, externalId=${externalId}`);
      } catch (err) {
        _log('error', `error enviando mensaje: ${err.message}`);
        throw new Error(`Envío de mensaje falló: ${err.message}`);
      }
      return false;
    }

    case 'template': {
      // Envía una plantilla wa_api APROBADA usando sendWhatsAppTemplate.
      // Los placeholders mapeados (contactField) se rellenan automáticamente
      // desde el contacto. Los Manual usan los valores fijos guardados en c.manualValues.
      const templateId = Number(c.templateId);
      if (!templateId) { _log('warn', 'template: sin templateId'); return false; }
      if (!ctx.convoId) { _log('warn', 'template: sin convoId'); return false; }
      try {
        const convo = convoSvc.getById(db, null, ctx.convoId);
        if (!convo) return false;
        const result = await sendWhatsAppTemplate(db, convo, templateId, c.manualValues || [], { autoFallback: true });
        convoSvc.addMessage(db, null, ctx.convoId, {
          externalId: result.externalId,
          direction: 'outgoing',
          provider:  convo.provider,
          body:      result.renderedBody,
          status:    'sent',
        });
        _log('info', `template ${templateId} enviada OK, externalId=${result.externalId}`);
      } catch (err) {
        _log('error', `error enviando template: ${err.message}`);
        throw new Error(`Envío de plantilla ${templateId} falló: ${err.message}`);
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
      if (ms <= 0) return false;

      // Timers <5s se ejecutan in-memory (overhead de persistir no se justifica).
      // Cualquier cosa mayor se persiste en bot_run_waits para sobrevivir reinicios.
      if (ms < 5000) {
        _log('info', `timer: esperando ${ms}ms in-memory`);
        await new Promise(r => setTimeout(r, ms));
        return false;
      }

      const runId = ctx._runId;
      const stepIndex = ctx._stepIndex;
      if (!runId) {
        _log('warn', `timer: sin _runId — fallback in-memory ${ms}ms (no se podra resumir tras restart)`);
        await new Promise(r => setTimeout(r, ms));
        return false;
      }
      const expiresAt = Math.floor(Date.now() / 1000) + Math.ceil(ms / 1000);
      const ctxSnapshot = {
        chainDepth:    ctx.chainDepth || 0,
        provider:      ctx.provider || null,
        integrationId: ctx.integrationId || null,
        pipelineId:    ctx.pipelineId || null,
        stageId:       ctx.stageId || null,
        messageBody:   ctx.messageBody || '',
        path:          Array.isArray(ctx._stepPath) ? ctx._stepPath : [stepIndex],
      };
      db.prepare(`
        INSERT INTO bot_run_waits (
          tenant_id, run_id, bot_id, contact_id, conversation_id, expedient_id,
          wait_step_id, wait_step_index, ctx_json, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
      `).run(
        ctx.tenantId,
        runId,
        db.prepare('SELECT bot_id FROM bot_runs WHERE id = ? AND tenant_id = ?').get(runId, ctx.tenantId)?.bot_id || 0,
        ctx.contactId || null,
        ctx.convoId || null,
        ctx.expedientId || null,
        step._id || `s${stepIndex}`,
        stepIndex,
        JSON.stringify(ctxSnapshot),
        expiresAt
      );
      _log('info', `timer: run ${runId} suspendido hasta ${new Date(expiresAt*1000).toISOString()} (${ms}ms)`);
      return 'suspend';
    }

    case 'stage': {
      const pipelineId = Number(c.pipelineId);
      const stageId    = Number(c.stageId);
      if (!pipelineId || !stageId || !ctx.contactId) return false;

      try {
        // BUSCAR el expediente ABIERTO del contacto (en CUALQUIER pipeline).
        // Antes la query buscaba por contact_id + pipeline_id, lo que causaba
        // duplicados cuando el bot cruzaba al contacto entre pipelines:
        // si Wuichy tenía exp en "1 MES" y el bot intentaba moverlo a
        // "8 MESES", la query no encontraba (pipeline_id distinto) y CREABA
        // un expediente nuevo. Resultado: 2 expedientes abiertos del mismo
        // contacto + el viejo "atorado" en su pipeline original.
        // Ahora busca cualquier expediente en estado in_progress y lo mueve.
        // Si lo movemos a un pipeline distinto, también cambia pipeline_id.
        const exp = db.prepare(`
          SELECT e.id
            FROM expedients e
            JOIN stages s ON s.id = e.stage_id
           WHERE e.contact_id = ? AND e.tenant_id = ?
             AND COALESCE(s.kind, 'in_progress') = 'in_progress'
           ORDER BY e.created_at DESC
           LIMIT 1
        `).get(ctx.contactId, ctx.tenantId);

        let resolvedExpId = null;
        if (exp) {
          expedientSvc.update(db, ctx.tenantId, exp.id, { stageId, pipelineId });
          resolvedExpId = exp.id;
          _log('info', `expediente ${exp.id} movido a etapa ${stageId} (pipeline ${pipelineId})`);
        } else {
          const created = expedientSvc.create(db, ctx.tenantId, {
            contactId:  ctx.contactId,
            pipelineId,
            stageId,
          });
          resolvedExpId = created.id;
          _log('info', `expediente creado (${created.id}) en pipeline ${pipelineId} etapa ${stageId} (no había abierto)`);
        }

        // Encadenar: dispara bots que escuchan la nueva etapa.
        // Sin esto, una secuencia de bots por etapa solo correría hasta el
        // primero (caso reportado por el user: bot etapa 1 mueve a 2 pero
        // bot etapa 2 no se activaba). Pasamos chainDepth+1 para anti-loop.
        const nextDepth = (ctx.chainDepth || 0) + 1;
        triggerPipelineStage(db, {
          expedientId: resolvedExpId,
          contactId:   ctx.contactId,
          pipelineId,
          stageId,
          chainDepth:  nextDepth,
        });
      } catch (err) {
        _log('error', `error en step stage: ${err.message}`);
        throw new Error(`Cambio de etapa falló: ${err.message}`);
      }
      return false;
    }

    case 'assign': {
      // c.assignee: nombre o ID del asesor a asignar al expediente.
      // Acepta ambos formatos por retrocompat (UI solo guardaba nombre).
      if (!ctx.expedientId) {
        _log('warn', 'assign: sin expedientId, saltando');
        return false;
      }
      const raw = String(c.assignee || '').trim();
      if (!raw) {
        _log('warn', 'assign: sin asesor configurado, saltando');
        return false;
      }
      let advisor = null;
      // Intentar como ID numérico primero
      if (/^\d+$/.test(raw)) {
        advisor = db.prepare('SELECT id, name FROM advisors WHERE id = ? AND tenant_id = ?').get(Number(raw), ctx.tenantId);
      }
      // Si no, buscar por nombre (case-insensitive, exact match)
      if (!advisor) {
        advisor = db.prepare('SELECT id, name FROM advisors WHERE LOWER(name) = LOWER(?) AND tenant_id = ?').get(raw, ctx.tenantId);
      }
      // Si no, buscar por nombre LIKE (primer match)
      if (!advisor) {
        advisor = db.prepare('SELECT id, name FROM advisors WHERE LOWER(name) LIKE LOWER(?) AND tenant_id = ? LIMIT 1').get(`%${raw}%`, ctx.tenantId);
      }
      if (!advisor) {
        _log('warn', `assign: no se encontró asesor "${raw}" en tenant ${ctx.tenantId}`);
        return false;
      }
      try {
        db.prepare('UPDATE expedients SET assigned_advisor_id = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
          .run(advisor.id, ctx.expedientId, ctx.tenantId);
        _log('info', `assign: expediente ${ctx.expedientId} asignado a ${advisor.name} (id=${advisor.id})`);
      } catch (e) {
        _log('error', `assign error: ${e.message}`);
      }
      return false;
    }

    case 'tag': {
      // c.tag puede ser:
      //   - string simple ("interesado") — legacy
      //   - string separado por coma ("interesado,vip,cotizado") — nuevo formato chips
      //   - array (["interesado","vip"]) — defensivo
      const raw = c.tag;
      const incoming = Array.isArray(raw)
        ? raw.map(t => String(t).trim()).filter(Boolean)
        : String(raw || '').split(',').map(t => t.trim()).filter(Boolean);
      if (!incoming.length || !ctx.contactId) return false;
      try {
        // Tags viven en contact_tags(contact_id, tag, tenant_id) — UNIQUE(contact_id, tag)
        const ins = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag, tenant_id) VALUES (?, ?, ?)');
        const added = [];
        for (const t of incoming) {
          const r = ins.run(ctx.contactId, t, ctx.tenantId);
          if (r.changes > 0) added.push(t);
        }
        _log('info', `etiquetas ${JSON.stringify(incoming)} en contacto ${ctx.contactId} (añadidas=${JSON.stringify(added)})`);
      } catch (err) {
        _log('error', `error en step tag: ${err.message}`);
        throw new Error(`Asignar etiqueta falló: ${err.message}`);
      }
      return false;
    }

    case 'stop_bot': {
      // Termina el run actual y limpia cualquier pausa previa para que el bot
      // pueda volver a dispararse en el siguiente mensaje. Los loops mid-conversación
      // ya están protegidos por bot_run_waits (wait_response activo).
      if (ctx.contactId && ctx._botId) {
        try {
          db.prepare(
            'DELETE FROM contact_bot_pauses WHERE contact_id = ? AND bot_id = ? AND tenant_id = ?'
          ).run(ctx.contactId, ctx._botId, ctx.tenantId);
        } catch (_) {}
      }
      _log('info', `bot ${ctx._botId} stop_bot para contacto ${ctx.contactId}`);
      return 'stop';
    }

    case 'create_task': {
      // Crea una tarea en el módulo de Recordatorios. Útil para programar
      // follow-ups automáticos. Hereda el asesor del lead si no se configuró
      // uno específico.
      const title = replaceVars(c.title || '', ctx).trim();
      if (!title) {
        _log('warn', 'create_task sin título — saltando');
        return false;
      }
      const description = replaceVars(c.description || '', ctx).trim() || null;
      // offsetAmount + offsetUnit → minutos (usado para due_at relativo a ahora)
      const offsetAmount = Number(c.offsetAmount || 1);
      const offsetUnit   = c.offsetUnit || 'h';
      const offsetMin    = offsetUnit === 'd' ? offsetAmount * 1440
                         : offsetUnit === 'h' ? offsetAmount * 60
                         : offsetAmount;
      const dueAt = Math.floor(Date.now() / 1000) + (offsetMin * 60);
      const durationMin = Math.max(Number(c.durationMinutes || 30), 1);

      // Asesor: configurado > asesor del lead > null
      let assignedAdvisorId = c.assignToAdvisorId ? Number(c.assignToAdvisorId) : null;
      if (!assignedAdvisorId && ctx.expedientId) {
        try {
          const exp = db.prepare('SELECT assigned_advisor_id FROM expedients WHERE id = ? AND tenant_id = ?').get(ctx.expedientId, ctx.tenantId);
          assignedAdvisorId = exp?.assigned_advisor_id || null;
        } catch {}
      }

      try {
        // Insertar directo (sin pasar por service.create) para evitar el chequeo
        // de conflictos — los bots automáticos no deben fallar por solapamientos.
        db.prepare(`
          INSERT INTO tasks (tenant_id, title, description, due_at, duration_minutes, assigned_advisor_id, expedient_id, contact_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ctx.tenantId, title, description, dueAt, durationMin,
          assignedAdvisorId, ctx.expedientId || null, ctx.contactId || null
        );
        _log('info', `create_task: "${title}" creada (due=${new Date(dueAt*1000).toISOString()}, asignado=${assignedAdvisorId || 'sin'})`);
      } catch (e) {
        _log('error', `create_task error: ${e.message}`);
      }
      return false;
    }

    case 'update_field': {
      // Actualiza un campo personalizado del expediente.
      const fieldId = Number(c.fieldId || 0);
      if (!fieldId) {
        _log('warn', 'update_field sin fieldId — saltando');
        return false;
      }
      if (!ctx.expedientId) {
        _log('warn', 'update_field sin expedientId — saltando');
        return false;
      }
      // Validar que el campo pertenece a este tenant y entidad expedient
      const fieldDef = db.prepare(
        "SELECT id, label, field_type FROM custom_field_defs WHERE id = ? AND tenant_id = ? AND entity = 'expedient'"
      ).get(fieldId, ctx.tenantId);
      if (!fieldDef) {
        _log('warn', `update_field: campo ${fieldId} no existe en tenant ${ctx.tenantId}`);
        return false;
      }
      const value = replaceVars(c.value || '', ctx);
      try {
        db.prepare(`
          INSERT INTO custom_field_values (tenant_id, entity, record_id, field_id, value)
          VALUES (?, 'expedient', ?, ?, ?)
          ON CONFLICT(entity, record_id, field_id) DO UPDATE SET value = excluded.value
        `).run(ctx.tenantId, ctx.expedientId, fieldId, value);
        _log('info', `update_field: "${fieldDef.label}" = "${value}" en expediente ${ctx.expedientId}`);
      } catch (e) {
        _log('error', `update_field error: ${e.message}`);
      }
      return false;
    }

    case 'http': {
      // Webhook / HTTP request — fire-and-forget para no bloquear el bot.
      // Permite integrar con Zapier, n8n, Make, Sheets, ERPs, etc.
      const url = (c.url || '').trim();
      if (!url) {
        _log('warn', `http step sin URL — saltando`);
        return false;
      }
      const method = (c.method || 'POST').toUpperCase();
      const timeoutMs = Math.min(Math.max(Number(c.timeoutSec || 10), 1) * 1000, 30000);

      // Fetch contact + expedient para construir payload por defecto
      const contact = ctx.contactId
        ? db.prepare('SELECT id, first_name, last_name, phone, email FROM contacts WHERE id = ? AND tenant_id = ?').get(ctx.contactId, ctx.tenantId)
        : null;
      const expedient = ctx.expedientId
        ? db.prepare(`
            SELECT e.id, e.name, e.value, e.pipeline_id, e.stage_id,
                   p.name AS pipeline_name, s.name AS stage_name
              FROM expedients e
              LEFT JOIN pipelines p ON p.id = e.pipeline_id
              LEFT JOIN stages    s ON s.id = e.stage_id
             WHERE e.id = ? AND e.tenant_id = ?
          `).get(ctx.expedientId, ctx.tenantId)
        : null;

      const defaultPayload = {
        bot:     { id: ctx._botId || null, name: ctx._botName || null },
        contact: contact ? {
          id:        contact.id,
          firstName: contact.first_name || null,
          lastName:  contact.last_name  || null,
          phone:     contact.phone      || null,
          email:     contact.email      || null,
        } : null,
        lead: expedient ? {
          id:           expedient.id,
          name:         expedient.name,
          value:        expedient.value,
          pipelineId:   expedient.pipeline_id,
          pipelineName: expedient.pipeline_name,
          stageId:      expedient.stage_id,
          stageName:    expedient.stage_name,
        } : null,
        message:     ctx.messageBody || '',
        triggeredAt: new Date().toISOString(),
      };

      // Headers — formato "Key: Value" uno por línea
      const headers = { 'Content-Type': 'application/json' };
      if (c.headers) {
        String(c.headers).split('\n').forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const k = line.slice(0, idx).trim();
            const v = line.slice(idx + 1).trim();
            if (k && v) headers[k] = v;
          }
        });
      }

      // Body — vacío = JSON automático con todos los datos. Custom = se sustituyen variables.
      let body;
      if (method !== 'GET' && method !== 'DELETE') {
        const customBody = (c.body || '').trim();
        if (customBody) {
          body = replaceVars(customBody, { ...ctx, contact });
        } else {
          body = JSON.stringify(defaultPayload, null, 2);
        }
      }

      // Fire-and-forget: no bloqueamos el bot esperando la respuesta del webhook.
      (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const res = await fetch(url, {
            method,
            headers,
            body: (method === 'GET' || method === 'DELETE') ? undefined : body,
            signal: controller.signal,
          });
          clearTimeout(timer);
          _log('info', `webhook ${method} ${url} → HTTP ${res.status}`);
        } catch (err) {
          _log('error', `webhook ${method} ${url} falló: ${err.message}`);
        }
      })();

      return false; // continuar con el siguiente step
    }

    case 'handover': {
      // Asignación a humano: pausa el bot, opcionalmente reasigna el lead a un
      // asesor específico, agrega una etiqueta de seguimiento y registra una
      // nota interna como actividad. Termina la cadena (return true).
      const targetAdvisorId = c.assignToAdvisorId ? Number(c.assignToAdvisorId) : null;
      const tagToAdd        = (c.addTag || '').trim();
      const noteText        = (c.note   || '').trim();

      // 1) Pausar el bot para esta conversación
      if (ctx.convoId) {
        try {
          convoSvc.setBotPaused(db, null, ctx.convoId, true);
          _log('info', `handover: bot pausado en conversación ${ctx.convoId}`);
        } catch (e) {
          _log('error', `handover: error pausando bot: ${e.message}`);
        }
      }

      // 2) Reasignar lead a asesor específico
      if (targetAdvisorId && ctx.expedientId) {
        try {
          const adv = db.prepare('SELECT id FROM advisors WHERE id = ? AND tenant_id = ?').get(targetAdvisorId, ctx.tenantId);
          if (adv) {
            db.prepare('UPDATE expedients SET assigned_advisor_id = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
              .run(targetAdvisorId, ctx.expedientId, ctx.tenantId);
            _log('info', `handover: expediente ${ctx.expedientId} asignado a asesor ${targetAdvisorId}`);
          } else {
            _log('warn', `handover: asesor ${targetAdvisorId} no existe en tenant ${ctx.tenantId}`);
          }
        } catch (e) {
          _log('error', `handover: error asignando: ${e.message}`);
        }
      }

      // 3) Agregar etiqueta de seguimiento al contacto (tabla contact_tags)
      if (tagToAdd && ctx.contactId) {
        try {
          const r = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag, tenant_id) VALUES (?, ?, ?)')
            .run(ctx.contactId, tagToAdd, ctx.tenantId);
          if (r.changes > 0) _log('info', `handover: etiqueta "${tagToAdd}" agregada al contacto ${ctx.contactId}`);
        } catch (e) {
          _log('error', `handover: error agregando etiqueta: ${e.message}`);
        }
      }

      // 4) Registrar nota como actividad para el humano que tome el lead
      if (noteText && ctx.expedientId) {
        try {
          require('../expedients/activity').log(db, {
            expedientId: ctx.expedientId,
            contactId:   ctx.contactId,
            type:        'note',
            description: `🤖 Bot → humano: ${noteText}`,
          });
        } catch (e) {
          _log('error', `handover: error registrando nota: ${e.message}`);
        }
      }

      // 5) Notificación in-app al asesor que recibe el lead
      const notifAdvisorId = targetAdvisorId || null;
      if (notifAdvisorId) {
        try {
          const notifSvc = require('../notifications/service');
          // Obtener nombre del contacto para el mensaje
          const contactRow = ctx.contactId
            ? db.prepare('SELECT name FROM contacts WHERE id = ? AND tenant_id = ?').get(ctx.contactId, ctx.tenantId)
            : null;
          const contactName = contactRow?.name || 'un lead';
          notifSvc.createNotification(db, {
            tenantId:  ctx.tenantId,
            advisorId: notifAdvisorId,
            type:      'handover',
            title:     `Nueva conversación asignada`,
            body:      `El bot te asignó la conversación con ${contactName}`,
            link:      'chats',
          });
          _log('info', `handover: notificación in-app enviada al asesor ${notifAdvisorId}`);
        } catch (e) {
          _log('error', `handover: error creando notificación in-app: ${e.message}`);
        }
      }

      return true; // detener cadena
    }

    case 'stop_and_start': {
      // Termina el bot actual y dispara otro bot (mismo contacto, mismo expediente).
      // No pausa la conversación — el nuevo bot toma el relevo.
      const targetBotId = Number(c.targetBotId);
      if (!targetBotId) {
        _log('error', 'stop_and_start sin targetBotId — terminando bot actual sin lanzar otro');
        return true;
      }
      const targetBot = db.prepare('SELECT * FROM salsbots WHERE id = ? AND tenant_id = ?').get(targetBotId, ctx.tenantId);
      if (!targetBot) {
        _log('error', `stop_and_start: bot destino #${targetBotId} no existe`);
        return true;
      }
      if (!targetBot.enabled) {
        _log('info', `stop_and_start: bot destino "${targetBot.name}" está desactivado — no se ejecuta`);
        return true;
      }
      // Hidratar steps
      try { targetBot.steps = JSON.parse(targetBot.steps || '[]'); } catch { targetBot.steps = []; }
      const nextDepth = (ctx.chainDepth || 0) + 1;
      if (nextDepth > MAX_BOT_CHAIN_DEPTH) {
        _log('error', `stop_and_start: chain depth ${nextDepth} excede el máximo (${MAX_BOT_CHAIN_DEPTH}). Posible bucle — abortando.`);
        return true;
      }
      _log('info', `stop_and_start: terminando bot actual y lanzando "${targetBot.name}" (chain=${nextDepth})`);
      runAsync(db, targetBot, {
        convoId:       ctx.convoId,
        contactId:     ctx.contactId,
        messageBody:   '',
        provider:      ctx.provider,
        integrationId: ctx.integrationId,
        expedientId:   ctx.expedientId,
        pipelineId:    ctx.pipelineId,
        stageId:       ctx.stageId,
        chainDepth:    nextDepth,
        tenantId:      ctx.tenantId,
      });
      return true;
    }

    case 'condition': {
      // Si tiene formato v2 (cases[]), delegar completamente a la lógica branch
      if (Array.isArray(c.cases) && c.cases.length) {
        return executeStep(db, { ...step, type: 'branch' }, ctx);
      }
      // Formato viejo: si condition falla, detener el flow
      const passes = evaluateCondition(db, c, ctx);
      return !passes;
    }

    case 'branch': {
      // Multi-case routing con soporte de AND/OR multi-regla por caso.
      // Formato nuevo: cases[i].rules[] + rules_op ('and'|'or') + steps[].
      // Formato viejo: cases[i].field/op/value + branch[] — compat total.
      const cases = Array.isArray(c.cases) ? c.cases : [];
      let matchedSteps = null;
      let matchedLabel = null;
      let matchedCaseIdx = -1;

      for (let cIdx = 0; cIdx < cases.length; cIdx++) {
        const cs = cases[cIdx];
        try {
          // Normalizar: formato viejo → formato nuevo
          const rules = Array.isArray(cs.rules) && cs.rules.length
            ? cs.rules
            : (cs.field ? [{ field: cs.field, op: cs.op, value: cs.value }] : []);
          if (!rules.length) continue;

          const rulesOp = cs.rules_op || 'and';
          const results = rules.map(rule => evaluateRule(db, rule, ctx));
          const isMatch = rulesOp === 'or' ? results.some(Boolean) : results.every(Boolean);

          if (isMatch) {
            // Soporte formato nuevo (steps) y viejo (branch)
            matchedSteps = Array.isArray(cs.steps) ? cs.steps
              : (Array.isArray(cs.branch) ? cs.branch : []);
            matchedLabel = rules.map(r => `${r.field}:${r.value}`).join(rulesOp === 'or' ? '|' : '&');
            matchedCaseIdx = cIdx;
            break;
          }
        } catch (err) {
          _log('error', `branch case error: ${err.message}`);
        }
      }

      if (matchedSteps === null && Array.isArray(c.default)) {
        matchedSteps = c.default;
        matchedLabel = '(default)';
        matchedCaseIdx = -1;
      }
      if (!matchedSteps) {
        _log('info', 'branch: ningún case matcheó y no hay default — saltando');
        return false;
      }
      _log('info', `branch matched "${matchedLabel}" — ejecutando ${matchedSteps.length} pasos`);
      const parentPath = Array.isArray(ctx._stepPath) ? ctx._stepPath : [];
      for (let si = 0; si < matchedSteps.length; si++) {
        const subStep = matchedSteps[si];
        const subPath = matchedCaseIdx === -1
          ? [...parentPath, 'default', si]
          : [...parentPath, 'cases', matchedCaseIdx, 'steps', si];
        const subCtx = { ...ctx, _stepPath: subPath };
        try {
          const result = await executeStep(db, subStep, subCtx);
          if (result === 'stop') return 'stop';
          if (result === true) return true;
          if (result === 'suspend') return 'suspend';
        } catch (subErr) {
          _log('error', `branch sub-step error: ${subErr.message}`);
          break;
        }
      }
      return true;
    }

    case 'wait_response': {
      // Suspende el run hasta que llegue una señal: respuesta del lead,
      // timeout, o falla de entrega. Persiste el estado en bot_run_waits.
      const timeoutMin = Number(c.timeoutMinutes || 1440); // default 24h
      const expiresAt = Math.floor(Date.now() / 1000) + (timeoutMin * 60);
      const runId = ctx._runId;
      const stepIndex = ctx._stepIndex;
      if (!runId) {
        _log('warn', 'wait_response sin runId — no se puede suspender, saltando');
        return false;
      }
      // Guardar contexto serializable (sin runId/stepIndex que ya tenemos como columnas)
      const ctxSnapshot = {
        chainDepth:    ctx.chainDepth || 0,
        provider:      ctx.provider || null,
        integrationId: ctx.integrationId || null,
        pipelineId:    ctx.pipelineId || null,
        stageId:       ctx.stageId || null,
        messageBody:   ctx.messageBody || '',
        path:          Array.isArray(ctx._stepPath) ? ctx._stepPath : [stepIndex],
      };
      db.prepare(`
        INSERT INTO bot_run_waits (
          tenant_id, run_id, bot_id, contact_id, conversation_id, expedient_id,
          wait_step_id, wait_step_index, ctx_json, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
      `).run(
        ctx.tenantId,
        runId,
        db.prepare('SELECT bot_id FROM bot_runs WHERE id = ? AND tenant_id = ?').get(runId, ctx.tenantId)?.bot_id || 0,
        ctx.contactId || null,
        ctx.convoId || null,
        ctx.expedientId || null,
        step._id || `s${stepIndex}`,
        stepIndex,
        JSON.stringify(ctxSnapshot),
        expiresAt
      );
      _log('info', `wait_response: run ${runId} suspendido hasta ${new Date(expiresAt*1000).toISOString()} (timeout ${timeoutMin}min)`);
      return 'suspend';
    }

    case 'book_appointment': {
      // El bot ya no agenda automáticamente. Su función es:
      // 1) Enviar notificación in-app al asesor para que abra el modal
      // 2) Continuar al siguiente step inmediatamente
      // El modal en el frontend (pipeline drop) es quien crea la cita.
      try {
        const notifSvc = require('../notifications/service');
        // Obtener asesor destino: el asignado al lead, o el que configuró el step
        let targetAdvisorId = c.advisorId || null;
        if (!targetAdvisorId && ctx.expedientId) {
          const exp = db.prepare('SELECT assigned_advisor_id FROM expedients WHERE id = ? AND tenant_id = ?')
            .get(ctx.expedientId, ctx.tenantId);
          targetAdvisorId = exp?.assigned_advisor_id || null;
        }
        // Si no hay asesor específico, notificar a todos los admins
        const targets = targetAdvisorId
          ? [targetAdvisorId]
          : db.prepare("SELECT id FROM advisors WHERE tenant_id = ? AND role = 'admin' AND active = 1")
              .all(ctx.tenantId).map(a => a.id);

        const contactRow = ctx.contactId
          ? db.prepare('SELECT first_name, last_name FROM contacts WHERE id = ? AND tenant_id = ?')
              .get(ctx.contactId, ctx.tenantId)
          : null;
        const contactName = contactRow
          ? `${contactRow.first_name || ''} ${contactRow.last_name || ''}`.trim() || 'un lead'
          : 'un lead';

        for (const advisorId of targets) {
          notifSvc.createNotification(db, {
            tenantId:  ctx.tenantId,
            advisorId,
            type:      'appointment',
            title:     '📅 Cita pendiente por agendar',
            body:      `${contactName} necesita agendar una cita`,
            link:      'pipelines',
          });
        }
        _log('info', `book_appointment: notificación enviada a ${targets.length} asesor(es)`);
      } catch (err) {
        _log('error', `book_appointment notif error: ${err.message}`);
      }
      return false; // continúa al siguiente step
    }

    case 'cancel_appointment': {
      if (!ctx.contactId) return false;
      try {
        const cancelled = apptSvc.cancelLatest(db, ctx.tenantId, ctx.contactId);
        if (!cancelled) {
          _log('info', 'cancel_appointment: no hay cita activa para este contacto');
          return false;
        }

        const rawMsg = c.message || 'Tu cita del {fecha_cita} a las {hora_cita} ha sido cancelada.';
        const msg = replaceVars(rawMsg, ctx)
          .replace(/\{fecha_cita\}/g, cancelled.fecha)
          .replace(/\{hora_cita\}/g,  cancelled.hora);

        if (msg && ctx.convoId) {
          const convo = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(ctx.convoId, ctx.tenantId);
          if (convo) await sendMessage(db, convo, msg);
        }
        _log('info', `cancel_appointment: cita ${cancelled.id} cancelada`);
      } catch (err) {
        _log('error', `cancel_appointment error: ${err.message}`);
        throw new Error(`Cancelar cita falló: ${err.message}`);
      }
      return false;
    }

    case 'reschedule_appointment': {
      if (!ctx.contactId) return false;
      try {
        const appt = apptSvc.reschedule(db, ctx.tenantId, {
          contactId:   ctx.contactId,
          expedientId: ctx.expedientId || null,
          convoId:     ctx.convoId     || null,
          advisorId:   c.advisorId     || null,
          offsetDays:  c.offsetDays,
          time:        c.time,
          durationMin: c.durationMin,
        });

        const rawMsg = c.message || 'Tu cita ha sido reagendada para el {fecha_cita} a las {hora_cita}.';
        const msg = replaceVars(rawMsg, ctx)
          .replace(/\{fecha_cita\}/g, appt.fecha)
          .replace(/\{hora_cita\}/g,  appt.hora);

        if (msg && ctx.convoId) {
          const convo = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(ctx.convoId, ctx.tenantId);
          if (convo) await sendMessage(db, convo, msg);
        }
        _log('info', `reschedule_appointment: cita ${appt.id} reagendada a ${appt.fecha} ${appt.hora}`);
      } catch (err) {
        _log('error', `reschedule_appointment error: ${err.message}`);
        throw new Error(`Reagendar cita falló: ${err.message}`);
      }
      return false;
    }

    case 'reminder_timer': {
      // Programa jobs que se ejecutan X tiempo antes de la cita del contacto.
      // Cada rama en c.reminders[] genera un job independiente.
      // El bot continúa inmediatamente; los sub-steps corren cuando llega el momento.
      if (!ctx.contactId) return false;
      try {
        // Obtener la cita activa más reciente del contacto
        const appt = db.prepare(`
          SELECT id, starts_at FROM appointments
           WHERE contact_id = ? AND tenant_id = ? AND status IN ('scheduled','confirmed')
           ORDER BY starts_at DESC LIMIT 1
        `).get(ctx.contactId, ctx.tenantId);

        if (!appt) {
          _log('info', 'reminder_timer: no hay cita activa — skipping');
          return false;
        }

        const now = Math.floor(Date.now() / 1000);
        const reminders = Array.isArray(c.reminders) ? c.reminders : [];
        let scheduled = 0, skipped = 0;

        for (const rem of reminders) {
          if (!rem.steps?.length) continue;
          let fireAt;

          if (rem.mode === 'before') {
            // X minutos/horas/días antes de la cita
            const units = { min: 60, hour: 3600, day: 86400 };
            const secs  = Number(rem.value || 0) * (units[rem.unit] || 60);
            fireAt = appt.starts_at - secs;
          } else if (rem.mode === 'day_before_at') {
            // Día anterior a una hora fija (ej. 1 día antes a las 20:00)
            const days = Number(rem.value || 1);
            const [hh, mm] = (rem.time || '20:00').split(':').map(Number);
            const apptDate = new Date(appt.starts_at * 1000);
            const fireDate = new Date(apptDate);
            fireDate.setDate(fireDate.getDate() - days);
            fireDate.setHours(hh, mm, 0, 0);
            fireAt = Math.floor(fireDate.getTime() / 1000);
          } else {
            continue;
          }

          if (fireAt <= now) {
            // Ya pasó — registrar como skipped y continuar
            db.prepare(`
              INSERT INTO appointment_reminder_jobs
                (tenant_id, bot_id, run_id, contact_id, expedient_id, convo_id,
                 reminder_id, steps_json, ctx_json, fire_at, skipped, skip_reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'fire_time_already_passed')
            `).run(ctx.tenantId, ctx.botId, ctx.runId, ctx.contactId, ctx.expedientId || null,
                   ctx.convoId || null, rem.id || String(scheduled),
                   JSON.stringify(rem.steps), JSON.stringify(ctx), fireAt);
            skipped++;
            _log('info', `reminder_timer: rama "${rem.id}" skipped — fire_at ya pasó`);
          } else {
            db.prepare(`
              INSERT INTO appointment_reminder_jobs
                (tenant_id, bot_id, run_id, contact_id, expedient_id, convo_id,
                 reminder_id, steps_json, ctx_json, fire_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(ctx.tenantId, ctx.botId, ctx.runId, ctx.contactId, ctx.expedientId || null,
                   ctx.convoId || null, rem.id || String(scheduled),
                   JSON.stringify(rem.steps), JSON.stringify(ctx), fireAt);
            scheduled++;
          }
        }
        _log('info', `reminder_timer: ${scheduled} jobs programados, ${skipped} skipped`);
      } catch (err) {
        _log('error', `reminder_timer error: ${err.message}`);
      }
      return false;
    }

    case 'ai_reply': {
      if (!ctx.convoId) {
        _log('warn', 'ai_reply: no hay conversación activa');
        return false;
      }
      try {
        const settings = aiSvc.getSettings(db, ctx.tenantId);
        if (!settings.apiKey && settings.provider !== 'ollama') {
          _log('warn', 'ai_reply: sin API key configurada, paso omitido');
          return false;
        }
        const knowledge = aiSvc.getKnowledgeContext(db, ctx.tenantId);
        const history   = aiSvc.getConversationHistory(db, ctx.tenantId, ctx.convoId, 15);

        const instruction = replaceVars(c.instruction || '', ctx);
        const profileRow  = db.prepare("SELECT value FROM app_settings WHERE key = 'profile' AND tenant_id = ?").get(ctx.tenantId);
        const profile     = profileRow ? JSON.parse(profileRow.value) : {};
        const companyName = profile.businessName || profile.name || 'nuestra empresa';

        const systemPrompt = [
          instruction || `Eres un asesor de ventas de ${companyName}. Responde de forma profesional, amigable y concisa en el mismo idioma que usa el cliente. No uses markdown.`,
          knowledge ? `Fuentes de conocimiento:\n${knowledge}` : '',
        ].filter(Boolean).join('\n\n');

        const reply = await aiSvc.callAI(settings, systemPrompt, history.length ? history : [{ role: 'user', content: ctx.messageBody || '' }]);
        if (!reply || !reply.trim()) return false;

        const convo = convoSvc.getById(db, null, ctx.convoId);
        if (!convo) return false;
        const externalId = await sendMessage(db, convo, reply);
        convoSvc.addMessage(db, null, ctx.convoId, {
          externalId, direction: 'outgoing', provider: convo.provider, body: reply, status: 'sent',
        });
        _log('info', `ai_reply enviado: "${reply.slice(0, 80)}"`);
      } catch (err) {
        _log('error', `ai_reply error: ${err.message}`);
      }
      return false;
    }

    default:
      return false;
  }
}

// Resume un run suspendido en un step wait_response, ejecutando los pasos
// de la rama indicada. branch: 'on_text_reply' | 'on_button_click' | 'on_timeout' | 'on_delivery_fail'
// Se llama "resumeWait" para distinguir del resumeRun() existente que reanuda
// runs pausados manualmente (con killRun/pauseRun/resumeRun).
async function resumeWait(db, waitId, branch, extraCtx = {}) {
  const wait = db.prepare('SELECT * FROM bot_run_waits WHERE id = ? AND status = ?').get(waitId, 'waiting');
  if (!wait) { _log('warn', `resumeRun: wait ${waitId} no encontrado o ya resumido`); return; }

  // Cargar bot ANTES de marcar como resumido — necesitamos el tipo de step
  // para decidir si este branch aplica (timers solo se resumen por on_timeout).
  const botRow = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(wait.bot_id);
  if (!botRow) { _log('error', `resumeRun: bot ${wait.bot_id} no existe`); return; }
  const tenantId = wait.tenant_id || botRow.tenant_id;
  let allSteps = [];
  try { allSteps = JSON.parse(botRow.steps || '[]'); } catch {}
  // Asegurar _id estable como en run normal
  allSteps = allSteps.map((s, i) => ({ ...s, _id: s._id || `s${i}` }));

  // Reconstruir ctx
  let snap = {};
  try { snap = JSON.parse(wait.ctx_json || '{}'); } catch {}

  // Localizar el wait_response via path (soporta nested dentro de ramas).
  // Fallback al wait_step_index legacy (top-level) si no hay path.
  const path = Array.isArray(snap.path) && snap.path.length
    ? snap.path
    : [wait.wait_step_index];
  const located = _walkStepPath(allSteps, path);
  const waitStep = located?.step;
  if (!waitStep || (waitStep.type !== 'wait_response' && waitStep.type !== 'timer')) {
    _log('error', `resumeRun: no se encontró wait_response/timer en path ${JSON.stringify(path)} (got ${waitStep?.type})`);
    return;
  }
  const isTimer = waitStep.type === 'timer';

  // GUARD CRÍTICO: un timer SOLO se resume por expiración natural (on_timeout)
  // o por adjust-wait manual (que cambia expires_at, no llama a esta función).
  // Eventos como on_delivery_fail / on_text_reply son de mensajes y NO deben
  // afectar timers — antes esto rompía cadenas enteras: si fallaba el envío
  // del primer mensaje, todos los timers de la cadena se "resumían" y los
  // bots avanzaban de stage en cascada.
  if (isTimer && branch !== 'on_timeout') {
    _log('info', `resumeWait: skip wait ${waitId} — timer no se resume por branch="${branch}" (solo on_timeout)`);
    return;
  }

  // Marcar como resumido (atómico — evita doble-resume)
  const upd = db.prepare(
    `UPDATE bot_run_waits SET status = 'resumed', resumed_branch = ?, resumed_at = unixepoch() WHERE id = ? AND status = 'waiting'`
  ).run(branch, waitId);
  if (upd.changes === 0) { _log('info', `resumeRun: wait ${waitId} ya fue resumido por otro proceso`); return; }

  const branches = waitStep.config?.branches || {};
  const branchSteps = isTimer ? [] : (Array.isArray(branches[branch]) ? branches[branch] : []);
  // Asegurar _ids únicos
  const branchStepsHydrated = branchSteps.map((s, i) => ({ ...s, _id: s._id || `${wait.wait_step_id}-${branch}-${i}` }));
  const contact = wait.contact_id
    ? db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(wait.contact_id, tenantId)
    : null;
  const ctx = {
    contactId:     wait.contact_id,
    convoId:       wait.conversation_id,
    expedientId:   wait.expedient_id,
    contact,
    runId:         wait.run_id,
    chainDepth:    snap.chainDepth || 0,
    provider:      snap.provider,
    integrationId: snap.integrationId,
    pipelineId:    snap.pipelineId,
    stageId:       snap.stageId,
    messageBody:   extraCtx.messageBody || snap.messageBody || '',
    tenantId,
    ...extraCtx,
  };

  if (isTimer) {
    _log('info', `resumeRun: timer expiró run ${wait.run_id} — continuando con hermanos`);
  } else {
    _log('info', `resumeRun: ejecutando ${branchStepsHydrated.length} pasos de rama "${branch}" del run ${wait.run_id}`);
  }

  // Ejecutar los pasos de la rama. Si hay otro wait_response dentro, vuelve a suspender.
  let suspended = false;
  let errored = false;
  let stopped = false;
  // Nuevo shape simple: si rama es 'on_timeout' y onTimeout === 'stop', pausar SOLO este bot
  // para este contacto (consistente con stop_bot). Solo aplica a wait_response.
  if (!isTimer && branch === 'on_timeout' && waitStep.config?.onTimeout === 'stop') {
    _log('info', `resumeRun: timeout con onTimeout=stop, pausando bot ${wait.bot_id} para contacto ${wait.contact_id}`);
    if (wait.contact_id && wait.bot_id) {
      try {
        db.prepare(`
          INSERT INTO contact_bot_pauses (tenant_id, contact_id, bot_id, paused, updated_at)
          VALUES (?, ?, ?, 1, unixepoch())
          ON CONFLICT (contact_id, bot_id) DO UPDATE SET paused = 1, updated_at = excluded.updated_at
        `).run(tenantId, wait.contact_id, wait.bot_id);
      } catch (e) { _log('warn', `pausa por timeout fallo: ${e.message}`); }
    }
    stopped = true;
  }
  for (let i = 0; i < branchStepsHydrated.length && !stopped; i++) {
    const step = branchStepsHydrated[i];
    ctx._stepIndex = wait.wait_step_index; // mantenemos el índice del wait original
    ctx._runId = wait.run_id;
    try {
      const result = await executeStep(db, step, ctx);
      if (result === 'suspend') { suspended = true; break; }
      if (result === true || result === 'stop') { stopped = true; break; }
    } catch (err) {
      _log('error', `resumeRun: paso ${i + 1} ("${step.type}") error: ${err.message}`);
      errored = true;
      break;
    }
  }

  // Continuación: ejecutar los HERMANOS que vienen DESPUÉS del wait_response
  // dentro del mismo contenedor (case.steps[], default[], reminders[].steps[] o top-level).
  // Esto preserva el contexto cuando wait_response está anidado dentro de una rama.
  const containerArr = located.containerArr || allSteps;
  const idxInContainer = typeof located.idxInContainer === 'number' ? located.idxInContainer : wait.wait_step_index;
  if (!suspended && !errored && !stopped) {
    const continuationSteps = containerArr.slice(idxInContainer + 1);
    _log('info', `resumeRun: continuando con ${continuationSteps.length} hermanos tras wait_response (path=${JSON.stringify(path)})`);
    for (let i = 0; i < continuationSteps.length; i++) {
      const step = continuationSteps[i];
      // Sub-path para que un wait_response anidado dentro de la continuación también funcione
      const subPath = path.slice(0, -1).concat([idxInContainer + 1 + i]);
      ctx._stepIndex = wait.wait_step_index;
      ctx._stepPath = subPath;
      ctx._runId = wait.run_id;
      try {
        const result = await executeStep(db, step, ctx);
        if (result === 'suspend') { suspended = true; break; }
        if (result === 'stop')    { stopped = true; break; }
        if (result === true)      break;
      } catch (err) {
        _log('error', `resumeRun: continuation paso ${i + 1} ("${step.type}") error: ${err.message}`);
        errored = true;
        break;
      }
    }
  }

  // Si el wait estaba ANIDADO (path > 1 elemento) y terminamos los hermanos sin
  // stop/suspend, continuar con los top-level steps DESPUÉS del ancestro outer.
  if (!suspended && !errored && !stopped && path.length > 1) {
    const topLevelAfter = path[0] + 1;
    const tailSteps = allSteps.slice(topLevelAfter);
    if (tailSteps.length > 0) {
      _log('info', `resumeRun: hermanos completados, continuando ${tailSteps.length} pasos top-level desde idx ${topLevelAfter}`);
      for (let i = 0; i < tailSteps.length; i++) {
        const step = tailSteps[i];
        ctx._stepIndex = topLevelAfter + i;
        ctx._stepPath = [topLevelAfter + i];
        ctx._runId = wait.run_id;
        try {
          const result = await executeStep(db, step, ctx);
          if (result === 'suspend') { suspended = true; break; }
          if (result === 'stop')    { stopped = true; break; }
          if (result === true)      break;
        } catch (err) {
          _log('error', `resumeRun: tail paso ${i + 1} ("${step.type}") error: ${err.message}`);
          errored = true;
          break;
        }
      }
    }
  }

  // Finalizar el run
  if (!suspended && wait.run_id) {
    const status = errored ? 'error' : 'done';
    try {
      db.prepare(`
        UPDATE bot_runs SET status = ?, finished_at = unixepoch()
        WHERE id = ? AND status NOT IN ('killed')
      `).run(status, wait.run_id);
    } catch (_) {}
    if (ctx.expedientId) {
      const desc = isTimer
        ? (status === 'done' ? 'Bot completado tras timer' : 'Bot falló tras timer')
        : (status === 'done' ? `Bot resumió rama "${branch}" y completó` : `Bot rama "${branch}" falló`);
      activitySvc.log(db, {
        expedientId: ctx.expedientId,
        contactId:   ctx.contactId,
        type:        status === 'done' ? 'bot_done' : 'bot_error',
        description: desc,
      });
    }
    _log('info', `run ${wait.run_id} finalizado (${status}) tras ${isTimer ? 'timer' : 'rama '+branch}`);
  }
}

// Busca cualquier wait suspendido para un contacto y lo resume en la rama dada.
// Útil para hooks de webhook (mensaje entrante, falla de entrega).
async function resumeWaitsForContact(db, contactId, branch, extraCtx = {}) {
  if (!contactId) return;
  const waits = db.prepare(`
    SELECT id FROM bot_run_waits
     WHERE contact_id = ? AND status = 'waiting'
     ORDER BY created_at DESC
  `).all(contactId);
  for (const w of waits) {
    try { await resumeWait(db, w.id, branch, extraCtx); }
    catch (err) { _log('error', `resumeWaitsForContact: ${err.message}`); }
  }
}

// ─── Disparadores programados (Fase 3) ───

function _safeParseJSON(str, fallback = {}) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function _scheduledFireForContacts(db, bot, contacts, scopeKey, extraCtx = {}) {
  for (const row of contacts) {
    try {
      // Dedup: ¿ya disparamos este bot a este contacto con este scope?
      const prev = db.prepare(
        'SELECT 1 FROM bot_schedule_runs WHERE bot_id = ? AND contact_id = ? AND scope_key = ?'
      ).get(bot.id, row.contact_id, scopeKey);
      if (prev) continue;
      db.prepare(`
        INSERT OR IGNORE INTO bot_schedule_runs (tenant_id, bot_id, contact_id, scope_key, fired_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `).run(bot.tenant_id, bot.id, row.contact_id, scopeKey);
      const convoRow = db.prepare(
        'SELECT id, provider, integration_id FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 1'
      ).get(row.contact_id, bot.tenant_id);
      runAsync(db, bot, {
        convoId:       convoRow?.id || null,
        contactId:     row.contact_id,
        messageBody:   '',
        provider:      convoRow?.provider || null,
        integrationId: convoRow?.integration_id || null,
        expedientId:   row.expedient_id || null,
        tenantId:      bot.tenant_id,
        ...extraCtx,
      });
    } catch (e) {
      _log('error', `scheduledFireForContacts error en contacto ${row.contact_id}: ${e.message}`);
    }
  }
}

// Devuelve los expedientes activos (con stage) de un tenant. Audiencia base
// para los broadcasts (one_time / daily). Limita a 5000 por seguridad.
function _activeExpedientsForTenant(db, tenantId) {
  return db.prepare(`
    SELECT e.id AS expedient_id, e.contact_id
      FROM expedients e
     WHERE e.tenant_id = ? AND e.contact_id IS NOT NULL AND e.stage_id IS NOT NULL
     LIMIT 5000
  `).all(tenantId);
}

function _checkScheduledOneTime(db, bot, now) {
  const cfg = _safeParseJSON(bot.trigger_value, {});
  const dt = cfg.datetime; // ISO local: "2026-05-15T09:00"
  if (!dt) return;
  const target = Math.floor(new Date(dt).getTime() / 1000);
  if (!Number.isFinite(target) || target > now) return;
  // Si ya disparó cualquier vez para este bot, no repetir (one_time real).
  const fired = db.prepare('SELECT 1 FROM bot_schedule_runs WHERE bot_id = ? LIMIT 1').get(bot.id);
  if (fired) return;
  const audience = _activeExpedientsForTenant(db, bot.tenant_id);
  _log('info', `scheduled_one_time → bot=${bot.id} target=${dt} audience=${audience.length}`);
  _scheduledFireForContacts(db, bot, audience, '');
}

function _checkScheduledDaily(db, bot, now) {
  const cfg = _safeParseJSON(bot.trigger_value, {});
  const hour = cfg.hour; // "09:00"
  const weekdays = Array.isArray(cfg.weekdays) ? cfg.weekdays : [1,1,1,1,1,1,1];
  if (!hour) return;
  const date = new Date(now * 1000);
  // weekdays: 0=Mon..6=Sun (lo definimos así)
  const dow = (date.getDay() + 6) % 7;
  if (!weekdays[dow]) return;
  const [hh, mm] = hour.split(':').map(Number);
  const sched = new Date(date);
  sched.setHours(hh || 0, mm || 0, 0, 0);
  const schedTs = Math.floor(sched.getTime() / 1000);
  if (schedTs > now) return;
  // Solo disparar si han pasado < 5 min desde la hora programada (evita
  // que un poller que despertó tarde arrastre disparos viejos)
  if (now - schedTs > 300) return;
  const dateKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const audience = _activeExpedientsForTenant(db, bot.tenant_id);
  _log('info', `scheduled_daily → bot=${bot.id} ${hour} dow=${dow} audience=${audience.length} key=${dateKey}`);
  _scheduledFireForContacts(db, bot, audience, dateKey);
}

function _checkScheduledField(db, bot, now) {
  const cfg = _safeParseJSON(bot.trigger_value, {});
  const fieldId = Number(cfg.fieldId);
  const offsetMin = Number(cfg.offsetMinutes); // negativo = antes, positivo = después
  if (!fieldId || !Number.isFinite(offsetMin)) return;
  // Buscar expedientes con valor en ese campo
  const rows = db.prepare(`
    SELECT e.id AS expedient_id, e.contact_id, cfv.value
      FROM expedients e
      JOIN custom_field_values cfv ON cfv.entity = 'expedient' AND cfv.record_id = e.id AND cfv.field_id = ?
     WHERE e.tenant_id = ? AND e.contact_id IS NOT NULL AND cfv.value IS NOT NULL AND cfv.value <> ''
     LIMIT 5000
  `).all(fieldId, bot.tenant_id);
  for (const row of rows) {
    try {
      // value es ISO-like: "2026-05-15" o "2026-05-15T09:00:00"
      const fieldTs = Math.floor(new Date(row.value).getTime() / 1000);
      if (!Number.isFinite(fieldTs)) continue;
      const fireTs = fieldTs + offsetMin * 60;
      if (fireTs > now) continue;
      // Solo dispara si pasó la hora pero hace < 1 hora (no arrastrar viejos)
      if (now - fireTs > 3600) continue;
      const scopeKey = `${fieldId}:${row.value}`;
      _scheduledFireForContacts(db, bot, [row], scopeKey, { fieldId, fieldValue: row.value });
    } catch (e) {
      _log('error', `scheduled_field error en exp ${row.expedient_id}: ${e.message}`);
    }
  }
}

let _scheduledTimer = null;
function startScheduledPoller(db) {
  if (_scheduledTimer) return;
  const tick = () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const bots = db.prepare(
        "SELECT * FROM salsbots WHERE enabled = 1 AND trigger_type IN ('scheduled_one_time','scheduled_daily','scheduled_field')"
      ).all().map(r => ({ ...r, steps: JSON.parse(r.steps || '[]') }));
      for (const bot of bots) {
        try {
          if      (bot.trigger_type === 'scheduled_one_time') _checkScheduledOneTime(db, bot, now);
          else if (bot.trigger_type === 'scheduled_daily')    _checkScheduledDaily(db, bot, now);
          else if (bot.trigger_type === 'scheduled_field')    _checkScheduledField(db, bot, now);
        } catch (e) {
          _log('error', `scheduledPoller bot ${bot.id} error: ${e.message}`);
        }
      }
    } catch (err) {
      console.error('[bot] scheduledPoller error:', err.message);
    }
  };
  _scheduledTimer = setInterval(tick, 60_000);
  _scheduledTimer.unref?.();
  console.log('[bot] startScheduledPoller iniciado (cada 60s)');
}

// Poller que cada 60s busca conversaciones cuyo último mensaje es saliente
// y lleva más de N minutos sin respuesta. Dispara bots con trigger_type='no_response'.
let _noResponseTimer = null;
function startNoResponsePoller(db) {
  if (_noResponseTimer) return;
  const tick = () => {
    try {
      // Conversaciones donde el último mensaje es outgoing
      const candidates = db.prepare(`
        SELECT c.id AS conversation_id, c.tenant_id, c.contact_id,
               m.id AS last_outgoing_id,
               (unixepoch() - m.created_at) / 60 AS minutes_since
          FROM conversations c
          JOIN messages m ON m.id = (
            SELECT id FROM messages WHERE conversation_id = c.id
             ORDER BY created_at DESC LIMIT 1
          )
         WHERE m.direction = 'outgoing'
           AND m.created_at <= unixepoch() - 60
           AND COALESCE(c.archived, 0) = 0
         LIMIT 500
      `).all();
      for (const row of candidates) {
        try {
          triggerNoResponse(db, {
            tenantId:        row.tenant_id,
            contactId:       row.contact_id,
            conversationId:  row.conversation_id,
            lastOutgoingId:  row.last_outgoing_id,
            minutesSince:    Number(row.minutes_since) || 0,
          });
        } catch (e) {
          _log('error', `noResponsePoller error en convo ${row.conversation_id}: ${e.message}`);
        }
      }
    } catch (err) {
      console.error('[bot] noResponsePoller error:', err.message);
    }
  };
  _noResponseTimer = setInterval(tick, 60_000);
  _noResponseTimer.unref?.();
  console.log('[bot] startNoResponsePoller iniciado (cada 60s)');
}

// Poller que cada 60s busca waits expirados y los resume en rama on_timeout.
let _waitTimeoutTimer = null;
function startWaitTimeoutPoller(db) {
  if (_waitTimeoutTimer) return;
  _waitTimeoutTimer = setInterval(async () => {
    try {
      const expired = db.prepare(`
        SELECT id FROM bot_run_waits
         WHERE status = 'waiting' AND expires_at <= unixepoch()
         LIMIT 50
      `).all();
      for (const w of expired) {
        await resumeWait(db, w.id, 'on_timeout');
      }
    } catch (err) {
      console.error('[bot] waitTimeoutPoller error:', err.message);
    }
  }, 60_000);
  _waitTimeoutTimer.unref?.();
  console.log('[bot] startWaitTimeoutPoller iniciado (cada 60s)');
}

// Poller para appointment_reminder_jobs — ejecuta sub-steps cuando llega fire_at
let _reminderJobTimer = null;
function startReminderJobPoller(db) {
  if (_reminderJobTimer) return;
  const tick = async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const jobs = db.prepare(`
        SELECT * FROM appointment_reminder_jobs
         WHERE fired = 0 AND skipped = 0 AND fire_at <= ?
         ORDER BY fire_at ASC LIMIT 50
      `).all(now);

      for (const job of jobs) {
        // Marcar como fired antes de ejecutar (evita doble disparo)
        db.prepare('UPDATE appointment_reminder_jobs SET fired = 1, fired_at = unixepoch() WHERE id = ?')
          .run(job.id);
        try {
          const steps = JSON.parse(job.steps_json || '[]');
          const ctx   = JSON.parse(job.ctx_json   || '{}');
          if (!steps.length) continue;
          // Ejecutar sub-steps en secuencia
          for (let i = 0; i < steps.length; i++) {
            const stop = await _runStep(db, steps[i], i, steps, ctx);
            if (stop) break;
          }
          _log('info', `reminderJobPoller: job ${job.id} ejecutado (${steps.length} steps)`);
        } catch (err) {
          _log('error', `reminderJobPoller: error en job ${job.id}: ${err.message}`);
          db.prepare('UPDATE appointment_reminder_jobs SET skip_reason = ? WHERE id = ?')
            .run(`exec_error: ${err.message}`, job.id);
        }
      }
    } catch (err) {
      console.error('[bot] reminderJobPoller error:', err.message);
    }
  };
  _reminderJobTimer = setInterval(tick, 60_000);
  _reminderJobTimer.unref?.();
  console.log('[bot] startReminderJobPoller iniciado (cada 60s)');
}

function evaluateCondition(db, c, ctx) {
  try {
    if (c.field === 'message') {
      return (ctx.messageBody || '').toLowerCase().includes((c.value || '').toLowerCase());
    }
    if (c.field === 'tag') {
      const rows = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? AND tenant_id = ?').all(ctx.contactId, ctx.tenantId);
      const tags = rows.map(r => r.tag);
      return tags.includes(c.value || '');
    }
    if (c.field === 'pipeline') {
      const exp = db.prepare(
        'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? LIMIT 1'
      ).get(ctx.contactId, Number(c.value), ctx.tenantId);
      return !!exp;
    }
  } catch (err) {
    console.error('[bot engine] evaluateCondition error:', err.message);
  }
  return true;
}

// Evalúa una regla individual — usada por el step `branch` con AND/OR multi-regla.
function evaluateRule(db, rule, ctx) {
  try {
    const op    = rule.op || 'contains';
    const value = String(rule.value || '').toLowerCase().trim();
    const field = rule.field || 'message';

    if (field === 'message') {
      const actual = String(ctx.messageBody || '').toLowerCase();
      const list = () => value.split(',').map(s => s.trim()).filter(Boolean);
      if (op === 'equals')       return actual === value;
      if (op === 'not_equals')   return actual !== value;
      if (op === 'starts_with')  return actual.startsWith(value);
      if (op === 'ends_with')    return actual.endsWith(value);
      if (op === 'matches_any')      return list().some(v => actual.includes(v));
      if (op === 'matches_none')     return list().every(v => !actual.includes(v));
      if (op === 'contains_all')     return list().every(v => actual.includes(v));
      if (op === 'not_contains_all') return !list().every(v => actual.includes(v));
      if (op === 'not_contains')     return !actual.includes(value);
      return actual.includes(value); // contains (default — frase exacta)
    }

    if (field === 'tag') {
      // Tags viven en contact_tags(contact_id, tag) — no en columna en contacts
      const rows = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? AND tenant_id = ?').all(ctx.contactId, ctx.tenantId);
      const lowerTags = rows.map(r => String(r.tag || '').toLowerCase());
      if (op === 'not_contains' || op === 'not_equals') return !lowerTags.includes(value);
      return lowerTags.includes(value);
    }

    if (field === 'pipeline') {
      const exp = db.prepare(
        'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? LIMIT 1'
      ).get(ctx.contactId, Number(rule.value), ctx.tenantId);
      const has = !!exp;
      return (op === 'not_contains' || op === 'not_equals') ? !has : has;
    }

    if (field === 'stage') {
      const exp = db.prepare(
        'SELECT stage_id FROM expedients WHERE contact_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(ctx.contactId, ctx.tenantId);
      const has = exp && String(exp.stage_id) === String(rule.value);
      return (op === 'not_equals' || op === 'not_contains') ? !has : !!has;
    }

    if (field === 'contact_name') {
      const contact = db.prepare('SELECT first_name, last_name FROM contacts WHERE id = ? AND tenant_id = ?').get(ctx.contactId, ctx.tenantId);
      const name = String(contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '').toLowerCase();
      if (op === 'equals')       return name === value;
      if (op === 'not_equals')   return name !== value;
      if (op === 'starts_with')  return name.startsWith(value);
      if (op === 'ends_with')    return name.endsWith(value);
      if (op === 'not_contains') return !name.includes(value);
      if (op === 'matches_any') {
        const list = value.split(',').map(s => s.trim()).filter(Boolean);
        return list.some(v => name.includes(v));
      }
      return name.includes(value);
    }

    if (field === 'phone') {
      const contact = db.prepare('SELECT phone FROM contacts WHERE id = ? AND tenant_id = ?').get(ctx.contactId, ctx.tenantId);
      const phone = String(contact?.phone || ctx.messageBody || '').replace(/\D/g, '');
      const cleanValue = value.replace(/\D/g, '');
      if (op === 'equals')       return phone === cleanValue;
      if (op === 'not_equals')   return phone !== cleanValue;
      if (op === 'starts_with')  return phone.startsWith(cleanValue);
      if (op === 'ends_with')    return phone.endsWith(cleanValue);
      if (op === 'not_contains') return !phone.includes(cleanValue);
      if (op === 'matches_any') {
        const list = cleanValue.split(',').map(s => s.trim()).filter(Boolean);
        return list.some(v => phone.includes(v));
      }
      return phone.includes(cleanValue);
    }
  } catch (err) {
    _log('error', `evaluateRule (${rule.field} ${rule.op} "${rule.value}"): ${err.message}`);
  }
  return false;
}

// Sustituye variables del contacto en un texto libre. Soporta tanto la sintaxis
// con llaves simples ({nombre}) como dobles ({{nombre}}, {{apellido}}, etc.)
// y también la convención de plantillas WhatsApp ({{1}} = first_name como
// fallback útil cuando el usuario copia el body de una plantilla aprobada).
//
// Si first_name está vacío, NO deja la variable cruda — la borra (mejor "Hola"
// que "Hola {{1}}") salvo si no hay contacto, en cuyo caso conserva el original
// para ayudar a debuggear en el log.
function replaceVars(text, ctx) {
  const c = ctx.contact || {};
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
  // Mapa de nombres de variable → valor del contacto. Todos en lowercase.
  const vars = {
    'nombre':           c.first_name || '',
    'first_name':       c.first_name || '',
    'apellido':         c.last_name  || '',
    'last_name':        c.last_name  || '',
    'nombre_completo':  fullName,
    'full_name':        fullName,
    'telefono':         c.phone || '',
    'phone':            c.phone || '',
    'email':            c.email || '',
    // Convención WhatsApp template — útil cuando el usuario copia un body
    // de plantilla aprobada al step "Enviar mensaje" libre.
    '1':                c.first_name || '',
  };
  const lookup = (key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : null;
  };
  // Pasada 1 — doble llave {{var}} (sintaxis tipo plantilla WhatsApp)
  let out = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const v = lookup(key);
    return v !== null ? v : match;
  });
  // Pasada 2 — llave simple {var} (sintaxis legacy del bot)
  out = out.replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (match, key) => {
    const v = lookup(key);
    return v !== null ? v : match;
  });
  return out;
}

module.exports = {
  triggerMessage, triggerPipelineStage, triggerNewContact,
  // Disparadores nuevos (Fase 1):
  triggerPipelineStageLeave, triggerAssigneeChanged, triggerTagAdded,
  // Disparadores nuevos (Fase 2):
  triggerMessageRead, triggerNoResponse, startNoResponsePoller,
  // Disparadores nuevos (Fase 3 — programados):
  startScheduledPoller,
  getLogs, clearLogs, killRun, pauseRun, resumeRun,
  // Sistema de wait_response (Opción A — branching):
  resumeWait, resumeWaitsForContact, startWaitTimeoutPoller,
  // Recordatorios de citas:
  startReminderJobPoller,
};
