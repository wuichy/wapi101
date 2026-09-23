// Vigilante de la ventana de 24 h de WhatsApp (bots con trigger_type='window_24h').
//
// Para qué existe: los leads del pipeline WHATSAPP nacen directo en "Leads
// Entrantes" (el webhook solo crea el registro) y crear un lead NO dispara el
// bot de su etapa, así que se pasaban a mano a "Etapa 1" (292 veces en 60 días).
// Un bot con este disparador vigila cada minuto a los leads de SU etapa y corre
// sus pasos (normalmente: pasar a Etapa 1) cuando el cliente no tiene nada
// pendiente de contestar y van 23 h 50 min desde su último mensaje: la misma
// hora del día en que estuvo conectado, y con la ventana todavía abierta, para
// que la plantilla de utilidad de la etapa siguiente salga gratis.
//
// Reglas que decidió Luis (16-sep-2026):
//   - Las 24 h cuentan desde el ÚLTIMO mensaje del cliente (así lo mide Meta).
//   - Se corre a las 23 h 50 min de ese mensaje, solo si todo está contestado.
//   - Si quedó un mensaje del cliente sin contestar, el lead se queda.
//   - Si se contestó cuando la ventana ya había cerrado, se corre a la misma
//     hora en días siguientes (23 h 50 min + 24 h, + 48 h…).
//   - Solo leads NUEVOS (creados después del bot); los que ya estaban los mueve él.
//   - Un "gracias", "ok", un emoji, un sticker o una reacción no son pendientes.
//     Excepción: si lo último que le mandamos era una pregunta, "ok", "sí", un
//     emoji o un sticker SON la respuesta y el lead se queda.
// Mejoras propias:
//   - Cada lead se corre una sola vez: si alguien lo regresa a la etapa, se respeta.
//   - Las reacciones no reinician la ventana (no está claro que Meta las cuente;
//     ignorarlas solo adelanta el movimiento, nunca lo manda con la ventana cerrada).
//   - Toda decisión que toma solo queda en el historial del lead con el porqué,
//     una sola vez (no cada minuto).

const activitySvc = require('../expedients/activity');

const TRIGGER               = 'window_24h';
const DAY_SEC               = 24 * 3600;
const WINDOW_SEC            = DAY_SEC;
const MOVE_AT_SEC           = 23 * 3600 + 50 * 60; // 23 h 50 min
const SAFE_BEFORE_CLOSE_SEC = 2 * 60;              // dentro de la ventana: nunca en los últimos 2 min
const LATE_SLOT_SEC         = 10 * 60;             // ventana ya cerrada: 10 min cada día para correr
const WARN_SEC              = 3 * 3600;            // marca visual: faltan 3 h o menos
const MIN_LEAD_AGE_SEC      = 2 * 60;              // el webhook crea el lead y luego guarda el mensaje
const MOVE_CHECK_AFTER_SEC  = 10 * 60;             // si tras 10 min sigue en la etapa, no se movió
const DEFAULT_TZ            = 'America/Mexico_City';
const CACHE_MS              = 15_000;

// ─── ¿El mensaje del cliente pide respuesta? ────────────────────────────────

// Agradecer cierra la plática aunque le hayamos preguntado algo.
const GRATITUDE = new Set([
  'gracias', 'grasias', 'gracia', 'grax', 'thanks', 'thx', 'bendiciones', 'amable',
  'agradezco', 'agradecida', 'agradecido',
]);
// Dar por recibido cierra la plática… salvo que lo último nuestro fuera una pregunta
// (entonces "ok" o "va" SON la respuesta y hay que seguir la plática).
const ACK = new Set([
  'ok', 'oki', 'okis', 'okey', 'okay', 'oka', 'va', 'vale', 'sale', 'dale', 'perfecto', 'perfecta',
  'listo', 'lista', 'entendido', 'entendida', 'enterado', 'enterada', 'excelente', 'genial', 'super',
  'bien', 'claro', 'deacuerdo',
]);
// Relleno que acompaña a lo anterior ("muchas gracias por la info", "ok, buenas noches").
// Solo, sin agradecer ni dar por recibido, NO cierra ("buenas tardes" es un saludo).
const FILLER = new Set([
  'muchas', 'muchisimas', 'mil', 'muy', 'y', 'de', 'acuerdo', 'igualmente', 'buen', 'buena', 'buenas',
  'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches', 'bonito', 'bonita', 'lindo', 'linda', 'feliz',
  'por', 'la', 'el', 'lo', 'le', 'se', 'su', 'tu', 'todo', 'info', 'informacion', 'ayuda', 'atencion', 'apoyo',
]);

