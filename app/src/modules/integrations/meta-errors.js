// Traductor de errores de Meta API → mensajes claros en español.
//
// REGLA DE ORO (2026-07-31): PRIMERO se muestra lo que Meta DIJO DE VERDAD
// (error_user_title / error_user_msg — vienen ya traducidos al español) junto
// con el código y subcódigo reales. Nuestro texto va DESPUÉS, como "cómo se
// arregla". Antes adivinábamos con una lista genérica de 5 causas y ninguna
// era la buena — p.ej. el 2388299 ("variable al principio o al final") salía
// como "formato inválido, revisa el footer…" y mandaba a buscar donde no era.
//
// La tabla de abajo son códigos REALES de la documentación de Meta:
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
// Si Meta manda uno que no está en la tabla, NO inventamos: mostramos su texto
// crudo + el código para poder buscarlo.

// OJO: `code` y `error_subcode` son NAMESPACES DISTINTOS. Meta manda por
// ejemplo code=100 subcode=33 ("Unsupported post request"), que no tiene nada
// que ver con el code=33 ("número eliminado"). Por eso van en dos tablas: si
// se mezclan, un subcódigo chico se traduce con el texto del código equivocado.
// Los subcódigos de plantillas (familia 2388xxx) SIEMPRE llegan en error_subcode
// acompañados de code=100.
const META_SUBCODES = {
  463:     { t: '🔑 La sesión de Meta caducó', f: 'Genera un token nuevo con caducidad NUNCA y pégalo en Integraciones → editar WhatsApp.' },
  // ─── Crear plantillas (Business Management API — familia 2388xxx) ───
  2388012: { t: '📞 Ese número ya está',     f: 'El teléfono ya existe en tu lista. Usa otro para la migración.' },
  2388019: { t: '📋 Llegaste al tope de plantillas', f: 'Meta permite máximo 250 plantillas por cuenta. Borra las que ya no uses y vuelve a intentar.' },
  2388039: { t: '⏳ No se puede cambiar ahorita', f: 'La plantilla está en revisión — Meta no deja editarla hasta que termine. Espera a que quede aprobada o rechazada.' },
  2388040: { t: '✂️ Texto demasiado largo',  f: 'Un campo pasó el límite de caracteres de Meta: header 60, body 1024, footer 60, botón 25. Recorta.' },
  2388047: { t: '🖼️ Header con formato inválido', f: 'El encabezado tiene algo que Meta no acepta: puede ser más de una variable, formato raro, o texto/archivo no soportado. El header de texto admite máximo un {{1}}.' },
  2388072: { t: '📝 Cuerpo con formato inválido', f: 'El body tiene formato que Meta no acepta. Revisa: variables con doble llave {{1}}, numeradas 1,2,3 sin saltos, sin saltos de línea de más y sin variables pegadas una a otra.' },
  2388073: { t: '🔻 Footer con formato inválido', f: 'El pie de página solo admite texto plano corto. Nada de URLs, teléfonos, emails ni variables {{N}}.' },
  2388091: { t: '📞 Número no elegible',     f: 'Ese número no puede recibir el código de registro. Usa el registro estándar de WhatsApp Manager.' },
  2388093: { t: '📞 Número no está en migración', f: 'Registra y verifica el número por el proceso normal.' },
  2388103: { t: '📞 No se pudo migrar',      f: 'Falta algo: webhooks, nombre para mostrar aprobado, facturación, o el estado de la cuenta. Revisa el detalle del error.' },
  2388293: { t: '🔢 Demasiadas variables para el texto', f: 'Tienes muchas {{N}} para lo corto que es el mensaje. Meta pide más texto fijo alrededor: agrega frases o quita variables.' },
  2388299: { t: '🔤 Variable al principio o al final', f: 'El cuerpo NO puede abrir ni cerrar con {{N}}. Pon una palabra antes (ej: "Hola {{1}}, …") y agrega una línea después del último (ej: "Te esperamos 💚").' },
};

