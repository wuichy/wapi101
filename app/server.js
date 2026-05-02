const express = require('express');
const path = require('path');
const fs = require('fs');

// ─── Carga de .env (parser mínimo, sin dependencias) ───
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ─── Config ───
const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || '127.0.0.1',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3001',
  dbPath: path.resolve(__dirname, process.env.DB_PATH || './data/reelance.sqlite'),
  uploadsDir: path.resolve(__dirname, process.env.UPLOADS_DIR || './data/uploads'),
  ai: {
    provider: process.env.AI_PROVIDER || 'anthropic',
    maxTokens: Number(process.env.AI_MAX_TOKENS) || 2048,
    temperature: Number(process.env.AI_TEMPERATURE) || 0.7,
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || '', model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-7' },
    openai:    { apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' },
    google:    { apiKey: process.env.GOOGLE_API_KEY || '', model: process.env.GOOGLE_MODEL || 'gemini-1.5-flash' },
    ollama:    { baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434', model: process.env.OLLAMA_MODEL || 'gemma2:9b' },
    custom:    { baseUrl: process.env.CUSTOM_AI_BASE_URL || '', apiKey: process.env.CUSTOM_AI_API_KEY || '', model: process.env.CUSTOM_AI_MODEL || '' }
  }
};

// ─── DB (corre migraciones automáticamente) ───
const { getDb } = require('./src/db');
const db = getDb(config.dbPath);

// ─── WhatsApp Web (Baileys): conectar handlers + restaurar sesiones ───
try {
  require('./src/modules/integrations/whatsapp-web/bootstrap').init(db);
  console.log('[wa-web] bootstrap inicializado');
} catch (err) {
  console.error('[wa-web] bootstrap error:', err.message);
}

// ─── Asesores: garantizar admin inicial ───
const advisorSvc = require('./src/modules/advisors/service');
advisorSvc.ensureFirstAdmin(db, {
  name:     process.env.ADMIN_NAME     || 'Administrador',
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin1234',
});

// ─── App ───
const app = express();

// Helper: monta un router con try/catch para que un módulo roto no tumbe a los demás
function mountSafe(mountPath, factory) {
  try {
    app.use(mountPath, factory(db));
    console.log(`[mount] ${mountPath}`);
  } catch (err) {
    console.error(`[mount] error en ${mountPath}:`, err.message);
  }
}

// ─── Webhooks PRIMERO: necesitan body crudo (HMAC). Cada handler usa express.raw() internamente.
mountSafe('/webhooks', require('./src/modules/integrations/webhooks'));

// JSON parser global para el resto
app.use(express.json({ limit: '5mb' }));

// VAPID public key — público (cliente lo necesita para suscribirse antes de login)
app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// ─── Login endpoints (públicos, no requieren sesión) ───
const { authMiddleware } = require('./src/middleware/auth');

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const advisor = advisorSvc.login(db, username.trim(), password);
  if (!advisor) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = advisorSvc.createSession(db, advisor.id);
  res.json({
    token,
    advisor: { id: advisor.id, name: advisor.name, username: advisor.username, role: advisor.role,
               permissions: JSON.parse(advisor.permissions || '{}') },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (token) advisorSvc.deleteSession(db, token);
  res.json({ ok: true });
});

// ─── Proteger todas las rutas /api/* con auth ───
app.use('/api', authMiddleware(db));

// API básica (protegida)
app.get('/api/me', (req, res) => res.json({ advisor: req.advisor }));

// Perfil de cuenta
app.get('/api/settings/profile', (_req, res) => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'profile'").get();
  res.json({ profile: row ? JSON.parse(row.value) : {} });
});
app.patch('/api/settings/profile', (req, res) => {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('profile', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify(req.body));
  res.json({ profile: req.body });
});
// /healthz — público, lo pinguea UptimeRobot. Devuelve 503 si algo está mal.
//   - Server vivo + DB accesible → 200
//   - Alguna integración marcada como 'connected' en DB pero el manager dice
//     'disconnected' o 'error' → 503 (alerta UptimeRobot)
const healthzStats = { hits: 0, last: null };
app.get('/healthz', (_req, res) => {
  healthzStats.hits++;
  healthzStats.last = Date.now();
  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    return res.status(503).json({ ok: false, reason: 'db_error', message: err.message });
  }
  // Estado de integraciones whatsapp-lite (Baileys)
  const issues = [];
  try {
    const waMgr = require('./src/modules/integrations/whatsapp-web/manager');
    const rows = db.prepare(
      "SELECT id, display_name FROM integrations WHERE provider = 'whatsapp-lite' AND status = 'connected'"
    ).all();
    for (const row of rows) {
      const live = waMgr.getStatus(row.id);
      if (live.status !== 'connected' && live.status !== 'connecting' && live.status !== 'qr') {
        issues.push({ kind: 'whatsapp-lite', id: row.id, name: row.display_name, liveStatus: live.status, error: live.error });
      }
    }
  } catch (_) {}
  if (issues.length) {
    return res.status(503).json({ ok: false, reason: 'integration_unhealthy', issues, env: config.env, ts: Date.now() });
  }
  res.json({ ok: true, env: config.env, ts: Date.now() });
});
app.get('/api/ai/info', (_req, res) => {
  const p = config.ai.provider;
  const model = (config.ai[p] && config.ai[p].model) || null;
  res.json({ provider: p, model });
});

// ─── Auth (OAuth callbacks) ───
mountSafe('/auth', require('./src/modules/auth/routes'));

// ─── Módulos de API ───
mountSafe('/api/contacts',           require('./src/modules/customers/routes'));
mountSafe('/api/pipelines',          require('./src/modules/pipelines/routes'));
mountSafe('/api/expedients',         require('./src/modules/expedients/routes'));
mountSafe('/api/integrations',       require('./src/modules/integrations/routes'));
mountSafe('/api/outgoing-webhooks',  require('./src/modules/outgoing-webhooks/routes'));
mountSafe('/api/bot',                require('./src/modules/bot/routes'));
mountSafe('/api/bot-tags',           require('./src/modules/bot-tags/routes'));
mountSafe('/api/machine-tokens',     require('./src/modules/machine-tokens/routes'));
mountSafe('/api/admin',              require('./src/modules/admin/routes'));
mountSafe('/api/conversations',      require('./src/modules/conversations/routes'));
mountSafe('/api/personal-chat',      require('./src/modules/personal-chat/routes'));
mountSafe('/api/templates',          require('./src/modules/templates/routes'));
mountSafe('/api/stats',              require('./src/modules/stats/routes'));
mountSafe('/api/advisors',           require('./src/modules/advisors/routes'));
mountSafe('/api/trash',              require('./src/modules/trash/routes'));
mountSafe('/api/push',               require('./src/modules/notifications/routes'));

// Manejador global de errores
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Error inesperado' });
});

// ─── Estáticos (no-cache en dev) ───
if (config.env !== 'production') {
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });
}
// Ruta /chat — sirve la SPA con marker para que el frontend active "modo personal"
// (chat-only, vista personal por asesor con hides + tags propios).
app.get('/chat', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(config.port, config.host, () => {
  console.log(`Reelance App → http://${config.host}:${config.port}  (env: ${config.env})`);
  console.log(`DB          → ${config.dbPath}`);
  console.log(`AI provider → ${config.ai.provider}`);
});

module.exports = { app, config, db };
