function asNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

module.exports = {
  webhook: {
    secret: (process.env.WC_WEBHOOK_SECRET || '').trim(),
    skipSignatureCheck: process.env.WC_SKIP_SIGNATURE_CHECK === '1'
  },
  phone: {
    defaultCountryPrefix: (process.env.WC_PHONE_PREFIX || '+521').trim()
  },
  kommo: {
    pipelineClientesId: asNumber(process.env.KOMMO_PIPELINE_CLIENTES_ID),
    statusRecientesId: asNumber(process.env.KOMMO_STATUS_RECIENTES_ID),
    clienteTagName: (process.env.KOMMO_CLIENTE_TAG || 'Cliente').trim(),
    fields: {
      lastOrderNumber: asNumber(process.env.KOMMO_FIELD_LAST_ORDER_NUMBER),
      lastOrderDate: asNumber(process.env.KOMMO_FIELD_LAST_ORDER_DATE),
      lastOrderTotal: asNumber(process.env.KOMMO_FIELD_LAST_ORDER_TOTAL),
      lastOrderItems: asNumber(process.env.KOMMO_FIELD_LAST_ORDER_ITEMS),
      lastOrderStatus: asNumber(process.env.KOMMO_FIELD_LAST_ORDER_STATUS)
    },
    botsToStop: asList(process.env.KOMMO_BOTS_TO_STOP_ON_ORDER)
  }
};
