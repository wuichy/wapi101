'use strict';

// Inbound Router — Híbrido IA + Bots
//
// Este módulo es el ÚNICO entry point para mensajes entrantes de clientes.
// Reemplaza la llamada directa a botEngine.triggerMessage() en todos los
// webhooks (WA API, WA Lite, Messenger, IG, etc.).
//
// Aplica el pipeline de 5 pasos para decidir quién contesta:
//
//   [1] ¿Humano activo? (último msg de asesor < ventana_humano)
//        → no hace nada, asesor sigue dueño
//
//   [2] ¿Hay wait_response activo? (bot esperando input del cliente)
//        → ya se maneja en bot/engine resumeWait — el router solo verifica
//          y se sale (no compite con el motor existente)
//
//   [2.5] ¿Hay wait_timer activo + behavior='cancel'?
//        → cancela el wait, sigue al paso 3
//        ¿wait_timer + behavior='branch'?
//        → llama resumeWait con la rama on_message
//        ¿wait_timer + behavior='ignore'?
//        → no hace nada (el msg se ignora, timer sigue)
//
//   [3] Matcher de bots: ¿algún trigger keyword/IA matchea?
//        → dispara el bot ganador (triggerMessage tradicional)
//
//   [4] ¿IA habilitada como fallback?
//        → la IA contesta libre (TODO Fase 2: integrar con módulo ai/)
//
//   [5] idle — no hace nada
//
// Modo legacy: si tenants.ia_hybrid_enabled = 0, el router es transparente
// y solo llama a triggerMessage directo (comportamiento de hoy).

const botEngine = require('../bot/engine');
const botMatcher = require('../bot-matcher/service');

// ─── Constantes ──────────────────────────────────────────────────────
const DEFAULT_HUMAN_WINDOW_MIN = 15;   // fallback si tenant no tiene config

// ─── Helpers ─────────────────────────────────────────────────────────

function _now() { return Math.floor(Date.now() / 1000); }

function _getTenantConfig(db, tenantId) {
  const row = db.prepare(`
    SELECT ia_hybrid_enabled, ia_matcher_enabled, ia_fallback_enabled,
           human_takeover_window_min
    FROM tenants WHERE id = ?
  `).get(tenantId);
  return row || {
    ia_hybrid_enabled: 0,
    ia_matcher_enabled: 0,
    ia_fallback_enabled: 0,
    human_takeover_window_min: DEFAULT_HUMAN_WINDOW_MIN,
  };
}

function _getConvo(db, convoId) {
  return db.prepare(`
    SELECT id, tenant_id, ai_mode, last_human_msg_at, last_ai_msg_at,
           human_takeover_until
    FROM conversations WHERE id = ?
  `).get(convoId);
}

