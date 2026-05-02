// Provider: WhatsApp Business API (Cloud API de Meta — flujo manual).
// Para el flujo QR (estilo WhatsApp Web / app móvil) usa el provider 'whatsapp-lite'.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

module.exports = {
  meta: {
    key: 'whatsapp',
    name: 'WhatsApp Business API',
    description: 'Conexión vía Cloud API oficial de Meta. Requiere número registrado en Meta Developer, plantillas aprobadas y respeta la ventana de servicio de 24h. Estable y oficial.',
    color: '#25d366',
    initial: 'W',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api'
  },

  // Campos que el usuario llena al conectar.
  // type: text | password | textarea
  // secret: true → se cifra y NO se devuelve al frontend después de guardar
  fields: [
    { key: 'phoneNumberId',    label: 'Phone Number ID',         type: 'text',     required: true,
      help: 'ID del número en developers.facebook.com → Whatsapp → API Setup' },
    { key: 'wabaId',           label: 'WhatsApp Business Account ID', type: 'text', required: true },
    { key: 'accessToken',      label: 'Access Token',            type: 'password', required: true, secret: true,
      help: 'System User token recomendado (permanente). Generar en Business Manager.' },
    { key: 'webhookVerifyToken', label: 'Webhook Verify Token',  type: 'password', required: false, secret: true,
      help: 'Cualquier string secreto. Lo configuras en Meta Developer al subscribir el webhook.' }
  ],

  // Verifica que las credenciales funcionen.
  // Por ahora hace una llamada GET al endpoint de info del número (lectura, no escritura).
  async test({ credentials }) {
    const { phoneNumberId, accessToken } = credentials;
    if (!phoneNumberId || !accessToken) {
      return { ok: false, message: 'Faltan campos requeridos' };
    }
    const version = process.env.META_GRAPH_VERSION || 'v22.0';
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          message: data?.error?.message || `HTTP ${res.status}`,
          code: data?.error?.code
        };
      }
      return {
        ok: true,
        displayName: data.display_phone_number || data.verified_name || 'Número de WhatsApp',
        externalId: phoneNumberId,
        details: { qualityRating: data.quality_rating, verifiedName: data.verified_name }
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  }
};
