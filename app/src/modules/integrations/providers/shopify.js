// Provider: Shopify Admin API.
// Docs: https://shopify.dev/docs/api/admin-rest

module.exports = {
  meta: {
    key: 'shopify',
    name: 'Shopify',
    description: 'Conecta tu tienda Shopify para sincronizar pedidos y clientes.',
    color: '#96bf48',
    initial: 'S',
    docsUrl: 'https://shopify.dev/docs/api/admin-rest',
    webhooks: {
      events: ['orders/create', 'orders/updated', 'customers/create'],
      signatureHeader: 'x-shopify-hmac-sha256',
      signatureAlgo: 'hmac-sha256-base64',
      verifyKeyField: 'webhookSecret'
    }
  },
  fields: [
    { key: 'shopDomain',      label: 'Shop Domain',      type: 'text',     required: true,
      help: 'Ej: mitienda.myshopify.com (sin https://)' },
    { key: 'adminApiToken',   label: 'Admin API Access Token', type: 'password', required: true, secret: true,
      help: 'Crea una "Custom App" en Shopify admin → Apps → Develop apps → Install → API credentials' },
    { key: 'apiVersion',      label: 'API Version',      type: 'text',     required: false,
      help: 'Por defecto: 2024-04' },
    { key: 'webhookSecret',   label: 'Webhook Secret',   type: 'password', required: false, secret: true,
      help: 'Si vas a recibir webhooks, lo defines en Shopify Admin → Webhooks.' }
  ],
  async test({ credentials }) {
    const { shopDomain, adminApiToken } = credentials;
    if (!shopDomain || !adminApiToken) {
      return { ok: false, message: 'Faltan campos requeridos' };
    }
    const domain = String(shopDomain).replace(/^https?:\/\//, '').replace(/\/$/, '');
    const version = credentials.apiVersion || '2024-04';
    try {
      const res = await fetch(`https://${domain}/admin/api/${version}/shop.json`, {
        headers: { 'X-Shopify-Access-Token': adminApiToken }
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, message: data?.errors || `HTTP ${res.status}` };
      }
      return {
        ok: true,
        displayName: data?.shop?.name || domain,
        externalId: String(data?.shop?.id || domain),
        details: { plan: data?.shop?.plan_name, currency: data?.shop?.currency }
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  }
};
