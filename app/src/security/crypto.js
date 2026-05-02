// Cifrado simétrico AES-256-GCM para credenciales sensibles (tokens, secrets).
// Lección de Reelance Hub: nunca guardar tokens en plain text.
//
// Formato del ciphertext: base64(iv || authTag || encrypted)
//   - iv: 12 bytes (96 bits, recomendado para GCM)
//   - authTag: 16 bytes (verifica integridad)
//   - encrypted: el resto

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32; // 256 bits

let cachedKey = null;
let warned = false;

function getKey() {
  if (cachedKey) return cachedKey;
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    cachedKey = Buffer.from(hex, 'hex');
    return cachedKey;
  }
  // Fallback inseguro: clave efímera generada al arrancar. Avisa una sola vez.
  if (!warned) {
    console.warn('[crypto] ⚠️  ENCRYPTION_KEY no configurada o inválida. Usando clave efímera (los tokens guardados se perderán al reiniciar).');
    console.warn('[crypto]    Genera una con: openssl rand -hex 32');
    warned = true;
  }
  cachedKey = crypto.randomBytes(KEY_LEN);
  return cachedKey;
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    const key = getKey();
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const authTag = buf.subarray(IV_LEN, IV_LEN + 16);
    const encrypted = buf.subarray(IV_LEN + 16);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (err) {
    console.error('[crypto] decrypt failed:', err.message);
    return null;
  }
}

// Helpers para JSON
function encryptJson(obj) {
  return encrypt(JSON.stringify(obj));
}
function decryptJson(ciphertext) {
  const text = decrypt(ciphertext);
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

// Para mostrar en logs/UI sin exponer el token completo
function mask(value, visible = 4) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= visible * 2) return '****';
  return `${s.slice(0, visible)}…${s.slice(-visible)}`;
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson, mask };
