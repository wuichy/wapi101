// ── Qué TIPO de línea de WhatsApp es cada integración ──────────────────────
//
// Decide qué reglas le aplica la pantalla a cada caja de respuesta:
//   'api'      → WhatsApp Cloud API (provider 'whatsapp'): ventana de 24 h y
//                contador de los 1,000 mensajes de servicio gratis al mes.
//   'business' → la app WhatsApp Business conectada por Lite: solo etiqueta.
//                Sus límites son de "difusiones comerciales" (una función
//                aparte y de pago de la app, según faq.whatsapp.com), NO de
//                los chats uno a uno que manda wapi → no lleva contador.
//   'personal' → WhatsApp normal conectado por Lite: nada.
//
// Cómo se sabe si una Lite es Business: al escanear el QR, WhatsApp le manda
// al dispositivo vinculado la plataforma del TELÉFONO PRINCIPAL, y Baileys la
// guarda en creds.platform (lib/Utils/validate-connection.js):
//   'smba' = Business en Android · 'smbi' = Business en iPhone
//   'android' / 'iphone' = WhatsApp normal
// Verificado 16-sep-2026 con las 4 líneas Lite reales: 31 smbi (Reelance),
// 33 iphone (Wuichy), 34 smba (Sistemas i Saltillo), 10 iphone.

const fs = require('fs');

const BUSINESS_PLATFORMS = new Set(['smba', 'smbi']);

function lineTypeFromPlatform(provider, platform) {
  if (provider === 'whatsapp') return 'api';
  if (provider !== 'whatsapp-lite') return null;
  const p = String(platform || '').trim().toLowerCase();
  if (!p) return 'unknown';
  return BUSINESS_PLATFORMS.has(p) ? 'business' : 'personal';
}

// Lee SOLO el campo platform del creds.json de una sesión. Nunca devuelve ni
// registra las llaves que viven en ese mismo archivo.
function platformFromCredsFile(file) {
  try {
    const platform = JSON.parse(fs.readFileSync(file, 'utf8'))?.platform;
    return typeof platform === 'string' && platform ? platform : null;
  } catch (_) {
    return null;
  }
}

module.exports = { lineTypeFromPlatform, platformFromCredsFile, BUSINESS_PLATFORMS };