// code → { t: título corto nuestro, f: cómo se arregla }
const META_CODES = {
  // ─── Autenticación / permisos ───
  0:       { t: '🔑 No se pudo autenticar', f: 'El token no sirve. Genera uno nuevo en business.facebook.com → System Users → Generar token.' },
  190:     { t: '🔑 Token caducado',        f: 'Genera un token nuevo (caducidad: NUNCA) con los scopes whatsapp_business_messaging + whatsapp_business_management y pégalo en Integraciones → editar WhatsApp.' },
  200:     { t: '🔑 Sin token o sin permiso', f: 'O no se mandó access token, o le falta un permiso (Meta usa el rango 200-299 para permisos). Revisa la integración de WhatsApp y regenera el token con whatsapp_business_messaging + whatsapp_business_management.' },
  100:     { t: '⚠️ Parámetro no soportado', f: 'Meta no aceptó algo del cuerpo de la petición. En plantillas casi siempre es: variable con una sola llave {nombre} en vez de {{1}}, variables no numeradas 1,2,3 seguidas, footer con URL/teléfono/email, o falta el valor de ejemplo de algún {{N}}.' },
  10:      { t: '🚫 Falta un permiso',      f: 'El token existe pero le faltan permisos. Regenéralo MARCANDO ambos: whatsapp_business_messaging + whatsapp_business_management.' },
  3:       { t: '🚫 Falta un permiso',      f: 'Revisa el token en el Access Token Debugger de Meta — le falta un scope.' },
  368:     { t: '🚧 Cuenta restringida',    f: 'Meta restringió tu WhatsApp Business Account por políticas. Revisa business.facebook.com → WhatsApp Manager → estado de la cuenta.' },
  33:      { t: '📵 Número eliminado',      f: 'El número de negocio fue borrado de Meta. Verifica en WhatsApp Manager que siga activo.' },

  // ─── Límites / disponibilidad ───
  1:       { t: '⚠️ Petición inválida',     f: 'Meta no entendió la petición, o está caída. Revisa metastatus.com y reintenta.' },
  2:       { t: '🔧 Meta está caída',       f: 'Servicio de Meta temporalmente no disponible. Espera unos minutos y reintenta.' },
  4:       { t: '🐢 Límite de la app',      f: 'Demasiadas llamadas a la API en poco tiempo. Espera 5-10 minutos.' },
  80007:   { t: '🐢 Límite de tu WABA',     f: 'Tu cuenta de WhatsApp Business llegó a su límite de llamadas. Espera y reintenta.' },
  2494055: { t: '🐢 Límite de envío',       f: 'Llegaste al tope de mensajes por segundo de la Cloud API. Baja el ritmo de envío.' },
  2494100: { t: '🔧 Cuenta en mantenimiento', f: 'Meta está haciendo mantenimiento en tu cuenta. Reintenta en unos minutos.' },
  135000:  { t: '⚠️ Error desconocido',     f: 'Meta rechazó los parámetros pero no dijo cuál. Revisa la plantilla campo por campo; si sigue, es bug de Meta.' },

  // ─── Enviar plantillas ───
  132000:  { t: '🔢 Faltan valores de variables', f: 'Mandaste menos (o más) valores de los {{N}} que tiene la plantilla. Deben coincidir exacto.' },
  132001:  { t: '📋 Plantilla no existe o no está aprobada', f: 'Verifica que esté APROBADA y que el idioma coincida (es_MX no es lo mismo que es).' },
  132005:  { t: '✂️ La traducción es muy larga', f: 'La versión traducida pasa el límite. Revisa esa traducción en WhatsApp Manager.' },
  132007:  { t: '🚫 Viola la política de WhatsApp', f: 'El contenido rompe las reglas de Meta. Quita lenguaje de urgencia, promesas de resultados o claims médicos.' },
  132012:  { t: '🔢 Valores mal formateados', f: 'Los valores que mandaste no tienen el formato que espera la plantilla (fechas, monedas, etc).' },
  132015:  { t: '⏸️ Plantilla pausada por calidad baja', f: 'Muchos usuarios la reportaron o bloquearon. Edítala (menos promocional, más útil) y vuelve a mandarla.' },
  132016:  { t: '⛔ Plantilla deshabilitada para siempre', f: 'Se pausó demasiadas veces. Crea una NUEVA con contenido distinto — esta ya no revive.' },
  132018:  { t: '🔢 Problema con los parámetros', f: 'Revisa y corrige los parámetros de la plantilla.' },
  134101:  { t: '⏳ Plantilla sincronizando', f: 'Espera hasta 10 minutos a que Meta termine de sincronizarla.' },
  134102:  { t: '⛔ Plantilla no disponible', f: 'Revisa su estado de elegibilidad en WhatsApp Manager.' },
  131055:  { t: '📢 Solo se aceptan plantillas MARKETING', f: 'Esta API solo admite categoría MARKETING. Cambia la categoría de la plantilla.' },
  134100:  { t: '📢 Solo se aceptan plantillas MARKETING', f: 'Verifica que la categoría de la plantilla sea MARKETING.' },

  // ─── Entrega de mensajes ───
  130403:  { t: '🚫 El usuario te bloqueó',  f: 'Ese contacto bloqueó tu número. No hay nada que hacer del lado tuyo.' },
  130429:  { t: '🐢 Tope de mensajes por segundo', f: 'Vas muy rápido. Espacia los envíos.' },
  130472:  { t: '🧪 Experimento de Meta',    f: 'Meta bloqueó el reenganche porque el lead no ha respondido recientemente. No es error tuyo.' },
  130497:  { t: '🌎 País restringido',       f: 'Tu WABA no puede mandar mensajes a ese país. Revisa la política de mensajería de WhatsApp.' },
  131000:  { t: '❓ Error desconocido al enviar', f: 'Falló sin motivo claro. Reintenta; si persiste es del lado de Meta.' },
  131005:  { t: '🚫 Falta un permiso',       f: 'Revisa los scopes del token.' },
  131008:  { t: '⚠️ Falta un parámetro',     f: 'La petición va incompleta. Reporta el caso — es un bug de wapi101.' },
  131009:  { t: '⚠️ Valor de parámetro inválido', f: 'Un valor no cumple lo que pide Meta. Revisa el detalle del error.' },
  131016:  { t: '🔧 Servicio no disponible', f: 'Meta está caída temporalmente. Revisa metastatus.com y reintenta.' },
  131021:  { t: '🔁 Te lo mandaste a ti mismo', f: 'El número de destino es el mismo que el que envía. Usa otro número.' },
  131026:  { t: '📵 No se pudo entregar',    f: 'El destinatario puede no tener WhatsApp, no haber aceptado los términos, o tener una versión muy vieja.' },
  131031:  { t: '🚧 Cuenta restringida',     f: 'Meta restringió tu cuenta, o falló la verificación de datos. Revisa Policy Enforcement en WhatsApp Manager.' },
  131037:  { t: '📛 Nombre para mostrar sin aprobar', f: 'Aprueba el display name del número en WhatsApp Manager.' },
  131042:  { t: '💳 Problema con el pago',   f: 'Revisa el método de pago y la línea de crédito en business.facebook.com → Facturación.' },
  131045:  { t: '📞 Número sin registrar',   f: 'Registra el número de negocio antes de enviar.' },
  131047:  { t: '⏰ Ventana de 24h cerrada', f: 'Pasaron más de 24h desde su último mensaje. Solo puedes mandarle una plantilla APROBADA.' },
  131048:  { t: '🚧 Restricción de envío',   f: 'Revisa la calidad de tu número y tus límites de plantillas en WhatsApp Manager.' },
  131049:  { t: '📉 Tope de marketing de Meta', f: 'Meta limita cuántos mensajes de MARKETING recibe cada usuario al día. Espera 24h o manda una plantilla UTILITY.' },
  131050:  { t: '🔕 Se dio de baja de marketing', f: 'Ese usuario pidió no recibir promociones. No reintentes.' },
  131051:  { t: '⚠️ Tipo de mensaje no soportado', f: 'Usa solo tipos que WhatsApp acepta.' },
  131052:  { t: '📥 No se pudo descargar el archivo', f: 'El media que mandó el usuario no se pudo bajar. Pídeselo de nuevo.' },
  131053:  { t: '📤 No se pudo subir el archivo', f: 'Verifica el tipo y el MIME del archivo. Meta acepta JPEG/PNG para imagen, MP4 para video, PDF para documento.' },
  131056:  { t: '🐢 Demasiados al mismo contacto', f: 'Le mandaste muchos mensajes en poco tiempo. Espera antes de reintentar con ese número.' },
  131057:  { t: '🔧 Cuenta en mantenimiento', f: 'Espera a que Meta termine el mantenimiento.' },
  131063:  { t: '⛔ Marketing deshabilitado', f: 'Las plantillas de marketing están apagadas para Cloud API en tu cuenta. Reactívalas en WhatsApp Manager.' },
  131064:  { t: '🚧 Violación de clasificación', f: 'Llegaste al límite por clasificar mal tus plantillas. La restricción se levanta sola; mientras, revisa las categorías.' },
  132068:  { t: '🚧 Flow bloqueado',         f: 'Corrige la configuración del Flow.' },
  132069:  { t: '🐢 Flow limitado',          f: 'El Flow mandó 10 mensajes en la última hora. Espera.' },
  134011:  { t: '📜 Falta aceptar términos de pagos', f: 'Acepta los WhatsApp Payments ToS con el link que da Meta.' },

  // ─── Registro / PIN ───
  133000:  { t: '📞 Falló el des-registro',  f: 'Des-registra el número y vuelve a registrarlo.' },
  133004:  { t: '🔧 Servidor no disponible', f: 'Reintenta en unos minutos.' },
  133005:  { t: '🔢 PIN incorrecto',         f: 'El PIN de verificación en dos pasos está mal. Reinícialo si no lo recuerdas.' },
  133006:  { t: '📞 Número sin verificar',   f: 'Verifica el número antes de registrarlo.' },
  133008:  { t: '🔢 Demasiados intentos de PIN', f: 'Espera el tiempo que indique Meta antes de reintentar.' },
  133009:  { t: '🔢 PIN muy rápido',         f: 'Espera lo que diga el detalle antes de reintentar.' },
  133010:  { t: '📞 Número no registrado',   f: 'Registra el número en la plataforma primero.' },
  133015:  { t: '📞 Número recién borrado',  f: 'Espera 5 minutos a que Meta termine de borrarlo y reintenta.' },
  133016:  { t: '🔢 Demasiados registros',   f: 'Espera a que Meta desbloquee el número.' },
};

