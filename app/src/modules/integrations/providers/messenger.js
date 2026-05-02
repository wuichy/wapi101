// Provider: Facebook Messenger (Meta Pages).
// Docs: https://developers.facebook.com/docs/messenger-platform

module.exports = {
  meta: {
    key: 'messenger',
    name: 'Messenger',
    description: 'Recibe y responde mensajes de tu Página de Facebook.',
    color: '#0084ff',
    initial: 'M',
    docsUrl: 'https://developers.facebook.com/docs/messenger-platform',
    setupSteps: [
      'Ve a <b>developers.facebook.com</b> y crea una App (tipo "Business")',
      'En tu App → Messenger → Configuración → selecciona tu Página',
      'Genera un <b>Page Access Token</b> (recomendado: long-lived)',
      'Copia el <b>App Secret</b> desde Configuración básica de la App',
      'Agrega el Webhook URL de abajo y el Verify Token que elijas',
      'Suscribe los eventos: <code>messages</code>, <code>messaging_postbacks</code>',
    ],
  },
  fields: [
    {
      key: 'pageId',
      label: 'Page ID',
      type: 'text',
      required: true,
      help: 'ID numérico de tu Página de Facebook (lo ves en Configuración de la página → Información de la página).',
    },
    {
      key: 'pageAccessToken',
      label: 'Page Access Token',
      type: 'password',
      required: true,
      secret: true,
      help: 'Token de la Página (long-lived). Se genera en Meta for Developers → tu App → Messenger → Configuración.',
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      type: 'password',
      required: true,
      secret: true,
      help: 'Lo encuentras en Meta for Developers → tu App → Configuración → Básica.',
    },
    {
      key: 'webhookVerifyToken',
      label: 'Webhook Verify Token',
      type: 'text',
      required: false,
      secret: true,
      help: 'Palabra clave que tú eliges. La pegas también en Meta cuando configuras el webhook.',
    },
  ],
  async test({ credentials }) {
    const { pageId, pageAccessToken } = credentials;
    if (!pageId || !pageAccessToken) return { ok: false, message: 'Faltan campos requeridos' };
    const version = process.env.META_GRAPH_VERSION || 'v22.0';
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${pageId}?fields=name,id`, {
        headers: { Authorization: `Bearer ${pageAccessToken}` },
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, message: data?.error?.message || `HTTP ${res.status}` };
      return {
        ok: true,
        displayName: data.name || `Página ${pageId}`,
        externalId: pageId,
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  },
};
