'use strict';

// Bot Matcher — clasificador semántico de mensajes vs triggers de bots.
//
// Hoy los triggers de bots son texto exacto/regex. Eso significa que
// "ola me intersa lo de la alopesia" NO matchea "Me gustaría obtener
// información de los productos para Alopecia Hombre Reelance". El
// matcher IA resuelve eso: usa Haiku (modelo barato y rápido) para
// decidir qué bot, si alguno, debe disparar.
//
// Diseño:
//   1) Una sola llamada al LLM por mensaje, evaluando TODOS los bots
//      keyword del tenant a la vez. Devuelve el bot_id ganador o null.
//   2) Cache por { tenant_id + hash(mensaje normalizado) } con TTL 24h.
//      Si el mismo mensaje (en forma normalizada) ya pasó, se devuelve
//      la decisión cacheada sin pegar al LLM.
//   3) Fallback: si la llamada al LLM falla por cualquier motivo, cae
//      al matcher tradicional (substring case-insensitive). Cero downtime.
//
// Cómo se integra:
//   inbound-router/_tryMatchBot llama a matchSemantic() si el tenant
//   tiene ia_matcher_enabled=1. Si está apagado, usa el matcher viejo.

const crypto = require('crypto');
const aiSvc = require('../ai/service');

const CACHE_TTL_SECONDS = 24 * 3600;
const MATCHER_MODEL_OVERRIDE = 'claude-haiku-4-5-20251001'; // barato y rápido
const MAX_BOTS_PER_CALL = 50; // límite duro para no exceder context window

// ─── Helpers ──────────────────────────────────────────────────────────

function _normalize(text) {
  // Quita acentos, lowercase, colapsa espacios y signos. La idea es que
  // "ALOPECIA!!" y "alopecia" sean la misma cache key.
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _hashMsg(text) {
  return crypto.createHash('sha1').update(_normalize(text)).digest('hex');
}

function _cacheGet(db, tenantId, msgHash) {
  const row = db.prepare(`
    SELECT bot_id FROM bot_matcher_cache
    WHERE tenant_id = ? AND msg_hash = ? AND expires_at > unixepoch()
    LIMIT 1
  `).get(tenantId, msgHash);
  return row ? row.bot_id : undefined; // undefined = miss; null = hit con "no match"
}

function _cachePut(db, tenantId, msgHash, botId, confidence) {
  try {
    db.prepare(`
      INSERT INTO bot_matcher_cache (tenant_id, msg_hash, bot_id, confidence, expires_at)
      VALUES (?, ?, ?, ?, unixepoch() + ?)
    `).run(tenantId, msgHash, botId || null, confidence ?? null, CACHE_TTL_SECONDS);
  } catch (_) { /* race condition de inserts duplicados — ignorar */ }
}

// ─── Matcher tradicional (fallback) ──────────────────────────────────
// Respeta trigger_match_mode: 'any' (default) / 'all' / 'exact'
function _matchKeyword(bots, messageBody) {
  if (!messageBody) return null;
  const body = messageBody.toLowerCase();
  for (const bot of bots) {
    if (bot.trigger_type !== 'keyword') continue;
    const raw = String(bot.trigger_value || '').trim();
    if (!raw) continue;
    const mode = bot.trigger_match_mode || 'any';

    if (mode === 'exact') {
      if (body.includes(raw.toLowerCase())) return bot.id;
      continue;
    }
    const keywords = raw.split(/[\n|,]/).map(k => k.toLowerCase().trim()).filter(Boolean);
    if (!keywords.length) continue;
    if (mode === 'all') {
      if (keywords.every(k => body.includes(k))) return bot.id;
    } else {
      if (keywords.some(k => body.includes(k))) return bot.id;
    }
  }
  return null;
}

// ─── Matcher semántico (IA) ──────────────────────────────────────────

/**
 * Construye el prompt que evalúa el mensaje vs N bots en una llamada.
 * Le pedimos al LLM que responda JSON con el bot_id ganador o null.
 */
function _buildSystemPrompt(bots) {
  const lines = bots.map(b => {
    const desc = b.trigger_value ? `Trigger: "${b.trigger_value}"` : '(sin descripción)';
    return `- bot_id=${b.id} | "${b.name}" | ${desc}`;
  }).join('\n');

  return `Eres un clasificador de intenciones para un CRM de WhatsApp en español MX.
Tu trabajo: dado un mensaje del cliente, decidir qué bot (si alguno) debe responder.

Bots disponibles:
${lines}

Reglas:
- Si el mensaje del cliente expresa CLARAMENTE la intención que describe un bot, devuelve ese bot_id.
- Si hay duda, varios bots posibles, o el mensaje es genérico (saludos, "hola", "?"), devuelve null.
- NUNCA inventes bot_ids que no estén en la lista.
- Considera variaciones, faltas de ortografía y parafraseo. Ej: "ola me intersa la alopesia" debería matchear un bot con trigger "información alopecia".

Responde SOLO un JSON válido con esta forma exacta, sin texto extra ni markdown:
{"bot_id": 123, "confidence": 0.85}
o si nada match:
{"bot_id": null, "confidence": 0.0}`;
}

async function _callMatcherLLM(settings, bots, messageBody) {
  const systemPrompt = _buildSystemPrompt(bots);
  // Override del modelo a Haiku siempre (más barato que el modelo por default
  // del tenant que puede ser Sonnet/Opus para respuestas conversacionales)
  const matchSettings = {
    ...settings,
    model: settings.provider === 'anthropic' ? MATCHER_MODEL_OVERRIDE : settings.model,
    temperature: 0, // determinista para classification
    maxTokens: 80,  // solo necesitamos el JSON pequeño
  };
  const raw = await aiSvc.callAI(matchSettings, systemPrompt, [
    { role: 'user', content: `Mensaje del cliente: "${messageBody}"` },
  ]);
  // Parsear JSON. A veces el LLM agrega texto antes/después aunque le pidamos
  // que no — extraemos el JSON con regex defensiva.
  const jsonMatch = String(raw).match(/\{[^{}]*\}/);
  if (!jsonMatch) return { botId: null, confidence: 0 };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const botId = Number.isInteger(parsed.bot_id) ? parsed.bot_id : null;
    const conf  = Number(parsed.confidence) || 0;
    return { botId, confidence: conf };
  } catch (_) {
    return { botId: null, confidence: 0 };
  }
}

