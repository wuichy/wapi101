// Webhook engine — outgoing webhook deliveries to apps
// ============================================================================
// Flow:
//   1) Algún evento del CRM (lead.created, message.received, etc.) llama emit()
//   2) emit() busca apps instaladas en el tenant suscritas a ese evento
//   3) Por cada app, crea una row en app_webhook_deliveries con status=pending
//   4) startDeliveryPoller corre cada 30s, busca pending/failed con next_retry_at vencido
//   5) processDelivery hace POST con HMAC al webhook_url
//   6) Si OK (2xx) → status=sent. Si error → calcula next_retry_at con exp backoff
//   7) Después de 6 intentos fallidos → status=giving_up
//
// HMAC: SHA256(webhook_secret, raw_body), header X-Wapi-Signature: sha256=<hex>

'use strict';

const crypto = require('crypto');

// Retry schedule (segundos desde el último intento)
// attempt 1: 0 (inmediato)
// attempt 2: 30s
// attempt 3: 5min
// attempt 4: 30min
// attempt 5: 2h
// attempt 6: 12h
// Después → giving_up
const RETRY_DELAYS = [0, 30, 300, 1800, 7200, 43200];
const MAX_ATTEMPTS = RETRY_DELAYS.length;
const TIMEOUT_MS = 10_000;

