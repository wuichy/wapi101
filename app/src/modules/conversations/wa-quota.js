// ── Contador de mensajes de SERVICIO de WhatsApp (Cloud API) ────────────────
//
// Desde el 1-oct-2026 Meta cobra los mensajes de servicio: lo que la empresa
// contesta DENTRO de la ventana de 24 h después de que el cliente escribió.
// Da 1,000 gratis al mes POR NÚMERO y cobra desde el 1,001 (entregado).
// Fuente oficial: developers.facebook.com/documentation/business-messaging/
//   whatsapp/pricing/non-template-messages — "Effective October 1, 2026, Meta
//   will charge on a per-message basis for service messages".
//
// ⚠️ El mes se reinicia a las 12 am de la ZONA HORARIA DE LA CUENTA (WABA),
// NO en UTC: "At the start of the next month (12am WABA timezone), message
// count resets to 0". Por eso la zona es configurable por integración
// (integrations.config.billingTimezone) y por defecto es la de México.
//
// Qué se cuenta, y por qué así:
//  - Solo provider 'whatsapp' (la API oficial). WhatsApp Lite (Baileys) no
//    pasa por la facturación de Meta.
//  - Salientes DENTRO de la ventana: hubo un entrante en la MISMA conversación
//    en las 24 h previas. Con `>=` en el borde, igual que isWaWindowClosed()
//    de app.js (cerrada solo si pasaron MÁS de 24 h): una sola regla.
//  - Solo lo que no falló: Meta cobra por mensaje entregado.
//  - COALESCE en status y meta_json: los mensajes viejos traen meta_json NULL
//    y `NULL NOT LIKE ...` da NULL, que tira la fila EN SILENCIO (16-sep-2026:
//    ese truco hizo reportar 110 entregados en mayo cuando eran 8,043).
//  - ⚠️ wapi no guarda si un saliente fue plantilla o texto libre. Una
//    plantilla mandada dentro de la ventana no gasta de los 1,000, pero aquí
//    sí cuenta. El error queda del lado SEGURO: marca un poco MENOS de lo que
//    realmente queda, nunca más.

const LIMIT = 1000;
const WARN_AT = 800;
const CHARGE_START = { year: 2026, month: 10 }; // Meta cobra servicio desde aquí
const DEFAULT_TZ = 'America/Mexico_City';
const CACHE_MS = 15_000;

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const _cache = new Map(); // `${tenant}:${integration}:${periodStart}` → { used, at }

function _partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second };
}

// Instante (ms) de las 00:00 del día indicado EN la zona `tz`.
// offset(ms) = (hora local escrita como si fuera UTC) − (instante real).
// Dos pasadas por si en medio hay cambio de horario.
function zonedMidnightMs(year, month, day, tz) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = (ms) => {
    const p = _partsIn(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}

function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (_) { return false; }
}

// Periodo de facturación que contiene a `nowMs`, en la zona de la cuenta.
function periodFor(nowMs, tz = DEFAULT_TZ) {
  const zone = isValidTz(tz) ? tz : DEFAULT_TZ;
  const p = _partsIn(nowMs, zone);
  const startMs = zonedMidnightMs(p.year, p.month, 1, zone);
  const ny = p.month === 12 ? p.year + 1 : p.year;
  const nm = p.month === 12 ? 1 : p.month + 1;
  const endMs = zonedMidnightMs(ny, nm, 1, zone);
  const chargeStartMs = zonedMidnightMs(CHARGE_START.year, CHARGE_START.month, 1, zone);
  return {
    start: Math.floor(startMs / 1000),
    end: Math.floor(endMs / 1000),
    chargeStart: Math.floor(chargeStartMs / 1000),
    active: nowMs >= chargeStartMs,
    label: `${MESES[p.month]} ${p.year}`,
    timezone: zone,
  };
}

function levelFor(used) {
  if (used >= LIMIT) return 'over';
  if (used >= WARN_AT) return 'warn';
  return 'ok';
}

function countServiceMessages(db, tenantId, integrationId, startSec, endSec) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n
      FROM messages o
      JOIN conversations c ON c.id = o.conversation_id
     WHERE o.tenant_id = ? AND c.tenant_id = ? AND c.integration_id = ?
       AND o.provider = 'whatsapp' AND o.direction = 'outgoing'
       AND o.created_at >= ? AND o.created_at < ?
       AND COALESCE(o.status, '') NOT IN ('failed', 'error')
       AND COALESCE(o.meta_json, '') NOT LIKE '%metaError%'
       AND EXISTS (
         SELECT 1 FROM messages i
          WHERE i.conversation_id = o.conversation_id
            AND i.direction = 'incoming'
            AND i.created_at <= o.created_at
            AND i.created_at >= o.created_at - 86400
       )
  `).get(tenantId, tenantId, integrationId, startSec, endSec);
  return row?.n || 0;
}

function _tzFor(db, integrationId) {
  try {
    const r = db.prepare('SELECT config FROM integrations WHERE id = ?').get(integrationId);
    const tz = r?.config ? JSON.parse(r.config)?.billingTimezone : null;
    if (tz && isValidTz(tz)) return tz;
  } catch (_) { /* config ilegible → zona por defecto */ }
  return DEFAULT_TZ;
}

function getQuota(db, tenantId, integrationId, { nowMs = Date.now(), tz } = {}) {
  const per = periodFor(nowMs, tz || _tzFor(db, integrationId));
  const startsOn = `${CHARGE_START.year}-${String(CHARGE_START.month).padStart(2, '0')}-01`;
  const base = { limit: LIMIT, timezone: per.timezone, periodLabel: per.label, startsOn, active: per.active };
  if (!per.active) return { ...base, used: 0, remaining: LIMIT, over: 0, level: 'pending' };

  const key = `${tenantId}:${integrationId}:${per.start}`;
  const hit = _cache.get(key);
  let used;
  if (hit && nowMs - hit.at < CACHE_MS) {
    used = hit.used;
  } else {
    used = countServiceMessages(db, tenantId, integrationId, per.start, per.end);
    _cache.set(key, { used, at: nowMs });
  }
  return { ...base, used, remaining: Math.max(0, LIMIT - used), over: Math.max(0, used - LIMIT), level: levelFor(used) };
}

// Un saliente nuevo por la API invalida el conteo del tenant para que la
// barra baje al instante (lo llama conversations/service.js addMessage).
function bustTenant(tenantId) {
  const prefix = `${tenantId}:`;
  for (const k of [..._cache.keys()]) if (k.startsWith(prefix)) _cache.delete(k);
}

module.exports = {
  LIMIT, WARN_AT, CHARGE_START, DEFAULT_TZ,
  zonedMidnightMs, periodFor, levelFor, countServiceMessages, getQuota, bustTenant, isValidTz,
};
