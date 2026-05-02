const webpush = require('web-push');
const config = require('./config');
const store = require('./store');

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!config.push.publicKey || !config.push.privateKey) {
    return false;
  }
  webpush.setVapidDetails(
    config.push.subject || 'mailto:admin@example.com',
    config.push.publicKey,
    config.push.privateKey
  );
  configured = true;
  return true;
}

function getSubscriptions() {
  const state = store.readState();
  return Array.isArray(state.pushSubscriptions) ? state.pushSubscriptions : [];
}

function saveSubscriptions(subs) {
  store.updateState((state) => {
    state.pushSubscriptions = subs;
  });
}

function addSubscription(sub) {
  if (!sub?.endpoint) {
    throw new Error('La suscripción no tiene endpoint.');
  }
  const incoming = {
    endpoint: sub.endpoint,
    keys: sub.keys || {},
    userAgent: sub.userAgent || null,
    createdAt: Date.now()
  };

  const existing = getSubscriptions();

  // Si ya existe esta misma endpoint exacta, no la agregamos otra vez.
  if (existing.some((s) => s.endpoint === sub.endpoint)) {
    return;
  }

  // Si existe una suscripción del MISMO User-Agent, la reemplazamos
  // (mismo dispositivo, suscripción vieja). Esto evita acumular duplicados
  // cuando el usuario reinstala la PWA o reactiva permisos.
  const filtered = incoming.userAgent
    ? existing.filter((s) => (s.userAgent || '') !== incoming.userAgent)
    : existing;

  filtered.push(incoming);
  saveSubscriptions(filtered);
}

function removeSubscription(endpoint) {
  const subs = getSubscriptions().filter((s) => s.endpoint !== endpoint);
  saveSubscriptions(subs);
}

async function sendToAll(payload) {
  if (!ensureConfigured()) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const subs = getSubscriptions();
  if (!subs.length) {
    return { sent: 0, failed: 0 };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const deadEndpoints = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadEndpoints.push(sub.endpoint);
      }
    }
  }));

  if (deadEndpoints.length) {
    const remaining = getSubscriptions().filter((s) => !deadEndpoints.includes(s.endpoint));
    saveSubscriptions(remaining);
  }

  // Log al store para diagnóstico
  try {
    const store = require('./store');
    store.pushSalesbotDebug({
      type: 'push_send',
      title: payload.title,
      body: (payload.body || '').slice(0, 80),
      tag: payload.tag,
      sentTo: sent,
      failed,
      removed: deadEndpoints.length
    });
  } catch (_e) { /* ignore */ }

  return { sent, failed, removed: deadEndpoints.length };
}

module.exports = {
  ensureConfigured,
  addSubscription,
  removeSubscription,
  getSubscriptions,
  sendToAll
};
