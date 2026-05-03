// Traductor de errores de Meta API → mensajes claros en español.
// Detecta patrones comunes y devuelve algo accionable, en lugar del
// "Invalid parameter" genérico.

function friendlyMetaError(err) {
  const msg     = (err?.message || '').toLowerCase();
  const userMsg = (err?.error_user_msg || '').toLowerCase();
  const details = (err?.error_data?.details || '').toLowerCase();
  const all     = `${msg} ${userMsg} ${details}`;
  const code    = err?.code;
  const subcode = err?.error_subcode;

  // ─── Token / autenticación ───
  if (all.includes('session has expired') || all.includes('access token has expired') || subcode === 463) {
    return '🔑 El token de Meta caducó. Para arreglar: ve a business.facebook.com → System Users → Wuichy → Generar token (caducidad: NUNCA, scopes: whatsapp_business_messaging + whatsapp_business_management). Después pégalo en Integraciones → editar WhatsApp.';
  }
  if (all.includes('permission') || all.includes('not authorized') || code === 200 || code === 10) {
    return '🚫 El token no tiene permisos suficientes. Genera uno nuevo en business.facebook.com → System Users → Wuichy y MARCA ambos: whatsapp_business_messaging + whatsapp_business_management.';
  }

  // ─── Plantillas ───
  if (all.includes('already exists') || all.includes('ya existe contenido') || all.includes('ya existe')) {
    return '📋 Ese nombre ya está usado en Meta (aunque la otra haya sido rechazada, Meta lo bloquea 30 días). Cambia el "Nombre interno" agregando un sufijo: por ejemplo "compra" → "compra_v2" o "compra_mayo". Después vuelve a Enviar a Meta.';
  }
  if (all.includes('header media') || all.includes('header format') || all.includes('image format') || all.includes('image too small')) {
    if (all.includes('too small')) return '📏 La imagen es muy chica. Meta requiere mínimo 192×192 px.';
    return '🖼️ El archivo del header NO es aceptado por Meta. Usa JPEG o PNG (no SVG, ni HEIC, ni GIF, ni WebP). Mínimo 192×192 px.';
  }
  if (all.includes('variable') && (all.includes('example') || all.includes('placeholder'))) {
    return '🔢 Faltan ejemplos en los placeholders. Llena el "Valor de ejemplo" en cada {{N}} (ej: para {{1}} pon "Luis"). Meta los usa para revisar la plantilla.';
  }
  if (all.includes('invalid parameter')) {
    return '⚠️ Meta rechazó por "formato inválido". Causas más comunes:\n  1) Variables como {nombre} (una llave) en vez de {{1}} (doble llave).\n  2) Footer con URL, teléfono o email (no permitidos — el footer es solo texto descriptivo).\n  3) Contenido promocional ("descuento", "oferta") en categoría UTILITY → cámbiala a MARKETING.\n  4) Faltan ejemplos en los placeholders.\n  5) Botón URL con dominio no permitido (bit.ly y wa.me suelen rechazarse).';
  }

  // ─── 24h window / sender ───
  if (all.includes('24 hour') || all.includes('outside') && all.includes('window') || all.includes('re-engagement')) {
    return '⏰ La ventana de 24 horas se cerró para este contacto. Solo puedes mandar plantillas APROBADAS de WhatsApp API. Crea una en Plantillas y envíala a Meta para aprobación.';
  }
  if (all.includes('rate limit') || all.includes('too many') || code === 80007 || code === 4) {
    return '🐢 Meta limitó tus envíos por demasiados mensajes en poco tiempo. Espera 5-10 minutos y vuelve a intentar.';
  }
  if (all.includes('blocked') || all.includes('flagged') || all.includes('quality')) {
    return '🚧 Meta bloqueó esta acción por calidad de tus plantillas o estatus de la cuenta. Revisa el estado de tu WABA en business.facebook.com → WhatsApp Manager.';
  }
  if (all.includes('phone') && (all.includes('not registered') || all.includes('not on whatsapp'))) {
    return '📵 Ese número no tiene WhatsApp activo, o el formato es incorrecto. Verifica que incluya el código de país (ej: +5213311234567).';
  }
  if (all.includes('recipient') || all.includes('to field')) {
    return '📵 Hay un problema con el número del destinatario. Verifica el formato (debe incluir código de país, ej: +52).';
  }

  // ─── Webhook / config ───
  if (all.includes('webhook') && all.includes('verify')) {
    return '🔌 El webhook de Meta no se verificó. Revisa que la URL pública responda y que el verify token coincida.';
  }
  if (all.includes('subscribed') || all.includes('subscription')) {
    return '🔌 Tu app no está suscrita al WABA. Hay que correr POST /v22.0/{waba_id}/subscribed_apps con el token (paso documentado en MANUAL_MAESTRO §5).';
  }

  // ─── Default — devuelve mensaje original pero limpiado ───
  const parts = [];
  if (err?.message)               parts.push(err.message);
  if (err?.error_user_msg)        parts.push(`(${err.error_user_msg})`);
  if (err?.error_data?.details)   parts.push(`— ${err.error_data.details}`);
  if (!parts.length)              return 'Error desconocido de Meta';
  return parts.join(' ');
}

// Mapeo de wa_rejected_reason (códigos de webhook) a texto amigable.
const REJECTED_REASON_LABELS = {
  INVALID_FORMAT:                 'Formato inválido (variables, footer, o estructura). Revisa: {{N}} bien numeradas, footer sin URLs, ejemplos llenados.',
  TAG_CONTENT_MISMATCH:           'Contenido no coincide con la categoría. Si tiene "descuento" u "oferta" → categoría debe ser MARKETING, no UTILITY.',
  PROMOTIONAL:                    'Marcada como promocional pero está en categoría UTILITY. Cámbiala a MARKETING.',
  CATEGORY_MISMATCH:              'Categoría incorrecta para este contenido. Promociones → MARKETING; confirmaciones → UTILITY; OTPs → AUTHENTICATION.',
  ABUSIVE_CONTENT:                'Contenido detectado como abusivo o spam. Revisa el body.',
  INVALID_VARIABLE_FORMAT:        'Variables mal formadas. Usa {{1}}, {{2}} consecutivos sin saltos.',
  SCAM:                           'Detectada como posible scam. Usa lenguaje neutral, no urgente.',
  NONE:                           'Sin razón específica',
};

function friendlyRejectedReason(reason) {
  if (!reason) return null;
  return REJECTED_REASON_LABELS[reason] || `Razón Meta: ${reason}`;
}

module.exports = { friendlyMetaError, friendlyRejectedReason };
