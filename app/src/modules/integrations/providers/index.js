// Catálogo de providers disponibles. Cada uno aislado: si uno falla al cargar,
// el resto sigue funcionando.

const providers = {};

function loadSafe(key, path) {
  try {
    providers[key] = require(path);
  } catch (err) {
    console.error(`[integrations] no se pudo cargar provider ${key}:`, err.message);
  }
}

loadSafe('whatsapp',      './whatsapp');
loadSafe('whatsapp-lite', './whatsapp-lite');
loadSafe('messenger',   './messenger');
loadSafe('instagram',   './instagram');
loadSafe('telegram',    './telegram');
loadSafe('tiktok',      './tiktok');
loadSafe('woocommerce', './woocommerce');
loadSafe('shopify',     './shopify');
loadSafe('square',      './square');

function get(key) { return providers[key] || null; }
function list() {
  return Object.values(providers).map((p) => ({
    ...p.meta,
    fields: p.fields.map((f) => ({ ...f, secret: undefined })) // no exponer si es secret en el catálogo
  }));
}

module.exports = { get, list, all: providers };
