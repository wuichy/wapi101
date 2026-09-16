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
//
// El tablero de analítica calcula su costo de Meta con este MISMO módulo
// (metaCostEstimate), para que el tablero y la caja de respuesta nunca digan
// cosas distintas sobre la misma ventana de 24 h.

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

// "Ventana abierta" para el saliente `o`: hubo un entrante en la misma
// conversación en las 24 h previas. UNA sola definición para el contador de la
// caja y para el costo del tablero.
const EN_VENTANA = `EXISTS (
         SELECT 1 FROM messages i
          WHERE i.conversation_id = o.conversation_id
            AND i.direction = 'incoming'
            AND i.created_at <= o.created_at
            AND i.created_at >= o.created_at - 86400
       )`;

// Salientes por la API oficial que no fallaron, en [startSec, endSec).
//   ventana: true  → dentro de 24 h (mensajes de servicio)
//            false → fuera de 24 h (forzosamente plantillas)
// Filtros opcionales: un número (integrationId) y un asesor (advisorId).
function countOutgoingApi(db, tenantId, startSec, endSec, { ventana, integrationId = null, advisorId = null } = {}) {
  const filtros = [];
  const params = [tenantId, startSec, endSec];
  if (integrationId != null) {
    filtros.push('AND c.tenant_id = ? AND c.integration_id = ?');
    params.push(tenantId, integrationId);
  }
  if (advisorId != null) {
    filtros.push('AND c.contact_id IN (SELECT id FROM contacts WHERE assigned_advisor_id = ? AND tenant_id = ?)');
    params.push(advisorId, tenantId);
  }
  const row = db.prepare(`
    SELECT COUNT(*) AS n
      FROM messages o
      JOIN conversations c ON c.id = o.conversation_id
     WHERE o.tenant_id = ?
       AND o.provider = 'whatsapp' AND o.direction = 'outgoing'
       AND o.created_at >= ? AND o.created_at < ?
       AND COALESCE(o.status, '') NOT IN ('failed', 'error')
       AND COALESCE(o.meta_json, '') NOT LIKE '%metaError%'
       AND ${ventana ? '' : 'NOT '}${EN_VENTANA}
       ${filtros.join('\n       ')}
  `).get(...params);
  return row?.n || 0;
}