function _waType(msg) {
  try { return JSON.parse(msg.meta_json || '{}').waType || null; } catch { return null; }
}

function _words(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/([a-z])\1+/g, '$1') // "graciass", "okk", "vaaa" → gracias, ok, va
    .split(/\s+/)
    .filter(Boolean);
}

function _classifyText(body, { afterQuestion = false } = {}) {
  const text = String(body || '').trim();
  if (!text) return 'substantive';
  if (/[?¿]/.test(text)) return 'substantive';
  const words = _words(text);
  // Solo emojis: cierra, salvo que le hayamos preguntado algo (un 👍 a "¿te paso el link?" es un sí).
  if (!words.length) {
    return /\p{Extended_Pictographic}/u.test(text) && !afterQuestion ? 'closer' : 'substantive';
  }
  let thanks = false;
  let ack = false;
  let yes = false;
  for (const w of words) {
    if (GRATITUDE.has(w)) thanks = true;
    else if (ACK.has(w)) ack = true;
    else if (w === 'si') yes = true;
    else if (!FILLER.has(w)) return 'substantive';
  }
  if (afterQuestion && (ack || yes)) return 'substantive';
  if (thanks) return 'closer';
  if (ack) return 'closer';
  return 'substantive'; // "sí" solo, o puro saludo
}

// 'reaction' | 'closer' | 'substantive'
function classifyIncoming(msg, { afterQuestion = false } = {}) {
  const type = _waType(msg);
  const body = String(msg.body || '').trim();
  if (type === 'reaction') return 'reaction';
  if (!type && /^(Reaccionó:|👍 Reacción$|Quitó la reacción$)/.test(body)) return 'reaction';
  if (type === 'sticker') return afterQuestion ? 'substantive' : 'closer';
  // Foto, audio, video, documento, ubicación, pedido, no soportado…: alguien tiene que verlo.
  if (type && !['text', 'button', 'interactive'].includes(type)) return 'substantive';
  if (!type && msg.media_url) return 'substantive';
  return _classifyText(body, { afterQuestion });
}

// Un saliente cuenta como respuesta si de verdad salió (no falló ni lo rechazó Meta).
function _countsAsAnswer(msg) {
  const status = String(msg.status || '').toLowerCase();
  if (status === 'failed' || status === 'error') return false;
  if (String(msg.meta_json || '').includes('metaError')) return false;
  return true;
}

// Lee el chat más reciente del contacto (el que usará el bot de la etapa siguiente).
function analyzeContact(db, tenantId, contactId) {
  const convo = db.prepare(`
    SELECT id, provider, integration_id, bot_paused
      FROM conversations
     WHERE contact_id = ? AND tenant_id = ?
     ORDER BY last_message_at DESC
     LIMIT 1
  `).get(contactId, tenantId);
  if (!convo || convo.provider !== 'whatsapp') {
    return { convo: convo || null, lastIn: null, lastOut: null, pending: null, pendingCount: 0 };
  }

  const msgs = db.prepare(`
    SELECT id, direction, body, media_url, status, meta_json, created_at
      FROM messages
     WHERE conversation_id = ? AND tenant_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 300
  `).all(convo.id, tenantId);

  let lastIn = null;
  let lastOut = null;
  const unanswered = []; // entrantes posteriores a nuestra última respuesta, del más nuevo al más viejo
  for (const m of msgs) {
    if (m.direction === 'outgoing') {
      if (!lastOut && _countsAsAnswer(m)) lastOut = m;
    } else if (m.direction === 'incoming') {
      if (!lastIn && classifyIncoming(m) !== 'reaction') lastIn = m;
      if (!lastOut) unanswered.push(m);
    }
    if (lastIn && lastOut) break;
  }

  const afterQuestion = !!(lastOut && /[?¿]/.test(String(lastOut.body || '')));
  const pendingList = unanswered.filter((m) => classifyIncoming(m, { afterQuestion }) === 'substantive');
  return {
    convo,
    lastIn,
    lastOut,
    pending: pendingList.length ? pendingList[pendingList.length - 1] : null, // el más viejo sin contestar
    pendingCount: pendingList.length,
  };
}

