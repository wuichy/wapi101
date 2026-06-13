'use strict';
// IP REAL del cliente. Cloudflare rota sus IPs de salida y mete varias en
// X-Forwarded-For, así que rate-limitear por req.ip/XFF[0] solo ralentiza el
// brute force (cada request "viene" de otra IP de CF). CF-Connecting-IP es la
// IP real del visitante y Cloudflare la inyecta siempre (y no es spoofeable a
// través de CF). Orden: CF-Connecting-IP → True-Client-IP → XFF[0] → req.ip.
function realClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const tci = req.headers['true-client-ip'];
  if (tci) return String(tci).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { realClientIp };