function countServiceMessages(db, tenantId, integrationId, startSec, endSec) {
  return countOutgoingApi(db, tenantId, startSec, endSec, { ventana: true, integrationId });
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

// ── Estimado de costo para el tablero de analítica ─────────────────────────
// Meta cobra por MENSAJE ENTREGADO desde jul-2025 (antes era por conversación
// de 24 h, el modelo que el tablero seguía usando):
//  - Plantillas: según su categoría. Fuera de la ventana todo saliente es
//    plantilla, pero wapi NO guarda la categoría de cada envío → se da un
//    RANGO: todas de utilidad (piso) a todas de marketing (techo).
//  - Servicio (dentro de 24 h): gratis hasta el 30-sep-2026; desde el
//    1-oct-2026 se cobra lo que pase de 1,000 al mes POR NÚMERO, a tarifa de
//    utilidad ("rates for service messages are the same as the rates for
//    utility and authentication messages").
//  - Los anuncios Click-to-WhatsApp dan 72 h gratis y wapi no los distingue:
//    ahí el estimado puede quedar ALTO, nunca bajo.
// Tarifas: cifras 2026 para México publicadas por terceros (go4whatsup,
// engagelab). Meta publica las oficiales en rate cards descargables; se fijan
// por .env sin tocar código: META_RATE_MARKETING_USD, META_RATE_UTILITY_USD,
// USD_TO_MXN.
function _rateFromEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function metaRates() {
  return {
    marketingUsd: _rateFromEnv('META_RATE_MARKETING_USD', 0.0436),
    utilityUsd:   _rateFromEnv('META_RATE_UTILITY_USD', 0.0080),
    usdToMxn:     _rateFromEnv('USD_TO_MXN', 18.5),
  };
}

// Mensajes de servicio COBRADOS que caen en [startSec, endSec), sumando todos
// los números de la API del tenant. La cuota de 1,000 es por número y por MES
// COMPLETO: si el rango empieza a medio mes, lo mandado antes del rango ya
// gastó parte de la cuota. Por eso, por cada mes:
//   cobrados en el rango = excedente(inicio del mes → fin del rango)
//                        − excedente(inicio del mes → inicio del rango)
function serviceChargesInRange(db, tenantId, startSec, endSec) {
  const numeros = db.prepare(
    "SELECT id FROM integrations WHERE tenant_id = ? AND provider = 'whatsapp'"
  ).all(tenantId);
  let charged = 0;
  for (const { id } of numeros) {
    const tz = _tzFor(db, id);
    let cursor = startSec;
    for (let i = 0; i < 60 && cursor < endSec; i++) {
      const per = periodFor(cursor * 1000, tz);
      if (per.active) {
        const desde = Math.max(per.start, startSec);
        const hasta = Math.min(per.end, endSec);
        const alFin = countServiceMessages(db, tenantId, id, per.start, hasta);
        const alInicio = desde > per.start ? countServiceMessages(db, tenantId, id, per.start, desde) : 0;
        charged += Math.max(0, alFin - LIMIT) - Math.max(0, alInicio - LIMIT);
      }
      cursor = per.end;
    }
  }
  return charged;
}

// start/end como los manda el tablero: segundos, con el FIN INCLUIDO (BETWEEN).
function metaCostEstimate(db, tenantId, { start, end, advisorId = null } = {}) {
  const s = Number(start);
  const e = Number(end) + 1; // → rango semiabierto [s, e)
  const rates = metaRates();
  const r2 = (n) => Math.round(n * 100) / 100;
  const startsOn = `${CHARGE_START.year}-${String(CHARGE_START.month).padStart(2, '0')}-01`;
  const chargeStartSec = Math.floor(zonedMidnightMs(CHARGE_START.year, CHARGE_START.month, 1, DEFAULT_TZ) / 1000);

  const plantillas = countOutgoingApi(db, tenantId, s, e, { ventana: false, advisorId });
  const servicio = countOutgoingApi(db, tenantId, s, e, { ventana: true, advisorId });
  const servicioActivo = e > chargeStartSec;
  // La cuota gratis es POR NÚMERO: con filtro de asesor no hay forma honesta de
  // repartirla entre personas → el cobro de servicio solo se da a nivel cuenta.
  const cobrados = advisorId != null ? null : (servicioActivo ? serviceChargesInRange(db, tenantId, s, e) : 0);
  const servicioUsd = (cobrados || 0) * rates.utilityUsd;
  const minUsd = plantillas * rates.utilityUsd + servicioUsd;
  const maxUsd = plantillas * rates.marketingUsd + servicioUsd;

  return {
    model: 'por-mensaje',
    templates: { count: plantillas, minUsd: r2(plantillas * rates.utilityUsd), maxUsd: r2(plantillas * rates.marketingUsd) },
    service: { count: servicio, active: servicioActivo, charged: cobrados, costUsd: r2(servicioUsd), freePerNumber: LIMIT, startsOn },
    minUsd: r2(minUsd),
    maxUsd: r2(maxUsd),
    minMxn: r2(minUsd * rates.usdToMxn),
    maxMxn: r2(maxUsd * rates.usdToMxn),
    rates,
    // Campos del formato VIEJO: un app.js en caché (antes de recargar) los
    // sigue leyendo; sin ellos truena el tablero entero (toFixed de undefined).
    conversations: plantillas,
    totalUsd: r2(maxUsd),
    totalMxn: r2(maxUsd * rates.usdToMxn),
    ratePerConversationUsd: rates.marketingUsd,
    note: 'Estimado. Meta cobra por mensaje entregado: las plantillas según su categoría (el rango va de utilidad a marketing, porque wapi no guarda la categoría de cada envío) y, desde el 1 de octubre de 2026, las respuestas dentro de 24 h que pasen de 1,000 al mes por número. Tarifas aproximadas para México.',
  };
}

module.exports = {
  LIMIT, WARN_AT, CHARGE_START, DEFAULT_TZ,
  zonedMidnightMs, periodFor, levelFor, countServiceMessages, countOutgoingApi, getQuota, bustTenant, isValidTz,
  metaRates, serviceChargesInRange, metaCostEstimate,
};
