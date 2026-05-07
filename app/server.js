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
  dbPath: path.resolve(__dirname, process.env.DB_PATH || './data/wapi101.sqlite'),
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

// ─── Super-admin: garantizar admin inicial si está configurado en .env ───
const superSvc = require('./src/modules/super/service');
superSvc.ensureFirstSuperAdmin(db);

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
// Stripe webhook va en su propio mount porque necesita raw body para verificar
// la firma. NO se debe poner detrás de express.json() global.
mountSafe('/webhooks/stripe', require('./src/modules/billing/webhook'));

// ─── Cache-busting de assets ─────────────────────────────────────────────
// Problema: en cada deploy, navegadores (especialmente iOS Safari, Cloudflare,
// SW PWA) sirven app.js/styles.css cacheados → la app aparece en blanco o con
// JS incompatible con el HTML nuevo. ETag/no-cache no es suficiente en
// entornos reales con proxies.
//
// Solución: pegar ?v=<BUILD_VERSION> a cada <script>/<link> servido. La URL
// cambia en cada deploy (cada reinicio del proceso) → cache key cambia →
// browser y SW descargan fresco automáticamente.
const BUILD_VERSION = String(Date.now());
const HTML_FILES = ['index.html', 'login.html', 'super.html', 'signup.html', 'landing.html', 'privacy.html', 'terms.html'];
const _htmlCache = {};
function _injectVersion(html) {
  return html
    .replace(/(<script\b[^>]*?\bsrc\s*=\s*["'])([^"'?]+\.js)(["'])/gi, `$1$2?v=${BUILD_VERSION}$3`)
    .replace(/(<link\b[^>]*?\bhref\s*=\s*["'])([^"'?]+\.css)(["'])/gi, `$1$2?v=${BUILD_VERSION}$3`);
}
for (const file of HTML_FILES) {
  try {
    const content = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
    _htmlCache[file] = _injectVersion(content);
  } catch (err) {
    console.warn(`[boot] No se pudo precargar ${file}: ${err.message}`);
  }
}
console.log(`[boot] BUILD_VERSION=${BUILD_VERSION} (${Object.keys(_htmlCache).length} HTMLs versionados)`);

// Endpoint público (no requiere auth) para que el cliente detecte si hay
// versión nueva en el server y prompt al usuario para recargar.
app.get('/api/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: BUILD_VERSION });
});

// Sirve la página HTML del super-admin ANTES de montar el router (sino el
// authMiddleware del router intercepta la GET /super y devuelve 401).
app.get('/super', (_req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  if (_htmlCache['super.html']) return res.type('html').send(_htmlCache['super.html']);
  res.sendFile(path.join(__dirname, 'public', 'super.html'));
});

