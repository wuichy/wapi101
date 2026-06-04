'use strict';

// Analítica de visitantes de la landing pública wapi101.com.
// Tracker → POST /api/track → upsert sesión + pageview. Stats/feed para /super.

// Detección de bots por user-agent (mismo criterio que reelance.mx).
const BOT_TOKENS = [
  'bot', 'crawl', 'spider', 'slurp', 'facebookexternalhit', 'facebookcatalog',
  'whatsapp', 'telegrambot', 'slackbot', 'bingpreview', 'googlebot', 'bingbot',
  'yandex', 'baiduspider', 'duckduckbot', 'applebot', 'petalbot', 'semrush',
  'ahrefs', 'headless', 'phantomjs', 'puppeteer', 'playwright', 'python-requests',
  'curl/', 'wget', 'go-http', 'okhttp', 'axios/', 'node-fetch', 'scrapy',
  'lighthouse', 'gtmetrix', 'pingdom', 'uptimerobot', 'statuscake',
];
function isBot(ua) {
  if (!ua) return false;
  const s = String(ua).toLowerCase();
  return BOT_TOKENS.some(t => s.includes(t));
}

// Tipo de dispositivo aproximado por user-agent (para el feed).
function deviceOf(ua) {
  const s = String(ua || '').toLowerCase();
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/mobi|iphone|android/.test(s)) return 'mobile';
  return 'desktop';
}

