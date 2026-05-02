const providers = require('./providers');
const { encryptJson, decryptJson, mask } = require('../../security/crypto');

// Convierte un row de DB a la forma que ve el frontend.
// IMPORTANTE: nunca devolvemos el credentials_enc ni los valores secret en plano.
// Los campos no-secretos sí los devolvemos para que el usuario pueda ver/editar.
function hydrate(row) {
  if (!row) return null;
  const provider = providers.get(row.provider);
  const creds = row.credentials_enc ? (decryptJson(row.credentials_enc) || {}) : {};
  // Build "públicos": campos no-secret + máscara de los secret
  const publicCreds = {};
  if (provider) {
    for (const field of provider.fields) {
      if (field.secret) {
        publicCreds[field.key] = creds[field.key] ? `••••${mask(creds[field.key])}` : '';
      } else {
        publicCreds[field.key] = creds[field.key] || '';
      }
    }
  }
  // URL pública del webhook para este provider (lo que el usuario pega en el dashboard del proveedor)
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/webhooks/${row.provider}`;

  const config = row.config ? (JSON.parse(row.config) || {}) : {};

  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    displayName: row.display_name,
    externalId: row.external_id,
    config,
    routing: config.routing || null,
    credentials: publicCreds,
    webhookUrl,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listAll(db) {
  // Devuelve catálogo + integraciones existentes por cada provider
  const rows = db.prepare('SELECT * FROM integrations ORDER BY id DESC').all();
  const integrations = rows.map(hydrate);

  return providers.list().map((p) => {
    const own = integrations.filter((i) => i.provider === p.key);
    return { ...p, integrations: own };
  });
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  return hydrate(row);
}

// Recupera credenciales en plano (para uso interno: tests, llamadas a la API real)
function getCredentialsPlain(db, id) {
  const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(id);
  if (!row) return null;
  return row.credentials_enc ? decryptJson(row.credentials_enc) : null;
}

// Une credenciales nuevas con las existentes preservando los secrets
// que el usuario no envió (porque solo vienen como máscara).
function mergeCredentials(provider, existing, incoming) {
  const merged = { ...existing };
  for (const field of provider.fields) {
    const v = incoming[field.key];
    if (v === undefined || v === null) continue;
    // Si el usuario manda la máscara, mantener el valor existente
    if (field.secret && typeof v === 'string' && v.startsWith('••••')) continue;
    merged[field.key] = v;
  }
  return merged;
}

async function connect(db, providerKey, incomingCreds) {
  const provider = providers.get(providerKey);
  if (!provider) throw new Error(`Provider desconocido: ${providerKey}`);

  // Flujo QR (whatsapp-lite vía Baileys): no validamos credenciales —
  // creamos un row pendiente y arrancamos la sesión que generará el QR.
  if (provider.meta?.authType === 'qr') {
    return connectQr(db, providerKey);
  }

  const missing = provider.fields
    .filter((f) => f.required && !incomingCreds[f.key])
    .map((f) => f.label);
  if (missing.length) throw new Error(`Faltan campos: ${missing.join(', ')}`);

  const testResult = await provider.test({ credentials: incomingCreds });
  if (!testResult.ok) throw new Error(testResult.message || 'No pude validar las credenciales con el proveedor');

  const externalId = testResult.externalId || incomingCreds.phoneNumberId || incomingCreds.pageId || incomingCreds.igUserId || incomingCreds.openId || null;
  const displayName = testResult.displayName || provider.meta.name;
  const encrypted = encryptJson(incomingCreds);

  const existing = externalId
    ? db.prepare('SELECT * FROM integrations WHERE provider = ? AND external_id = ?').get(providerKey, externalId)
    : null;

  let savedId;
  if (existing) {
    db.prepare(`
      UPDATE integrations
      SET status = 'connected', display_name = ?, credentials_enc = ?, last_error = NULL,
          connected_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?
    `).run(displayName, encrypted, existing.id);
    savedId = existing.id;
  } else {
    const result = db.prepare(`
      INSERT INTO integrations (provider, status, display_name, external_id, credentials_enc, connected_at)
      VALUES (?, 'connected', ?, ?, ?, unixepoch())
    `).run(providerKey, displayName, externalId, encrypted);
    savedId = result.lastInsertRowid;
  }

  // Telegram: registrar webhook automáticamente
  if (providerKey === 'telegram' && provider.setWebhook) {
    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/webhooks/telegram`;
    try {
      const result = await provider.setWebhook(incomingCreds.botToken, webhookUrl, incomingCreds.webhookSecret || '');
      console.log('[telegram] setWebhook:', result.description || result.ok);
    } catch (err) {
      console.warn('[telegram] no se pudo registrar webhook:', err.message);
    }
  }

  return getById(db, savedId);
}

async function update(db, id, incomingCreds) {
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  if (!row) throw new Error('Integración no encontrada');
  const provider = providers.get(row.provider);
  if (!provider) throw new Error(`Provider desconocido: ${row.provider}`);

  const existingCreds = row.credentials_enc ? (decryptJson(row.credentials_enc) || {}) : {};
  const merged = mergeCredentials(provider, existingCreds, incomingCreds);

  const test = await provider.test({ credentials: merged });
  if (!test.ok) {
    db.prepare('UPDATE integrations SET status = ?, last_error = ?, updated_at = unixepoch() WHERE id = ?')
      .run('error', test.message, id);
    throw new Error(test.message || 'No pude validar las credenciales');
  }

  db.prepare(`
    UPDATE integrations
    SET status = 'connected', display_name = ?, external_id = ?, credentials_enc = ?,
        last_error = NULL, connected_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ?
  `).run(test.displayName || row.display_name, test.externalId || row.external_id, encryptJson(merged), id);

  return getById(db, id);
}

