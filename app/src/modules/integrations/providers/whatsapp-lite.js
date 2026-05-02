// Provider: WhatsApp Lite (QR / multi-dispositivo).
// Conexión NO oficial vía protocolo de WhatsApp Web — el usuario escanea un QR
// desde Configuración → Dispositivos vinculados de su app móvil de WhatsApp.
//
// No requiere cuenta de Meta Developer ni plantillas aprobadas. Sin ventana 24h.
// CONTRA: WhatsApp puede banear el número si detecta abuso. Sin soporte oficial.
// Implementado con Baileys: ./../whatsapp-web/manager.js
//
// IMPORTANTE: este provider tiene authType='qr'. El servicio de integraciones
// detecta esa flag y activa un flujo distinto (no llama provider.test() con
// credenciales — en lugar de eso arranca una sesión Baileys que genera QR).

module.exports = {
  meta: {
    key: 'whatsapp-lite',
    name: 'WhatsApp Lite (QR)',
    description: 'Conecta WhatsApp escaneando un QR desde tu app móvil (Configuración → Dispositivos vinculados → Vincular un dispositivo). Sin cuenta de Meta Developer, sin plantillas, sin ventana de 24h. Riesgo: WhatsApp puede banear el número si detecta uso abusivo.',
    color: '#25d366',
    initial: 'WL',
    authType: 'qr',
    docsUrl: 'https://faq.whatsapp.com/378279804439436'
  },

  // Sin campos: el flujo es por QR, no por formulario.
  fields: [],

  // No se usa en flujo QR (la conexión la maneja el manager). Se devuelve { ok: true }
  // para no romper código existente que pueda llamarlo.
  async test() {
    return { ok: true, displayName: 'WhatsApp Lite (QR)', externalId: null, details: { mode: 'qr' } };
  }
};