// Códigos de la familia "ya existe" no vienen numerados de forma estable —
// se detectan por texto.
function friendlyMetaError(err) {
  const msg     = (err?.message || '').toLowerCase();
  const userMsg = (err?.error_user_msg || '').toLowerCase();
  const title   = (err?.error_user_title || '').toLowerCase();
  const details = (err?.error_data?.details || '').toLowerCase();
  const all     = `${msg} ${title} ${userMsg} ${details}`;
  const code    = err?.code;
  const subcode = err?.error_subcode;

  if (!err) return 'Error desconocido de Meta';

  // Lo que Meta dijo LITERAL — nunca se pierde, siempre se muestra.
  const metaSaid = [err?.error_user_title, err?.error_user_msg]
    .filter(Boolean).map(s => String(s).trim()).filter((s, i, a) => a.indexOf(s) === i).join(' — ')
    || err?.error_data?.details || err?.message || '';
  const codeTag = [code, subcode].filter(v => v != null).join('/');

  // Compone: título nuestro + lo que dijo Meta + cómo se arregla + código.
  const compose = (t, f) => [
    t,
    metaSaid ? `Meta dijo: "${metaSaid}"` : null,
    f ? `👉 ${f}` : null,
    codeTag ? `· código ${codeTag}` : null,
  ].filter(Boolean).join('\n');

  // ─── 1) Casos especiales de wapi101 (más accionables que la tabla) ───
  if (all.includes('session has expired') || all.includes('access token has expired') || subcode === 463) {
    return compose('🔑 El token de Meta caducó',
      'business.facebook.com → System Users → Wuichy → Generar token (caducidad: NUNCA, scopes whatsapp_business_messaging + whatsapp_business_management). Pégalo en Integraciones → editar WhatsApp.');
  }
  if (all.includes('already exists') || all.includes('ya existe contenido') || all.includes('ya existe')) {
    return compose('📋 Ese nombre ya está usado en Meta',
      'Aunque la otra haya sido rechazada, Meta bloquea el nombre 30 días. Cambia el "Nombre interno" con un sufijo: "compra" → "compra_v2". Después vuelve a Enviar a Meta.');
  }
  if (all.includes('image too small') || all.includes('too small')) {
    return compose('📏 La imagen es muy chica', 'Meta requiere mínimo 192×192 px.');
  }
  if (all.includes('header media') || all.includes('image format')) {
    return compose('🖼️ El archivo del header no lo acepta Meta',
      'Usa JPEG o PNG (no SVG, ni HEIC, ni GIF, ni WebP). Mínimo 192×192 px.');
  }

  // ─── 2) Tablas de códigos reales de Meta. El subcódigo es más específico,
  //     pero se busca en SU PROPIA tabla (namespaces distintos, ver arriba).
  const hit = META_SUBCODES[subcode] || META_CODES[code];
  if (hit) return compose(hit.t, hit.f);

  // ─── 3) Sin código conocido: detección por texto, sin inventar de más ───
  if (all.includes('variable') && (all.includes('example') || all.includes('placeholder'))) {
    return compose('🔢 Faltan ejemplos en los placeholders',
      'Llena el "Valor de ejemplo" en cada {{N}} (ej: para {{1}} pon "Luis"). Meta los usa para revisar la plantilla.');
  }
  if (all.includes('webhook') && all.includes('verify')) {
    return compose('🔌 El webhook de Meta no se verificó',
      'Revisa que la URL pública responda y que el verify token coincida.');
  }
  if (all.includes('subscribed') || all.includes('subscription')) {
    return compose('🔌 Tu app no está suscrita al WABA',
      'Corre POST /v22.0/{waba_id}/subscribed_apps con el token (MANUAL_MAESTRO §5).');
  }
  if (all.includes('permission') || all.includes('not authorized')) {
    return compose('🚫 El token no tiene permisos suficientes',
      'Genera uno nuevo en business.facebook.com → System Users y MARCA ambos: whatsapp_business_messaging + whatsapp_business_management.');
  }

  // ─── 4) Nada conocido: mostramos LO QUE META DIJO, tal cual, con su código.
  //     Nunca inventamos una causa aquí — con el código se puede buscar.
  return compose('⚠️ Meta rechazó la operación', null);
}

