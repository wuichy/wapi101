// Provider: Square (pagos, cobros, catálogo).
// Docs: https://developer.squareup.com/docs

module.exports = {
  meta: {
    key: 'square',
    name: 'Square',
    description: 'Procesa cobros y sincroniza clientes con Square.',
    color: '#3e4348',
    initial: 'S',
    docsUrl: 'https://developer.squareup.com/docs',
    webhooks: {
      events: ['payment.created', 'payment.updated', 'order.created'],
      signatureHeader: 'x-square-hmacsha256-signature',
      signatureAlgo: 'hmac-sha256-base64-url',
      verifyKeyField: 'webhookSignatureKey'
    }
  },
  fields: [
    { key: 'accessToken',     label: 'Access Token',     type: 'password', required: true, secret: true,
      help: 'Square Developer Dashboard → Applications → Credentials' },
    { key: 'environment',     label: 'Entorno',          type: 'text',     required: true,
      help: 'sandbox | production (default: production)' },
    { key: 'applicationId',   label: 'Application ID',   type: 'text',     required: false },
    { key: 'webhookSignatureKey', label: 'Webhook Signature Key', type: 'password', required: false, secret: true,
      help: 'Para verificar webhooks. Square Dashboard → Webhooks → Subscriptions.' }
  ],
  async test({ credentials }) {
    const { accessToken, environment } = credentials;
    if (!accessToken) {
      return { ok: false, message: 'Faltan campos requeridos' };
    }
    const env = (environment || 'production').toLowerCase();
    const base = env === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';
    try {
      const res = await fetch(`${base}/v2/locations`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Square-Version': '2024-04-17'
        }
      });
      const data = await res.json();
      if (!res.ok || data.errors) {
        const msg = data?.errors?.[0]?.detail || `HTTP ${res.status}`;
        return { ok: false, message: msg };
      }
      const main = (data.locations || [])[0];
      return {
        ok: true,
        displayName: main?.name || `Square (${env})`,
        externalId: main?.id || env,
        details: { environment: env, locations: (data.locations || []).length }
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  }
};