async function testExisting(db, id) {
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  if (!row) throw new Error('Integración no encontrada');
  const provider = providers.get(row.provider);
  if (!provider) throw new Error(`Provider desconocido: ${row.provider}`);
  const creds = row.credentials_enc ? (decryptJson(row.credentials_enc) || {}) : {};
  const result = await provider.test({ credentials: creds });
  if (result.ok) {
    db.prepare('UPDATE integrations SET status = ?, last_error = NULL, updated_at = unixepoch() WHERE id = ?')
      .run('connected', id);
  } else {
    db.prepare('UPDATE integrations SET status = ?, last_error = ?, updated_at = unixepoch() WHERE id = ?')
      .run('error', result.message || 'Test falló', id);
  }
  return result;
}

function disconnect(db, id) {
  // Si es una sesión de WhatsApp Web, cerrarla y borrar auth files
  try {
    const row = db.prepare('SELECT provider FROM integrations WHERE id = ?').get(id);
    if (row?.provider === 'whatsapp-lite') {
      const manager = require('./whatsapp-web/manager');
      manager.stopSession(id, { logout: true, removeAuth: true })
        .catch(err => console.warn(`[wa-web] stopSession ${id}:`, err.message));
    }
  } catch (_) {}
  return db.prepare('DELETE FROM integrations WHERE id = ?').run(id).changes > 0;
}

// Flujo QR: crea integración pendiente y arranca sesión Baileys.
// El QR se obtiene con qrStatus(id) — frontend lo polea cada ~1.5s.
async function connectQr(db, providerKey) {
  // Reutilizar SOLO si hay una sesión activa en proceso (connecting/pending).
  // 'disconnected' y 'error' son estados terminales — empezar con un row nuevo
  // y dejar que el usuario decida qué hacer con el viejo (la papelera lo guardará).
  const existing = db.prepare(
    `SELECT id FROM integrations WHERE provider = ? AND status IN ('pending','connecting') ORDER BY id DESC LIMIT 1`
  ).get(providerKey);

  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE integrations SET status = 'connecting', last_error = NULL, updated_at = unixepoch() WHERE id = ?`)
      .run(id);
  } else {
    const result = db.prepare(`
      INSERT INTO integrations (provider, status, display_name, external_id)
      VALUES (?, 'connecting', ?, NULL)
    `).run(providerKey, providers.get(providerKey).meta.name);
    id = result.lastInsertRowid;
  }

  // Arrancar Baileys (no esperamos al QR — el frontend lo polea)
  const manager = require('./whatsapp-web/manager');
  manager.startSession(id).catch(err => {
    console.error(`[wa-web ${id}] startSession falló:`, err.message);
    db.prepare(`UPDATE integrations SET status = 'error', last_error = ?, updated_at = unixepoch() WHERE id = ?`)
      .run(err.message, id);
  });

  return getById(db, id);
}

function qrStatus(db, id) {
  const row = db.prepare('SELECT provider, status, display_name, external_id, last_error FROM integrations WHERE id = ?').get(id);
  if (!row) return null;
  if (row.provider !== 'whatsapp-lite') return null;
  const manager = require('./whatsapp-web/manager');
  const live = manager.getStatus(id);
  return {
    id,
    dbStatus:    row.status,
    liveStatus:  live.status,
    qrDataUrl:   live.qrDataUrl || null,
    phoneNumber: live.phoneNumber || row.external_id || null,
    pushName:    live.pushName || null,
    displayName: row.display_name,
    lastError:   row.last_error || live.error || null,
  };
}

// Guarda una integración que ya fue autenticada por OAuth (el caller provee tokens y metadatos).
// No llama a provider.test() porque el token ya fue verificado en el flujo OAuth.
async function connectRaw(db, providerKey, creds, { displayName, externalId }) {
  const encrypted = encryptJson(creds);
  const existing = externalId
    ? db.prepare('SELECT * FROM integrations WHERE provider = ? AND external_id = ?').get(providerKey, String(externalId))
    : null;

  if (existing) {
    db.prepare(`
      UPDATE integrations
      SET status = 'connected', display_name = ?, credentials_enc = ?, last_error = NULL,
          connected_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?
    `).run(displayName, encrypted, existing.id);
    return getById(db, existing.id);
  }

  const r = db.prepare(`
    INSERT INTO integrations (provider, status, display_name, external_id, credentials_enc, connected_at)
    VALUES (?, 'connected', ?, ?, ?, unixepoch())
  `).run(providerKey, displayName, String(externalId || ''), encrypted);
  return getById(db, r.lastInsertRowid);
}

// Actualiza solo el routing (pipeline/stage) de una integración existente.
function updateRouting(db, id, { pipelineId, stageId, pipelineName, stageName }) {
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  if (!row) throw new Error('Integración no encontrada');
  const config = row.config ? (JSON.parse(row.config) || {}) : {};
  config.routing = { pipelineId, stageId, pipelineName: pipelineName || null, stageName: stageName || null };
  db.prepare('UPDATE integrations SET config = ?, updated_at = unixepoch() WHERE id = ?')
    .run(JSON.stringify(config), id);
  return getById(db, id);
}

module.exports = { listAll, getById, connect, connectQr, qrStatus, update, testExisting, disconnect, getCredentialsPlain, connectRaw, updateRouting };