/**
 * matchSemantic — punto de entrada del matcher IA.
 *
 * @param {Database} db
 * @param {object} params
 *   - tenantId, messageBody, bots[] (lista de bots habilitados del tenant)
 * @returns {Promise<{botId: number|null, source: 'cache'|'llm'|'fallback', confidence: number, latencyMs: number}>}
 */
async function matchSemantic(db, { tenantId, messageBody, bots }) {
  const t0 = Date.now();

  if (!messageBody || !bots || !bots.length) {
    return { botId: null, source: 'fallback', confidence: 0, latencyMs: 0 };
  }

  const msgHash = _hashMsg(messageBody);

  // ── 1) Cache ──
  const cached = _cacheGet(db, tenantId, msgHash);
  if (cached !== undefined) {
    return { botId: cached, source: 'cache', confidence: 1.0, latencyMs: Date.now() - t0 };
  }

  // ── 2) Config IA del tenant ──
  const settings = aiSvc.getSettings(db, tenantId);
  if (!settings || !settings.apiKey || !settings.provider) {
    // Sin IA configurada → fallback a keyword tradicional
    const botId = _matchKeyword(bots, messageBody);
    return { botId, source: 'fallback', confidence: botId ? 0.5 : 0, latencyMs: Date.now() - t0 };
  }

  // Solo evaluamos bots con trigger_type='keyword'. Los demás (pipeline_stage,
  // scheduled, etc.) no son matcheables por texto y se evalúan por otros paths.
  const matchableBots = bots
    .filter(b => b.trigger_type === 'keyword')
    .slice(0, MAX_BOTS_PER_CALL);
  if (!matchableBots.length) {
    _cachePut(db, tenantId, msgHash, null, 0);
    return { botId: null, source: 'llm', confidence: 0, latencyMs: Date.now() - t0 };
  }

  // ── 3) LLM ──
  try {
    const { botId, confidence } = await _callMatcherLLM(settings, matchableBots, messageBody);
    // Validar que el botId devuelto SÍ esté en nuestra lista (defensa contra
    // hallucinations del LLM).
    const validBotId = matchableBots.some(b => b.id === botId) ? botId : null;
    _cachePut(db, tenantId, msgHash, validBotId, confidence);
    return { botId: validBotId, source: 'llm', confidence, latencyMs: Date.now() - t0 };
  } catch (err) {
    console.warn('[bot-matcher] LLM call failed, falling back to keyword:', err.message);
    // Fallback: matcher tradicional. NO cacheamos un fallback para que el
    // próximo intento sí pegue al LLM cuando se recupere.
    const botId = _matchKeyword(matchableBots, messageBody);
    return { botId, source: 'fallback', confidence: botId ? 0.5 : 0, latencyMs: Date.now() - t0 };
  }
}

module.exports = {
  matchSemantic,
  // Helpers expuestos para testing
  _normalize,
  _hashMsg,
  _matchKeyword,
};