function _logDecision(db, { tenantId, conversationId, messageId, decision, reason, botId, matcherUsed, matcherMs }) {
  try {
    db.prepare(`
      INSERT INTO inbound_router_log
        (tenant_id, conversation_id, message_id, decision, reason, bot_id, matcher_used, matcher_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, conversationId || null, messageId || null, decision, reason || null,
           botId || null, matcherUsed ? 1 : 0, matcherMs || null);
  } catch (err) {
    console.warn('[inbound-router] log failed:', err.message);
  }
}

// ─── Paso 1: ¿humano activo? ─────────────────────────────────────────
function _isHumanActive(convo, cfg) {
  if (!convo) return false;
  // Modo humano permanente (lock manual del asesor)
  if (convo.ai_mode === 'human_lock') return true;
  if (convo.human_takeover_until && convo.human_takeover_until > _now()) return true;
  // Ventana automática: último msg del asesor dentro de N minutos
  const windowMin = cfg.human_takeover_window_min || DEFAULT_HUMAN_WINDOW_MIN;
  if (convo.last_human_msg_at) {
    const sinceMin = (_now() - convo.last_human_msg_at) / 60;
    if (sinceMin < windowMin) return true;
  }
  return false;
}

// ─── Paso 2 + 2.5: ¿hay bot waits activos? ───────────────────────────
function _activeWaits(db, contactId) {
  const rows = db.prepare(`
    SELECT id, run_id, bot_id, wait_step_id, wait_kind, on_message_behavior, branch_step_id
    FROM bot_run_waits
    WHERE contact_id = ? AND status = 'waiting'
  `).all(contactId);
  // Resolver el wait_kind REAL leyendo el step del bot. Esto cubre el caso
  // de waits viejos (pre-migration 087) que tienen wait_kind='response' por
  // default pero realmente son timers según el step del bot — sino, el
  // router se atoraría delegando al engine que rechaza el resume.
  return rows.map(w => ({ ...w, wait_kind: _resolveActualWaitKind(db, w) }));
}

function _resolveActualWaitKind(db, wait) {
  // Si ya está marcado explícitamente, respetar
  if (wait.wait_kind === 'timer' || wait.wait_kind === 'scheduled') return wait.wait_kind;
  // Si no, leer el step real del bot y verificar su tipo
  try {
    const bot = db.prepare('SELECT steps FROM salsbots WHERE id=?').get(wait.bot_id);
    if (!bot) return 'response';
    const steps = JSON.parse(bot.steps || '[]');
    const step = _findStepRecursive(steps, wait.wait_step_id);
    if (!step) return 'response';
    if (step.type === 'timer') return 'timer';
    return 'response';
  } catch (_) {
    return 'response';
  }
}

function _findStepRecursive(steps, stepId) {
  if (!Array.isArray(steps)) return null;
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    if (s._id === stepId) return s;
    // Buscar dentro de branches del wait_response y branch step
    if (s.config?.branches) {
      for (const k of Object.keys(s.config.branches)) {
        const found = _findStepRecursive(s.config.branches[k], stepId);
        if (found) return found;
      }
    }
    // Buscar dentro de cases del branch v2
    if (Array.isArray(s.config?.cases)) {
      for (const c of s.config.cases) {
        const found = _findStepRecursive(c.steps, stepId);
        if (found) return found;
      }
    }
    if (Array.isArray(s.config?.default)) {
      const found = _findStepRecursive(s.config.default, stepId);
      if (found) return found;
    }
    // Buscar dentro de reminders del reminder_timer
    if (Array.isArray(s.config?.reminders)) {
      for (const r of s.config.reminders) {
        const found = _findStepRecursive(r?.steps, stepId);
        if (found) return found;
      }
    }
  }
  return null;
}

// ─── Entry point principal ───────────────────────────────────────────
/**
 * handleInboundMessage — sustituye a botEngine.triggerMessage como entry
 * point único para mensajes entrantes de clientes.
 *
 * Argumentos idénticos a triggerMessage, más:
 *  - messageId (opcional): id del registro en messages para logging
 *
 * Es síncrono en su decisión inicial pero lanza ejecución asíncrona del
 * bot/IA elegido. Caller no necesita await.
 */
function handleInboundMessage(db, args) {
  const { convoId, contactId, messageBody, provider, integrationId, messageId } = args;

  // Resolver tenant
  let tenantId = args.tenantId;
  if (!tenantId && contactId) {
    const row = db.prepare('SELECT tenant_id FROM contacts WHERE id = ?').get(contactId);
    tenantId = row?.tenant_id;
  }
  if (!tenantId) {
    // Fallback al motor viejo si no podemos resolver tenant
    botEngine.triggerMessage(db, args);
    return;
  }

  const cfg = _getTenantConfig(db, tenantId);

  // ─── MODO LEGACY ────────────────────────────────────────────────
  // Si el tenant no activó el híbrido, comportamiento original.
  // Los bots con wait_response ya se manejan dentro de triggerMessage
  // del engine (revisa bot_run_waits primero). No queremos romper nada.
  if (!cfg.ia_hybrid_enabled) {
    botEngine.triggerMessage(db, args);
    return;
  }

  // ─── MODO HÍBRIDO ───────────────────────────────────────────────
  const convo = convoId ? _getConvo(db, convoId) : null;

  // [1] Asesor humano activo
  if (_isHumanActive(convo, cfg)) {
    _logDecision(db, {
      tenantId, conversationId: convoId, messageId,
      decision: 'human', reason: 'asesor activo dentro de ventana',
    });
    return; // ni bot ni IA contestan
  }

  // ai_mode = 'off' silencia solo la IA. Bots siguen.
  // ai_mode = 'human_lock' ya filtrado arriba.

  // [2 + 2.5] Bot waits activos
  const waits = contactId ? _activeWaits(db, contactId) : [];

  // Separar por tipo
  const responseWaits = waits.filter(w => (w.wait_kind || 'response') === 'response');
  const timerWaits    = waits.filter(w => w.wait_kind === 'timer');
  // scheduled NO bloquea — son side-effects programados que corren solos
  // (los maneja el waitTimeoutPoller del engine).

  if (responseWaits.length > 0) {
    // El bot está esperando explícitamente input del cliente. Esto ya lo
    // maneja botEngine.triggerMessage() — lo dejamos pasar para que
    // resumeWait haga su trabajo. No metemos matcher ni IA.
    _logDecision(db, {
      tenantId, conversationId: convoId, messageId,
      decision: 'bot_resume', reason: 'wait_response activo',
      botId: responseWaits[0].bot_id,
    });
    botEngine.triggerMessage(db, args);
    return;
  }

  if (timerWaits.length > 0) {
    // wait_timer activo. ¿Qué hacer con el msg entrante?
    const handled = _handleTimerInterruption(db, args, timerWaits, tenantId);
    if (handled) return; // ya se manejó (cancel o branch)
    // 'ignore' o sin behavior → cae al pipeline normal
  }

  // [3] Matcher de bots — intenta disparar un bot por keyword/IA.
  //     El matcher IA puede ser async (llamada a Haiku). Para no bloquear
  //     el webhook, lanzamos la resolución asíncrona y dejamos que el
  //     webhook devuelva 200 al provider.
  const useMatcherIA = !!cfg.ia_matcher_enabled;
  const aiSilenced = convo && convo.ai_mode === 'off';

  _resolveAndDispatch(db, args, { tenantId, useMatcherIA, aiSilenced, aiFallbackEnabled: !!cfg.ia_fallback_enabled, convoId, messageId })
    .catch(err => console.error('[inbound-router] resolve failed:', err));
}

/**
 * Resuelve qué hacer con un mensaje (matcher → dispatch).
 * Se separa en async para que el matcher IA pueda hacer llamadas a Haiku
 * sin bloquear el webhook. El webhook ya respondió 200 al provider.
 */
async function _resolveAndDispatch(db, args, { tenantId, useMatcherIA, aiSilenced, aiFallbackEnabled, convoId, messageId }) {
  const tStart = Date.now();
  let matchResult;
  try {
    matchResult = await _tryMatchBot(db, { tenantId, messageBody: args.messageBody, useMatcherIA });
  } catch (err) {
    console.warn('[inbound-router] matcher error:', err.message);
    matchResult = { botId: null, source: 'fallback', confidence: 0, latencyMs: 0 };
  }
  const matcherMs = Date.now() - tStart;

  if (matchResult.botId) {
    _logDecision(db, {
      tenantId, conversationId: convoId, messageId,
      decision: 'bot_start',
      reason: `trigger match (${matchResult.source}, conf ${matchResult.confidence?.toFixed?.(2) || '?'})`,
      botId: matchResult.botId, matcherUsed: useMatcherIA, matcherMs,
    });
    // Dejamos que triggerMessage haga el trabajo — aunque iterará todos los
    // bots, los triggers idénticos al matcher van a ganar como deben.
    botEngine.triggerMessage(db, args);
    return;
  }

  // [4] IA fallback (solo si habilitada Y la convo permite IA)
  if (aiFallbackEnabled && !aiSilenced) {
    _logDecision(db, {
      tenantId, conversationId: convoId, messageId,
      decision: 'ai_active', reason: 'fallback libre',
      matcherUsed: useMatcherIA, matcherMs,
    });
    _triggerAiFallback(db, args);
    return;
  }

  // [5] idle
  _logDecision(db, {
    tenantId, conversationId: convoId, messageId,
    decision: 'idle', reason: aiSilenced ? 'ai_mode=off y sin bot match' : 'sin match',
    matcherUsed: useMatcherIA, matcherMs,
  });
}

// ─── Manejar interrupción de wait_timer por mensaje del cliente ──────
function _handleTimerInterruption(db, args, timerWaits, tenantId) {
  // Si hay múltiples timers activos (raro pero posible — el cliente tiene
  // 2 bots con waits en paralelo), aplicamos la regla a TODOS según su
  // propio behavior.
  let anyBranched = false;
  for (const wait of timerWaits) {
    const behavior = wait.on_message_behavior || 'cancel';
    if (behavior === 'ignore') {
      // No hacemos nada con este wait — el timer sigue.
      continue;
    }
    if (behavior === 'cancel') {
      // Cancela el wait. El paso siguiente del bot NO se ejecutará.
      db.prepare(`UPDATE bot_run_waits SET status='cancelled', resumed_at=unixepoch() WHERE id=?`)
        .run(wait.id);
      _logDecision(db, {
        tenantId, conversationId: args.convoId, messageId: args.messageId,
        decision: 'wait_cancelled', reason: `timer cancelado por msg entrante (wait ${wait.id})`,
        botId: wait.bot_id,
      });
      // Cae al pipeline normal (matcher / IA).
      continue;
    }
    if (behavior === 'branch') {
      // Resume el wait por la rama on_message — el bot brinca a branch_step_id.
      // Esto OCUPA la convo (es como un bot corriendo) — no caemos a matcher/IA.
      botEngine.resumeWait(db, wait.id, 'on_message', {
        messageBody: args.messageBody,
        targetStepId: wait.branch_step_id,
      }).catch(err => {
        console.error('[inbound-router] resumeWait failed:', err);
      });
      _logDecision(db, {
        tenantId, conversationId: args.convoId, messageId: args.messageId,
        decision: 'bot_branch', reason: `wait_timer branched on_message (step ${wait.branch_step_id})`,
        botId: wait.bot_id,
      });
      anyBranched = true;
    }
  }
  return anyBranched; // true = manejado, no caer al resto del pipeline
}

// ─── Matcher: delega a bot-matcher/service o usa keyword ─────────────
async function _tryMatchBot(db, { tenantId, messageBody, useMatcherIA }) {
  if (!messageBody) return { botId: null, source: 'fallback', confidence: 0 };
  const bots = botEngine.enabledBots(db, tenantId);
  if (!bots || !bots.length) return { botId: null, source: 'fallback', confidence: 0 };

  // Matcher IA (Haiku) si está habilitado en el tenant. El módulo bot-matcher
  // ya tiene su propio fallback a keyword si el LLM falla, así que confiamos
  // en él para ambos casos cuando useMatcherIA=true.
  if (useMatcherIA) {
    return botMatcher.matchSemantic(db, { tenantId, messageBody, bots });
  }

  // Matcher tradicional (substring case-insensitive) — comportamiento legacy
  const body = messageBody.toLowerCase();
  for (const bot of bots) {
    if (bot.trigger_type !== 'keyword') continue;
    const keywords = String(bot.trigger_value || '')
      .split(/[\n|,]/).map(k => k.toLowerCase().trim()).filter(Boolean);
    if (keywords.some(k => body.includes(k))) {
      return { botId: bot.id, source: 'keyword', confidence: 1.0 };
    }
  }
  return { botId: null, source: 'keyword', confidence: 0 };
}

// ─── IA fallback — llama al LLM configurado por el tenant ────────────
// Es fire-and-forget: el webhook ya respondió 200. Si falla, se loggea.
async function _triggerAiFallback(db, args) {
  try {
    const aiSvc = require('../ai/service');
    const convoSvc = require('../conversations/service');
    const { sendMessage } = require('../conversations/sender');

    const tenantId = args.tenantId || (args.contactId && db.prepare('SELECT tenant_id FROM contacts WHERE id = ?').get(args.contactId)?.tenant_id);
    if (!tenantId) return;

    const settings = aiSvc.getSettings(db, tenantId);
    if (!settings || !settings.apiKey || !settings.provider) {
      console.log('[inbound-router] IA fallback skipped: tenant', tenantId, 'sin config IA');
      return;
    }

    const knowledge = aiSvc.getKnowledgeContext(db, tenantId);
    const history   = aiSvc.getConversationHistory(db, tenantId, args.convoId, 15);

    const profileRow = db.prepare("SELECT value FROM app_settings WHERE key = 'profile' AND tenant_id = ?").get(tenantId);
    const profile    = profileRow ? JSON.parse(profileRow.value) : {};
    const companyName = profile.businessName || profile.name || 'nuestra empresa';

    const systemPrompt = [
      `Eres un asesor de ventas de ${companyName}. Responde de forma profesional, amigable y concisa en el mismo idioma que usa el cliente. No uses markdown.`,
      knowledge ? `Fuentes de conocimiento:\n${knowledge}` : '',
    ].filter(Boolean).join('\n\n');

    const reply = await aiSvc.callAI(
      settings,
      systemPrompt,
      history.length ? history : [{ role: 'user', content: args.messageBody || '' }]
    );
    if (!reply || !reply.trim()) return;

    const convo = convoSvc.getById(db, null, args.convoId);
    if (!convo) return;
    const externalId = await sendMessage(db, convo, reply);
    convoSvc.addMessage(db, null, args.convoId, {
      externalId, direction: 'outgoing', provider: convo.provider, body: reply, status: 'sent',
    });

    // Marcar telemetría
    db.prepare(`UPDATE conversations SET last_ai_msg_at = unixepoch() WHERE id = ?`).run(args.convoId);

    console.log(`[inbound-router] IA fallback respondió convo ${args.convoId}: "${reply.slice(0, 60)}"`);
  } catch (err) {
    console.error('[inbound-router] IA fallback error:', err.message);
  }
}

// ─── Helpers públicos para el resto del CRM ──────────────────────────

/**
 * markHumanMessage — llamar cuando un asesor mande un mensaje saliente.
 * Actualiza last_human_msg_at para que la ventana humano arranque.
 */
function markHumanMessage(db, conversationId) {
  if (!conversationId) return;
  db.prepare(`UPDATE conversations SET last_human_msg_at = unixepoch() WHERE id = ?`)
    .run(conversationId);
}

/**
 * setAiMode — cambia el modo de IA de una conversación.
 *  - 'auto'       (default) pipeline normal
 *  - 'off'        silencia IA (bots siguen)
 *  - 'human_lock' silencia TODO hasta que se vuelva a 'auto'
 */
function setAiMode(db, conversationId, mode) {
  if (!['auto', 'off', 'human_lock'].includes(mode)) {
    throw new Error('invalid ai_mode: ' + mode);
  }
  db.prepare(`UPDATE conversations SET ai_mode = ? WHERE id = ?`).run(mode, conversationId);
}

/**
 * giveBackToAI — el asesor presiona "Devolver a IA ahora": resetea la
 * ventana humano para que la IA pueda contestar de inmediato.
 */
function giveBackToAI(db, conversationId) {
  db.prepare(`
    UPDATE conversations
    SET last_human_msg_at = NULL,
        human_takeover_until = NULL,
        ai_mode = CASE WHEN ai_mode = 'human_lock' THEN 'auto' ELSE ai_mode END
    WHERE id = ?
  `).run(conversationId);
}

/**
 * Limpieza periódica de cache del matcher IA (TTL).
 */
function _cleanupMatcherCache(db) {
  db.prepare(`DELETE FROM bot_matcher_cache WHERE expires_at < unixepoch()`).run();
  // También limpia logs viejos (>7 días)
  db.prepare(`DELETE FROM inbound_router_log WHERE created_at < unixepoch() - 7*86400`).run();
}

function startCleanupTimer(db) {
  setInterval(() => _cleanupMatcherCache(db), 60 * 60 * 1000); // 1h
  console.log('[inbound-router] cleanup timer started');
}

module.exports = {
  handleInboundMessage,
  markHumanMessage,
  setAiMode,
  giveBackToAI,
  startCleanupTimer,
  // helpers expuestos para testing
  _isHumanActive,
  _activeWaits,
};