// Mapeo de wa_rejected_reason (códigos de webhook) a texto amigable.
const REJECTED_REASON_LABELS = {
  INVALID_FORMAT:                 'Formato inválido (variables, footer, o estructura). Revisa: {{N}} bien numeradas, que el cuerpo NO empiece ni termine con variable, footer sin URLs, ejemplos llenados.',
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

// Detecta si un error (de Meta API o de error.message string) corresponde a un
// token caducado / inválido. Aplica a WhatsApp Cloud, Messenger, Instagram —
// cualquier llamada a graph.facebook.com con Bearer token.
function isMetaAuthError(err) {
  if (!err) return false;
  const message = typeof err === 'string'
    ? err
    : (err.message || err.error_user_msg || err.error_data?.details || '');
  const code    = err.code;
  const subcode = err.error_subcode;
  const txt = String(message).toLowerCase();

  if (subcode === 463) return true;
  // SOLO errores de TOKEN (190 = invalid/expired, 102 = session key inválida).
  // Los códigos 10/200 son errores de PERMISO POR MENSAJE (ej. "(#10) message
  // sent outside of allowed window" = ventana 24h de Messenger) — un fallo
  // rutinario de un solo mensaje NO debe tumbar la integración entera.
  if (code === 190 || code === 102) return true;
  if (txt.includes('session has expired')) return true;
  if (txt.includes('access token has expired')) return true;
  if (txt.includes('invalid oauth')) return true;
  if (txt.includes('error validating access token')) return true;
  if (txt.includes('token has been invalidated')) return true;
  return false;
}

module.exports = { friendlyMetaError, friendlyRejectedReason, isMetaAuthError, META_CODES, META_SUBCODES };
