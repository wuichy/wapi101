'use strict';
// Guard anti-SSRF para URLs salientes controladas por el usuario (webhooks de
// la Developers Platform, webhooks salientes del CRM, sync de WooCommerce).
//
// Sin esto, un tenant podía apuntar un webhook a http://169.254.169.254/ (metadata
// de la nube), http://127.0.0.1:2019 (admin de Caddy), o a la propia red interna,
// y el servidor haría la request por él (con eco parcial de la respuesta) = SSRF.
//
// Estrategia: exigir http(s), resolver DNS y rechazar si CUALQUIER IP resuelta
// cae en rango privado/loopback/link-local/ULA/metadata. Re-resolver justo antes
// del fetch (en processDelivery) cierra la ventana de DNS-rebinding/TOCTOU.

const dns = require('dns').promises;
const net = require('net');

// ¿Una IP literal (v4/v6) cae en un rango no-ruteable / interno / peligroso?
function isBlockedIp(ip) {
  if (!ip) return true;
  const v = net.isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some(n => Number.isNaN(n))) return true;
    const [a, b] = o;
    if (a === 0) return true;                         // 0.0.0.0/8
    if (a === 10) return true;                        // 10/8 privada
    if (a === 127) return true;                       // loopback
    if (a === 169 && b === 254) return true;          // link-local + metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 privada
    if (a === 192 && b === 168) return true;          // 192.168/16 privada
    if (a === 100 && b >= 64 && b <= 127) return true;// 100.64/10 CGNAT
    if (a >= 224) return true;                        // multicast/reservado
    return false;
  }
  if (v === 6) {
    const lo = ip.toLowerCase();
    if (lo === '::1' || lo === '::') return true;     // loopback / unspecified
    if (lo.startsWith('fe80')) return true;           // link-local
    if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // ULA fc00::/7
    if (lo.startsWith('ff')) return true;             // multicast
    // IPv4-mapped (::ffff:a.b.c.d) → validar la parte v4
    const m = lo.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    if (lo === '::ffff:0:0' || lo.includes('169.254.169.254')) return true;
    return false;
  }
  return true; // no es IP válida
}

// Valida una URL saliente. Lanza Error si es insegura. Devuelve {url, ip} si OK.
// Resuelve DNS y rechaza si alguna IP destino es interna.
async function assertSafeUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); }
  catch { throw new Error('URL inválida'); }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Solo se permiten URLs http(s)');
  }
  const host = u.hostname;
  if (!host) throw new Error('URL sin host');

  // Si el host ya es una IP literal, validarla directo.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('Destino no permitido (IP interna/privada)');
    return { url: u.href, ip: host };
  }

  // Resolver TODAS las IPs (A + AAAA) y rechazar si CUALQUIERA es interna.
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw new Error('No se pudo resolver el host del destino'); }
  if (!addrs.length) throw new Error('Host sin direcciones');
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error('Destino no permitido (resuelve a IP interna/privada)');
  }
  return { url: u.href, ip: addrs[0].address };
}

// Versión sincrónica/best-effort para validación en el momento de GUARDAR
// (createApp/create webhook): exige http(s) y, si es IP literal, la valida.
// La validación con DNS real ocurre en assertSafeUrl justo antes del fetch.
function assertSafeUrlShape(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); }
  catch { throw new Error('URL inválida'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Solo se permiten URLs http(s)');
  }
  if (net.isIP(u.hostname) && isBlockedIp(u.hostname)) {
    throw new Error('Destino no permitido (IP interna/privada)');
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) {
    throw new Error('Destino no permitido (host interno)');
  }
  return u.href;
}

module.exports = { assertSafeUrl, assertSafeUrlShape, isBlockedIp };
