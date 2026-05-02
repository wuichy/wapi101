// Provider: WooCommerce REST API.
// Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/

module.exports = {
  meta: {
    key: 'woocommerce',
    name: 'WooCommerce',
    description: 'Sincroniza pedidos y clientes de tu tienda WooCommerce.',
    color: '#7f54b3',
    initial: 'W',
    docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
    webhooks: {
      events: ['order.created', 'order.updated', 'customer.created'],
      signatureHeader: 'x-wc-webhook-signature',
      signatureAlgo: 'hmac-sha256-base64',
      verifyKeyField: 'webhookSecret'
    }
  },
  fields: [
    { key: 'siteUrl',         label: 'URL de la tienda',  type: 'text',     required: true,
      help: 'Ej: https://mitienda.com (sin slash final)' },
    { key: 'consumerKey',     label: 'Consumer Key',      type: 'password', required: true, secret: true,
      help: 'WooCommerce → Ajustes → Avanzado → REST API → Crear clave' },
    { key: 'consumerSecret',  label: 'Consumer Secret',   type: 'password', required: true, secret: true },
    { key: 'webhookSecret',   label: 'Webhook Secret',    type: 'password', required: false, secret: true,
      help: 'Para verificar la firma de webhooks. Lo defines al crear el webhook en WC.' }
  ],
  async test({ credentials }) {
    const { siteUrl, consumerKey, consumerSecret } = credentials;
    if (!siteUrl || !consumerKey || !consumerSecret) {
      return { ok: false, message: 'Faltan campos requeridos' };
    }
    const base = String(siteUrl).replace(/\/$/, '');
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    try {
      const res = await fetch(`${base}/wp-json/wc/v3/system_status?_fields=environment.site_url,environment.version`, {
        headers: { Authorization: `Basic ${auth}` }
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, message: data?.message || `HTTP ${res.status}` };
      }
      const url = data?.environment?.site_url || base;
      return {
        ok: true,
        displayName: new URL(url).hostname,
        externalId: url,
        details: { wcVersion: data?.environment?.version }
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  }
};