// Páginas legales (públicas, sin auth). Servidas como rutas explícitas para
// que aparezcan limpio en URL (sin .html) y para que Meta/Cloudflare las
// puedan crawlear sin issue.
app.get('/privacy', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms',   (_req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// Catálogo público de planes (lo necesita la landing y la página /pricing).
// Se monta ANTES del authMiddleware. Delega a billing/routes para mantener una sola fuente de verdad.
app.get('/api/public/plans', (_req, res) => {
  const { getPlans } = require('./src/modules/billing/routes');
  res.json({ plans: getPlans() });
});

// ─── Super-admin API: monta ANTES del authMiddleware (/api). Tiene su propio
// flujo de auth con tokens sa_*. NO usa req.tenantId ni filtros multi-tenant.
mountSafe('/super', require('./src/modules/super/routes'));

// JSON parser global para el resto.
// 150mb para soportar adjuntos de chat (PDFs hasta 100MB → ~133MB en base64).
// Imágenes y videos pequeños caben holgadamente. La expansión base64 es 4/3.
app.use(express.json({ limit: '150mb' }));

// VAPID public key — público (cliente lo necesita para suscribirse antes de login)
app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// ─── Login endpoints (públicos, no requieren sesión) ───
const { authMiddleware, loadTenant } = require('./src/middleware/auth');

app.post('/api/auth/login', (req, res) => {
  const { username, password, tenantSlug } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const result = advisorSvc.login(db, username.trim(), password, tenantSlug ? String(tenantSlug).trim() : null);
  if (result.error === 'SLUG_REQUIRED') {
    return res.status(400).json({
      error: 'Hay múltiples cuentas con ese usuario. Indica el slug del workspace.',
      code: 'TENANT_SLUG_REQUIRED',
    });
  }
  if (result.error || !result.advisor) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const advisor = result.advisor;
  // Validar tenant del advisor — si está suspendido/cancelado, no emitir token.
  const tenant = loadTenant(db, advisor.tenant_id);
  if (!tenant)                          return res.status(403).json({ error: 'Tenant inexistente', code: 'TENANT_NOT_FOUND' });
  if (tenant.status === 'suspended')    return res.status(403).json({ error: 'Cuenta suspendida — contacta soporte', code: 'TENANT_SUSPENDED' });
  if (tenant.status === 'cancelled')    return res.status(403).json({ error: 'Cuenta cancelada', code: 'TENANT_CANCELLED' });
  const token = advisorSvc.createSession(db, advisor.id);
  res.json({
    token,
    advisor: { id: advisor.id, name: advisor.name, username: advisor.username, role: advisor.role,
               permissions: JSON.parse(advisor.permissions || '{}'),
               tenantId: advisor.tenant_id },
    tenant: { slug: tenant.slug, displayName: tenant.display_name, plan: tenant.plan },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (token) advisorSvc.deleteSession(db, token);
  res.json({ ok: true });
});

// ─── Signup público — crea tenant + admin + auto-login ─────────────────
// Sin auth. Registra rate-limit básico por IP en memoria (5 intentos / 10 min)
// para mitigar bots; el rate limit "real" se hace después con Redis o similar.
const _signupAttempts = new Map();
function _signupRateLimit(ip) {
  const now = Date.now();
  const entry = _signupAttempts.get(ip) || { count: 0, resetAt: now + 10*60*1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 10*60*1000; }
  entry.count++;
  _signupAttempts.set(ip, entry);
  return entry.count <= 5;
}
function _slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

app.post('/api/auth/signup', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (!_signupRateLimit(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' });
  }

  const { companyName, adminName, email, password, plan: planParam } = req.body || {};
  if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Nombre de la empresa requerido' });
  if (!adminName || !adminName.trim())     return res.status(400).json({ error: 'Tu nombre es requerido' });
  if (!email || !email.includes('@'))      return res.status(400).json({ error: 'Email inválido' });
  if (!password || password.length < 8)    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const VALID_PAID = ['basico', 'pro', 'ultra'];
  const plan = VALID_PAID.includes(planParam) ? planParam : 'free';

  // Auto-generar slug y username
  let slug = _slugify(companyName);
  if (!slug || slug.length < 2) return res.status(400).json({ error: 'El nombre de la empresa genera un slug inválido' });
  // Si el slug existe, agregar sufijo numérico
  let attempt = 0, finalSlug = slug;
  while (db.prepare('SELECT id FROM tenants WHERE slug = ?').get(finalSlug)) {
    attempt++;
    finalSlug = slug + '-' + attempt;
    if (attempt > 99) return res.status(409).json({ error: 'No se pudo generar un slug único, intenta otro nombre' });
  }
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

  try {
    const superSvc = require('./src/modules/super/service');
    const result = superSvc.createTenant(db, {
      slug: finalSlug,
      displayName: companyName.trim(),
      plan,
      adminName: adminName.trim(),
      adminUsername: username,
      adminEmail: email.trim(),
      adminPassword: password,
    });

    // Auto-login: crear session inmediato
    const advisor = result.tenant && db.prepare(
      "SELECT * FROM advisors WHERE tenant_id = ? AND role = 'admin' AND active = 1 ORDER BY id DESC LIMIT 1"
    ).get(result.tenant.id);
    if (!advisor) throw new Error('No se pudo crear el admin');
    const token = advisorSvc.createSession(db, advisor.id);

    // Para planes de pago: crear checkout Stripe con trial 14 días
    let checkoutUrl = null;
    if (VALID_PAID.includes(plan)) {
      try {
        const { getPlans } = require('./src/modules/billing/routes');
        const planObj = getPlans().find(p => p.key === plan);
        const priceId = planObj?.priceIdMonthly;
        if (priceId) {
          const billingSvc = require('./src/modules/billing/service');
          const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
          const sess = await billingSvc.createCheckoutSession(db, result.tenant.id, priceId, {
            successUrl: `${baseUrl}/app?billing=success`,
            cancelUrl:  `${baseUrl}/app?billing=cancelled`,
          });
          checkoutUrl = sess.url;
        }
      } catch (err) {
        console.warn('[signup] no se pudo crear checkout session:', err.message);
      }
    }

    res.json({
      token,
      checkoutUrl,
      advisor: {
        id: advisor.id,
        name: advisor.name,
        username: advisor.username,
        role: advisor.role,
        permissions: JSON.parse(advisor.permissions || '{}'),
        tenantId: advisor.tenant_id,
      },
      tenant: {
        slug: result.tenant.slug,
        displayName: result.tenant.display_name,
        plan: result.tenant.plan,
      },
    });
  } catch (err) {
    // Mensajes de error legibles para el frontend
    const msg = err.message || 'Error al crear la cuenta';
    const code = /Email|UNIQUE/i.test(msg) ? 409 : 400;
    res.status(code).json({ error: msg });
  }
});

// ─── Proteger todas las rutas /api/* con auth ───
app.use('/api', authMiddleware(db));

// API básica (protegida)
app.get('/api/me', (req, res) => res.json({ advisor: req.advisor }));

// ─── OAuth prepare: stashea tenant_id en oauth_states ANTES de abrir el
//      popup OAuth. Necesario porque /auth/{meta,tiktok}/start son GETs
//      que abren popups sin headers Authorization, así que no pueden saber
//      el tenantId del advisor logueado. El frontend llama este endpoint
//      con su Bearer token, recibe un state pre-creado, y abre el popup
//      con ?state=<existing-state>.
const crypto = require('crypto');
const VALID_OAUTH_PROVIDERS = ['messenger', 'instagram', 'facebook', 'whatsapp-lite', 'tiktok', 'threads'];
app.post('/api/auth/oauth/prepare', (req, res) => {
  const { provider } = req.body || {};
  if (!VALID_OAUTH_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Provider inválido' });
  }
  // Limpieza de states viejos (>1h)
  db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
  const state = crypto.randomBytes(20).toString('hex');
  db.prepare("INSERT INTO oauth_states (state, provider, tenant_id) VALUES (?, ?, ?)")
    .run(state, provider, req.tenantId);
  res.json({ state });
});

// Perfil de cuenta — por tenant. La tabla app_settings tiene UNIQUE(key) global,
// pero como solo Lucho (tenant 1) la usa, el upsert por key+tenant funciona.
// Cuando se onboarde el 2do tenant se hará UNIQUE(tenant_id, key) en migración.
app.get('/api/settings/profile', (req, res) => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'profile' AND tenant_id = ?").get(req.tenantId);
  res.json({ profile: row ? JSON.parse(row.value) : {} });
});
app.patch('/api/settings/profile', (req, res) => {
  // Upsert manual ya que el ON CONFLICT clause necesita la columna unique.
  const existing = db.prepare("SELECT id FROM app_settings WHERE key = 'profile' AND tenant_id = ?").get(req.tenantId);
  if (existing) {
    db.prepare("UPDATE app_settings SET value = ?, updated_at = unixepoch() WHERE id = ?")
      .run(JSON.stringify(req.body), existing.id);
  } else {
    db.prepare("INSERT INTO app_settings (tenant_id, key, value, updated_at) VALUES (?, 'profile', ?, unixepoch())")
      .run(req.tenantId, JSON.stringify(req.body));
  }
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
  // Estado de integraciones whatsapp-lite (Baileys) — todas las del sistema,
  // monitoreo cross-tenant para alertas operacionales (UptimeRobot).
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
mountSafe('/api/integration-votes',  require('./src/modules/integration-votes/routes'));
mountSafe('/api/outgoing-webhooks',  require('./src/modules/outgoing-webhooks/routes'));
mountSafe('/api/bot',                require('./src/modules/bot/routes'));
mountSafe('/api/bot-tags',           require('./src/modules/bot-tags/routes'));
mountSafe('/api/template-tags',      require('./src/modules/template-tags/routes'));
mountSafe('/api/machine-tokens',     require('./src/modules/machine-tokens/routes'));
mountSafe('/api/admin',              require('./src/modules/admin/routes'));
mountSafe('/api/conversations',      require('./src/modules/conversations/routes'));
mountSafe('/api/personal-chat',      require('./src/modules/personal-chat/routes'));
mountSafe('/api/templates',          require('./src/modules/templates/routes'));
mountSafe('/api/stats',              require('./src/modules/stats/routes'));
mountSafe('/api/advisors',           require('./src/modules/advisors/routes'));
mountSafe('/api/trash',              require('./src/modules/trash/routes'));
mountSafe('/api/reports',            require('./src/modules/reports/routes'));
mountSafe('/api/push',               require('./src/modules/notifications/routes'));
mountSafe('/api/billing',            require('./src/modules/billing/routes'));
mountSafe('/api/tasks',              require('./src/modules/tasks/routes'));
mountSafe('/api/ai-knowledge',       require('./src/modules/ai-knowledge/routes'));
mountSafe('/api/analytics',          require('./src/modules/analytics/routes'));
mountSafe('/api/business',           require('./src/modules/business/routes'));
mountSafe('/api/appointments',       require('./src/modules/appointments/routes'));

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
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Sirve archivos subidos (media de plantillas, etc.) bajo /uploads.
// Cache normal — los archivos no cambian (cada upload genera nombre único).
app.use('/uploads', express.static(config.uploadsDir, {
  maxAge: '1d',
  index: false,
}));

// ─── Routing del producto SaaS ───
// /            → Landing pública (con auto-detect: si hay token, redirige a /app)
// /login       → Pantalla de login del CRM
// /signup      → Form de signup público (crea tenant + admin + auto-login)
// /app, /app/* → CRM SPA (index.html)
//
// Estas rutas se montan ANTES del express.static general para que ganen
// precedencia sobre los archivos HTML correspondientes que serían servidos
// con el path por default.

const _sendFile = (file) => (_req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  if (_htmlCache[file]) return res.type('html').send(_htmlCache[file]);
  res.sendFile(path.join(__dirname, 'public', file));
};

app.get('/',         _sendFile('landing.html'));
app.get('/login',    _sendFile('login.html'));
app.get('/signup',   _sendFile('signup.html'));
app.get('/app',      _sendFile('index.html'));
// Express 5 requiere wildcards con nombre (no '*' suelto). '*splat' captura
// cualquier subpath bajo /app y lo manda al index.html del SPA.
app.get('/app/*splat', _sendFile('index.html'));

// Estáticos — HTML/CSS/JS sin caché agresivo (always revalidate via ETag).
// Imágenes/fonts mantienen el comportamiento default de express.static.
// Esto evita que Safari/Cloudflare retengan versiones viejas tras un deploy:
// el browser pregunta cada vez "¿sigue siendo válido?" y el server devuelve
// 304 si no cambió, 200 con el archivo nuevo si sí.
// IMPORTANTE: index:false para que express.static NO sirva index.html en /
// (la ruta '/' ya la maneja el handler de landing arriba).
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js|json|map)$/i.test(filePath)) {
      res.set('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

app.listen(config.port, config.host, () => {
  console.log(`Wapi101 App → http://${config.host}:${config.port}  (env: ${config.env})`);
  console.log(`DB          → ${config.dbPath}`);
  console.log(`AI provider → ${config.ai.provider}`);
  // Iniciar poller que cada 60s resume waits expirados (rama on_timeout)
  try { require('./src/modules/bot/engine').startWaitTimeoutPoller(db); } catch (err) {
    console.warn('[boot] no se pudo iniciar wait timeout poller:', err.message);
  }
  // Iniciar poller de recordatorios de citas
  try { require('./src/modules/bot/reminders').startAppointmentReminderPoller(db); } catch (err) {
    console.warn('[boot] no se pudo iniciar appointment reminder poller:', err.message);
  }
});

module.exports = { app, config, db };
