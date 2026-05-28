'use strict';

// Detector estático de conflictos entre bots con trigger_type='keyword'.
// No usa IA — solo análisis de substring case-insensitive sobre las
// keywords declaradas en cada bot.
//
// Reglas:
//   - Comparar todos los pares (A,B) de bots keyword del mismo tenant.
//   - Para cada keyword de A, buscar overlap con keywords de B:
//       * Match exacto (case-insensitive) tras normalizar espacios → conflict
//       * Keyword de A es substring de keyword de B → conflict (B es más amplio)
//       * Keyword de B es substring de keyword de A → conflict (A es más amplio)
//   - Ignora keywords muy cortas (<3 chars) — son ruido (ej. "ok", "10")
//   - Modo 'exact' en uno de los bots: solo conflict si la frase exacta
//     está contenida en algún keyword del otro.

const MIN_KW_LEN = 3;

function _normalize(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function _parseKeywords(triggerValue, mode) {
  const raw = String(triggerValue || '').trim();
  if (!raw) return [];
  if (mode === 'exact') return [_normalize(raw)].filter(Boolean);
  return raw.split(/[\n|,]/).map(_normalize).filter(k => k && k.length >= MIN_KW_LEN);
}

/**
 * Detecta conflictos entre bots con trigger keyword del tenant.
 *
 * @returns {object} mapa { [botId]: [{ id, name, sharedKeywords }] }
 *          Si un bot no tiene conflicts, su entrada no existe (no es array vacío).
 */
function detectConflicts(db, tenantId) {
  const bots = db.prepare(`
    SELECT id, name, trigger_value, trigger_match_mode, enabled
    FROM salsbots
    WHERE tenant_id = ? AND trigger_type = 'keyword' AND enabled = 1
  `).all(tenantId);

  // Pre-parsear keywords de cada bot
  const parsed = bots.map(b => ({
    id:       b.id,
    name:     b.name,
    mode:     b.trigger_match_mode || 'any',
    keywords: _parseKeywords(b.trigger_value, b.trigger_match_mode || 'any'),
  })).filter(b => b.keywords.length > 0);

  const result = {};

  // Comparar todos los pares (A, B)
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const A = parsed[i];
      const B = parsed[j];
      const shared = _findShared(A, B);
      if (shared.length === 0) continue;

      // Registrar en ambas direcciones
      if (!result[A.id]) result[A.id] = [];
      if (!result[B.id]) result[B.id] = [];
      result[A.id].push({ id: B.id, name: B.name, sharedKeywords: shared });
      result[B.id].push({ id: A.id, name: A.name, sharedKeywords: shared });
    }
  }

  return result;
}

function _findShared(A, B) {
  const shared = new Set();
  for (const kwA of A.keywords) {
    for (const kwB of B.keywords) {
      if (kwA === kwB) {
        shared.add(kwA);
        continue;
      }
      // Substring bidireccional (A dentro de B, o B dentro de A).
      // Si kwA es un solo token y muy genérico (<5 chars) y kwB es una
      // frase larga que lo contiene, NO contar conflict — kwA es solo
      // una palabra incidental. Solo contar si la palabra completa
      // está como token aislado (entre word boundaries).
      if (kwA.length >= 5 && kwB.includes(kwA)) shared.add(kwA);
      else if (kwB.length >= 5 && kwA.includes(kwB)) shared.add(kwB);
      else if (kwA.length < 5 && _isWholeWord(kwB, kwA)) shared.add(kwA);
      else if (kwB.length < 5 && _isWholeWord(kwA, kwB)) shared.add(kwB);
    }
  }
  return [...shared];
}

function _isWholeWord(haystack, needle) {
  // Word-boundary check para keywords cortas
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(haystack);
}

/**
 * Versión simplificada: devuelve solo los bots con conflictos como
 * array plano, listo para mostrar en un alert global.
 */
function listConflictedBots(db, tenantId) {
  const map = detectConflicts(db, tenantId);
  const out = [];
  for (const botId of Object.keys(map)) {
    const conflicts = map[botId];
    const bot = db.prepare('SELECT id, name FROM salsbots WHERE id = ?').get(botId);
    if (!bot) continue;
    out.push({
      id: bot.id,
      name: bot.name,
      conflictsWith: conflicts,
    });
  }
  return out;
}

module.exports = { detectConflicts, listConflictedBots, _parseKeywords, _findShared };
