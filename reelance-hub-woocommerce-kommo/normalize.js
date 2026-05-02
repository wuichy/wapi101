const config = require('./config');

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatMxPhone(rawPhone) {
  const digits = onlyDigits(rawPhone);
  if (!digits) return null;

  const prefix = config.phone.defaultCountryPrefix;
  const prefixDigits = onlyDigits(prefix);

  if (digits.startsWith(prefixDigits)) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `${prefix}${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `${prefix}${digits.slice(1)}`;
  }

  if (digits.length === 12 && digits.startsWith('52')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

function formatDateDDMMYY(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function buildItemsSummary(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';
  return lineItems
    .map((item) => {
      const qty = item.quantity || 1;
      const name = item.name || item.product_name || 'producto';
      return `${qty}x ${name}`;
    })
    .join(', ');
}

function pickFullName(billing) {
  const first = String(billing?.first_name || '').trim();
  const last = String(billing?.last_name || '').trim();
  const combined = [first, last].filter(Boolean).join(' ').trim();
  return { firstName: first, lastName: last, fullName: combined };
}

function normalizeOrder(payload) {
  const billing = payload?.billing || {};
  const orderNumber = String(payload?.number || payload?.id || '').trim();
  const orderId = payload?.id || null;
  const orderDate = payload?.date_created || payload?.date_paid || new Date().toISOString();
  const total = payload?.total != null ? String(payload.total) : '';
  const currency = payload?.currency || '';
  const status = payload?.status || '';

  const { firstName, lastName, fullName } = pickFullName(billing);
  const phone = formatMxPhone(billing.phone);
  const email = String(billing.email || '').trim().toLowerCase() || null;

  return {
    orderId,
    orderNumber,
    orderDate,
    orderDateFormatted: formatDateDDMMYY(orderDate),
    total,
    currency,
    status,
    itemsSummary: buildItemsSummary(payload?.line_items),
    contact: {
      firstName,
      lastName,
      fullName,
      phone,
      email
    }
  };
}

module.exports = {
  normalizeOrder,
  formatMxPhone,
  formatDateDDMMYY,
  onlyDigits
};
