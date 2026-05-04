// Bot execution engine.
// Runs bot steps sequentially for a given contact/conversation context.
// Timers use setTimeout — suitable for seconds/minutes. For hours/days the
// process must stay alive (acceptable for the current single-process setup).

const convoSvc     = require('../conversations/service');
const expedientSvc = require('../expedients/service');
const activitySvc  = require('../expedients/activity');
const { sendMessage, sendWhatsAppTemplate } = require('../conversations/sender');

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
        chainDepth,  // se propaga al ctx del run; lo usa el step 'stage' para incrementarlo
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
        const result = await sendWhatsAppTemplate(db, convo, templateId, c.manualValues || []);
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
           WHERE e.contact_id = ?
             AND COALESCE(s.kind, 'in_progress') = 'in_progress'
           ORDER BY e.created_at DESC
           LIMIT 1
        `).get(ctx.contactId);

        let resolvedExpId = null;
        if (exp) {
          expedientSvc.update(db, exp.id, { stageId, pipelineId });
          resolvedExpId = exp.id;
          _log('info', `expediente ${exp.id} movido a etapa ${stageId} (pipeline ${pipelineId})`);
        } else {
          const created = expedientSvc.create(db, {
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
        const row = db.prepare('SELECT tags FROM contacts WHERE id = ?').get(ctx.contactId);
        if (row) {
          const tags = (() => { try { return JSON.parse(row.tags || '[]'); } catch { return []; } })();
          const added = [];
          for (const t of incoming) {
            if (!tags.includes(t)) { tags.push(t); added.push(t); }
          }
          if (added.length) {
            db.prepare('UPDATE contacts SET tags = ? WHERE id = ?').run(JSON.stringify(tags), ctx.contactId);
          }
          _log('info', `etiquetas ${JSON.stringify(incoming)} en contacto ${ctx.contactId} (añadidas=${JSON.stringify(added)})`);
        }
      } catch (err) {
        _log('error', `error en step tag: ${err.message}`);
      }
      return false;
    }

    case 'stop_bot': {
      if (ctx.convoId) {
        convoSvc.setBotPaused(db, null, ctx.convoId, true);
        _log('info', `bot pausado para conversación ${ctx.convoId}`);
      }
      return true;
    }

    case 'stop_and_start': {
      // Termina el bot actual y dispara otro bot (mismo contacto, mismo expediente).
      // No pausa la conversación — el nuevo bot toma el relevo.
      const targetBotId = Number(c.targetBotId);
      if (!targetBotId) {
        _log('error', 'stop_and_start sin targetBotId — terminando bot actual sin lanzar otro');
        return true;
      }
      const targetBot = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(targetBotId);
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
      });
      return true;
    }

    case 'condition': {
      // Basic condition: if false, skip remaining steps
      const passes = evaluateCondition(db, c, ctx);
      return !passes; // return true (stop) if condition fails
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
      };
      db.prepare(`
        INSERT INTO bot_run_waits (
          run_id, bot_id, contact_id, conversation_id, expedient_id,
          wait_step_id, wait_step_index, ctx_json, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
      `).run(
        runId,
        // bot_id se busca a través del run
        db.prepare('SELECT bot_id FROM bot_runs WHERE id = ?').get(runId)?.bot_id || 0,
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

  // Marcar como resumido (atómico — evita doble-resume)
  const upd = db.prepare(
    `UPDATE bot_run_waits SET status = 'resumed', resumed_branch = ?, resumed_at = unixepoch() WHERE id = ? AND status = 'waiting'`
  ).run(branch, waitId);
  if (upd.changes === 0) { _log('info', `resumeRun: wait ${waitId} ya fue resumido por otro proceso`); return; }

  // Cargar bot
  const botRow = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(wait.bot_id);
  if (!botRow) { _log('error', `resumeRun: bot ${wait.bot_id} no existe`); return; }
  let allSteps = [];
  try { allSteps = JSON.parse(botRow.steps || '[]'); } catch {}
  // Asegurar _id estable como en run normal
  allSteps = allSteps.map((s, i) => ({ ...s, _id: s._id || `s${i}` }));

  const waitStep = allSteps[wait.wait_step_index];
  if (!waitStep || waitStep.type !== 'wait_response') {
    _log('error', `resumeRun: step en índice ${wait.wait_step_index} no es wait_response`);
    return;
  }

  const branches = waitStep.config?.branches || {};
  const branchSteps = Array.isArray(branches[branch]) ? branches[branch] : [];
  // Asegurar _ids únicos
  const branchStepsHydrated = branchSteps.map((s, i) => ({ ...s, _id: s._id || `${wait.wait_step_id}-${branch}-${i}` }));

  // Reconstruir ctx
  let snap = {};
  try { snap = JSON.parse(wait.ctx_json || '{}'); } catch {}
  const contact = wait.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(wait.contact_id) : null;
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
    ...extraCtx,
  };

  _log('info', `resumeRun: ejecutando ${branchStepsHydrated.length} pasos de rama "${branch}" del run ${wait.run_id}`);

  // Ejecutar los pasos de la rama. Si hay otro wait_response dentro, vuelve a suspender.
  let suspended = false;
  let errored = false;
  for (let i = 0; i < branchStepsHydrated.length; i++) {
    const step = branchStepsHydrated[i];
    ctx._stepIndex = wait.wait_step_index; // mantenemos el índice del wait original
    ctx._runId = wait.run_id;
    try {
      const result = await executeStep(db, step, ctx);
      if (result === 'suspend') { suspended = true; break; }
      if (result === true || result === 'stop') break;
    } catch (err) {
      _log('error', `resumeRun: paso ${i + 1} ("${step.type}") error: ${err.message}`);
      errored = true;
      break;
    }
  }

  // Finalizar el run (las ramas siempre terminan el bot, salvo que tengan otro wait_response)
  if (!suspended && wait.run_id) {
    const status = errored ? 'error' : 'done';
    try {
      db.prepare(`
        UPDATE bot_runs SET status = ?, finished_at = unixepoch()
        WHERE id = ? AND status NOT IN ('killed')
      `).run(status, wait.run_id);
    } catch (_) {}
    if (ctx.expedientId) {
      activitySvc.log(db, {
        expedientId: ctx.expedientId,
        contactId:   ctx.contactId,
        type:        status === 'done' ? 'bot_done' : 'bot_error',
        description: status === 'done' ? `Bot resumió rama "${branch}" y completó` : `Bot rama "${branch}" falló`,
      });
    }
    _log('info', `run ${wait.run_id} finalizado (${status}) tras rama ${branch}`);
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
  getLogs, clearLogs, killRun, pauseRun, resumeRun,
  // Sistema de wait_response (Opción A — branching):
  resumeWait, resumeWaitsForContact, startWaitTimeoutPoller,
};
