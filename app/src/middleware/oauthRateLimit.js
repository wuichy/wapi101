// Rate limit por app OAuth — sliding window en memoria
// ============================================================================
// Cuando una request viene autenticada con OAuth (req.appAuth), enforzamos
// el límite de la app (configurado en apps.rate_limit_per_min, default 600).
// Window: 60 segundos. Implementación: token bucket simple por appId.

'use strict';

// Map<appId, { count, resetAt }>
const _buckets = new Map();
const WINDOW_MS = 60_000;

function oauthRateLimit() {
  return (req, res, next) => {
    if (!req.appAuth) return next();
    const appId = req.appAuth.appId;
    const limit = req.appAuth.rateLimit || 600;
    const now = Date.now();
    let bucket = _buckets.get(appId);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      _buckets.set(appId, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, limit - bucket.count);
    const resetIn = Math.ceil((bucket.resetAt - now) / 1000);

    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(resetIn));

    if (bucket.count > limit) {
      res.set('Retry-After', String(resetIn));
      return res.status(429).json({
        error: `Rate limit excedido (${limit} req/min)`,
        code:  'RATE_LIMIT_EXCEEDED',
        retryAfter: resetIn,
      });
    }
    next();
  };
}

// Limpieza periódica (cada 5 min) de buckets viejos para no leak memoria
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _buckets) {
    if (now >= v.resetAt + WINDOW_MS) _buckets.delete(k);
  }
}, 5 * 60_000).unref?.();

module.exports = { oauthRateLimit };
