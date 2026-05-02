const crypto = require('crypto');

function expectedSignature(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyWooSignature(rawBody, headerSignature, secret) {
  if (!secret) return false;
  if (!headerSignature) return false;
  const expected = expectedSignature(rawBody, secret);
  return timingSafeEqual(expected, headerSignature);
}

module.exports = { verifyWooSignature, expectedSignature };
