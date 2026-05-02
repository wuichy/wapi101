const crypto = require('crypto');
const config = require('./config');

const PUBLIC_PATHS = new Set([
  '/login',
  '/login.html',
  '/styles.css',
  '/manifest.json',
  '/sw.js',
  '/auth/kommo/callback',
  '/healthz'  // monitoreo externo (UptimeRobot)
]);

const PUBLIC_PATH_PREFIXES = [
  '/webhooks/',
  '/api/kommo/salesbot/handoff',
  '/uploads/',
  '/preview/',  // HTML con OG tags para que WhatsApp muestre miniatura
  '/icons/'
];

function isAuthEnabled() {
  return Boolean(config.auth.password && config.auth.sessionSecret);
}

function signSession(payload = {}) {
  const data = JSON.stringify({ ...payload, iat: Date.now() });
  const encoded = Buffer.from(data, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.auth.sessionSecret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') {
    return null;
  }

  const [encoded, sig] = cookieValue.split('.');
  if (!encoded || !sig) {
    return null;
  }

  const expected = crypto
    .createHmac('sha256', config.auth.sessionSecret)
    .update(encoded)
    .digest('base64url');

  let valid = false;
  try {
    valid =
      expected.length === sig.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch (_e) {
    return null;
  }

  if (!valid) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_e) {
    return null;
  }

  if (!payload || typeof payload.iat !== 'number') {
    return null;
  }

  if (Date.now() - payload.iat > config.auth.sessionDurationMs) {
    return null;
  }

  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const k = trimmed.slice(0, idx);
    const v = trimmed.slice(idx + 1);
    result[k] = decodeURIComponent(v);
  }
  return result;
}

function passwordMatches(submitted) {
  const expected = String(config.auth.password || '');
  const actual = String(submitted || '');

  if (!expected) {
    return false;
  }

  if (expected.length !== actual.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch (_e) {
    return false;
  }
}

function isPathPublic(pathname) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function requireAuth(req, res, next) {
  if (!isAuthEnabled()) {
    return next();
  }

  if (isPathPublic(req.path)) {
    return next();
  }

  const cookies = parseCookies(req);
  const session = verifySession(cookies[config.auth.cookieName]);

  if (session) {
    req.session = session;
    return next();
  }

  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  return res.redirect('/login');
}

function buildSessionCookie(value) {
  const maxAgeSeconds = Math.floor(config.auth.sessionDurationMs / 1000);
  const parts = [
    `${config.auth.cookieName}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax'
  ];

  if (process.env.NODE_ENV !== 'development') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildLogoutCookie() {
  const parts = [
    `${config.auth.cookieName}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax'
  ];

  if (process.env.NODE_ENV !== 'development') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

module.exports = {
  isAuthEnabled,
  requireAuth,
  passwordMatches,
  signSession,
  verifySession,
  parseCookies,
  buildSessionCookie,
  buildLogoutCookie
};
