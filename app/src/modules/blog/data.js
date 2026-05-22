// Datos del blog de Wapi101 — guías técnicas y de marketing.
// Cada entry produce un artículo completo vía render.js.
//
// Estructura: cada POST tiene metadata + sections (h, p[]) + faqs ([q, a][]).
// Los párrafos soportan markdown limitado: **bold**, [link](url), `code`.
//
// CRITERIO SEO:
//   - title 55-70 chars, incluye keyword principal + año / "México" / "LATAM"
//   - description 140-160 chars, incluye keyword + value prop
//   - 1500-2500 palabras en total (sections + faqs)
//   - 6-10 sections y 8-10 FAQs por artículo
//   - Internal linking a /signup, /vs/*, /crm-*, /developers
//
// Auditoría: revisar cada 6 meses por precios y features que cambien.

const POSTS = {

  // ───────────────────────────────────────────────────────────────────
  // 1. Cómo conectar WhatsApp Business API
  // ───────────────────────────────────────────────────────────────────
  'como-conectar-whatsapp-business-api': {
    slug: 'como-conectar-whatsapp-business-api',
    title: 'Cómo conectar WhatsApp Business API paso a paso (2026, México)',
    description: 'Guía completa para activar WhatsApp Business API en México: requisitos, verificación de Meta, costos reales, proveedor BSP o Cloud API directo. Sin vueltas.',
    keywords: 'como conectar whatsapp business api, activar whatsapp api mexico, whatsapp business api precio, whatsapp cloud api configuracion, meta business verificacion, certificado whatsapp business',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Guías',
    excerpt: 'Activar WhatsApp Business API ya no requiere semanas ni un proveedor caro. Te explico el camino más directo en 2026 — Cloud API de Meta directo — con los requisitos reales, el costo y los pasos exactos.',
    readingTime: '9 min',
    sections: [
      {
        h: 'WhatsApp Business API en 2026: qué cambió',
        p: [
          'Hace tres años activar WhatsApp Business API era un dolor: tenías que pasar por un BSP (Business Solution Provider) tipo Twilio o 360dialog, pagar setup fees de USD $500-$2000 y esperar semanas. Hoy Meta lanzó **WhatsApp Cloud API** que es gratis de configurar, lo hospeda Meta directamente y se puede activar el mismo día.',
          'Para una PyME en México, esto cambia todo: ya no necesitas un intermediario que te cobre por mensaje encima de lo que cobra Meta. Pagas solo a Meta los costos por conversación (que arrancan en $0 si el cliente te escribió primero) y tu CRM como [Wapi101](/signup) se conecta directo vía API.',
          'Importante: WhatsApp Business API ≠ WhatsApp Business (la app gratuita). La API es para automatizar con sistemas, integrar bots, mandar plantillas masivas y conectar a un CRM. Si tienes menos de 250 contactos y vendes manual, no necesitas API — la app sola alcanza. Si quieres saber cuál te conviene, te dejo la [comparativa WhatsApp Business vs API](/blog/whatsapp-business-vs-api-diferencias).',
        ],
      },
      {
        h: 'Requisitos para activar la API en México',
        p: [
          'Necesitas tres cosas: (1) un **número telefónico** que no esté actualmente usado en la app WhatsApp Business — Meta lo "migra" a la API y queda inutilizable en la app móvil; (2) una cuenta de **Meta Business Manager** verificada (mismo Meta de Facebook/Instagram); (3) una **cuenta de WhatsApp Business Account (WABA)** que se crea durante el flujo.',
          'El número puede ser un fijo, celular o un VoIP — Meta acepta los tres. Lo único es que recibirás un código de verificación por SMS o llamada para confirmar que es tuyo. Si vas a usar tu número personal, mejor consigue uno dedicado: una vez que migras a la API no puedes "regresar" a la app sin volver a verificar el número (proceso de 30+ días).',
          'La **verificación de Meta Business** sí es importante: si solo tienes la cuenta básica de Facebook Business sin verificar, te limita a ~250 conversaciones por día. Para quitar ese límite necesitas subir RFC, comprobante de domicilio comercial y un documento del representante legal. Toma ~3-5 días hábiles que Meta apruebe.',
        ],
      },
      {
        h: 'Cloud API directo vs BSP (Twilio, 360dialog): cuál elegir',
        p: [
          '**Cloud API directo** (recomendado en 2026): te conectas a Meta sin intermediario. Pagas USD $0.005-$0.025 por conversación según el país y el tipo (utility, marketing, auth, service). En México un mensaje utility cuesta ~USD $0.012, marketing ~USD $0.030 — son centavos. Esta es la opción que conecta Wapi101.',
          '**BSP (Business Solution Provider)** como Twilio, 360dialog, MessageBird: te cobran el precio de Meta + un margen (típicamente USD $0.005-$0.010 extra por mensaje) + cuotas mensuales de USD $50-$500. Sirven si necesitas SMS de respaldo, voz tradicional o si tu compliance interno exige un proveedor con SOC2 dedicado. Para una PyME normal en México no aportan algo que justifique el sobreprecio.',
          'Si quieres ver una comparativa más detallada con números reales, escribí [WhatsApp Cloud API vs Twilio](/blog/whatsapp-cloud-api-vs-twilio): cuándo conviene cada uno y dónde se "esconde" el costo real.',
        ],
      },
      {
        h: 'Paso 1: Crea/verifica tu Meta Business Manager',
        p: [
          'Entra a `business.facebook.com` con tu cuenta personal de Facebook. Si nunca lo usaste, crea un Business Manager nuevo. En el menú lateral ve a **Configuración del negocio → Información del negocio** y llena nombre legal, dirección, RFC, sitio web, email del responsable.',
          'Luego en **Centro de seguridad** sube los documentos para la verificación oficial de Meta: una identificación oficial del representante legal (INE) y un comprobante de domicilio comercial (factura CFE, agua, internet o acta constitutiva). Meta tarda 3 a 5 días en aprobar. Sin esta verificación tendrás límite de **250 conversaciones/día** — suficiente para arrancar, pero crece rápido.',
          'Mientras esperas la verificación puedes seguir con los siguientes pasos: la API funciona aunque la verificación oficial esté pendiente, solo con tope diario.',
        ],
      },
      {
        h: 'Paso 2: Crea la WhatsApp Business Account',
        p: [
          'Dentro de Business Manager ve a **Cuentas → Cuentas de WhatsApp** y dale "Agregar nueva cuenta de WhatsApp Business". Te va a pedir un nombre para tu WABA (puede ser tu marca: "Wapi101 LATAM") y la zona horaria.',
          'Después agregas tu primer número de teléfono. Aquí es donde te llega el código de verificación por SMS/llamada. Una vez verificado, el número queda asignado a esa WABA y ya no es usable en la app móvil. Para "des-migrar" en el futuro es un proceso de 30+ días — piensa bien qué número usas.',
          'Configura el **perfil del negocio**: nombre que verán los clientes en el chat, foto de perfil (cuadrada 640×640 idealmente), descripción, dirección, sitio web, categoría de negocio. Esto sale en el "header" de la conversación de cada cliente.',
        ],
      },
      {
        h: 'Paso 3: Genera tu System User Access Token',
        p: [
          'En **Business Manager → Configuración del negocio → Usuarios → Usuarios del sistema** crea un nuevo "System User" con el rol Admin. Este usuario no es una persona, es un identidad técnica para que tu CRM se autentique con Meta.',
          'Asignale la WABA que creaste en el paso anterior (en "Recursos asignados → Cuentas de WhatsApp"). Luego en el detalle del System User da clic en **Generate New Token** y selecciona los permisos: `whatsapp_business_messaging` y `whatsapp_business_management`. Marca "Never expires" para que el token no se invalide cada 60 días.',
          'Copia el token y guárdalo bien — Meta NO te lo vuelve a mostrar. Este token es lo que pegarás en Wapi101 (o el CRM que uses) para que pueda mandar mensajes en nombre de tu WABA.',
        ],
      },
      {
        h: 'Paso 4: Configura el webhook de mensajes entrantes',
        p: [
          'Para recibir mensajes en tu CRM (no solo enviar), Meta necesita una URL pública donde te hace POST cada vez que llega un mensaje. Esto se llama **webhook**. En la app de Meta ve a **WhatsApp → Configuración → Webhooks** y registra la URL.',
          'Si usas Wapi101, la URL ya está lista: `https://wapi101.com/webhooks/whatsapp` y el verify token te lo damos al conectar tu integración. Solo lo copias, pegas, suscribes los eventos `messages`, `message_template_status_update` y `phone_number_quality_update`, y listo.',
          'Si lo estás integrando custom, revisa la documentación en [/developers](/developers) — tenemos OAuth 2.0, webhooks con HMAC y SDK para Node.js y Python.',
        ],
      },
      {
        h: 'Paso 5: Conecta en Wapi101 (o el CRM que uses)',
        p: [
          'En Wapi101: Configuración → Integraciones → Conectar WhatsApp Cloud API. Pegas el **Phone Number ID** (lo ves en Meta Business → WhatsApp → Configuración de API), el **WABA ID** y el **Access Token** del System User. Listo, te conecta en 10 segundos.',
          'Manda un mensaje de prueba a tu WhatsApp personal desde la sección "Plantillas" — Meta exige que el primer mensaje sea una plantilla aprobada (las "hello_world" ya viene aprobada por default).',
          'Si quieres saber cómo crear y aprobar tus propias plantillas con el flujo de Meta, te lo platico paso a paso en [Plantillas WhatsApp Business: guía completa](/blog/plantillas-whatsapp-business-guia).',
        ],
      },
      {
        h: '¿Y si no quieres la API? Alternativas',
        p: [
          'Si lo que necesitas es WhatsApp para venta directa simple (responder clientes manualmente, ver el chat en computadora) y no requieres bots ni plantillas masivas, hay una alternativa **gratuita**: conectar WhatsApp Web normal a través de un CRM. Wapi101 ofrece esto como **WhatsApp Lite** — escaneas QR igual que en WhatsApp Web, todos tus mensajes entran al CRM, sin pagar por API.',
          'La diferencia: con WhatsApp Lite puedes enviar **hasta 200-300 mensajes nuevos por día** sin que WhatsApp se ponga incómodo (sobre todo a contactos que no te habían escrito). Con la API formal puedes mandar miles, con plantillas pre-aprobadas y sin riesgo de baneo. Buena puerta de entrada antes de migrar a API.',
          'Otra alternativa: para [restaurantes](/crm-restaurantes), [clínicas](/crm-clinicas) o [inmobiliarias](/crm-inmobiliaria) donde el volumen no justifica API, WhatsApp Lite + un CRM bueno ya es suficiente.',
        ],
      },
    ],
    faqs: [
      ['¿Cuánto cuesta WhatsApp Business API en México?', 'El setup es gratis con Cloud API directo. Pagas por conversación a Meta: ~USD $0.012 (utility) a ~USD $0.030 (marketing) por conversación de 24h. Las conversaciones iniciadas por el cliente cuestan menos. Para 1000 mensajes/mes calcula USD $20-$50.'],
      ['¿Cuánto tarda Meta en aprobar mi cuenta?', 'La WABA y el primer número se activan el mismo día. La verificación oficial de Meta Business (que quita el tope de 250 conv/día) tarda 3-5 días hábiles. Si tu cuenta no está verificada igual puedes operar, solo con ese límite.'],
      ['¿Puedo usar mi número personal de WhatsApp?', 'Técnicamente sí pero NO se recomienda. Una vez migrado a la API, ese número deja de funcionar en la app móvil. Si quieres regresar a la app son 30+ días de espera. Mejor consigue un número dedicado.'],
      ['¿Necesito un BSP como Twilio o 360dialog?', 'En 2026 ya no es obligatorio. Cloud API de Meta directo es la opción más barata y rápida. BSPs sirven para casos específicos (SMS de respaldo, voz tradicional, compliance estricto). Para una PyME normal, vete directo.'],
      ['¿Qué pasa si me banean el número?', 'Meta puede suspender un número si recibe muchos reportes de spam o si mandas mensajes a contactos que no te dieron permiso. Para evitarlo: solo manda plantillas aprobadas a tu lista, no uses listas compradas, deja siempre opción de "STOP" o desuscripción.'],
      ['¿Cuál es el límite de mensajes por día?', 'Depende del "tier" de tu número. Empiezas en Tier 1 (1,000 conversaciones únicas/día). Si tu calidad de mensajes es buena (pocos reports), subes automáticamente a Tier 2 (10K), Tier 3 (100K) y eventualmente "ilimitado". El upgrade es automático según comportamiento.'],
      ['¿Puedo usar WhatsApp API con un CRM diferente a Wapi101?', 'Sí, la API es un estándar de Meta. Cualquier CRM con integración (Kommo, Salesforce, HubSpot, etc.) puede conectarse. Pero verifica si te cobra extra por mensaje encima de lo de Meta. En [vs/kommo](/vs/kommo) y [vs/manychat](/vs/manychat) comparamos.'],
      ['¿Necesito ser empresa registrada (con RFC) para activar la API?', 'Para la **verificación oficial** de Meta sí — te piden RFC y documentos del negocio. Sin verificar, puedes operar con tope diario. Para verificación: persona moral (S.A. de C.V., S. de R.L.) lo aprueban más rápido; persona física con actividad empresarial también funciona.'],
      ['¿Puedo cambiar de proveedor sin perder el número?', 'Sí, el número está vinculado a tu WABA, no al proveedor. Si te cambias de Twilio a Cloud API directo, solo generas nuevo token y actualizas en el nuevo proveedor. El historial de mensajes lo mantiene tu CRM, no Meta.'],
      ['¿La API soporta multimedia, ubicación, contactos?', 'Sí — texto, imágenes (JPG/PNG hasta 5MB), video (MP4 hasta 16MB), audio, documentos (PDF hasta 100MB), ubicación, contactos vCard, listas interactivas y botones de respuesta rápida. Wapi101 expone todo desde la UI sin que toques la API.'],
    ],
    relatedSlugs: ['plantillas-whatsapp-business-guia', 'whatsapp-business-vs-api-diferencias', 'whatsapp-cloud-api-vs-twilio'],
  },

  // ───────────────────────────────────────────────────────────────────
  // 2. Plantillas WhatsApp Business
  // ───────────────────────────────────────────────────────────────────
  'plantillas-whatsapp-business-guia': {
    slug: 'plantillas-whatsapp-business-guia',
    title: 'Plantillas WhatsApp Business: guía completa de aprobación (2026)',
    description: 'Cómo crear plantillas WhatsApp Business (HSM) que Meta apruebe a la primera. Categorías, errores comunes, ejemplos reales y costos por tipo en 2026.',
    keywords: 'plantillas whatsapp business, plantillas hsm whatsapp, aprobacion plantilla whatsapp, mensaje plantilla whatsapp api, plantillas marketing utility whatsapp, ejemplo plantilla aprobada whatsapp',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Guías',
    excerpt: 'Las plantillas (HSM) son el único mensaje que puedes mandar a un cliente que no te escribió primero. Aquí te dejo todo lo que Meta espera, cómo redactarlas para que aprueben rápido y los errores típicos que las hacen rebotar.',
    readingTime: '11 min',
    sections: [
      {
        h: '¿Qué es una plantilla HSM y por qué la necesitas?',
        p: [
          'En WhatsApp Business API, una **plantilla** (oficialmente "Highly Structured Message" o HSM) es un mensaje pre-aprobado por Meta que puedes mandar a clientes incluso si ellos no te escribieron primero. Sin una plantilla, solo puedes responder dentro de las **24 horas** posteriores a un mensaje del cliente.',
          'Esto significa: si quieres mandar una confirmación de pedido, un recordatorio de cita, una promoción o un mensaje de cobranza a alguien que no te escribió hoy — **obligatorio** usar plantilla.',
          'Meta revisa cada plantilla manualmente (o con IA) y la aprueba/rechaza en 1-24 horas. Una vez aprobada queda guardada en tu cuenta y puedes mandarla cuantas veces quieras (cobrándote solo por conversación, ~USD $0.012-$0.030 dependiendo de tipo y país).',
        ],
      },
      {
        h: 'Las 3 categorías que Meta usa (importante para el costo)',
        p: [
          '**Marketing**: promociones, descuentos, anuncios de producto nuevo, lanzamiento de campaña, recordatorios de carrito abandonado. Costo más alto en México: ~USD $0.030 por conversación. Meta es estricto — no aprueba lenguaje agresivo tipo "ÚLTIMA OPORTUNIDAD!!!" ni promesas falsas.',
          '**Utility**: confirmación de compra, recibo, recordatorio de cita, actualización de envío, código de verificación de transacción. Costo medio: ~USD $0.012 en México. Aprobación rápida si el texto coincide con el caso real (no usar utility para vender un producto nuevo).',
          '**Authentication**: solo códigos OTP para login o verificación. Costo bajísimo: ~USD $0.0035 en México. Tiene formato muy restringido (solo el código + nombre del servicio). Para esto puedes consultar la integración en [/developers](/developers).',
          'Categorizar mal tu plantilla puede llevar a rechazo o a que Meta te recategoríce automáticamente (y te cobre más). Sé honesto.',
        ],
      },
      {
        h: 'Anatomía de una plantilla',
        p: [
          'Una plantilla tiene 3-4 componentes: **header** (opcional: texto, imagen, video o documento), **body** (obligatorio, texto con variables {{1}} {{2}}…), **footer** (opcional, texto corto sin variables, máx 60 chars), **botones** (opcional: hasta 3 botones de respuesta rápida o 1 botón de URL/llamada).',
          'Las **variables** ({{1}}, {{2}}, etc.) son placeholders que rellenas al enviar la plantilla. Ejemplo: "Hola {{1}}, tu pedido {{2}} llegará el {{3}}." Cuando mandas la plantilla, reemplazas {{1}} = "María", {{2}} = "#4521", {{3}} = "viernes".',
          'Meta exige que tus variables tengan **valores de ejemplo realistas** al someter la plantilla — si pones "1234" en lugar de "María" como ejemplo del {{1}} de nombre, te rechazan.',
        ],
      },
      {
        h: 'Ejemplos: plantilla aprobada vs rechazada',
        p: [
          '**Aprobada (utility)**: *"Hola {{1}}, tu pedido #{{2}} de {{3}} ya está confirmado. Te avisamos cuando salga a entrega. Gracias por preferir [Nombre Negocio]."* Esta tiene tono claro, variables con ejemplos realistas (María / 4521 / $890 MXN), sin emojis excesivos, sin frases de venta.',
          '**Rechazada (categorizada mal)**: la misma plantilla anterior pero submitida como "marketing". Meta la rechaza porque el contenido es claramente utility (confirmación post-compra). Re-categoriza y aprueba.',
          '**Rechazada (lenguaje agresivo)**: *"OFERTA EXCLUSIVA SOLO HOY!!!! ⚡⚡⚡ Compra YA antes de que se acabe!!!"* — Meta rechaza por uso excesivo de mayúsculas, exclamaciones, urgencia falsa.',
          '**Rechazada (variable poco clara)**: *"Hola {{1}}, te escribo de {{2}} sobre {{3}}."* — Meta rechaza porque no se entiende qué tipo de información va en cada variable. Necesitas ejemplos concretos al someter.',
        ],
      },
      {
        h: 'Reglas que casi siempre causan rechazo',
        p: [
          '**URLs de afiliado o tracking visibles**: si pones un link tipo `bit.ly/x9k2` en el body, Meta rechaza. Usa el botón "Visitar sitio web" con URL completa y limpia: `https://tudominio.com/pedidos/4521`.',
          '**Datos sensibles en variables**: nada de números de tarjeta de crédito, contraseñas, NSS, RFC completo. Meta detecta esto y rechaza por compliance.',
          '**Lenguaje promocional en categoría utility**: usar "compra", "descuento", "oferta" en una plantilla categorizada como utility es rechazo automático. Si vas a promocionar, usa categoría marketing.',
          '**Promesas no verificables**: "100% garantizado", "número 1 en México", "mejor del mercado" — Meta lo considera engañoso. Usa lenguaje específico y comprobable.',
        ],
      },
      {
        h: 'Cómo crear y enviar a aprobación en Wapi101',
        p: [
          'En Wapi101: Plantillas → Nueva plantilla. Llenas nombre interno (snake_case, ej `confirmacion_pedido`), seleccionas idioma (es_MX), categoría y los componentes. Editor visual te muestra cómo se verá en el chat real.',
          'Al "Enviar a aprobación", la plantilla se envía a Meta. En 1-24 horas el estado pasa a `approved`, `rejected` o `paused`. Si es rejected, Meta da un código de motivo (ej. INVALID_FORMAT, INVALID_DEFAULT_VALUE) que te ayuda a entender qué corregir.',
          'Puedes editar plantillas rechazadas y volver a someterlas hasta 10 veces antes de que el nombre quede bloqueado — entonces usa otro nombre interno.',
        ],
      },
      {
        h: 'Plantillas multi-idioma',
        p: [
          'Si vendes en México y EE.UU., puedes tener la misma plantilla en `es_MX` y `en_US`. Meta las aprueba por separado (cada idioma es su propia plantilla en backend). Buena práctica: nombres internos iguales con sufijo de idioma (`bienvenida_es`, `bienvenida_en`) para mantenerlas alineadas.',
          'En Wapi101 la UI te permite tenerlas como variantes de la misma plantilla — al enviar, el sistema detecta el idioma del contacto (basado en su número o configuración) y manda la versión correcta.',
        ],
      },
      {
        h: 'Estrategias para PyMEs: plantillas que conviene tener desde el día 1',
        p: [
          '**Confirmación de compra/pedido** (utility): casi todos los e-commerces necesitan esta. Sirve para Shopify, WooCommerce, ventas manuales. Ejemplo en [/crm-ecommerce](/crm-ecommerce).',
          '**Recordatorio de cita** (utility): clínicas, salones, mecánicos, peluquerías. 24h antes y 1h antes. Reduce no-shows ~40%. Patrón típico en [/crm-clinicas](/crm-clinicas).',
          '**Carrito abandonado** (marketing): para e-commerce. Manda 15min después del abandono con el producto y CTA. Recupera ~10-25% según industria — escribí una guía aparte: [Recuperar carritos por WhatsApp](/blog/recuperar-carritos-abandonados-whatsapp).',
          '**Reactivación** (marketing): clientes que no compran hace 3+ meses. "Te extrañamos, te dejamos 10% off." Conversiones ~3-8%.',
          '**Reseña post-venta** (marketing): pides feedback 3 días después de la entrega. Manda link a Google Reviews. Aumenta tus estrellas pasivamente.',
        ],
      },
    ],
    faqs: [
      ['¿Cuánto tarda Meta en aprobar una plantilla?', 'Típicamente 1-24 horas. Plantillas muy simples (utility con texto corto) suelen aprobarse en minutos. Marketing con imagen header o muchas variables tarda más. Authentication es casi instantáneo.'],
      ['¿Cuántas plantillas puedo tener?', 'Hasta 6,000 plantillas por WABA. En la práctica, una PyME normal usa 10-30. Hay límite de 250 envíos a aprobación por día.'],
      ['¿Puedo mandar plantillas a un contacto que ya borró WhatsApp?', 'No. Meta detecta el estado del número y te devuelve error en el webhook (estado `failed`). Tu CRM debería marcar al contacto como "inactivo" automáticamente.'],
      ['¿Las plantillas funcionan con multimedia (imagen, video)?', 'Sí, en el header puedes poner imagen (JPG/PNG ≤5MB), video (MP4 ≤16MB) o documento (PDF ≤100MB). Útil para catálogos, facturas o promociones visuales.'],
      ['¿Qué pasa si una plantilla aprobada empieza a recibir reportes?', 'Meta la pausa automáticamente (estado `paused`) y te avisa por webhook. Tienes 7 días para apelar o eliminar. Si sigues mandando spam, pueden bajar la calidad de tu número o suspenderlo.'],
      ['¿Puedo editar una plantilla aprobada?', 'Sí pero el editing reenvía a aprobación. Si Meta rechaza la edición, la versión anterior sigue activa. Mejor práctica: crea una nueva variante con sufijo `_v2` para no perder la aprobada.'],
      ['¿Cuál es la diferencia entre categoría marketing y utility?', 'Marketing = promocional, vendedor (ofertas, descuentos, lanzamientos). Utility = informativo, transaccional (confirmaciones, recordatorios, actualizaciones). Costo marketing es ~2.5x más caro que utility.'],
      ['¿Puedo usar emojis en plantillas?', 'Sí pero moderado. 1-2 emojis emblemáticos pasan, "🎉🎉🎉🔥🔥🔥" se rechaza por "spammy". Meta también rechaza emojis ambiguos como manos en signo de ok que pueden malinterpretarse.'],
      ['¿Necesito plantilla para responder a un cliente?', 'No, si te escribió en las últimas 24h puedes mandar mensaje libre (sin plantilla). La plantilla solo es necesaria para iniciar conversación o pasadas las 24h.'],
      ['¿Wapi101 cobra extra por plantillas?', 'No. Pagas solo lo que cobra Meta directamente (Wapi101 usa Cloud API, sin margen extra). En tu reporte ves el costo real por conversación. Puedes verlo en [precios](/#pricing).'],
    ],
    relatedSlugs: ['como-conectar-whatsapp-business-api', 'recuperar-carritos-abandonados-whatsapp', 'bots-whatsapp-pymes-ejemplos'],
  },

  // ───────────────────────────────────────────────────────────────────
  // 3. WhatsApp Business vs WhatsApp Business API
  // ───────────────────────────────────────────────────────────────────
  'whatsapp-business-vs-api-diferencias': {
    slug: 'whatsapp-business-vs-api-diferencias',
    title: 'WhatsApp Business vs WhatsApp Business API: diferencias (2026)',
    description: 'Diferencias entre WhatsApp Business (app) y WhatsApp Business API: límites, costos, cuándo migrar y qué CRM elegir según tu volumen y equipo en 2026.',
    keywords: 'whatsapp business vs api, diferencia whatsapp business api, cuando migrar whatsapp api, whatsapp business app limites, whatsapp api mexico cuando',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Comparativas',
    excerpt: 'Ambas se llaman "WhatsApp Business" pero son productos diferentes. Uno es app gratuita para vendedores solos, el otro es una API para automatizar con un CRM. Aquí te dejo cuándo conviene cada uno con números reales.',
    readingTime: '7 min',
    sections: [
      {
        h: 'La confusión: son dos productos distintos',
        p: [
          'Meta vende WhatsApp Business como si fuera una sola cosa, pero en realidad son **dos productos diferentes**: (1) **WhatsApp Business App**, la app móvil gratuita que descargas en tu iPhone o Android, y (2) **WhatsApp Business API** (también llamada **Cloud API**), una API HTTP para integrar WhatsApp en un CRM o sistema custom.',
          'No son "versiones del mismo producto" ni puedes "actualizar" de uno al otro libremente. Son tecnologías separadas con casos de uso, límites y costos distintos. Elegir el equivocado puede costarte semanas de re-implementación.',
        ],
      },
      {
        h: 'WhatsApp Business App: para quién está hecha',
        p: [
          'La app móvil gratuita es para **vendedores solos o equipos chicos (1-3 personas)** que manejan ventas manualmente. La descargas, escaneas QR para conectar con WhatsApp Web en tu PC, y trabajas igual que WhatsApp normal pero con perfil de negocio (catálogo simple, etiquetas de chat, respuestas rápidas).',
          'Es **gratis** y funciona desde el día uno sin trámites con Meta. No requiere verificación, RFC ni nada. Lo que sí: cada conversación la respondes tú a mano. No hay bots, no hay plantillas masivas, no hay integración con CRM externo (salvo soluciones como [WhatsApp Lite de Wapi101](/signup) que escanean QR como WhatsApp Web).',
        ],
      },
      {
        h: 'WhatsApp Business API: para quién está hecha',
        p: [
          'La API es para **negocios con volumen** que necesitan: bots automáticos, mandar plantillas masivas (recordatorios, promos, confirmaciones de pedido), integración con CRM/ERP/Shopify, multi-asesor sin compartir teléfono, reportería avanzada.',
          'Activarla requiere: cuenta Meta Business verificada, WABA, número dedicado, token de acceso, webhook configurado. Te lo expliqué paso a paso en [Cómo conectar WhatsApp Business API](/blog/como-conectar-whatsapp-business-api).',
          'Costos: gratis el setup (con Cloud API directo). Pagas por conversación a Meta: USD $0.012-$0.030 cada una. Más el costo del CRM (Wapi101 desde MXN $149/mes).',
        ],
      },
      {
        h: 'Comparación directa: límites y features',
        p: [
          '**Conversaciones simultáneas**: la app gratuita permite hasta 4 dispositivos vinculados (1 teléfono + 4 PCs/tablets). La API es ilimitada (cualquier número de operadores conectados al mismo tiempo desde el CRM).',
          '**Contactos en el broadcast**: la app limita a 256 contactos por lista de difusión, y el receptor debe tenerte agregado para ver el broadcast. La API permite mandar plantillas a contactos sin que te tengan agregado, sin límite teórico de destinatarios (sujeto al tier de tu número, típicamente 1K-100K conv/día).',
          '**Bots y automatización**: la app no tiene bots reales (solo "respuestas rápidas" que tú envías manualmente). La API se integra con CRM y permite bots visuales completos con condiciones, ramas, IA. Ejemplo en [Bots WhatsApp para PyMEs](/blog/bots-whatsapp-pymes-ejemplos).',
          '**Plantillas pre-aprobadas (HSM)**: solo disponibles en la API. En la app no existen — todo es chat libre dentro de 24h.',
          '**Integración con CRM**: la app no se integra con sistemas externos. La API es para integrar con cualquier CRM/ERP via REST.',
        ],
      },
      {
        h: 'Cuándo migrar de la app a la API',
        p: [
          'Las señales claras: (1) tienes 3+ vendedores compartiendo el mismo teléfono y se pierden mensajes; (2) necesitas mandar recordatorios masivos a clientes pasivos (más de 256 a la vez); (3) quieres automatizar respuestas (FAQ, cotizaciones, agendar citas); (4) te interesa medir KPIs como tiempo de respuesta, conversión por asesor, etc.',
          'Si vendes en e-commerce con [carritos abandonados frecuentes](/blog/recuperar-carritos-abandonados-whatsapp), la API es prácticamente obligatoria — no puedes mandar plantilla automática desde la app.',
          'Si tienes [una clínica con citas a recordar](/crm-clinicas) o [una inmobiliaria con leads que entran por anuncios](/crm-inmobiliaria), la API te paga el costo en el primer mes solo por reducir no-shows y responder leads más rápido.',
        ],
      },
      {
        h: 'Alternativa híbrida: WhatsApp Web vinculado a CRM',
        p: [
          'Si todavía no quieres ir a la API formal pero ya te aprieta la app, hay una opción intermedia: conectar tu WhatsApp normal a un CRM vía **WhatsApp Web** (escaneando QR como en la PC). Esto te da CRM, multi-asesor y bots básicos sin pagar a Meta por mensaje.',
          'Wapi101 ofrece esto como **WhatsApp Lite**: escaneas QR, todos los mensajes entran al CRM, varios asesores trabajan en paralelo, puedes tener bots de respuesta. Limitación: WhatsApp puede limitarte si mandas demasiados mensajes nuevos por día (~200-300 a contactos que no te escribieron).',
          'Bueno para empezar. Cuando creces a +1000 mensajes/día o necesitas plantillas oficiales, migras a la API. Wapi101 te deja ambos canales en la misma bandeja.',
        ],
      },
      {
        h: '¿Qué CRM elegir según tu caso?',
        p: [
          '**Vendedor solo, <100 mensajes/día**: WhatsApp Business App gratuita es suficiente. No necesitas CRM por ahora.',
          '**Equipo 2-5 personas, 100-500 mensajes/día**: WhatsApp Lite + CRM ligero. Wapi101 plan Básico (MXN $149/mes) cubre esto. Comparativa en [/vs/kommo](/vs/kommo) y [/vs/manychat](/vs/manychat).',
          '**Equipo 5-20 personas, 500-5000 mensajes/día**: API formal + CRM con multi-asesor y plantillas. Wapi101 plan Pro (MXN $299/mes) o Ultra (MXN $499/mes).',
          '**Volumen alto (>10K mensajes/día) o e-commerce con catálogo**: API + integración con tu tienda (Shopify, WooCommerce). Aquí ya juegas con conexiones custom — visita [/developers](/developers).',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar la app gratuita y la API al mismo tiempo?', 'No con el mismo número. La API "se traga" el número y deja de funcionar en la app. Si quieres ambos canales, usa números distintos.'],
      ['¿La API reemplaza completamente a la app?', 'En features sí, pero la API requiere un CRM o sistema. Sin software detrás, no tienes UI para responder mensajes. Wapi101 te da esa UI.'],
      ['¿Cuándo conviene quedarme con la app?', 'Si eres 1-2 personas, menos de 100 mensajes/día, vendes 1-on-1 sin necesidad de automatizar. La app gratuita es perfecta — no pagues por API si no la necesitas.'],
      ['¿Cuánto cuesta migrar de la app a la API?', 'Setup gratis con Cloud API directo. Luego pagas a Meta por conversación (~USD $20-$50/mes en volumen típico de PyME) + el CRM (MXN $149-499/mes en Wapi101).'],
      ['¿Pierdo el historial de mensajes al migrar a la API?', 'Sí — Meta no copia tu historial de la app a la API. Si te importa el historial, exporta los chats antes (en la app: Configuración → Chats → Exportar) y guárdalos como referencia.'],
      ['¿La API soporta llamadas de voz/video?', 'No por ahora — solo mensajes. Para voz/video puedes usar links de Google Meet, Zoom o WhatsApp Calling Beta (que se está rolling out lento).'],
      ['¿Pueden mis clientes notar la diferencia?', 'Casi nada. Ven el mismo "perfil de empresa" con foto, descripción y opción de ver catálogo. La diferencia es interna en tu lado (multi-operador, bots, etc.).'],
      ['¿Qué pasa si quiero regresar de la API a la app?', 'Puedes "des-migrar" un número de la API de regreso a la app. Toma ~30 días e implica que pierdas las capacidades API durante ese tiempo. Casi nadie lo hace.'],
      ['¿Hay alguna versión intermedia entre la app y la API?', 'Sí, WhatsApp Lite (conectar WhatsApp Web normal a un CRM). Te da CRM, multi-asesor y bots sin pagar API. Bueno para arrancar. Lo ofrece Wapi101 desde MXN $149/mes.'],
      ['¿Puedo escalar de WhatsApp Lite a API formal sin cambiar de CRM?', 'En Wapi101 sí — el mismo workspace puede tener ambos canales conectados simultáneamente. Manejas un solo equipo de asesores que ve los chats de ambos.'],
    ],
    relatedSlugs: ['como-conectar-whatsapp-business-api', 'plantillas-whatsapp-business-guia', 'bots-whatsapp-pymes-ejemplos'],
  },

  // ───────────────────────────────────────────────────────────────────
  // 4. Carritos abandonados WhatsApp
  // ───────────────────────────────────────────────────────────────────
  'recuperar-carritos-abandonados-whatsapp': {
    slug: 'recuperar-carritos-abandonados-whatsapp',
    title: 'Carritos abandonados por WhatsApp: cómo recuperar 40% de ventas',
    description: 'Recuperar carritos abandonados por WhatsApp convierte 5-10x más que email. Timing exacto, plantillas aprobadas, integración Shopify y WooCommerce — ejemplos reales 2026.',
    keywords: 'recuperar carrito abandonado whatsapp, mensaje carrito abandonado plantilla, automatizar carritos abandonados shopify whatsapp, recuperar ventas perdidas whatsapp, ecommerce whatsapp recovery, woocommerce whatsapp carrito',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Estrategia',
    excerpt: 'Los emails de carrito abandonado convierten 1-3%. WhatsApp convierte 10-25% en promedio. Te explico el timing exacto, qué decir, qué NO decir y cómo automatizarlo con tu tienda Shopify o WooCommerce.',
    readingTime: '8 min',
    sections: [
      {
        h: 'Por qué WhatsApp convierte mejor que email',
        p: [
          'El email de carrito abandonado tiene una tasa de apertura del 40-50% en promedio (Mailchimp/Klaviyo benchmarks) y conversión del 1-3%. WhatsApp tiene **tasa de apertura del 95-98%** (Meta lo confirma con sus métricas internas) y conversión de carritos del **10-25%** según industria.',
          'La razón es simple: el email se mezcla con docenas de notificaciones diarias y termina en promociones de Gmail. WhatsApp llega al mismo chat donde tu cliente habla con su mamá. Es inmediato, personal, y abre.',
          'En e-commerce LATAM esto es brutal. Si tu tienda Shopify factura USD $10K/mes y tiene 65% de tasa de abandono (estándar Baymard), un buen flujo de WhatsApp puede recuperar USD $1.5K-$3K/mes adicionales sin costo de adquisición.',
        ],
      },
      {
        h: 'El timing exacto: cuándo mandar cada mensaje',
        p: [
          '**Mensaje 1: 15-30 minutos después del abandono.** Aún están en sesión de compra (probablemente en otra pestaña). Tono suave: "Hola {{1}}, vi que dejaste algunos productos en tu carrito. ¿Necesitas ayuda con algo?" Sin descuento todavía — la mayoría no lo necesita, solo el recordatorio.',
          '**Mensaje 2: 4-6 horas después.** Si no respondió al primero. Aquí ya puedes incluir incentivo suave: "Sigue ahí tu pedido por si quieres terminarlo 🛍️. Tienes envío gratis arriba de $499." Mantén el carrito por 48-72h sin caducar.',
          '**Mensaje 3: 24 horas después.** Último mensaje. Aquí sí incluyes urgencia real + descuento si tu margen lo permite: "Última llamada — guarda 10% con código TUNOMBRE10 hasta mañana." Si no convirtió ahora, no la fuerzas más.',
          'Mandar más de 3 mensajes baja la tasa de conversión y aumenta los reports de spam a Meta. Tres es el sweet spot.',
        ],
      },
      {
        h: 'Plantilla aprobada de carrito (copia y úsala)',
        p: [
          'Categoría: **Marketing** (la categoriza Meta automáticamente porque incluye CTA de compra).',
          'Body: *"Hola {{1}} 👋 ¿Olvidaste algo? Tu pedido de **{{2}}** sigue esperándote en tu carrito. Si necesitas ayuda para terminarlo, aquí estoy."*',
          'Botón de URL: *"Finalizar mi compra"* → `https://tutienda.com/checkout/{{cartId}}`',
          'Esta plantilla se aprueba en horas porque: no usa palabras "agresivas", el descuento NO está en el primer mensaje (eso causa rechazo si lo metes), tiene CTA limpio con URL completa (no shortener).',
          'Ejemplos completos para más industrias en [/crm-ecommerce](/crm-ecommerce).',
        ],
      },
      {
        h: 'Integración con Shopify (webhook + plantilla)',
        p: [
          'Shopify dispara un webhook `checkouts/create` cuando alguien empieza checkout y `checkouts/abandoned` cuando lo abandona (después de su threshold configurable, típicamente 10min). Configuras la URL del webhook hacia tu CRM.',
          'En Wapi101: Configuración → Webhooks entrantes → Conectar Shopify. Pegas el secret de Shopify, eliges qué eventos quieres escuchar. Cada `checkouts/abandoned` activa un bot que: (1) busca el contacto por email/teléfono, (2) crea conversación si no existe, (3) dispara el flujo de 3 mensajes con timing configurado.',
          'Si el usuario completa la compra (`orders/create`), el bot se cancela automáticamente — no se manda el resto de los mensajes de recuperación. Sin esto se ven malísimos.',
        ],
      },
      {
        h: 'Integración con WooCommerce',
        p: [
          'WooCommerce no tiene "abandoned checkout" nativo pero los plugins más usados (CartFlows, Abandoned Cart Lite, FunnelKit) sí lo exponen vía webhook o REST API.',
          'Otra opción: tracking del front-end. Un script en checkout que cuando alguien escribe email/teléfono en el formulario lo guarda en tu CRM como "checkout iniciado" con los items. Si pasan X minutos sin completar, dispara el flujo.',
          'En Wapi101 hay integración nativa con WooCommerce vía REST API (no hace falta plugin extra). Más detalles en [/crm-ecommerce](/crm-ecommerce) y en [/developers](/developers) si quieres custom.',
        ],
      },
      {
        h: 'Métricas a medir (los KPIs que importan)',
        p: [
          '**Tasa de apertura**: cuántos abrieron el primer mensaje. WhatsApp normal es 95-98%. Si baja de 90%, algo está roto (números desactualizados, mensaje en spam).',
          '**Tasa de respuesta**: cuántos respondieron algo (no compraron, pero contestaron). 20-30% es normal. Te da feedback orgánico ("ya lo compré en otro lado", "está muy caro", "envío tarda mucho").',
          '**Tasa de recuperación**: cuántos completaron la compra atribuible al mensaje. 10-25% es el rango típico. Por debajo de 5% revisas timing, copy o tu oferta.',
          '**Costo por recuperación**: cuánto pagaste a Meta en plantillas dividido entre las ventas recuperadas. En México, con plantilla marketing ~USD $0.030 cada una, si recuperas 1 de cada 10 envíos a USD $50 ticket promedio → ROI 167x.',
          'Wapi101 te muestra estos KPIs por defecto en el dashboard de bots. Si usas otro CRM, asegúrate de medirlos — sin medir no puedes optimizar.',
        ],
      },
      {
        h: 'Errores típicos que matan la conversión',
        p: [
          '**Mandar a contactos que no dieron consentimiento**: si no recolectaste el "OK para WhatsApp" en checkout, Meta te puede bajar la calidad del número rápido. Pon checkbox explícito en checkout: "Acepto recibir actualizaciones por WhatsApp" (default desmarcado para cumplir LFPDPPP en México).',
          '**Plantilla genérica sin nombre/producto**: "Tienes un carrito pendiente" sin nombre del cliente ni producto se siente impersonal. Las variables {{1}} y {{2}} son barato y sube conversión 2-3x.',
          '**Solo descuento, sin contexto**: empezar con "10% OFF!" sin recordar qué dejaron suena a spam. Primero recuerdas el carrito, después (si no responde) ofreces incentivo.',
          '**No respetar el "no me interesa"**: si responden "no gracias" o "ya compré en otro lado", **detén el flujo**. Mandar otro mensaje después de eso es lo que más reports genera.',
        ],
      },
      {
        h: 'Más allá del carrito: secuencias post-venta',
        p: [
          'El mismo motor que usas para carritos abandonados sirve para: confirmación de envío (utility, gratis si está en categoría correcta), encuesta NPS 7 días post-entrega, reactivación a 30/60/90 días sin compra, cumpleaños del cliente con cupón.',
          'Estas secuencias compuestas son las que llevan un negocio de USD $10K/mes a USD $25K/mes sin gastar más en ads. La diferencia: tu lista de clientes en WhatsApp es 10x más valiosa que tu lista de email.',
          'Ejemplos completos de cada flujo en [Bots WhatsApp para PyMEs: 10 ejemplos](/blog/bots-whatsapp-pymes-ejemplos).',
        ],
      },
    ],
    faqs: [
      ['¿Es legal mandar mensajes de WhatsApp a clientes en México?', 'Sí siempre que tengas consentimiento. La LFPDPPP exige aviso de privacidad y opt-in explícito. En checkout incluye checkbox "Acepto WhatsApp" desmarcado por default. Sin esto te pueden multar.'],
      ['¿Cuánto cuesta mandar plantillas de carrito abandonado?', 'En México ~USD $0.030 por conversación (categoría marketing). Si recuperas 1 de cada 10 envíos a USD $50 ticket, ROI ~167x. Cualquier número arriba de 5% de recovery rate justifica el gasto.'],
      ['¿Qué pasa si el cliente ya no tiene WhatsApp activo?', 'Meta te devuelve error en el webhook (estado `failed`). Tu CRM lo marca como "inactivo" y no le manda más. No te cobran por mensajes fallidos.'],
      ['¿Puedo recuperar carritos sin la API formal (solo WhatsApp Lite)?', 'Técnicamente sí pero no puedes mandar a usuarios que no te escribieron antes. WhatsApp Lite/Web bloquea ese flujo. Para carritos abandonados de gente nueva → necesitas API.'],
      ['¿Cuál es el tiempo ideal del primer mensaje?', '15-30 minutos. Antes es invasivo (siguen en checkout), después se enfrían. La mayoría de e-commerce usa 20min como default y funciona bien.'],
      ['¿Cómo evito que Meta categorice como spam?', 'No uses mayúsculas excesivas, no más de 3 mensajes por carrito, respeta unsubscribe inmediatamente, manda solo a opt-in real. Mantén tu rating de calidad en "alta" — si baja, pausa campañas y revisa.'],
      ['¿Funciona con Mercado Libre o tiendas de marketplace?', 'No directo — esos no te dan datos del cliente para WhatsApp. Funciona con tu tienda propia (Shopify, WooCommerce, Tiendanube, custom).'],
      ['¿Y si mi e-commerce no tiene API webhook nativo?', 'Casi todos los gestores modernos los tienen. Si tu plataforma es muy custom, puedes usar Zapier/Make como bridge: Shopify → Zapier → Wapi101 API. Hay docs en [/developers](/developers).'],
      ['¿Cuántos mensajes son demasiados?', 'Más de 3 mensajes por carrito sube reports de spam. La regla: 15min, 4-6h, 24h. Después déjalo morir. Re-engagement por otros canales (email, retargeting) si quieres seguir.'],
      ['¿Debo incluir descuento siempre?', 'No. El primer mensaje sin descuento convierte mejor de lo que crees (40-50% de la conversión total). Solo agregas descuento en el 2do/3er mensaje si no han respondido. Hacer descuento desde el primer mensaje "entrena" al cliente a abandonar carritos esperando promo.'],
    ],
    relatedSlugs: ['bots-whatsapp-pymes-ejemplos', 'plantillas-whatsapp-business-guia', 'como-conectar-whatsapp-business-api'],
  },

  // ───────────────────────────────────────────────────────────────────
  // 5. Bots WhatsApp ejemplos
  // ───────────────────────────────────────────────────────────────────
  'bots-whatsapp-pymes-ejemplos': {
    slug: 'bots-whatsapp-pymes-ejemplos',
    title: 'Bots de WhatsApp para PyMEs: 10 ejemplos que funcionan (2026)',
    description: '10 bots de WhatsApp con flujos reales para PyMEs en México: bienvenida, catálogo, citas, FAQ, recuperación. Plantillas listas, sin necesidad de programar.',
    keywords: 'bot whatsapp ejemplos, bots whatsapp pymes mexico, chatbot whatsapp negocio, ejemplos flujos whatsapp, automatizar whatsapp pyme, bot whatsapp restaurantes clinicas',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Estrategia',
    excerpt: 'No todos los bots son útiles. Aquí 10 flujos concretos que funcionan en PyMEs reales de México y LATAM — con el paso a paso del flujo y la plantilla aprobada que necesitas para cada uno.',
    readingTime: '12 min',
    sections: [
      {
        h: '1. Bot de bienvenida + calificación de lead',
        p: [
          '**Cuándo se dispara**: primer mensaje de un contacto nuevo. **Para qué sirve**: presentarte, capturar info básica y dirigir al humano correcto.',
          'Flujo: (1) "Hola, soy [Bot], ayudante de [Negocio]. ¿Cómo te puedo ayudar?" con 3 botones: "Ver productos", "Cotizar", "Tengo una duda"; (2) según botón, hace preguntas de calificación (¿qué buscas? ¿cuándo?); (3) según respuesta asigna al asesor correcto o entra a otro bot.',
          'Tasa de respuesta típica: 70-85%. El bot baja la carga del equipo en 40-60% para preguntas repetidas.',
        ],
      },
      {
        h: '2. Bot de catálogo automático',
        p: [
          '**Cuándo**: el cliente escribe "catálogo", "menú" o "qué tienen". **Para qué sirve**: enviar productos sin que un asesor humano arme respuesta.',
          'Flujo: si tu tienda tiene catálogo de WhatsApp Business sincronizado, el bot manda la lista. Si no, manda un PDF/imagen + link a tu sitio. Botones de respuesta: "Ver producto X", "Hablar con vendedor".',
          'Útil para [restaurantes](/crm-restaurantes) (mandar menú), tiendas físicas (catálogo), distribuidoras (lista de precios para mayoristas).',
        ],
      },
      {
        h: '3. Bot de reserva de cita',
        p: [
          '**Cuándo**: el cliente dice "quiero agendar", "cita", "reservar". **Para qué sirve**: agendar sin que nadie lo agende manualmente.',
          'Flujo: (1) "¿Para qué día?" con botones [hoy / mañana / esta semana / elegir fecha]; (2) según respuesta, muestra horarios disponibles del asesor o servicio elegido; (3) confirma con plantilla utility "Cita confirmada para el {{1}} a las {{2}}. Te recordamos 24h antes."',
          'Esencial para [clínicas](/crm-clinicas), salones de belleza, mecánicos, [inmobiliarias](/crm-inmobiliaria) (visitas a propiedad). Reduce no-shows 30-50% con el recordatorio automático.',
        ],
      },
      {
        h: '4. Bot de FAQ con escalado a humano',
        p: [
          '**Cuándo**: preguntas frecuentes ("horario", "ubicación", "envíos", "garantía"). **Para qué sirve**: responder en segundos a 60-70% de las dudas comunes.',
          'Flujo: detecta keyword en el mensaje (horario, ubicación, etc.) y responde con info pre-cargada. Si no detecta nada → "No te entendí, te paso con un humano" → asigna al asesor disponible.',
          'Vital: NUNCA dejes un FAQ que entre en loop sin opción de "hablar con humano". Si el cliente se frustra, lo pierdes.',
        ],
      },
      {
        h: '5. Bot de recuperación de carrito abandonado',
        p: [
          '**Cuándo**: webhook de tu e-commerce dispara abandono. **Para qué sirve**: convertir el 10-25% de carritos perdidos.',
          'Flujo de 3 mensajes con timing 15min/4h/24h. Detalle completo en [Recuperar carritos por WhatsApp](/blog/recuperar-carritos-abandonados-whatsapp).',
          'Si el cliente completa la compra en cualquier momento, el bot se cancela solo — esto requiere webhook bidireccional con tu tienda.',
        ],
      },
      {
        h: '6. Bot de confirmación de pedido + tracking',
        p: [
          '**Cuándo**: cliente acaba de comprar (webhook `orders/create`). **Para qué sirve**: bajar consultas de "¿dónde está mi pedido?"',
          'Flujo: (1) plantilla utility "Pedido #{{1}} confirmado. Total: ${{2}}. Te avisamos cuando salga"; (2) cuando el pedido cambia a `shipped`, manda plantilla con número de guía y link de tracking; (3) cuando llega a `delivered`, manda "¿Cómo fue todo?" con botones [Bien / Mal].',
          'Si el cliente responde "Mal" → asigna a soporte humano. Si "Bien" → manda link de Google Review (post 3 días para no ser invasivo).',
        ],
      },
      {
        h: '7. Bot de encuesta NPS post-venta',
        p: [
          '**Cuándo**: 7 días después de entrega/servicio. **Para qué sirve**: medir satisfacción + cazar reviews para Google.',
          'Flujo: (1) "¿Del 0 al 10, qué tan probable es que recomiendes [Negocio]?"; (2) si 9-10 → "Genial, ¿nos dejas review aquí?" con link Google; (3) si 7-8 → "¿Qué pudimos mejorar?" → guarda respuesta; (4) si 0-6 → asigna a manager para llamada de recuperación.',
          'Promedio: convierte 8-15% de los 9-10 en reviews públicas. Suma a tus estrellas de Google de forma orgánica.',
        ],
      },
      {
        h: '8. Bot de calificación y derivación de leads',
        p: [
          '**Cuándo**: lead nuevo entra por anuncio de Facebook/Instagram con click-to-WhatsApp. **Para qué sirve**: filtrar leads buenos de malos antes de que el vendedor pierda tiempo.',
          'Flujo: hace 3-5 preguntas (¿qué producto? ¿cuándo lo necesitas? ¿presupuesto?). Según respuestas, asigna score: alto → al mejor vendedor; medio → cola general; bajo → bot envía info y deja seguimiento automático.',
          'Esencial para [inmobiliarias](/crm-inmobiliaria) (filtra curiosos vs compradores reales), distribuidoras (mayorista vs detalle), B2B.',
        ],
      },
      {
        h: '9. Bot de cobranza amigable',
        p: [
          '**Cuándo**: factura vencida X días. **Para qué sirve**: recordar pago sin que nadie tenga que hacerlo manual.',
          'Flujo: día 1 después de vencimiento → "Hola {{1}}, te recordamos que tu factura #{{2}} por ${{3}} vence hoy"; día 3 → "Hola, sigue pendiente la factura #{{2}}, ¿necesitas link de pago?" con botón al checkout; día 7 → asigna a humano si sigue sin pagar.',
          'Plantilla categoría utility (es transaccional, no marketing). Costo bajo. Reduce días de cuentas por cobrar 30-50% en B2B.',
        ],
      },
      {
        h: '10. Bot de reactivación de clientes inactivos',
        p: [
          '**Cuándo**: cliente sin comprar hace 60-90 días. **Para qué sirve**: rescatar la base que ya tienes (mucho más barato que adquirir nuevos).',
          'Flujo (plantilla marketing): "Hola {{1}}, te extrañamos 😊 Hace tiempo no te vemos. Tenemos {{2}}% off en {{3}}. ¿Te interesa?" con botones [Sí, ver / Más tarde / No me interesa].',
          'Si responde "No me interesa" → marca como opt-out, no le mandes más. Si "Más tarde" → reagenda 60 días. Si "Sí" → asigna a vendedor con todo el contexto.',
          'Conversión típica: 3-8%. Sobre una base de 1000 inactivos a USD $50 ticket promedio → USD $1.5K-4K rescatados al mes.',
        ],
      },
      {
        h: 'Cómo armar estos bots sin programar',
        p: [
          'Todos estos bots están construibles en Wapi101 con el **bot builder visual** (drag & drop, sin código). Cada paso del flujo es un nodo: condición, mensaje, esperar respuesta, asignar etiqueta, etc. Te lo arrastras al canvas y conectas con líneas.',
          'Las plantillas (que algunos bots requieren) las creas en la sección Plantillas y mandas a aprobación a Meta — proceso explicado en [Plantillas WhatsApp Business: guía completa](/blog/plantillas-whatsapp-business-guia).',
          'Si quieres ver una vista previa, [pruébalo 14 días gratis](/signup). Hay templates pre-armados de cada uno de estos 10 bots para que solo personalices texto.',
        ],
      },
    ],
    faqs: [
      ['¿Necesito API formal para todos estos bots?', 'Para los que mandan mensaje primero (carrito, cobranza, reactivación, encuesta NPS): sí. Para los que solo responden cuando el cliente escribe (bienvenida, catálogo, FAQ, agendar): puedes hacerlo con WhatsApp Lite.'],
      ['¿Cuántos bots puedo tener simultáneos?', 'En Wapi101 no hay límite. Lo común es 3-8 bots activos en una PyME mediana. Más allá de eso se vuelve difícil de mantener.'],
      ['¿Los bots reemplazan al humano?', 'No. La mejor configuración es bot + humano: el bot filtra/responde lo repetitivo, el humano cierra ventas y maneja casos delicados. Siempre deja opción "hablar con humano" en cada bot.'],
      ['¿Se pueden conectar bots con IA tipo ChatGPT?', 'Sí. Wapi101 tiene step "AI Reply" que llama a GPT-4 / Claude con el historial del chat y responde. Útil cuando el cliente hace pregunta no anticipada. Cuesta tokens de OpenAI/Anthropic aparte.'],
      ['¿Qué pasa si el cliente responde algo no esperado?', 'Cada paso "wait_response" tiene timeout y fallback. Si pasa el timeout o la respuesta no matchea ninguna condición, el flujo va a la rama "default" (típicamente: asignar a humano).'],
      ['¿Los bots funcionan en Messenger e Instagram también?', 'Sí — Wapi101 tiene los 4 canales (WhatsApp, Messenger, Instagram, Telegram) en la misma bandeja. Un mismo bot puede dispararse en cualquiera.'],
      ['¿Cuánto tarda armar el primer bot?', '15-30 minutos para uno básico (bienvenida + FAQ). 1-2 horas para uno complejo con condiciones (calificación de leads, recuperación de carrito).'],
      ['¿Puedo importar bots de Kommo o ManyChat?', 'No directo — los formatos son distintos. Pero en Wapi101 el [Data Center](/signup) permite importar contactos y plantillas. El bot lo armas desde cero, que suele ser oportunidad de simplificarlo.'],
      ['¿Los bots se pueden A/B testear?', 'Sí, puedes tener dos bots con el mismo trigger en 50/50 y comparar conversión. Útil para optimizar copy y timing.'],
      ['¿Hay plantillas pre-armadas?', 'Sí, Wapi101 trae 10 templates iniciales (los 10 de este artículo) que puedes copiar y personalizar. Cobre 14 días gratis para probarlos.'],
    ],
    relatedSlugs: ['plantillas-whatsapp-business-guia', 'recuperar-carritos-abandonados-whatsapp', 'whatsapp-business-vs-api-diferencias'],
  },

  // ───────────────────────────────────────────────────────────────────
  // 6. Cloud API vs Twilio
  // ───────────────────────────────────────────────────────────────────
  'whatsapp-cloud-api-vs-twilio': {
    slug: 'whatsapp-cloud-api-vs-twilio',
    title: 'WhatsApp Cloud API vs Twilio: cuál elegir en 2026 (comparativa)',
    description: 'Diferencias entre WhatsApp Cloud API (Meta directo) y Twilio (BSP): precios reales por mensaje, latencia, features y cuándo conviene cada uno en 2026.',
    keywords: 'whatsapp cloud api vs twilio, whatsapp cloud api precio, twilio whatsapp mexico, bsp whatsapp comparacion, alternativa a twilio whatsapp, meta cloud api ventajas',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Comparativas',
    excerpt: 'Twilio fue durante años la opción default para WhatsApp Business API. En 2026, Cloud API de Meta directo cambió el juego: cobra menos, configura más rápido, mismo SLA. Aquí cuándo sigue valiendo Twilio y cuándo no.',
    readingTime: '8 min',
    sections: [
      {
        h: 'Contexto: cómo era hasta 2023',
        p: [
          'Antes de mayo 2022, WhatsApp Business API solo se podía consumir a través de un **BSP** (Business Solution Provider): Twilio, 360dialog, MessageBird, Vonage, Infobip, etc. Eran intermediarios que hospedaban tu conexión a la API de Meta y cobraban un margen por mensaje + cuotas mensuales.',
          'En esa era, Twilio era la opción "más segura" por su madurez, SDK pulido, soporte y compliance (SOC 2, HIPAA, ISO). Para empresas grandes valía la pena pagar USD $0.005-$0.010 extra por mensaje encima del costo de Meta.',
          'Eso cambió cuando Meta lanzó **Cloud API**: el mismo servicio API pero hospedado por Meta directo, sin BSP. Setup gratis, latencia más baja, sin margen extra.',
        ],
      },
      {
        h: 'WhatsApp Cloud API: la opción directa',
        p: [
          'Cloud API es **Meta hospedando la conexión** a la API. Tu CRM (Wapi101) habla directo con `graph.facebook.com`. No hay tercero entre tú y Meta.',
          'Costos: solo lo que cobra Meta por conversación. En México: USD $0.012 (utility), USD $0.030 (marketing), USD $0.0035 (auth). Cero setup fee, cero mensualidad fija.',
          'Activación: 10-30 minutos siguiendo la guía de [Cómo conectar WhatsApp Business API](/blog/como-conectar-whatsapp-business-api). Sin esperar aprobación de un BSP.',
          'Esta es la opción que conecta Wapi101 por defecto.',
        ],
      },
      {
        h: 'Twilio: cuándo todavía conviene',
        p: [
          'Twilio agrega ~USD $0.005-$0.010 por mensaje encima del costo de Meta, más cuota mensual variable. Para un envío de 5K mensajes/mes en México, el sobrecosto Twilio puede ser USD $25-$50/mes extra vs Cloud API directo.',
          'Razones legítimas para pagar ese extra: (1) ya tienes contratos enterprise con Twilio para SMS o voz y quieres consolidar facturación; (2) necesitas SMS como **fallback** automático cuando WhatsApp no entrega (Twilio gestiona esto nativo); (3) tu compliance interno exige un proveedor con certificaciones específicas (HIPAA strict mode, SOC 2 Type 2 dedicado, contrato BAA, etc.); (4) necesitas integraciones con Twilio Studio (no-code visual builder) que ya tienes armadas.',
          'Si no marca ninguna de esas, casi seguro Cloud API directo te conviene.',
        ],
      },
      {
        h: 'Comparativa de costos reales (México, 10K conversaciones/mes)',
        p: [
          '**Cloud API directo + Wapi101**: solo pagas Meta. 10K conversaciones tipo utility = 10K × USD $0.012 = **USD $120/mes**. Más Wapi101 plan Pro USD ~$17/mes (MXN $299). **Total: ~USD $137/mes**.',
          '**Twilio + Wapi101 (o cualquier CRM)**: pagas Meta + margen Twilio + cuotas. 10K × (USD $0.012 + USD $0.0075) = USD $195/mes. Plus Twilio monthly minimum ~USD $25. Más el CRM USD $17/mes. **Total: ~USD $237/mes**.',
          'Diferencia: **~USD $100/mes** (~MXN $2,000/mes). En un año son USD $1,200 (MXN $24,000) que se quedan en tu bolsillo en lugar del intermediario.',
          'Estos números asumen volumen "mediano". A volumen alto (>100K conv/mes), la diferencia escala lineal y se vuelve significativa.',
        ],
      },
      {
        h: 'Diferencias técnicas y features',
        p: [
          '**Latencia**: Cloud API directo es ~50-150ms más rápido en LATAM (un hop menos). Twilio agrega un round-trip a sus servidores. Para conversaciones humanas no se nota, para bots con muchos pasos sí.',
          '**SDKs**: Twilio tiene SDKs muy pulidos en 10+ lenguajes (Node, Python, Ruby, PHP, .NET, Java, etc.) con docs y ejemplos detallados. Meta tiene Graph API que es estándar HTTP — más simple pero menos hand-holding.',
          '**Twilio Studio**: visual builder propio (parecido al bot builder de Wapi101). Si ya tienes flujos armados ahí, migrar a Cloud API directo implica rearmarlos. En Wapi101 ese paso es trivial — el bot builder visual está incluido.',
          '**Soporte**: Twilio tiene soporte enterprise 24/7 con SLA contratado (en planes pagados). Meta tiene soporte limitado para Cloud API (mejorando rápido). Para una PyME, el soporte del CRM (Wapi101 hablamos español MX) suele resolver más rápido que cualquier ticket de BSP.',
        ],
      },
      {
        h: 'Otras alternativas a Twilio (no solo Cloud API)',
        p: [
          'Si Cloud API te queda corto pero Twilio te parece caro, hay BSPs intermedios: **360dialog** (alemán, popular en LATAM, USD $50/mes flat + sin margen por mensaje), **MessageBird** (holandés, pricing parecido a Twilio), **Gupshup** (indio, agresivo en precio para volumen alto).',
          'Pero en 2026 el caso de uso de un BSP es cada vez más estrecho. Si quieres una comparativa con plataformas completas (no solo BSP), revisa [vs/respond-io](/vs/respond-io) y [vs/sleekflow](/vs/sleekflow) que son CRMs completos basados en Cloud API directo.',
        ],
      },
      {
        h: 'Cómo migrar de Twilio a Cloud API directo',
        p: [
          'Si tienes Twilio activo y quieres bajar costos: (1) toma backup de tu cuenta Twilio (números, plantillas activas); (2) en Meta Business Manager toma posesión directa de tu WABA — Twilio tiene que "release" tu WABA para esto; (3) genera nuevo token desde Cloud API; (4) actualiza credenciales en tu CRM o sistema.',
          'El número telefónico se mantiene — no necesitas comprar otro ni avisar a clientes. Los chats activos se preservan.',
          'Wapi101 incluye una guía paso a paso para migrar desde Twilio o cualquier BSP. Si estás en este caso, contáctanos antes y te ayudamos a hacer la migración sin downtime.',
        ],
      },
    ],
    faqs: [
      ['¿Cloud API tiene las mismas features que Twilio?', 'Para 95% de casos sí. Diferencias: Twilio tiene SDKs más pulidos, Twilio Studio, integración SMS fallback, certificaciones específicas. Cloud API es más simple y barato. Para PyMEs LATAM, Cloud API es suficiente.'],
      ['¿Puedo tener Cloud API y Twilio al mismo tiempo?', 'No con el mismo número de teléfono. Si quieres ambos, usa números distintos. La mayoría no necesita ambos — uno u otro.'],
      ['¿Cloud API soporta multimedia y plantillas igual que Twilio?', 'Sí, todas las features de WhatsApp Business funcionan igual (multimedia, plantillas, botones, listas, location). La diferencia está en la capa de servicio, no en lo que puedes mandar.'],
      ['¿Cuánto se ahorra al cambiarse de Twilio a Cloud API?', 'Depende del volumen. A 10K conv/mes en México: ~USD $100/mes (MXN $2K). A 100K: ~USD $1,000/mes. A 1M: ~USD $10K/mes. El ahorro escala lineal.'],
      ['¿Cloud API tiene SLA garantizado?', 'Meta ofrece 99.9% uptime para Cloud API. Twilio ofrece 99.99% (con SLA contratado en planes Enterprise). Para PyMEs la diferencia es 4 minutos extra de downtime al mes — irrelevante.'],
      ['¿Twilio tiene mejor soporte?', 'Twilio tiene soporte 24/7 con SLA en sus planes pagados. Meta Cloud API tiene soporte estándar (mejorando). Si compras un CRM como Wapi101, el soporte del CRM (en español MX) es lo que más usas — no el del BSP.'],
      ['¿Cloud API tiene rate limits diferentes?', 'No, los rate limits son los mismos porque dependen del "tier" de tu número en Meta (no del proveedor). Tier 1: 1K conv únicas/día. Sube automático a Tier 2 (10K), Tier 3 (100K) y "ilimitado" según calidad.'],
      ['¿Necesito un developer para usar Cloud API?', 'No si usas un CRM que ya lo integra (como Wapi101). Si quieres custom, sí — pero las docs de Meta son razonables. Para devs: [/developers](/developers).'],
      ['¿Twilio cobra por número telefónico?', 'Sí, Twilio cobra ~USD $1/mes por número de WhatsApp Business + costos por mensaje. Cloud API directo no cobra por número (solo paga Meta por conversación).'],
      ['¿Cuál tiene mejor latencia?', 'Cloud API directo es ~50-150ms más rápido por tener un hop menos. Para chats humanos imperceptible, para bots de muchos pasos sí se nota.'],
    ],
    relatedSlugs: ['como-conectar-whatsapp-business-api', 'whatsapp-business-vs-api-diferencias', 'plantillas-whatsapp-business-guia'],
  },

  // ─── Placeholder safety — mantén este al final ───
  '_placeholder': {
    slug: '_placeholder',
    title: 'Placeholder — no listar',
    description: '',
    keywords: '',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    author: 'Equipo Wapi101',
    category: 'Guías',
    excerpt: '',
    readingTime: '5 min',
    sections: [{ h: 'Placeholder', p: ['Este es un placeholder.'] }],
    faqs: [],
    hidden: true,
  },

};

module.exports = { POSTS };