// ─── Emit ─────────────────────────────────────────────────────────────────
// Llamado desde puntos de evento del CRM. Encola entregas para todas las apps
// del tenant suscritas a ese evento.
function emit(db, { tenantId, eventType, data }) {
  if (!tenantId || !eventType) return { enqueued: 0 };
  try {
    // Buscar apps con install activo en este tenant que tengan webhook_url
    // configurado y estén suscritas a este evento.
    const apps = db.prepare(`
      SELECT a.id AS app_id, a.webhook_url, a.webhook_events, i.id AS install_id
        FROM apps a
        JOIN dev_app_installs i ON i.app_id = a.id
       WHERE i.tenant_id = ?
         AND i.revoked_at IS NULL
         AND a.status NOT IN ('suspended','rejected')
         AND a.webhook_url IS NOT NULL
         AND a.webhook_url != ''
    `).all(tenantId);

    if (!apps.length) return { enqueued: 0 };

    const payload = {
      event:      eventType,
      tenantId,
      occurredAt: Math.floor(Date.now() / 1000),
      data,
    };
    const payloadJson = JSON.stringify(payload);

    let enqueued = 0;
    for (const app of apps) {
      let events;
      try { events = JSON.parse(app.webhook_events || '[]'); }
      catch { events = []; }
      if (!Array.isArray(events) || !events.includes(eventType)) continue;
      // Enqueue: status=pending, next_retry_at=ahora (poller lo procesa en su próximo tick)
      db.prepare(`
        INSERT INTO app_webhook_deliveries
          (app_id, install_id, tenant_id, event_type, payload_json, url, next_retry_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(app.app_id, app.install_id, tenantId, eventType, payloadJson, app.webhook_url, Math.floor(Date.now() / 1000));
      enqueued++;
    }
    return { enqueued };
  } catch (err) {
    console.error('[webhooks-out] emit error:', err.message);
    return { enqueued: 0, error: err.message };
  }
}

// ─── Process single delivery ─────────────────────────────────────────────
async function processDelivery(db, delivery) {
  // Cargar webhook_secret de la app
  const appRow = db.prepare('SELECT webhook_secret FROM apps WHERE id = ?').get(delivery.app_id);
  if (!appRow || !appRow.webhook_secret) {
    db.prepare(`UPDATE app_webhook_deliveries SET status='giving_up', last_error=?, last_attempt_at=unixepoch() WHERE id=?`)
      .run('app sin webhook_secret', delivery.id);
    return;
  }

  const signature = 'sha256=' + crypto
    .createHmac('sha256', appRow.webhook_secret)
    .update(delivery.payload_json)
    .digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const attemptN = delivery.attempts + 1;
  let statusCode = null;
  let errorMsg = null;
  let ok = false;

  try {
    const res = await fetch(delivery.url, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'User-Agent':         'Wapi101-Webhook/1.0',
        'X-Wapi-Signature':   signature,
        'X-Wapi-Event':       delivery.event_type,
        'X-Wapi-Delivery':    String(delivery.id),
        'X-Wapi-Attempt':     String(attemptN),
      },
      body:   delivery.payload_json,
      signal: controller.signal,
    });
    statusCode = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      const body = await res.text().catch(() => '');
      errorMsg = `HTTP ${res.status}: ${body.slice(0, 200)}`;
    }
  } catch (err) {
    errorMsg = err.name === 'AbortError' ? 'timeout (10s)' : (err.message || String(err)).slice(0, 200);
  } finally {
    clearTimeout(timer);
  }

  if (ok) {
    db.prepare(`
      UPDATE app_webhook_deliveries
         SET status='sent', attempts=?, last_attempt_at=unixepoch(),
             last_status_code=?, last_error=NULL, next_retry_at=NULL
       WHERE id=?
    `).run(attemptN, statusCode, delivery.id);
  } else if (attemptN >= MAX_ATTEMPTS) {
    db.prepare(`
      UPDATE app_webhook_deliveries
         SET status='giving_up', attempts=?, last_attempt_at=unixepoch(),
             last_status_code=?, last_error=?, next_retry_at=NULL
       WHERE id=?
    `).run(attemptN, statusCode, errorMsg, delivery.id);
  } else {
    const delaySecs = RETRY_DELAYS[attemptN] || 86400;
    const nextRetry = Math.floor(Date.now() / 1000) + delaySecs;
    db.prepare(`
      UPDATE app_webhook_deliveries
         SET status='failed', attempts=?, last_attempt_at=unixepoch(),
             last_status_code=?, last_error=?, next_retry_at=?
       WHERE id=?
    `).run(attemptN, statusCode, errorMsg, nextRetry, delivery.id);
  }
}

// ─── Poller ──────────────────────────────────────────────────────────────
let _pollerTimer = null;
function startDeliveryPoller(db) {
  if (_pollerTimer) return;
  const tick = async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const pending = db.prepare(`
        SELECT * FROM app_webhook_deliveries
         WHERE status IN ('pending','failed')
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC
         LIMIT 50
      `).all(now);
      for (const d of pending) {
        await processDelivery(db, d);
      }
    } catch (err) {
      console.error('[webhooks-out] poller error:', err.message);
    }
  };
  _pollerTimer = setInterval(tick, 30_000);
  _pollerTimer.unref?.();
  // Primer tick a los 5s para no bloquear el boot
  setTimeout(tick, 5_000);
  console.log('[webhooks-out] poller iniciado (cada 30s)');
}

// ─── Replay desde dashboard ──────────────────────────────────────────────
function replayDelivery(db, deliveryId, devAccountId) {
  // Verificar ownership: la delivery debe ser de una app del dev
  const row = db.prepare(`
    SELECT d.id, d.app_id, d.status, a.dev_account_id
      FROM app_webhook_deliveries d
      JOIN apps a ON a.id = d.app_id
     WHERE d.id = ?
  `).get(deliveryId);
  if (!row) throw new Error('Delivery no encontrada');
  if (row.dev_account_id !== devAccountId) throw new Error('No autorizado');

  // Resetear para que el poller la reintente
  db.prepare(`
    UPDATE app_webhook_deliveries
       SET status='pending', attempts=0, next_retry_at=unixepoch(),
           last_error=NULL, last_status_code=NULL
     WHERE id=?
  `).run(deliveryId);
  return { ok: true };
}

// ─── Listado (dashboard del dev) ─────────────────────────────────────────
function listDeliveries(db, appId, devAccountId, { limit = 50 } = {}) {
  // Verificar ownership
  const own = db.prepare('SELECT id FROM apps WHERE id = ? AND dev_account_id = ?').get(appId, devAccountId);
  if (!own) return [];
  return db.prepare(`
    SELECT id, event_type, status, attempts, last_status_code, last_error,
           url, created_at, last_attempt_at, next_retry_at,
           substr(payload_json, 1, 500) AS payload_preview
      FROM app_webhook_deliveries
     WHERE app_id = ?
     ORDER BY created_at DESC
     LIMIT ?
  `).all(appId, Math.min(limit, 200));
}

module.exports = {
  emit, processDelivery, startDeliveryPoller,
  replayDelivery, listDeliveries,
  RETRY_DELAYS, MAX_ATTEMPTS,
};