// Ingesta. body: { sessionId, path, title, referrer, userAgent, utm*, ping }.
// geo: { country, region, city } desde headers de Cloudflare.
function track(db, body, geo) {
  const sessionId = String(body.sessionId || '').trim();
  if (!sessionId || sessionId.length < 6) return { skipped: 'no-session' };

  // Ping (heartbeat): solo refresca last_seen_at, sin crear pageview.
  if (body.ping === true) {
    db.prepare('UPDATE visitor_sessions SET last_seen_at = unixepoch() WHERE session_id = ?').run(sessionId);
    return { ok: true, ping: true };
  }

  const ua = body.userAgent || '';
  const bot = isBot(ua) ? 1 : 0;
  const existing = db.prepare('SELECT id FROM visitor_sessions WHERE session_id = ?').get(sessionId);

  if (existing) {
    db.prepare('UPDATE visitor_sessions SET last_seen_at = unixepoch() WHERE session_id = ?').run(sessionId);
  } else {
    db.prepare(`
      INSERT INTO visitor_sessions
        (session_id, utm_source, utm_medium, utm_campaign, utm_content,
         referrer, landing_page, user_agent, country, region, city, is_bot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      body.utmSource || null, body.utmMedium || null, body.utmCampaign || null, body.utmContent || null,
      body.referrer || null, body.path || null, ua || null,
      geo.country || null, geo.region || null, geo.city || null, bot
    );
  }

  const path = String(body.path || '/').slice(0, 300);
  db.prepare('INSERT INTO visitor_pageviews (session_id, path, title) VALUES (?, ?, ?)')
    .run(sessionId, path, (body.title || '').slice(0, 200) || null);

  return { ok: true };
}

// Rango → [fromSec, toSec]. range: 'today'|'yesterday'|'7d'|'30d'|'month'.
function _rangeBounds(range) {
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  switch (range) {
    case 'today':     return [now - (now % day), now]; // aprox UTC; suficiente para overview
    case 'yesterday': return [now - day, now];
    case '30d':       return [now - 30 * day, now];
    case 'month':     return [now - 30 * day, now];
    case '7d':
    default:          return [now - 7 * day, now];
  }
}

// Stats + feed para /super. Excluye bots de las stats (los marca en el feed).
function getOverview(db, { range = '7d', country = null } = {}) {
  const [from, to] = _rangeBounds(range);

  const botCount = db.prepare(
    'SELECT COUNT(*) n FROM visitor_sessions WHERE is_bot = 1 AND last_seen_at BETWEEN ? AND ?'
  ).get(from, to).n;

  const totalHumans = db.prepare(
    'SELECT COUNT(*) n FROM visitor_sessions WHERE is_bot = 0 AND last_seen_at BETWEEN ? AND ?'
  ).get(from, to).n;

  // Nuevos (primera visita en el rango) vs recurrentes
  const nuevos = db.prepare(
    'SELECT COUNT(*) n FROM visitor_sessions WHERE is_bot = 0 AND created_at BETWEEN ? AND ?'
  ).get(from, to).n;
  const recurrentes = Math.max(0, totalHumans - nuevos);

  const totalPageviews = db.prepare(`
    SELECT COUNT(*) n FROM visitor_pageviews pv
    JOIN visitor_sessions s ON s.session_id = pv.session_id
    WHERE s.is_bot = 0 AND pv.created_at BETWEEN ? AND ?
  `).get(from, to).n;

  const topCountries = db.prepare(`
    SELECT COALESCE(country,'??') AS country, COUNT(*) AS n
    FROM visitor_sessions
    WHERE is_bot = 0 AND last_seen_at BETWEEN ? AND ?
    GROUP BY COALESCE(country,'??') ORDER BY n DESC LIMIT 8
  `).all(from, to);

  const topRegions = db.prepare(`
    SELECT COALESCE(region,'—') AS region, COALESCE(country,'??') AS country, COUNT(*) AS n
    FROM visitor_sessions
    WHERE is_bot = 0 AND region IS NOT NULL AND region != '' AND last_seen_at BETWEEN ? AND ?
    GROUP BY region, country ORDER BY n DESC LIMIT 8
  `).all(from, to);

  const topSources = db.prepare(`
    SELECT
      CASE
        WHEN utm_source IS NOT NULL AND utm_source != '' THEN utm_source
        WHEN referrer IS NULL OR referrer = '' THEN '(directo)'
        ELSE referrer
      END AS source,
      COUNT(*) AS n
    FROM visitor_sessions
    WHERE is_bot = 0 AND last_seen_at BETWEEN ? AND ?
    GROUP BY source ORDER BY n DESC LIMIT 8
  `).all(from, to);

  const topPages = db.prepare(`
    SELECT pv.path AS path, COUNT(*) AS n
    FROM visitor_pageviews pv
    JOIN visitor_sessions s ON s.session_id = pv.session_id
    WHERE s.is_bot = 0 AND pv.created_at BETWEEN ? AND ?
    GROUP BY pv.path ORDER BY n DESC LIMIT 10
  `).all(from, to);

  // Feed: últimos visitantes (humanos por defecto). Filtro opcional por país.
  const feedRows = db.prepare(`
    SELECT * FROM visitor_sessions
    WHERE last_seen_at BETWEEN ? AND ?
      ${country ? 'AND country = ?' : ''}
    ORDER BY last_seen_at DESC LIMIT 60
  `).all(...(country ? [from, to, country] : [from, to]));

  const feed = feedRows.map(s => {
    const pvs = db.prepare(
      'SELECT path, created_at FROM visitor_pageviews WHERE session_id = ? ORDER BY created_at ASC'
    ).all(s.session_id);
    const durationSec = Math.max(0, (s.last_seen_at || 0) - (s.created_at || 0));
    return {
      sessionShort: String(s.session_id).slice(-6),
      isBot: !!s.is_bot,
      isNew: s.created_at >= from,
      device: deviceOf(s.user_agent),
      country: s.country, region: s.region, city: s.city,
      source: s.utm_source || s.referrer || null,
      utmCampaign: s.utm_campaign || null,
      pageCount: pvs.length,
      pages: pvs.slice(0, 8).map(p => p.path),
      durationSec,
      lastSeenAt: s.last_seen_at,
      createdAt: s.created_at,
    };
  });

  return {
    range, from, to,
    stats: {
      humans: totalHumans, nuevos, recurrentes, bots: botCount,
      pageviews: totalPageviews,
      topCountries, topRegions, topSources, topPages,
    },
    feed,
  };
}

module.exports = { isBot, deviceOf, track, getOverview };
