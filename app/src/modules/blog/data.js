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
    relatedSlugs: ['mejores-plataformas-whatsapp-business-api-latam', 'whatsapp-business-vs-api-diferencias', 'whatsapp-cloud-api-vs-twilio'],
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
      ['¿Wapi101 cobra extra por plantillas?', 'No. Pagas solo lo que cobra Meta directamente (Wapi101 usa Cloud API, sin margen extra). En tu reporte ves el costo real por conversación. Puedes verlo en [precios](/#pricingSection).'],
    ],
    relatedSlugs: ['evitar-bloqueo-whatsapp-business-mensajes-masivos', 'como-conectar-whatsapp-business-api', 'bots-whatsapp-pymes-ejemplos'],
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
    relatedSlugs: ['whatsapp-business-multiagente-varios-usuarios', 'como-conectar-whatsapp-business-api', 'mejores-plataformas-whatsapp-business-api-latam'],
  },

  // ───────────────────────────────────────────────────────────────────
  // 4. Carritos abandonados WhatsApp
  // ───────────────────────────────────────────────────────────────────
  'recuperar-carritos-abandonados-whatsapp': {
    slug: 'recuperar-carritos-abandonados-whatsapp',
    title: 'Carritos abandonados por WhatsApp: cómo recuperar 40% de ventas',
    description: 'Cómo recuperar carritos abandonados por WhatsApp: mensajes que sí convierten, tiempos de envío, plantillas aprobadas y automatización con tu tienda.',
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
    relatedSlugs: ['chatbot-whatsapp-con-ia-para-negocios', 'plantillas-whatsapp-business-guia', 'como-conectar-whatsapp-business-api'],
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
    relatedSlugs: ['mejores-plataformas-whatsapp-business-api-latam', 'como-conectar-whatsapp-business-api', 'whatsapp-business-vs-api-diferencias'],
  },

  // ─── Placeholder safety — mantén este al final ───
  // ───────────────────────────────────
  // 7. Ranking de plataformas de WhatsApp Business API (2026-09-28)
  // Origen: Search Console mostró que las impresiones de wapi101 vienen de
  // búsquedas tipo IA ("compara hubspot con twilio, infobip y 360dialog…
  // ranking de mejor a peor") donde salíamos en pos 6-11 con /vs/hubspot.
  // Este artículo responde exactamente esa pregunta.
  // ───────────────────────────────────
  'mejores-plataformas-whatsapp-business-api-latam': {
    slug: 'mejores-plataformas-whatsapp-business-api-latam',
    title: 'Mejores plataformas de WhatsApp Business API en LATAM (2026)',
    description: 'Ranking de mejor a peor: Twilio, Infobip, 360dialog, Botmaker, HubSpot, Vonage, Bird y Wapi101. Precios reales y cuál elegir en México y LATAM.',
    keywords: 'mejores plataformas whatsapp business api, twilio vs infobip vs 360dialog, botmaker vs hubspot whatsapp, ranking whatsapp api latam, proveedor whatsapp business api mexico, bsp whatsapp latam',
    publishedAt: '2026-09-28',
    updatedAt: '2026-09-28',
    author: 'Equipo Wapi101',
    category: 'Comparativas',
    excerpt: 'Ocho plataformas para conectar WhatsApp Business API, ordenadas de mejor a peor según para quién son, cuánto cuestan de verdad y qué tan rápido las tienes andando en LATAM.',
    readingTime: '8 min',
    sections: [
      {
        h: 'Cómo armamos este ranking (y por qué no hay una sola ganadora)',
        p: [
          'Cuando alguien busca "compara Twilio con Infobip y 360dialog para la API de WhatsApp" lo que quiere es una respuesta directa: cuál es mejor. La respuesta honesta es que **depende de tu tamaño y de si tienes desarrolladores**. Un banco con 200 agentes y una tienda de 3 personas no deberían usar la misma herramienta, aunque las dos manden WhatsApps.',
          'Así que ordenamos las 8 plataformas de mejor a peor **para cada perfil**, y al final hay un ranking general con criterios explícitos: costo real por conversación (no solo el precio de lista), tiempo hasta el primer mensaje, si necesitas programar, soporte en español y en horario de LATAM, y qué tan atado quedas al proveedor.',
          'Somos Wapi101, un CRM para WhatsApp, así que tenemos interés en esto. Por eso las categorías donde otra plataforma es claramente mejor lo decimos sin rodeos. Si buscas la comparación técnica a fondo entre Cloud API y Twilio, ya la escribimos en [WhatsApp Cloud API vs Twilio](/blog/whatsapp-cloud-api-vs-twilio).',
        ],
      },
      {
        h: 'Primero: BSP, CRM o API directa — son cosas distintas',
        p: [
          'La confusión más común: comparar peras con manzanas. Hay tres tipos de plataforma en esta lista.',
          '**API directa (Meta Cloud API).** Meta te da la API gratis; pagas solo los mensajes de plantilla que envías (desde julio de 2025 Meta cobra por mensaje según la categoría: marketing, utilidad o autenticación; responder dentro de la ventana de 24 horas no cuesta). No hay intermediario, pero tampoco hay interfaz: necesitas un software que la use. [Cómo conectarla paso a paso](/blog/como-conectar-whatsapp-business-api).',
          '**BSP (Business Solution Provider): Twilio, Infobip, 360dialog, Vonage, MessageBird.** Revenden la API con una capa técnica encima. Cobran una comisión por mensaje o una cuota mensual, y están hechos para que tu equipo de desarrollo construya sobre ellos. Sin desarrolladores, un BSP solo te da una llave que no sabes usar.',
          '**CRM con WhatsApp: HubSpot, Botmaker, Wapi101.** Software terminado: inbox, bots, pipeline, equipo. Se conectan a la Cloud API (o a un BSP) por debajo. Aquí no programas nada. La diferencia entre ellos está en el precio, en qué tan completo es el CRM, y en si fueron hechos para LATAM o adaptados después.',
        ],
      },
      {
        h: 'El ranking, de mejor a peor',
        p: [
          '**1. Meta Cloud API directa + un CRM que la use.** La mejor relación costo/control para el 80% de los negocios en 2026. Cero comisión de intermediario, la API oficial, y eliges el software encima. La desventaja es que Meta no da soporte humano: si algo falla, tu CRM tiene que saber leer los errores de Meta. (Es nuestra categoría, y también la de Botmaker o de cualquier CRM serio.)',
          '**2. 360dialog.** El BSP más barato y transparente: cuota mensual fija (desde ~$50 USD) y sin comisión por mensaje. Si tienes un desarrollador, es la forma más limpia de tener la API con soporte humano. Si no lo tienes, no te sirve solo.',
          '**3. Twilio.** El estándar para desarrolladores: la mejor documentación del mercado, SDKs en todos los lenguajes, y escala infinita. Cobra ~$0.005 USD por mensaje encima de lo de Meta, y la consola está en inglés. Perfecto para una empresa de software; excesivo para una tienda.',
          '**4. Infobip.** Enterprise: omnicanal (WhatsApp, SMS, RCS, email, voz), oficinas en LATAM, contratos anuales y precios que se negocian. Si mandas millones de mensajes al mes y tienes un área de TI, está entre las mejores. Si eres PyME, ni te van a contestar rápido.',
          '**5. Botmaker.** El competidor directo hecho en LATAM (Argentina) para empresas medianas y grandes: bots muy completos, integraciones con e-commerce, soporte en español. El precio es de nivel enterprise (cientos de dólares al mes) y la curva de aprendizaje es real. Buena opción si ya tienes 20+ agentes.',
          '**6. HubSpot con WhatsApp.** Excelente CRM… donde WhatsApp es un añadido. La integración nativa llegó tarde, requiere planes Marketing/Service de pago, y las conversaciones de WhatsApp viven en un rincón del CRM, no al centro. Si ya pagas HubSpot, úsalo. Si estás eligiendo por WhatsApp, hay mejores. [Wapi101 vs HubSpot](/vs/hubspot).',
          '**7. Vonage (antes Nexmo).** Un BSP sólido, orientado a voz y SMS, con WhatsApp como uno más de sus canales. Documentación buena, precios parecidos a Twilio, menos comunidad en español. No hay una razón fuerte para elegirlo sobre Twilio salvo que ya lo uses para llamadas.',
          '**8. MessageBird (ahora Bird).** Cambió de nombre, de precios y de enfoque varias veces en dos años; hoy empuja su propia suite de marketing. Funciona, pero la inestabilidad del rumbo lo pone al final: no conviene construir tu operación sobre una plataforma que no sabes cómo se llamará el año que entra.',
        ],
      },
      {
        h: 'Si eres una PyME en México o LATAM',
        p: [
          'Descarta los BSP puros (Twilio, Infobip, Vonage, Bird): son llaves para desarrolladores, y tú necesitas un software que ya funcione. Descarta también las suites enterprise si tienes menos de 10 personas atendiendo.',
          'Lo que buscas es un CRM que se conecte **directo a la Cloud API** (sin comisión por mensaje), que tenga inbox compartido, pipeline y bots sin código, y que su soporte hable tu idioma y esté en tu horario. Eso es exactamente lo que construimos en [Wapi101](/crm-whatsapp-business): gratis para empezar y desde MXN $149 al mes (unos 9 USD), con la API de Meta directa o tu número por QR si todavía no tienes la API aprobada.',
          'Costo real de ejemplo para una tienda que manda 1,500 mensajes de plantilla al mes: con Twilio + un CRM aparte pagas los mensajes de Meta, más la comisión de Twilio, más el CRM. Con un CRM conectado directo pagas los mensajes de Meta y el CRM. La diferencia no es enorme al mes, pero se multiplica al escalar — y sobre todo, es una factura menos y un proveedor menos que puede fallar.',
        ],
      },
      {
        h: 'Si eres empresa mediana o grande',
        p: [
          'Con equipo de TI: **360dialog o Twilio** como capa de API, y construyes o compras el software encima. Es la arquitectura más flexible y la que menos te ata.',
          'Sin ganas de construir: **Botmaker** si necesitas bots muy sofisticados y ya operas en LATAM a escala; **Infobip** si tu operación es omnicanal y multinacional. Pide precios reales antes de decidir: los dos negocian.',
          'Y un consejo que aplica a cualquiera: el número de WhatsApp está atado a tu cuenta de Meta (WABA), no al proveedor. [Puedes cambiar de plataforma sin perder el número](/blog/whatsapp-business-vs-api-diferencias) — así que no firmes un contrato anual por miedo a quedarte sin línea.',
        ],
      },
      {
        h: 'Los errores que vemos al elegir',
        p: [
          '**Elegir por el precio de lista.** El costo real es Meta + proveedor + software + horas de tu equipo. Un BSP "barato" con 40 horas de desarrollo no es barato.',
          '**Ignorar el soporte.** Cuando Meta rechaza una plantilla o pausa tu número por calidad, necesitas a alguien que entienda el error en minutos, no un ticket en inglés que responden en 48 horas. Pregunta antes de contratar: ¿en qué idioma, en qué horario, y por qué canal?',
          '**Comprar el enterprise antes de tiempo.** Empieza con lo que puedas tener funcionando esta semana. Migrar después es más fácil de lo que parece, porque el número es tuyo.',
        ],
      },
    ],
    faqs: [
      ['¿Cuál es la mejor plataforma de WhatsApp Business API en 2026?', 'No hay una para todos. Para PyMEs en LATAM: un CRM conectado directo a la Cloud API de Meta (sin comisión por mensaje), como Wapi101. Para equipos con desarrolladores: 360dialog o Twilio. Para operaciones enterprise multinacionales: Infobip o Botmaker.'],
      ['¿Twilio, Infobip o 360dialog: cuál es mejor?', 'De mejor a peor para la mayoría: 360dialog (más barato y transparente, cuota fija), Twilio (mejor documentación y escala, comisión por mensaje) e Infobip (enterprise, contratos anuales). Los tres necesitan desarrolladores.'],
      ['¿HubSpot sirve para WhatsApp?', 'Sirve si ya pagas HubSpot Marketing o Service y quieres tener WhatsApp dentro. Si estás eligiendo una herramienta POR WhatsApp, quedan cortas las funciones de bots y de inbox comparadas con un CRM especializado.'],
      ['¿Botmaker o Wapi101?', 'Botmaker es para empresas medianas y grandes con bots complejos y presupuesto enterprise. Wapi101 es para PyMEs y equipos pequeños que quieren inbox, pipeline y bots sin código, gratis para empezar y desde MXN $149 al mes. Si tienes menos de 20 agentes, Wapi101; si tienes 50, Botmaker.'],
      ['¿Necesito un BSP para usar WhatsApp Business API?', 'No desde 2022. Meta Cloud API se contrata directo y gratis; pagas solo las conversaciones. El BSP solo agrega soporte técnico y herramientas para desarrolladores — útil si programas, innecesario si usas un CRM que ya se conecta directo.'],
      ['¿Cuánto cuesta mandar mensajes por WhatsApp Business API en México?', 'Desde julio de 2025 Meta cobra por mensaje de plantilla entregado, con tarifa por país y categoría (marketing, utilidad, autenticación). En México un mensaje de utilidad cuesta del orden de uno o dos centavos de dólar y uno de marketing unos cuatro o cinco centavos; consulta la tabla oficial de Meta porque cambia. Responder dentro de la ventana de 24 horas no se cobra. Encima va lo que cobre tu proveedor o CRM.'],
      ['¿Puedo cambiar de proveedor sin perder mi número?', 'Sí. El número está vinculado a tu WhatsApp Business Account (WABA) en Meta, no al proveedor. Se migra entre BSPs y CRMs conservando número, nombre verificado y plantillas aprobadas.'],
      ['¿Qué pasa si no tengo todavía la API aprobada?', 'Puedes empezar con tu número de WhatsApp conectado por QR (como WhatsApp Web) en un CRM que lo soporte, y migrar a la API cuando Meta apruebe tu cuenta. Wapi101 soporta las dos modalidades.'],
    ],
    relatedSlugs: ['precio-whatsapp-business-api-mexico', 'whatsapp-cloud-api-vs-twilio', 'como-conectar-whatsapp-business-api'],
  },

  // ───────────────────────────────────
  // 8. WhatsApp multiagente (2026-09-28) — cluster "whatsapp multiagente /
  // varios usuarios / en varios celulares": la duda #1 de cualquier negocio
  // que crece. Explica las 3 vías sin vender humo (los dispositivos vinculados
  // de la app sirven para 2-3 personas).
  // ───────────────────────────────────
  'whatsapp-business-multiagente-varios-usuarios': {
    slug: 'whatsapp-business-multiagente-varios-usuarios',
    title: 'WhatsApp Business multiagente: varios usuarios, un número',
    description: 'Cómo atender un solo número de WhatsApp Business con varios agentes: dispositivos vinculados, API + CRM o conexión por QR. Ventajas, límites y costos reales.',
    keywords: 'whatsapp business multiagente, whatsapp multiusuario, whatsapp business varios usuarios, whatsapp business en varios celulares, whatsapp multiagente gratis, un numero de whatsapp varios agentes',
    publishedAt: '2026-09-28',
    updatedAt: '2026-09-28',
    author: 'Equipo Wapi101',
    category: 'Guías',
    excerpt: 'Tres formas de que varias personas atiendan el mismo WhatsApp: los dispositivos vinculados de la app, la API con un CRM, y el punto medio por QR. Cuál te conviene según tu tamaño.',
    readingTime: '7 min',
    sections: [
      {
        h: 'El problema: un celular, cinco personas y cero control',
        p: [
          'Pasa en casi todos los negocios que crecen: el WhatsApp del negocio vive en un celular, y ese celular pasa de mano en mano. Uno contesta en la mañana, otro en la tarde, alguien se lleva el teléfono a su casa y los clientes de la noche se quedan sin respuesta. Nadie sabe quién prometió qué, y cuando esa persona renuncia se lleva las conversaciones con ella.',
          '“WhatsApp multiagente” es simplemente eso: que varias personas atiendan el mismo número, cada una desde su propio dispositivo, con reglas sobre quién ve qué. Hay tres formas de lograrlo, y la que te conviene depende de cuántas personas atienden y de cuánto control necesitas.',
        ],
      },
      {
        h: 'Opción 1: dispositivos vinculados de WhatsApp Business (gratis, hasta 4 equipos)',
        p: [
          'La app de WhatsApp Business permite vincular hasta cuatro dispositivos adicionales al teléfono principal: computadoras con WhatsApp Web o la app de escritorio, y también otros celulares. Es gratis y toma dos minutos: Configuración → Dispositivos vinculados → escanear el código QR.',
          '**Lo bueno:** cero costo, cero curva de aprendizaje, y el historial se sincroniza. Para dos o tres personas que se tienen confianza y atienden pocas conversaciones al día, es suficiente.',
          '**Lo malo:** no hay asignación de chats (todos ven todo y dos personas pueden contestar el mismo mensaje), no hay roles ni permisos, no hay métricas de quién atendió qué ni en cuánto tiempo, y las etiquetas y respuestas rápidas siguen siendo las de la app. Además, el número sigue atado a un celular físico: si se pierde, se descompone o se lo lleva alguien, se detiene el negocio.',
          'En algunos países Meta ofrece WhatsApp Business Premium, una suscripción de pago que amplía el límite de dispositivos y agrega una página web del negocio. No está en todos los mercados y sigue sin resolver la asignación ni los reportes.',
        ],
      },
      {
        h: 'Opción 2: WhatsApp Business API + un CRM (sin límite de agentes)',
        p: [
          'La API de WhatsApp Business (hoy “Cloud API”, la que da Meta directamente) desconecta el número de cualquier celular: vive en la nube, y el software que la usa, normalmente un CRM, decide quién atiende cada conversación. No hay límite de usuarios impuesto por Meta; el límite lo pone el plan de tu CRM.',
          '**Lo que ganas:** bandeja compartida con asignación (manual, por turnos o por reglas), roles y permisos, notas internas, respuestas rápidas y plantillas compartidas, bots que atienden antes de pasar a un humano, y reportes: tiempos de respuesta, conversaciones por agente, ventas por canal. También puedes mandar mensajes iniciados por el negocio con plantillas aprobadas por Meta.',
          '**Lo que cambia:** el número deja de funcionar en la app de WhatsApp Business (se migra a la API), Meta cobra por cada mensaje de plantilla que envías (responder dentro de la ventana de 24 horas no cuesta), y necesitas una cuenta de Meta Business. La [diferencia completa entre la app y la API la explicamos aquí](/blog/whatsapp-business-vs-api-diferencias).',
          'Con Wapi101 la conexión es directa a Meta, sin intermediario ni comisión por mensaje encima de lo que cobra Meta. [La guía paso a paso para conectar la API](/blog/como-conectar-whatsapp-business-api) toma menos de una hora si ya tienes tu cuenta de Meta Business.',
        ],
      },
      {
        h: 'Opción 3: el punto medio, conectar tu número por QR a un CRM',
        p: [
          'Muchos negocios no quieren migrar todavía a la API: no tienen la verificación de Meta, no quieren perder la app en el celular, o simplemente quieren probar. Para eso existe la conexión por QR: el CRM se vincula a tu WhatsApp como si fuera un dispositivo más (igual que WhatsApp Web), y sobre esa conexión te da bandeja compartida, asignación, etiquetas, pipeline y bots.',
          'En Wapi101 esto se llama WhatsApp Lite. Es la forma más rápida de tener multiagente hoy mismo, con tu número actual y sin trámites. La contra: al no ser la API oficial, depende de que el celular tenga batería e internet, no permite plantillas aprobadas para campañas, y es menos estable a volúmenes altos. Piénsalo como el primer escalón: empiezas por QR, y cuando la operación lo pide, migras a la API sin cambiar de herramienta.',
        ],
      },
      {
        h: 'Comparativa rápida: cuál elegir según tu tamaño',
        p: [
          '**1 a 3 personas, pocas conversaciones al día:** dispositivos vinculados. Gratis y suficiente, mientras nadie necesite saber quién atendió qué.',
          '**3 a 10 personas o más de 50 conversaciones al día:** CRM por QR o API. Aquí ya duele no tener asignación ni reportes; un CRM con plan gratuito o de MXN $149 al mes se paga con la primera venta que no se pierde.',
          '**Más de 10 personas, campañas salientes o varias sucursales:** API + CRM, sin discusión. Necesitas plantillas aprobadas, bots que filtren, y que el número no dependa de un celular.',
          '**Varios números o varias marcas:** API + CRM multicanal, para que cada línea (y también Instagram, Messenger o Telegram) caiga en la misma bandeja con reglas distintas. [Así se ve en un CRM para WhatsApp](/crm-whatsapp-business).',
        ],
      },
      {
        h: 'Errores comunes al pasar a multiagente',
        p: [
          '**Compartir la cuenta con una sola contraseña.** Sin usuarios propios no hay trazabilidad: si algo sale mal no sabes quién fue, y si alguien se va, hay que cambiar la contraseña de todos.',
          '**No definir reglas de asignación.** “El que lo vea, lo contesta” termina en dos respuestas contradictorias o en ninguna. Define turnos, asignación por tipo de consulta o rotación automática.',
          '**Migrar a la API sin exportar el historial.** Las conversaciones de la app no se pasan a la API. Exporta lo importante (o captura los datos de tus clientes en el CRM) antes de migrar.',
          '**Comprar el plan grande desde el día uno.** Empieza con lo que te deje operar esta semana; casi todos los CRM serios te dejan crecer sin migrar.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar WhatsApp Business en dos o más celulares?', 'Sí. La app de WhatsApp Business permite vincular hasta cuatro dispositivos adicionales (computadoras u otros celulares) al teléfono principal, desde Configuración → Dispositivos vinculados. Todos ven las mismas conversaciones; no hay asignación ni roles.'],
      ['¿Cuántos usuarios puede tener un número con WhatsApp Business API?', 'Meta no pone límite. El número lo atienden tantos agentes como permita tu CRM. En Wapi101 el plan Gratis incluye 1 usuario, los planes de pago incluyen 2 y se agregan usuarios adicionales según se necesite.'],
      ['¿Hay WhatsApp multiagente gratis?', 'Sí, en dos formas: los dispositivos vinculados de la app (gratis pero sin asignación ni reportes) y CRMs con plan gratuito. Wapi101 tiene plan Gratis con 1 usuario y 500 contactos, útil para probar la bandeja, los bots y el pipeline antes de pagar.'],
      ['¿Se pierde el historial de chats al pasar a la API?', 'Las conversaciones que viven en la app no se migran automáticamente a la API. El número se conserva, los chats no. Exporta lo que necesites antes de migrar y, si es posible, empieza a registrar clientes en el CRM desde antes.'],
      ['¿Puedo seguir usando la app de WhatsApp Business después de conectar la API?', 'No con el mismo número: al migrar a la API el número deja de funcionar en la app. Si quieres conservar la app, la alternativa es la conexión por QR (WhatsApp Lite en Wapi101), que funciona en paralelo a tu celular.'],
      ['¿Cómo se reparten los chats entre agentes?', 'Depende del CRM. Lo habitual es asignación manual, rotación automática (round robin), por reglas (idioma, sucursal, tipo de consulta o etiqueta) o que un bot califique primero y asigne según la respuesta.'],
      ['¿Los clientes notan la diferencia?', 'No. Para el cliente sigue siendo el mismo número y el mismo chat. Solo nota que le contestan más rápido y que no tiene que repetir su historia cada vez que lo atiende otra persona.'],
    ],
    relatedSlugs: ['whatsapp-business-vs-api-diferencias', 'como-conectar-whatsapp-business-api', 'bots-whatsapp-pymes-ejemplos'],
  },

  // ───────────────────────────────────
  // 9. Evitar bloqueos (2026-09-28) — cluster "whatsapp me bloqueó / mensajes
  // masivos sin bloqueo / número suspendido". Mucha búsqueda, casi todo lo que
  // hay publicado es de vendedores de herramientas no oficiales. Aquí va la
  // vía oficial (API + calidad + límites) con reglas concretas.
  // ───────────────────────────────────
  'evitar-bloqueo-whatsapp-business-mensajes-masivos': {
    slug: 'evitar-bloqueo-whatsapp-business-mensajes-masivos',
    title: 'Cómo evitar que WhatsApp bloquee tu número de negocio (2026)',
    description: 'Por qué WhatsApp suspende números de negocio, cómo mandar mensajes masivos sin que te bloqueen, qué es la calificación de calidad y qué hacer si ya te pasó.',
    keywords: 'whatsapp bloqueo numero negocio, evitar bloqueo whatsapp business, mensajes masivos whatsapp sin bloqueo, whatsapp business suspendido, calificacion de calidad whatsapp, limites de mensajes whatsapp api',
    publishedAt: '2026-09-28',
    updatedAt: '2026-09-28',
    author: 'Equipo Wapi101',
    category: 'Guías',
    excerpt: 'WhatsApp bloquea números por patrones, no por mala suerte. Las reglas que sí evitan el bloqueo, los límites de envío de la API y el camino para mandar campañas sin poner en riesgo tu número.',
    readingTime: '8 min',
    sections: [
      {
        h: 'Por qué WhatsApp bloquea números de negocio',
        p: [
          'Un bloqueo casi nunca es aleatorio. WhatsApp mide señales: cuántas personas te reportan o te bloquean, qué porcentaje de tus mensajes son iniciados por ti sin respuesta, si mandas el mismo texto a muchos contactos en poco tiempo, si el número es nuevo y de pronto envía cientos de mensajes, y si usas software no oficial para automatizar la app.',
          'Las causas más frecuentes que vemos: listas compradas o contactos que nunca dieron su número al negocio, envíos masivos desde extensiones de navegador o apps “modificadas”, mensajes idénticos con solo un link, y no dejar que la gente deje de recibir mensajes. Cualquiera de esas dispara reportes, y los reportes disparan el bloqueo.',
          'Hay dos tipos de bloqueo: el temporal (te limita por horas o días, suele venir con aviso) y el permanente (“esta cuenta ya no puede usar WhatsApp”). El segundo es muy difícil de revertir, así que lo importante es no llegar ahí.',
        ],
      },
      {
        h: 'App vs API: reglas distintas para mandar mensajes',
        p: [
          'En la app de WhatsApp Business (la del celular) no hay envío masivo oficial. Las listas de difusión llegan solo a quien tiene tu número guardado, y todo lo que sea automatizar la app con herramientas externas viola los términos. Es la razón por la que la mayoría de los bloqueos vienen de la app: se le pide algo para lo que no fue hecha.',
          'En la API de WhatsApp Business (Cloud API) los mensajes salientes se hacen con plantillas que Meta aprueba antes, con categorías claras (marketing, utilidad, autenticación) y con un sistema de calidad y límites explícito. Es el único camino oficial para mandar campañas, y por eso es más seguro: sabes las reglas de antemano. [Aquí explicamos las diferencias entre app y API](/blog/whatsapp-business-vs-api-diferencias).',
        ],
      },
      {
        h: 'Calificación de calidad y límites de envío en la API',
        p: [
          'Cada número en la API tiene una calificación de calidad: verde (alta), amarilla (media) o roja (baja). Se calcula con las señales de los últimos días: bloqueos, reportes y las razones que la gente da al bloquearte. Si cae a roja de forma sostenida, Meta baja tu límite de envío y puede restringir el número.',
          'Los límites de envío son escalones de conversaciones iniciadas por el negocio en 24 horas: 250 al empezar sin verificación de negocio, y luego 1,000, 10,000, 100,000 e ilimitado. Se sube de nivel automáticamente cuando envías con buena calidad cerca del límite actual; la verificación de Meta Business acelera el arranque.',
          'Desde 2025 Meta además limita cuántos mensajes de marketing recibe una misma persona de todos los negocios en un periodo. Si tus plantillas de marketing “no llegan” a algunos contactos sin que tú hayas hecho nada mal, suele ser eso, no un bloqueo.',
        ],
      },
      {
        h: 'Las 9 reglas que sí evitan el bloqueo',
        p: [
          '**1. Solo escribe a quien te dio permiso.** Opt-in real: formulario, casilla marcada, un “sí” en el chat o un click en un anuncio. Nada de listas compradas ni de contactos “de un amigo”.',
          '**2. Calienta el número.** Un número nuevo no manda 2,000 mensajes el primer día. Empieza con decenas, sube gradualmente y mira la calidad antes de cada salto.',
          '**3. Personaliza.** Nombre, contexto de por qué le escribes, y un texto que no parezca copiado y pegado a mil personas. Los mensajes idénticos con un link y nada más son la firma del spam.',
          '**4. Ofrece salida.** “Responde BAJA para no recibir más mensajes”, y respétalo de verdad. Quien no puede salir, te reporta.',
          '**5. Responde rápido a quien te contesta.** Una campaña que genera respuestas sin atender genera bloqueos. Ten a alguien (o un bot que pase a alguien) del otro lado.',
          '**6. Usa la categoría correcta en las plantillas.** Un aviso de envío es utilidad, una promoción es marketing. Meta re-clasifica y penaliza el marketing disfrazado; nuestra [guía de plantillas](/blog/plantillas-whatsapp-business-guia) explica cómo redactar cada tipo.',
          '**7. Frecuencia razonable.** Una promo diaria al mismo contacto termina en bloqueo aunque haya dado opt-in. Semanal o quincenal para marketing, y solo lo transaccional cuando toca.',
          '**8. Nada de herramientas no oficiales sobre la app.** Extensiones que “mandan a todos tus contactos”, APKs modificados, bots que simulan un dedo humano. Es la vía rápida al bloqueo permanente.',
          '**9. Vigila la calidad cada semana.** En la API la ves en Meta Business Manager (o en tu CRM). Si baja a amarilla, frena las campañas y revisa qué mensaje generó reportes.',
        ],
      },
      {
        h: 'Qué hacer si ya te bloquearon',
        p: [
          '**Bloqueo temporal en la app:** espera el plazo indicado, no intentes “brincarlo” con otro número o chip, y cuando regrese, baja el ritmo de envíos. Suele ser una advertencia.',
          '**Bloqueo permanente en la app:** en el aviso hay un botón de “Solicitar revisión”. Explica en pocas líneas quién eres, qué hace el negocio y por qué crees que fue un error. Las revisiones se resuelven en horas o días. Si no procede, no hay más recurso; lo que sigue es un número nuevo y hacerlo bien desde el inicio (idealmente ya con API).',
          '**Restricción en la API:** revisa la calificación de calidad y las plantillas pausadas en Meta Business Manager. Meta indica el motivo (plantillas con mal desempeño, reportes). Corrige el mensaje, espera a que la calidad se recupere y el límite vuelve a subir solo.',
        ],
      },
      {
        h: 'Cómo ayuda un CRM a no llegar ahí',
        p: [
          'Un CRM conectado a la API no evita el bloqueo por arte de magia, pero te da las herramientas: envíos por plantilla aprobada, control de frecuencia y de lotes, registro del opt-in y del opt-out por contacto, segmentación para no escribirle a todos lo mismo, y bandeja compartida para responder rápido cuando la campaña genera conversaciones. Y cuando Meta rechaza o pausa una plantilla, te muestra el motivo real en vez de dejarte adivinar.',
          'En [Wapi101](/crm-whatsapp-business) puedes empezar por QR con tu número actual (para ordenar la atención) y pasar a la API cuando quieras hacer campañas en serio. Si tu volumen es alto, ve directo a la API: es la única forma oficial de mandar mensajes masivos sin jugarte el número. [Cuánto cuesta, aquí](/blog/precio-whatsapp-business-api-mexico).',
        ],
      },
    ],
    faqs: [
      ['¿Se puede mandar mensajes masivos por WhatsApp sin que te bloqueen?', 'Sí, por la vía oficial: WhatsApp Business API con plantillas aprobadas, a contactos con opt-in, respetando los límites de envío y la frecuencia. Desde la app del celular no hay envío masivo oficial; hacerlo con herramientas externas es lo que provoca bloqueos.'],
      ['¿Cuántos mensajes puedo mandar por día sin que me bloqueen?', 'En la app no hay un número público; los bloqueos se disparan por reportes y patrones, no por un tope fijo. En la API los límites son explícitos: 250 conversaciones iniciadas por el negocio en 24 horas al empezar sin verificación, y luego 1,000, 10,000, 100,000 e ilimitado según tu calidad.'],
      ['¿Qué es la calificación de calidad de WhatsApp?', 'Es el semáforo (verde, amarillo, rojo) que Meta asigna a cada número de la API según reportes y bloqueos recientes de los usuarios. Roja sostenida baja tu límite de envío; verde te permite subir de nivel.'],
      ['¿Por qué me bloquearon si solo escribía a mis clientes?', 'Lo más común: escribir a gente que no había aceptado recibir mensajes, mandar el mismo texto a muchos contactos en poco tiempo, o usar una herramienta no oficial. También influye que el número sea nuevo y arranque con mucho volumen.'],
      ['¿Cómo recupero un número bloqueado de WhatsApp Business?', 'Si es temporal, esperando el plazo. Si es permanente, con el botón “Solicitar revisión” del aviso, explicando tu caso. Si Meta confirma el bloqueo, no hay más recurso y toca empezar con un número nuevo, idealmente ya con la API.'],
      ['¿La API me protege del bloqueo?', 'Te da reglas claras y un semáforo de calidad para no llegar al bloqueo, y campañas por la vía oficial. Pero si mandas spam desde la API también te restringen: la calificación de calidad baja y Meta pausa plantillas o reduce tu límite.'],
      ['¿Puedo usar otro número o chip mientras estoy bloqueado?', 'Técnicamente sí, pero si repites el mismo patrón vuelven a bloquearte, y usar varios números para evadir bloqueos es motivo de suspensión. Mejor corrige la forma de enviar antes de reintentar.'],
    ],
    relatedSlugs: ['plantillas-whatsapp-business-guia', 'whatsapp-business-vs-api-diferencias', 'precio-whatsapp-business-api-mexico'],
  },

  // ───────────────────────────────────
  // 10. Precio de la API en México (2026-09-28) — cluster "cuánto cuesta
  // whatsapp business api / precio por mensaje". Casi todo lo publicado sigue
  // con la tabla vieja "por conversación"; desde julio 2025 Meta cobra por
  // mensaje. Cifras SIEMPRE aproximadas y con el aviso de consultar la tabla
  // oficial: Meta las cambia.
  // ───────────────────────────────────
  'precio-whatsapp-business-api-mexico': {
    slug: 'precio-whatsapp-business-api-mexico',
    title: 'Precio de WhatsApp Business API en México 2026: guía real',
    description: 'Cuánto cuesta de verdad WhatsApp Business API en México: tarifa de Meta por mensaje, comisión del proveedor, costo del CRM y ejemplos por tipo de negocio.',
    keywords: 'precio whatsapp business api mexico, cuanto cuesta whatsapp business api, tarifas whatsapp api 2026, costo por mensaje whatsapp, whatsapp cloud api precio, whatsapp business api gratis',
    publishedAt: '2026-09-28',
    updatedAt: '2026-09-28',
    author: 'Equipo Wapi101',
    category: 'Precios',
    excerpt: 'La API de WhatsApp es gratis; lo que se paga son los mensajes, el proveedor y el software. Desglose de las tres capas con números aproximados para México y tres escenarios reales.',
    readingTime: '8 min',
    sections: [
      {
        h: 'Primero lo más importante: la API en sí es gratis',
        p: [
          'Meta no cobra por “tener” la API de WhatsApp Business. Crear la cuenta, conectar el número, recibir mensajes y responder dentro de la ventana de servicio no cuesta nada. Lo que sí se paga son tres cosas distintas, y casi todos los precios confusos que ves en internet vienen de mezclarlas: (1) lo que Meta cobra por mensajes de plantilla, (2) lo que cobra el proveedor si usas uno, y (3) lo que cuesta el software con el que atiendes.',
          'Ojo con la información vieja: hasta mediados de 2025 Meta cobraba “por conversación” (una ventana de 24 horas). Desde julio de 2025 cobra **por mensaje de plantilla entregado**, por categoría. Muchos blogs siguen mostrando la tabla anterior.',
        ],
      },
      {
        h: 'Capa 1: lo que cobra Meta (por mensaje, por categoría)',
        p: [
          'Hay tres categorías de plantilla, cada una con su tarifa por país: **marketing** (promociones, novedades, recordatorios comerciales), **utilidad** (confirmaciones, avisos de envío, recordatorios de cita, cambios de pedido) y **autenticación** (códigos de verificación). Marketing es la más cara; utilidad y autenticación son mucho más baratas.',
          'Para México, en orden de magnitud: un mensaje de utilidad cuesta alrededor de uno o dos centavos de dólar, y uno de marketing entre cuatro y cinco centavos. Son cifras aproximadas: Meta publica la tabla oficial por país y la ajusta; antes de presupuestar, consulta la tarifa vigente. Lo que no cambia es la proporción: marketing cuesta varias veces más que utilidad.',
          '**Lo gratis:** las conversaciones que inicia el cliente. Cuando alguien te escribe, tienes 24 horas para responder sin costo, con mensajes libres (sin plantilla). Un mensaje de plantilla de utilidad enviado dentro de esa ventana abierta tampoco se cobra. Y si el cliente llega desde un anuncio de click-to-WhatsApp o desde el botón de tu página de Facebook, la ventana gratuita es de 72 horas.',
          'Traducido: un negocio que sobre todo **responde** a clientes (tienda, consultorio, servicio) puede pagar casi nada a Meta. Un negocio que sobre todo **inicia** contacto con promociones paga proporcionalmente más, y por eso conviene separar bien utilidad de marketing.',
        ],
      },
      {
        h: 'Capa 2: lo que cobra el proveedor (BSP), si usas uno',
        p: [
          'Puedes conectar la API de dos formas: directo con Meta (Cloud API, sin intermediario) o a través de un proveedor autorizado (BSP) como Twilio, 360dialog, Infobip o Vonage. El BSP agrega su propio cobro: Twilio, por ejemplo, cobra alrededor de medio centavo de dólar por mensaje encima de la tarifa de Meta; 360dialog cobra una cuota mensual fija en lugar de comisión; Infobip negocia contratos. [Comparamos las plataformas aquí](/blog/mejores-plataformas-whatsapp-business-api-latam).',
          'Si tu software se conecta directo a la Cloud API (como hace Wapi101), esta capa es cero. Vale la pena preguntar explícitamente a cualquier CRM: “¿cobran algo por mensaje encima de Meta?”. Algunos sí, y a volumen se nota.',
        ],
      },
      {
        h: 'Capa 3: el software para atender (CRM, inbox, bots)',
        p: [
          'La API sola es un grifo sin llave: para que un equipo la use necesitas un software que muestre las conversaciones, las reparta, guarde clientes y automatice. Aquí los precios van desde gratis hasta miles de pesos al mes, y casi siempre se cobran por usuario o por plan.',
          'Como referencia, Wapi101 tiene plan Gratis (1 usuario, 500 contactos), Básico desde MXN $149 al mes (2 usuarios, 8,000 contactos, plantillas, API pública), Pro desde MXN $299 (agrega respuesta con IA y soporte prioritario) y Ultra desde MXN $499 (100,000 contactos, marca blanca). Sin cobro por mensaje. Otros CRM del mercado cobran entre USD $15 y $50 por usuario al mes; [el ranking por tipo de negocio está aquí](/mejor-crm-latam).',
        ],
      },
      {
        h: 'Tres escenarios con números aproximados',
        p: [
          '**Consultorio que manda 600 recordatorios de cita al mes (utilidad).** Meta: 600 mensajes de utilidad, del orden de USD $6 a $12 al mes. Proveedor: $0 si es Cloud API directa. Software: plan Gratis o Básico. Total: menos de MXN $400 al mes, y cada cita que no se pierde vale más que eso.',
          '**Tienda en línea con 2,000 clientes que manda una promo quincenal (marketing) y avisos de envío (utilidad).** Meta: 4,000 mensajes de marketing al mes (alrededor de USD $160 a $200) más 800 de utilidad (unos USD $8 a $16). Software: plan Pro. Total: unos MXN $3,500 a $4,300 al mes. Si esas promos venden más del 1% de las veces, sale sobrado.',
          '**Negocio de servicios que solo responde (100 conversaciones al día iniciadas por clientes).** Meta: $0, todo cae en la ventana gratuita. Software: Básico o Pro según usuarios. Total: MXN $149 a $299 al mes. Este es el caso de la mayoría de las PyMEs, y por eso “la API es cara” suele ser un mito.',
        ],
      },
      {
        h: 'Cómo bajar la cuenta sin bajar resultados',
        p: [
          '**Clasifica bien las plantillas.** Un aviso de envío es utilidad, no marketing; la diferencia por mensaje es de varias veces.',
          '**Aprovecha la ventana de 24 horas.** Si el cliente te escribió hoy, todo lo que le respondas hoy es gratis. Diseña tus flujos para responder mientras la ventana está abierta, en vez de mandar plantillas al día siguiente.',
          '**Usa anuncios de click-to-WhatsApp.** Además de traer clientes, abren una ventana gratuita de 72 horas.',
          '**Segmenta el marketing.** Mandar la promo a los 2,000 contactos cuesta el doble que mandarla a los 1,000 que sí compran, y además cuida tu calificación de calidad ([cómo evitar bloqueos](/blog/evitar-bloqueo-whatsapp-business-mensajes-masivos)).',
          '**Conecta directo a Meta.** Elimina la capa del proveedor cuando tu CRM lo permite. [Cómo se conecta, paso a paso](/blog/como-conectar-whatsapp-business-api).',
        ],
      },
    ],
    faqs: [
      ['¿WhatsApp Business API es gratis?', 'La API en sí, sí: no hay costo por conectarla, recibir mensajes ni responder dentro de la ventana de 24 horas. Se paga por los mensajes de plantilla que envía el negocio (marketing, utilidad, autenticación), por el proveedor si usas uno, y por el software con el que atiendes.'],
      ['¿Cuánto cuesta un mensaje de WhatsApp Business API en México?', 'Depende de la categoría. En orden de magnitud, un mensaje de utilidad cuesta uno o dos centavos de dólar y uno de marketing cuatro o cinco centavos. Meta publica la tabla oficial por país y la actualiza; conviene consultarla antes de presupuestar.'],
      ['¿Meta sigue cobrando por conversación?', 'No. Desde julio de 2025 cobra por mensaje de plantilla entregado, según categoría y país. Las conversaciones iniciadas por el cliente y las respuestas dentro de la ventana de 24 horas no se cobran.'],
      ['¿Qué mensajes son gratis en la API?', 'Todo lo que respondas dentro de las 24 horas después de que el cliente te escribió, los mensajes de plantilla de utilidad enviados dentro de esa ventana abierta, y las conversaciones que llegan desde anuncios click-to-WhatsApp o botones de página de Facebook durante 72 horas.'],
      ['¿Cuánto cuesta un CRM para WhatsApp Business?', 'Desde gratis hasta más de USD $50 por usuario al mes. Wapi101: plan Gratis, Básico MXN $149, Pro MXN $299 y Ultra MXN $499 al mes, sin cobro por mensaje encima de Meta.'],
      ['¿Es más barato usar Twilio o conectar directo a Meta?', 'Conectar directo elimina la comisión del proveedor (en Twilio, alrededor de medio centavo de dólar por mensaje). Twilio tiene sentido si tu equipo de desarrollo construye encima; si usas un CRM que ya se conecta directo, no necesitas pagar esa capa.'],
      ['¿Necesito verificar mi negocio en Meta para usar la API?', 'Para empezar no: puedes enviar hasta 250 conversaciones iniciadas por el negocio en 24 horas sin verificación. Para subir de límite, mostrar el nombre del negocio y acceder a todas las funciones, sí conviene verificar el Meta Business.'],
      ['¿Puedo probar la API sin pagar?', 'Sí. Meta no cobra por conectar, y con un CRM con plan gratuito como Wapi101 puedes conectar tu número y atender conversaciones entrantes sin costo; solo pagas si envías plantillas.'],
    ],
    relatedSlugs: ['mejores-plataformas-whatsapp-business-api-latam', 'whatsapp-cloud-api-vs-twilio', 'como-conectar-whatsapp-business-api'],
  },

  // ───────────────────────────────────
  // 11. Chatbot con IA (2026-09-28) — cluster "chatbot whatsapp ia / chatgpt
  // en whatsapp para negocios / ia whatsapp business". Conecta con la IA
  // auto-respuesta del plan Pro. Honesto sobre lo que NO conviene delegar.
  // ───────────────────────────────────
  'chatbot-whatsapp-con-ia-para-negocios': {
    slug: 'chatbot-whatsapp-con-ia-para-negocios',
    title: 'Chatbot de WhatsApp con IA para negocios: guía práctica 2026',
    description: 'Qué puede hacer un chatbot de WhatsApp con inteligencia artificial en un negocio real, qué no conviene delegarle, cómo entrenarlo sin programar y cuánto cuesta.',
    keywords: 'chatbot whatsapp ia, inteligencia artificial whatsapp business, chatgpt whatsapp negocios, bot whatsapp con ia sin programar, asistente virtual whatsapp, automatizar whatsapp con ia',
    publishedAt: '2026-09-28',
    updatedAt: '2026-09-28',
    author: 'Equipo Wapi101',
    category: 'Automatización',
    excerpt: 'La IA en WhatsApp sirve para responder con contexto, calificar leads y agendar; no sirve para prometer precios ni tomar decisiones delicadas. Cómo combinar IA, reglas y humanos, paso a paso.',
    readingTime: '8 min',
    sections: [
      {
        h: 'Bot de reglas vs bot con IA: no son lo mismo',
        p: [
          'Un bot de reglas funciona con menús y palabras clave: “escribe 1 para precios, 2 para horarios”. Es predecible, barato y perfecto para flujos cerrados (confirmar una cita, capturar un dato, dar un horario). Su límite es obvio: si el cliente escribe algo que no está en el menú, se atora.',
          'Un bot con IA generativa entiende lenguaje natural: lee “oigan, ¿tienen el vestido azul en talla M y me lo mandan a Monterrey?” y responde con base en el catálogo y las políticas que le diste. No necesita que el cliente siga un guion. Su límite es otro: puede sonar seguro estando equivocado si no le pones contexto y frenos.',
          'En la práctica, lo que funciona en un negocio real es la combinación: reglas para lo estructurado, IA para lo abierto, y un humano a un click de distancia. [Los ejemplos de bots de reglas para PyMEs están aquí](/blog/bots-whatsapp-pymes-ejemplos); este artículo es sobre la parte de IA.',
        ],
      },
      {
        h: 'Lo que un chatbot con IA hace bien',
        p: [
          '**Responder preguntas frecuentes con contexto.** Horarios, ubicación, formas de pago, políticas de envío y devolución, diferencias entre productos. Si le das una base de conocimiento clara, resuelve la mayoría de las dudas de primer contacto a cualquier hora.',
          '**Calificar leads.** Preguntar qué necesita, para cuándo, en qué zona y con qué presupuesto, y con eso etiquetar el chat, moverlo en el pipeline y asignarlo al asesor correcto. Es el uso con mejor retorno: el asesor recibe la conversación ya filtrada.',
          '**Agendar y confirmar.** Proponer horarios disponibles, registrar la cita y mandar el recordatorio (con plantilla de utilidad si ya cerró la ventana de 24 horas).',
          '**Atender fuera de horario y en otros idiomas.** Contesta a las 11 de la noche, en inglés si el cliente escribe en inglés, y deja el resumen listo para que el equipo retome en la mañana.',
          '**Resumir y sugerir.** Para el agente humano: resumir un chat largo, sugerir una respuesta, detectar el tono del cliente. Aquí la IA no habla con el cliente, ayuda a quien sí lo hace.',
        ],
      },
      {
        h: 'Lo que no conviene delegarle (todavía)',
        p: [
          '**Precios y promesas que no estén en su base.** Si el precio no está en el catálogo que le diste, no debe inventarlo. Configura el bot para que diga “te confirmo con un asesor” en vez de improvisar.',
          '**Decisiones sensibles.** Diagnósticos médicos, asesoría legal, reclamaciones con dinero de por medio, quejas fuertes. La IA puede recabar la información y pasar el caso; la decisión la toma una persona.',
          '**Datos personales delicados.** No le pidas al bot que recolecte datos bancarios ni documentos por chat. Manda a un canal seguro.',
          '**Cerrar ventas complejas.** Un cliente que compara tres opciones y pide descuento quiere hablar con alguien. El bot lo detecta y lo pasa; no lo retiene.',
        ],
      },
      {
        h: 'Cómo montarlo sin programar, paso a paso',
        p: [
          '**1. Define el alcance en una hoja.** Qué debe resolver el bot (las 15 preguntas más frecuentes de tu chat real), qué debe pasar a humano, y en qué tono habla (tutea, usa emojis, formal). Lee tus últimos 200 chats: ahí está la lista.',
          '**2. Arma la base de conocimiento.** FAQs redactadas como las contestaría tu mejor vendedor, catálogo con precios vigentes, políticas, horarios, direcciones. Texto claro, sin jerga interna. Si la fuente cambia (precios), agenda actualizarla.',
          '**3. Ponle frenos.** Instrucciones explícitas: no inventar precios, no prometer fechas de entrega que no estén en la política, y pasar a humano cuando el cliente lo pida o cuando no esté seguro. Y una palabra de escape que siempre funcione: “asesor”.',
          '**4. Conéctalo al flujo, no lo sueltes solo.** El bot recibe después del saludo, califica, y entrega a un pipeline: etiqueta, etapa, asesor asignado. En [Wapi101](/crm-whatsapp-business) la IA se enciende por canal o por bot y se apaga cuando entra un humano, para que no se pisen.',
          '**5. Pruébalo con tu equipo una semana.** Que tres personas le escriban como clientes difíciles. Corrige la base con lo que falle. Solo entonces enciéndelo con clientes reales, primero en horario nocturno o en un canal.',
          '**6. Mide y ajusta cada semana.** Porcentaje de chats resueltos sin humano, porcentaje que pidió asesor, tiempo de primera respuesta, y las preguntas que el bot no supo (esas van a la base de conocimiento).',
        ],
      },
      {
        h: 'Cuánto cuesta un chatbot de WhatsApp con IA',
        p: [
          'Tres componentes: los mensajes de WhatsApp (gratis si el cliente inició la conversación y respondes dentro de 24 horas; [el detalle de tarifas está aquí](/blog/precio-whatsapp-business-api-mexico)), el software que orquesta el bot, y el uso del modelo de IA, que se cobra por texto procesado.',
          'Para una PyME el uso de IA cuesta poco: una conversación típica de 10 mensajes con contexto del negocio cuesta fracciones de centavo de dólar con los modelos actuales. Lo que domina el costo es el software. En Wapi101 la respuesta automática con IA viene en el plan Pro (MXN $299 al mes) y el uso del modelo se cubre con un crédito de IA que cargas y consumes según el volumen; los bots de reglas están en todos los planes, incluido el Gratis.',
          'Si alguien te cotiza un “chatbot con IA” en decenas de miles de pesos de desarrollo, pregunta qué estás pagando: hoy la parte de IA se configura, no se programa. Lo que sí vale la pena pagar es el trabajo de armar bien la base de conocimiento y los flujos.',
        ],
      },
      {
        h: 'Reglas de Meta y buenas prácticas con clientes',
        p: [
          'Meta pide que un negocio automatizado ofrezca siempre una forma clara de llegar a una persona, y que no se usen bots para spam. Buenas prácticas que además mejoran resultados: decir que es un asistente automático cuando el cliente pregunta, no fingir ser humano, responder corto (WhatsApp no es correo), y nunca dejar al cliente atrapado en un loop: tres intentos sin entender y pasa a humano.',
          'Y un consejo de experiencia: el mejor bot con IA no es el que contesta todo, es el que sabe cuándo callarse. Un “te paso con Ana, que conoce ese caso” a tiempo vende más que diez respuestas correctas.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo poner ChatGPT en mi WhatsApp Business?', 'No directamente en la app del celular. Necesitas la API de WhatsApp Business (o una conexión por QR a un CRM) y un software que conecte el modelo de IA con tus chats, le dé el contexto de tu negocio y controle cuándo responde. Los CRM con IA integrada hacen exactamente eso sin programar.'],
      ['¿Un chatbot con IA reemplaza a mis vendedores?', 'No. Reemplaza las preguntas repetitivas y el primer filtro; los vendedores reciben leads calificados y conversaciones resumidas. Los negocios que mejor resultado obtienen usan la IA para que el equipo atienda más y mejor, no para quitar al equipo.'],
      ['¿Cómo evito que el bot invente respuestas?', 'Dándole una base de conocimiento clara, instrucciones explícitas de no inventar precios ni promesas, y una regla de pasar a humano cuando no esté seguro o cuando el cliente lo pida. Y probándolo con tu equipo antes de encenderlo con clientes.'],
      ['¿Cuánto cuesta un chatbot de WhatsApp con IA?', 'El uso del modelo de IA cuesta fracciones de centavo por conversación; lo que pesa es el software. En Wapi101 la IA viene en el plan Pro (MXN $299 al mes) con crédito de IA por uso; los bots de reglas están en todos los planes, incluido el Gratis.'],
      ['¿Necesito la API de WhatsApp para usar IA?', 'Es lo recomendable, porque es la vía oficial y estable. Como paso intermedio, algunos CRM (Wapi101 incluido) permiten conectar tu número por QR y usar bots e IA sobre esa conexión, con las limitaciones de no ser la API oficial.'],
      ['¿El bot puede agendar citas?', 'Sí: consulta la disponibilidad, propone horarios, registra la cita y manda el recordatorio. Requiere que el CRM tenga calendario o se conecte al tuyo.'],
      ['¿Meta permite bots con IA en WhatsApp?', 'Sí, siempre que el negocio ofrezca una forma clara de hablar con una persona, no use la automatización para spam y respete las políticas de mensajería. Decir que es un asistente automático cuando el cliente lo pregunta es buena práctica.'],
    ],
    relatedSlugs: ['bots-whatsapp-pymes-ejemplos', 'precio-whatsapp-business-api-mexico', 'whatsapp-business-multiagente-varios-usuarios'],
  },

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