// ─── Textos del historial ───────────────────────────────────────────────────

function _fmt(sec, tz = DEFAULT_TZ) {
  if (!sec) return '—';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(sec * 1000));
  } catch {
    return new Date(sec * 1000).toISOString();
  }
}

const MEDIA_LABEL = {
  image: 'una foto', video: 'un video', audio: 'un audio', document: 'un documento',
  location: 'su ubicación', order: 'un pedido del catálogo', contacts: 'un contacto',
};

function _preview(msg) {
  const type = _waType(msg);
  const body = String(msg.body || '').replace(/\s+/g, ' ').trim();
  if (MEDIA_LABEL[type] && !body) return MEDIA_LABEL[type];
  if (!body) return msg.media_url ? 'un archivo' : 'un mensaje';
  const cut = body.length > 60 ? `${body.slice(0, 57)}…` : body;
  return `«${cut}»`;
}

function _targetStageName(db, bot) {
  const step = (Array.isArray(bot.steps) ? bot.steps : []).find((s) => s && s.type === 'stage');
  if (!step) return null;
  const id = Number(step.stageId || step.config?.stageId);
  const row = id ? db.prepare('SELECT name FROM stages WHERE id = ?').get(id) : null;
  return row?.name || step.config?.stageName || null;
}

// ─── Decisiones (una fila por bot + lead) ───────────────────────────────────

function _prevDecision(db, botId, expedientId) {
  return db.prepare('SELECT * FROM bot_window_guard WHERE bot_id = ? AND expedient_id = ?').get(botId, expedientId) || null;
}

function _saveDecision(db, row) {
  db.prepare(`
    INSERT INTO bot_window_guard (tenant_id, bot_id, expedient_id, decision, reason, last_in_at, slot_at, detail, decided_at)
    VALUES (@tenant_id, @bot_id, @expedient_id, @decision, @reason, @last_in_at, @slot_at, @detail, @decided_at)
    ON CONFLICT(bot_id, expedient_id) DO UPDATE SET
      tenant_id  = excluded.tenant_id,
      decision   = excluded.decision,
      reason     = excluded.reason,
      last_in_at = excluded.last_in_at,
      slot_at    = excluded.slot_at,
      detail     = excluded.detail,
      decided_at = excluded.decided_at
  `).run(row);
}

