// Notificaciones Web Push (VAPID).
// Cada navegador suscrito recibe pushes; SW las muestra como Notifications nativas.
//
// Reglas:
//   - Suscripciones en DB (no JSON) — supervivencia entre reinicios garantizada.
//   - Endpoint UNIQUE — re-suscribir desde el mismo navegador no acumula filas.
//   - Auto-cleanup: si webpush devuelve 410/404 (suscripción muerta), borramos.
//   - Cooldown anti-spam por kind+key (evita lluvia de pushes en eventos en bucle).

const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) {
    console.warn('[push] VAPID_PUBLIC_KEY/PRIVATE_KEY no configurados — push deshabilitado');
    return false;
  }
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
}

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function addSubscription(db, tenantId, sub, { userAgent = null, advisorId = null } = {}) {
  if (!sub?.endpoint) throw new Error('Suscripción sin endpoint');
  const keysJson = JSON.stringify(sub.keys || {});
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO push_subscriptions (tenant_id, endpoint, keys, user_agent, advisor_id, created_at, last_seen_at, fail_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      keys = excluded.keys,
      user_agent = excluded.user_agent,
      advisor_id = excluded.advisor_id,
      last_seen_at = excluded.last_seen_at,
      fail_count = 0
  `).run(tenantId, sub.endpoint, keysJson, userAgent, advisorId, now, now);
}

function removeSubscription(db, endpoint) {
  // El endpoint es único globalmente (URL específica del browser). No
  // necesitamos filtrar por tenant — solo el dueño del endpoint llega aquí.
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes;
}

// Si tenantId es null, devuelve TODAS las suscripciones (uso histórico,
// solo single-tenant). Para multi-tenant pasar tenantId explícito.
function listSubscriptions(db, tenantId) {
  if (tenantId == null) {
    return db.prepare('SELECT id, endpoint, keys, user_agent, advisor_id, fail_count FROM push_subscriptions').all();
  }
  return db.prepare('SELECT id, endpoint, keys, user_agent, advisor_id, fail_count FROM push_subscriptions WHERE tenant_id = ?').all(tenantId);
}

// Cooldown global por (kind, key) para evitar inundación de pushes en eventos repetidos.
const cooldowns = new Map();
function isOnCooldown(kind, key, ms) {
  const id = `${kind}:${key || ''}`;
  const t = cooldowns.get(id) || 0;
  if (Date.now() - t < ms) return true;
  cooldowns.set(id, Date.now());
  return false;
}

// tenantId puede ser null para callers internos sin contexto auth (webhooks,
// bootstrap). En ese caso envía a TODOS — válido en single-tenant. Para
// multi-tenant los callers deben pasar tenantId explícito.
async function sendToAll(db, tenantId, payload, { kind = 'manual', cooldownKey = null, cooldownMs = 0 } = {}) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, skipped: true };
  if (cooldownMs && cooldownKey && isOnCooldown(kind, cooldownKey, cooldownMs)) {
    return { sent: 0, failed: 0, cooldownActive: true };
  }

  const subs = listSubscriptions(db, tenantId);
  if (!subs.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const dead = [];

  await Promise.all(subs.map(async (s) => {
    try {
      const keys = JSON.parse(s.keys || '{}');
      await webpush.sendNotification({ endpoint: s.endpoint, keys }, body);
      sent++;
      db.prepare('UPDATE push_subscriptions SET last_seen_at = unixepoch(), fail_count = 0 WHERE id = ?').run(s.id);
    } catch (err) {
      failed++;
      const code = err.statusCode || 0;
      if (code === 410 || code === 404) {
        dead.push(s.endpoint);
      } else {
        db.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?').run(s.id);
      }
    }
  }));

  if (dead.length) {
    const placeholders = dead.map(() => '?').join(',');
    db.prepare(`DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`).run(...dead);
  }

  // Bitácora — se asocia al tenant si está dado; sino queda con el DEFAULT 1.
  try {
    if (tenantId != null) {
      db.prepare(`
        INSERT INTO alert_log (tenant_id, kind, title, body, payload, sent_count, failed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, kind, payload.title || null, (payload.body || '').slice(0, 200), JSON.stringify(payload).slice(0, 2000), sent, failed);
    } else {
      db.prepare(`
        INSERT INTO alert_log (kind, title, body, payload, sent_count, failed)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(kind, payload.title || null, (payload.body || '').slice(0, 200), JSON.stringify(payload).slice(0, 2000), sent, failed);
    }
  } catch (_) {}

  return { sent, failed, removed: dead.length };
}

module.exports = {
  getPublicKey,
  ensureConfigured,
  addSubscription,
  removeSubscription,
  listSubscriptions,
  sendToAll,
};
