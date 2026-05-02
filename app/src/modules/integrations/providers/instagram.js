// Provider: Instagram Messaging API (cuenta Business/Creator vinculada a una Página de Facebook).
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login

module.exports = {
  meta: {
    key: 'instagram',
    name: 'Instagram',
    description: 'Recibe y responde DMs de tu cuenta Business o Creator de Instagram.',
    color: '#e1306c',
    initial: 'I',
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform',
    setupSteps: [
      'Asegúrate de tener una cuenta <b>Business o Creator</b> en Instagram',
      'Vincula tu cuenta IG a una <b>Página de Facebook</b>',
      'Ve a <b>developers.facebook.com</b> → crea o usa tu App → añade "Instagram" como producto',
      'En Instagram → Configuración de API → selecciona tu cuenta de IG',
      'Genera un <b>Access Token</b> con scopes: <code>instagram_basic</code>, <code>instagram_manage_messages</code>',
      'Copia el <b>Instagram Business Account ID</b> y el <b>App Secret</b>',
      'Agrega el Webhook URL de abajo, suscribe el evento <code>messages</code>',
    ],
  },
  fields: [
    {
      key: 'igUserId',
      label: 'Instagram Business Account ID',
      type: 'text',
      required: true,
      help: 'ID numérico de tu cuenta de Instagram Business (se encuentra en Meta Business Suite → Configuración).',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      type: 'password',
      required: true,
      secret: true,
      help: 'Token con scopes instagram_basic + instagram_manage_messages. Genera uno long-lived para producción.',
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
    const { igUserId, accessToken } = credentials;
    if (!igUserId || !accessToken) return { ok: false, message: 'Faltan campos requeridos' };
    const version = process.env.META_GRAPH_VERSION || 'v22.0';
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${igUserId}?fields=username,name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, message: data?.error?.message || `HTTP ${res.status}` };
      return {
        ok: true,
        displayName: data.username ? `@${data.username}` : data.name || 'Cuenta IG',
        externalId: igUserId,
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  },
};