function _contactPaused(db, tenantId, contactId, botId) {
  const perBot = db.prepare(
    'SELECT paused FROM contact_bot_pauses WHERE contact_id = ? AND bot_id = ? AND tenant_id = ?'
  ).get(contactId, botId, tenantId);
  if (perBot?.paused) return true;
  try {
    const c = db.prepare('SELECT bot_paused FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, tenantId);
    return !!c?.bot_paused;
  } catch {
    return false;
  }
}

function _defaultIsHumanOnly(db, convo) {
  try {
    return require('../conversations/sender').isHumanOnlyChannel(db, convo);
  } catch {
    return false;
  }
}

// ─── Un lead ────────────────────────────────────────────────────────────────

function _handleLead(db, { bot, stage, exp, nowSec, runBot, isHumanOnly, log }) {
  const tenantId = bot.tenant_id;
  const prev = _prevDecision(db, bot.id, exp.id);
  const target = _targetStageName(db, bot);
  const doing = target ? `pasa a "${target}"` : `corre el bot "${bot.name}"`;

  // Guarda la decisión y la anota en el historial SOLO si cambió.
  const decide = ({ decision, reason = null, lastInAt = null, slotAt = null, type, description, meta = {} }) => {
    const same = prev
      && prev.decision === decision
      && (prev.reason || null) === (reason || null)
      && (prev.last_in_at ?? null) === (lastInAt ?? null);
    if (same) return false;
    _saveDecision(db, {
      tenant_id: tenantId, bot_id: bot.id, expedient_id: exp.id, decision, reason,
      last_in_at: lastInAt, slot_at: slotAt, detail: description, decided_at: nowSec,
    });
    activitySvc.log(db, {
      expedientId: exp.id,
      contactId:   exp.contact_id,
      type,
      description,
      metadata:    { botId: bot.id, decision, reason, lastInAt, slotAt, ...meta },
    });
    log('info', `vigilante 24 h (bot ${bot.id}) lead ${exp.id}: ${decision}${reason ? `/${reason}` : ''}`);
    return true;
  };
  const skip = (reason, description, extra = {}) => {
    decide({ decision: 'skip', reason, type: 'bot_window_skip', description, ...extra });
    return { action: 'skip', reason };
  };

  // 1) Ya lo corrió antes: nunca dos veces.
  if (prev && ['moved', 'returned', 'move_failed'].includes(prev.decision)) {
    if (prev.decision !== 'moved') return { action: 'done', reason: prev.decision };
    if (nowSec - prev.decided_at < MOVE_CHECK_AFTER_SEC) return { action: 'moving' };
    if (Number(exp.stage_entered_at || 0) > Number(prev.decided_at)) {
      decide({
        decision: 'returned', type: 'bot_window_skip',
        description: `Regresó a "${stage.name}" después de que el vigilante lo movió. No lo vuelve a mover: queda a tu cargo.`,
      });
      return { action: 'done', reason: 'returned' };
    }
    decide({
      decision: 'move_failed', type: 'bot_window_skip',
      description: `El vigilante intentó que ${doing} (${_fmt(prev.decided_at)}) pero sigue en "${stage.name}". No lo vuelve a intentar solo: revisa las ejecuciones del bot "${bot.name}".`,
    });
    return { action: 'done', reason: 'move_failed' };
  }

  // 2) Recién creado: el webhook guarda el mensaje un instante después del lead.
  if (nowSec - Number(exp.created_at || 0) < MIN_LEAD_AGE_SEC) return { action: 'wait', reason: 'too_new' };

  // 3) El paso "etapa" mueve el lead abierto MÁS NUEVO del contacto: tiene que ser este.
  const newest = db.prepare(`
    SELECT e.id
      FROM expedients e
      JOIN stages s ON s.id = e.stage_id
     WHERE e.contact_id = ? AND e.tenant_id = ?
       AND COALESCE(s.kind, 'in_progress') = 'in_progress'
     ORDER BY e.created_at DESC
     LIMIT 1
  `).get(exp.contact_id, tenantId);
  if (newest && newest.id !== exp.id) {
    return skip('other_open_lead',
      `El vigilante no lo mueve: el contacto tiene otro lead abierto más nuevo (#${newest.id}) y el bot movería ese.`);
  }

  // 4) La ventana solo existe en la API oficial de WhatsApp.
  const a = analyzeContact(db, tenantId, exp.contact_id);
  if (!a.convo) return skip('no_convo', 'El vigilante no lo mueve: el contacto no tiene chat.');
  if (a.convo.provider !== 'whatsapp') {
    return skip('not_api',
      'El vigilante no lo mueve: su chat más reciente no es por la API oficial de WhatsApp, así que no aplica la ventana de 24 h.');
  }
  // ── El ancla del reloj: el último mensaje del CLIENTE… o el NUESTRO ──────
  // (21-sep-2026, regla de Luis para Cartbounty: "si les mandamos mensajes y
  // no respondían nada, se pasaban a Etapa 1".) Un carrito abandonado entra a
  // la etapa sin haber escrito jamás: no hay ventana de 24 h que medir, pero
  // SÍ hay silencio que medir — desde nuestro último mensaje. Un día completo
  // callado y el lead sigue su camino. Si tampoco le hemos escrito nosotros,
  // la regla no aplica: no se mide el silencio de una conversación vacía.
  const anclaNuestra = !a.lastIn;
  if (anclaNuestra && !a.lastOut) {
    return skip('no_messages',
      'El vigilante no lo mueve: nadie ha escrito en este chat (ni el cliente ni nosotros) — no hay silencio que medir.');
  }

  const lastInAt  = anclaNuestra ? Number(a.lastOut.created_at) : Number(a.lastIn.created_at);
  const closesAt  = lastInAt + WINDOW_SEC;
  const firstSlot = lastInAt + MOVE_AT_SEC;
  const base = { lastInAt, closesAt, pending: !!a.pending };
  if (nowSec < firstSlot) return { action: 'wait', reason: 'before_slot', slotAt: firstSlot, ...base };

  const k       = Math.floor((nowSec - firstSlot) / DAY_SEC);
  const slotAt  = firstSlot + k * DAY_SEC;
  const slotEnd = k === 0 ? closesAt - SAFE_BEFORE_CLOSE_SEC : slotAt + LATE_SLOT_SEC;

  // 5) Mensaje del cliente sin contestar → se queda.
  if (a.pending) {
    decide({
      decision: 'stay', reason: 'pending', lastInAt, slotAt: firstSlot, type: 'bot_window_stay',
      description: `Se queda en "${stage.name}": el cliente mandó ${_preview(a.pending)} (${_fmt(a.pending.created_at)}) y sigue sin respuesta. `
        + (nowSec < closesAt
          ? `Su ventana de 24 h cierra ${_fmt(closesAt)}.`
          : `Su ventana de 24 h cerró ${_fmt(closesAt)}.`),
      meta: { closesAt, pendingMessageId: a.pending.id },
    });
    return { action: 'stay', reason: 'pending', slotAt, ...base };
  }

  // 6) Todo contestado pero fuera de su turno → espera el siguiente (misma hora, otro día).
  if (nowSec >= slotEnd) return { action: 'wait', reason: 'next_slot', slotAt: slotAt + DAY_SEC, ...base };

  // 7) Pausas y canal solo-humano: el motor no correría el bot, así que ni lo intenta.
  if (a.convo.bot_paused || _contactPaused(db, tenantId, exp.contact_id, bot.id)) {
    return skip('paused',
      `El vigilante no lo mueve: los bots están pausados en su chat. Si los reanudas, ${doing} en su siguiente turno (la misma hora en que escribió el cliente).`,
      { lastInAt, slotAt });
  }
  if ((isHumanOnly || _defaultIsHumanOnly)(db, a.convo)) {
    return skip('human_only',
      'El vigilante no lo mueve: su chat entra por un canal marcado como solo-humano.',
      { lastInAt, slotAt });
  }

  // 8) Correr el bot.
  decide({
    decision: 'moved', lastInAt, slotAt, type: 'bot_window_move',
    description: anclaNuestra
      ? `El cliente nunca respondió: ${doing} solo. Nuestro último mensaje fue ${_fmt(lastInAt)} y pasó un día completo en silencio.`
      : (k === 0
        ? `Todo contestado: ${doing} solo. Último mensaje del cliente ${_fmt(lastInAt)}; su ventana de 24 h cierra ${_fmt(closesAt)}.`
        : `Todo contestado: ${doing} solo. Su ventana ya había cerrado (${_fmt(closesAt)}), así que esperó a la misma hora en que escribió el cliente.`),
    meta: { closesAt, anclaNuestra },
  });
  try {
    runBot(bot, {
      convoId:       a.convo.id,
      contactId:     exp.contact_id,
      messageBody:   '',
      provider:      a.convo.provider,
      integrationId: a.convo.integration_id || null,
      expedientId:   exp.id,
      pipelineId:    exp.pipeline_id,
      stageId:       exp.stage_id,
      chainDepth:    0,
      tenantId,
    });
  } catch (e) {
    _saveDecision(db, {
      tenant_id: tenantId, bot_id: bot.id, expedient_id: exp.id, decision: 'move_failed', reason: null,
      last_in_at: lastInAt, slot_at: slotAt, detail: e.message, decided_at: nowSec,
    });
    activitySvc.log(db, {
      expedientId: exp.id, contactId: exp.contact_id, type: 'bot_window_skip',
      description: `El vigilante no pudo correr el bot "${bot.name}": ${e.message}. No lo vuelve a intentar solo.`,
      metadata: { botId: bot.id, decision: 'move_failed' },
    });
    log('error', `vigilante 24 h (bot ${bot.id}) lead ${exp.id}: ${e.message}`);
    return { action: 'error', reason: e.message, slotAt, ...base };
  }
  return { action: 'move', slotAt, late: k > 0, ...base };
}

// ─── Reloj: cada minuto ─────────────────────────────────────────────────────

function tick(db, { nowSec = Math.floor(Date.now() / 1000), runBot, isHumanOnly = null, log = () => {} } = {}) {
  if (typeof runBot !== 'function') throw new Error('window-guard.tick: falta runBot');
  const results = [];
  let bots;
  try {
    bots = db.prepare('SELECT * FROM salsbots WHERE enabled = 1 AND trigger_type = ?').all(TRIGGER);
  } catch (e) {
    log('error', `vigilante 24 h: no pude leer los bots: ${e.message}`);
    return results;
  }
  for (const row of bots) {
    let steps;
    try { steps = JSON.parse(row.steps || '[]'); } catch { steps = null; }
    if (!Array.isArray(steps) || !steps.length) continue;
    const stageId = Number(row.trigger_value);
    if (!stageId) continue;
    const stage = db.prepare('SELECT id, name, pipeline_id FROM stages WHERE id = ? AND tenant_id = ?').get(stageId, row.tenant_id);
    if (!stage) continue;
    const bot = { ...row, steps };
    // Solo leads NUEVOS: creados después del bot.
    const leads = db.prepare(`
      SELECT id, contact_id, pipeline_id, stage_id, created_at, stage_entered_at
        FROM expedients
       WHERE tenant_id = ? AND stage_id = ? AND created_at >= ?
       ORDER BY created_at ASC
       LIMIT 1000
    `).all(row.tenant_id, stageId, Number(row.created_at) || 0);
    for (const exp of leads) {
      try {
        const r = _handleLead(db, { bot, stage, exp, nowSec, runBot, isHumanOnly, log });
        results.push({ botId: bot.id, expedientId: exp.id, ...r });
      } catch (e) {
        log('error', `vigilante 24 h (bot ${bot.id}) lead ${exp.id}: ${e.message}`);
        results.push({ botId: bot.id, expedientId: exp.id, action: 'error', reason: e.message });
      }
    }
  }
  return results;
}

// ─── Marca visual en la tarjeta del lead ────────────────────────────────────

let _watchCache = new Map(); // tenantId → { at, stages: Map<stageId, bot> }

function watchedStages(db, tenantId, nowMs = Date.now()) {
  const hit = _watchCache.get(tenantId);
  if (hit && nowMs >= hit.at && nowMs - hit.at < CACHE_MS) return hit.stages;
  const stages = new Map();
  try {
    const rows = db.prepare(
      'SELECT id, name, trigger_value FROM salsbots WHERE tenant_id = ? AND enabled = 1 AND trigger_type = ?'
    ).all(tenantId, TRIGGER);
    for (const b of rows) {
      const sid = Number(b.trigger_value);
      if (sid && !stages.has(sid)) stages.set(sid, b);
    }
  } catch { /* sin tabla de bots: no hay nada que vigilar */ }
  _watchCache.set(tenantId, { at: nowMs, stages });
  return stages;
}

function bustCache() { _watchCache = new Map(); }

// Lo que la TARJETA tiene que decir de un lead en etapa vigilada. Dos casos:
//
//   • 'pending'   — el cliente escribió, nadie le contestó y faltan 3 h o menos
//                   para que cierre su ventana. (Lo de siempre.)
//   • 'scheduled' — todo contestado: el vigilante ya tiene HORA para moverlo.
//
// 🚨 Por qué existe 'scheduled' (23-sep-2026): el bot de ventana NO arranca cuando
// el cliente escribe — espera hasta 10 min antes de que cierre la ventana de 24 h
// (MOVE_AT_SEC). Pero la alarma de la etapa grita "Estancado" a las 9 h. O sea que
// la tarjeta se veía en rojo, sin nada corriendo y sin reloj, durante ~15 h antes
// de que el bot siquiera despertara. La interfaz decía "roto" cuando estaba
// esperando a propósito. El reloj aquí es EL MISMO de _handleLead: si cambia allá,
// cambia aquí (lo cubre pruebas/probar-window-alert.js).
//
// Aplica a TODOS los leads de una etapa vigilada (también los viejos): solo avisa.
function windowAlertFor(db, tenantId, row, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  try {
    if (!row || !row.contact_id || !row.stage_id) return null;
    const bot = watchedStages(db, tenantId, nowSec * 1000).get(Number(row.stage_id));
    if (!bot) return null;

    const a = analyzeContact(db, tenantId, row.contact_id);
    if (!a.convo || a.convo.provider !== 'whatsapp') return null;

    // 1) Algo del cliente sin contestar: mandan las prisas, no el bot.
    if (a.lastIn && a.pending) {
      const closesAt = Number(a.lastIn.created_at) + WINDOW_SEC;
      const left = closesAt - nowSec;
      if (left <= 0 || left > WARN_SEC) return null;
      return { kind: 'pending', closesAt, pendingSince: Number(a.pending.created_at) };
    }

    // 2) Todo contestado → el vigilante ya tiene hora. El bot no lo vuelve a tocar
    //    si ya lo movió (o si el movimiento falló y quedó a cargo de un humano).
    const prev = _prevDecision(db, bot.id, row.id);
    if (prev && ['moved', 'returned', 'move_failed'].includes(prev.decision)) return null;

    // Ancla del reloj: el último mensaje del CLIENTE, o el NUESTRO si nunca escribió
    // (carrito abandonado: no hay ventana que medir, pero sí silencio).
    const ancla = a.lastIn || a.lastOut;
    if (!ancla) return null;
    const anchorAt  = Number(ancla.created_at);
    const closesAt  = anchorAt + WINDOW_SEC;
    const firstSlot = anchorAt + MOVE_AT_SEC;

    let slotAt;
    if (nowSec < firstSlot) {
      slotAt = firstSlot;
    } else {
      const k       = Math.floor((nowSec - firstSlot) / DAY_SEC);
      const thisOne = firstSlot + k * DAY_SEC;
      const slotEnd = k === 0 ? closesAt - SAFE_BEFORE_CLOSE_SEC : thisOne + LATE_SLOT_SEC;
      slotAt = nowSec >= slotEnd ? thisOne + DAY_SEC : thisOne;   // se le pasó el turno: mañana
    }
    return {
      kind: 'scheduled',
      slotAt,
      closesAt,
      botName: bot.name || null,
      anchorIsOurs: !a.lastIn,   // el reloj corre desde NUESTRO mensaje, no del suyo
    };
  } catch {
    return null;
  }
}

module.exports = {
  TRIGGER,
  WINDOW_SEC,
  MOVE_AT_SEC,
  SAFE_BEFORE_CLOSE_SEC,
  LATE_SLOT_SEC,
  WARN_SEC,
  MOVE_CHECK_AFTER_SEC,
  classifyIncoming,
  analyzeContact,
  tick,
  watchedStages,
  bustCache,
  windowAlertFor,
};
