// Datos para páginas de comparación y SEO de Wapi101.
// Cada entry produce una página completa vía render.js.
//
// Tipos:
//   - "vs": comparación 1-a-1 con un competidor
//   - "topic": página temática (nicho/intención SEO)
//
// Precios al 2026-05 (públicos). Pueden cambiar — auditar trimestralmente.

const WAPI101 = {
  name: 'Wapi101',
  priceLow: 'MXN $149/mes',
  priceMid: 'MXN $299/mes',
  priceHigh: 'MXN $499/mes',
  hq: 'México',
  origin: 'México',
  channels: ['WhatsApp Cloud API', 'Messenger', 'Instagram', 'Telegram', 'WhatsApp Web'],
  bots: 'Builder visual + condiciones anidadas + plantillas',
  free: '14 días de prueba gratis sin tarjeta',
};

const PAGES = {

  // ── Comparaciones directas ─────────────────────────────────────
  'vs/kommo': {
    type: 'vs',
    slug: 'vs/kommo',
    competitor: 'Kommo',
    competitorAlt: 'amoCRM',
    title: 'Wapi101 vs Kommo: Comparación completa 2026 (CRM WhatsApp LATAM)',
    description: 'Comparativa honesta de Wapi101 vs Kommo (antes amoCRM): precios en MXN, WhatsApp Cloud API nativo, bots visuales, multicanal y soporte en español. Decide cuál CRM conviene a tu PyME en México y LATAM.',
    keywords: 'wapi101 vs kommo, kommo crm comparacion, alternativa a kommo, amocrm vs wapi101, crm whatsapp barato latam',
    hero: 'Kommo (ex-amoCRM) es uno de los CRMs más usados en LATAM por sus pipelines kanban y Salesbot. Wapi101 nació mexicano, multicanal y con un precio plano en pesos que no escala por usuario. Te dejamos la comparación honesta para que decidas según tu caso.',
    verdict: 'Wapi101 conviene si quieres WhatsApp Cloud API nativo, precio fijo sin contar usuarios y soporte en español MX. Kommo conviene si necesitas un ecosistema enorme de integraciones y ya estás pagándolo.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes (todo incluido)', 'USD $15–$45 por usuario/mes'],
      ['Modelo de precio',         'Plano por workspace',           'Por usuario (escala rápido)'],
      ['Prueba gratis',            '14 días sin tarjeta',           '14 días sin tarjeta'],
      ['WhatsApp Cloud API',       'Nativo (sin terceros)',         'Vía aggregators (Twilio, 360dialog)'],
      ['Messenger / Instagram',    '✅ Incluido',                   '✅ Vía add-on'],
      ['Telegram',                 '✅ Incluido',                   'Limitado / via integraciones'],
      ['Bot builder',              'Visual con ramas anidadas',     'Salesbot visual'],
      ['Plantillas WhatsApp',      'Editor + aprobación integrada', 'Sí (vía broadcast)'],
      ['Pipelines / Kanban',       'Ilimitados',                    'Ilimitados'],
      ['Soporte en español MX',    'Equipo en México',              'Soporte global (multiidioma)'],
      ['Origen / sede',            'México',                        'Origen ruso, sede actual EU'],
      ['Curva de aprendizaje',     'Suave (interfaz minimalista)',  'Media (mucha config)'],
    ],
    sections: [
      {
        h: '¿Qué hace cada uno?',
        p: [
          'Kommo es un CRM multipropósito con foco en ventas conversacionales: pipelines kanban, Salesbot, integración con WhatsApp vía aggregators externos. Tiene años en el mercado y un ecosistema grande de integraciones.',
          'Wapi101 es un CRM multicanal hecho en México, con WhatsApp Cloud API nativo (sin intermediarios cobrándote por mensaje), Messenger, Instagram y Telegram en una sola bandeja. Bot builder visual con condiciones, plantillas aprobadas y precio en pesos mexicanos plano por workspace.',
        ],
      },
      {
        h: 'Precio real para una PyME de 3 personas',
        p: [
          'En Kommo, el plan Advanced cuesta alrededor de USD $25 por usuario/mes. Una PyME con 3 vendedores paga ~USD $75/mes (≈ MXN $1,500/mes) — y eso sin contar la integración WhatsApp que suele requerir un proveedor adicional (Twilio cobra por mensaje).',
          'En Wapi101 el plan Pro es MXN $299/mes plano para todo el workspace, incluyendo hasta 5 usuarios y WhatsApp Cloud API directa con Meta (sin sobrecargo por mensaje). Es ~5× más barato a igual número de usuarios.',
        ],
      },
      {
        h: 'WhatsApp: Cloud API vs aggregators',
        p: [
          'Wapi101 se conecta directo con WhatsApp Cloud API de Meta. Tú eres el dueño del número, no pagas markup por mensaje, y los costos son los oficiales de Meta (gratis hasta 1,000 conversaciones de servicio/mes).',
          'Kommo se integra vía aggregators como Twilio o 360dialog. Esos proveedores cobran un fee por mensaje encima del costo de Meta, y agregan una capa de complejidad. Para un negocio que manda miles de mensajes/mes, esa diferencia es significativa.',
        ],
      },
      {
        h: '¿Cuándo elegir Kommo?',
        p: [
          'Si ya tienes Kommo y un equipo entrenado: el costo de cambio puede no valer la pena hasta que crezcas.',
          'Si necesitas una integración muy específica que solo Kommo tiene (ej. CRMs verticales conectados vía Zapier/Make antiguos).',
          'Si tu volumen de mensajes WhatsApp es bajo y el costo por usuario no es prioridad.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si eres una PyME mexicana o LATAM con 1–10 personas y quieres pagar en pesos sin sorpresas por tipo de cambio.',
          'Si tu canal principal es WhatsApp y quieres la conexión directa con Meta (sin intermediarios cobrando markup).',
          'Si valoras soporte en español MX, documentación local y un producto pensado para el contexto LATAM.',
          'Si quieres bots visuales con sub-menús anidados (wait_response + condiciones) sin pagar tier alto.',
        ],
      },
    ],
    faqs: [
      ['¿Wapi101 reemplaza completamente a Kommo?', 'Para casos de uso de PyME conversacional vía WhatsApp/Messenger/Instagram/Telegram, sí. Si dependes de integraciones muy específicas de Kommo (ej. telefonía VoIP X o un ERP vertical), valida primero si esas existen en Wapi101 o se pueden hacer vía webhooks/API.'],
      ['¿Puedo migrar mis contactos y pipelines de Kommo a Wapi101?', 'Sí. Tenemos scripts de migración para Kommo (contactos, leads, pipelines, etiquetas). Si necesitas ayuda, el equipo lo hace contigo en el onboarding.'],
      ['¿Wapi101 tiene Salesbot como Kommo?', 'Sí, llamamos al equivalente "Bot Builder". Soporta condiciones anidadas, wait_response (esperar respuesta), plantillas WhatsApp, asignación automática y handover a humano.'],
      ['¿Por qué Wapi101 es más barato?', 'Tres razones: (1) precio plano por workspace en vez de por usuario; (2) WhatsApp Cloud API directo con Meta, sin markups de aggregators; (3) equipo lean operando desde México, con costos optimizados.'],
    ],
  },

  'vs/hubspot': {
    type: 'vs',
    slug: 'vs/hubspot',
    competitor: 'HubSpot',
    title: 'Wapi101 vs HubSpot: ¿Cuál CRM conviene para WhatsApp Business?',
    description: 'HubSpot ofrece CRM gratis pero su integración WhatsApp es costosa y limitada. Wapi101 es nativo WhatsApp Cloud API en pesos mexicanos. Comparativa completa: precios, bots, multicanal y soporte LATAM.',
    keywords: 'wapi101 vs hubspot, hubspot whatsapp, alternativa hubspot pymes, hubspot crm vs whatsapp crm',
    hero: 'HubSpot tiene el ecosistema CRM más maduro del mundo y un plan gratis muy generoso. Pero su integración con WhatsApp es un add-on caro y básico. Wapi101 nació con WhatsApp en el centro. Aquí la comparación honesta.',
    verdict: 'HubSpot es ideal si necesitas marketing automation completo (email, landing pages, ads) y tu equipo ya conoce su ecosistema. Wapi101 conviene si tu canal principal es WhatsApp y quieres precio fijo en MXN sin escalar por contacto o usuario.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes',                       'CRM gratis · Marketing Hub desde USD $20/mes'],
      ['Costo Marketing+Sales',    'Incluido en plan único',              'Marketing $890 + Sales $90 = USD $980/mes (Pro)'],
      ['WhatsApp Business API',    'Nativo, directo con Meta',            'Add-on pagado, vía 3rd party connectors'],
      ['Messenger / Instagram',    '✅ Incluido',                          '✅ Vía Service Hub'],
      ['Telegram',                 '✅ Incluido',                          '❌ No nativo'],
      ['Bot builder',              'Visual con ramas anidadas',           'Workflows + Chatflows (separados)'],
      ['Pipelines kanban',         'Ilimitados',                          '2 en CRM gratis, ilimitados pago'],
      ['Soporte en español MX',    'Equipo en México',                    'Soporte global, partner mexicano (extra)'],
      ['Curva de aprendizaje',     'Suave (1 día)',                       'Pronunciada (semanas)'],
      ['Mejor para',               'PyMEs LATAM con foco WhatsApp',       'Empresas mid-market con marketing complejo'],
    ],
    sections: [
      {
        h: '¿Cuánto cuesta cada uno realmente?',
        p: [
          'HubSpot tiene un CRM gratis muy bueno para iniciar, pero el "todo incluido" es engañoso. Para tener email marketing automatizado, secuencias de ventas y bots conversacionales necesitas Marketing Hub Pro (USD $890/mes) + Sales Hub Pro (USD $90/usuario/mes). Para 3 vendedores: ≈ USD $1,160/mes = MXN $23,000/mes.',
          'Wapi101 incluye CRM + pipelines + bots + multicanal + plantillas en MXN $299/mes plano (≈ USD $15). Diferencia: 75× más barato para PyMEs.',
        ],
      },
      {
        h: '¿Qué tan buena es la integración WhatsApp de HubSpot?',
        p: [
          'HubSpot tiene una integración WhatsApp en Service Hub, pero es básica: requiere un partner (360dialog, Twilio, Trengo, etc.) que cobra encima de Meta, y muchas funciones avanzadas (plantillas dinámicas, broadcast segmentado, bots condicionales) requieren combinar con Workflows que tienen su propia curva.',
          'Wapi101 es WhatsApp-first: la UI está pensada para conversaciones, los bots tienen condiciones anidadas pensadas para sub-menús (rama 1 → respuesta → sub-rama 1.1), y las plantillas se editan y mandan a aprobación dentro del mismo CRM.',
        ],
      },
      {
        h: '¿Cuándo elegir HubSpot?',
        p: [
          'Si necesitas marketing automation completo: email blasts, landing pages, ads, CRM y soporte en una sola plataforma.',
          'Si tu modelo es B2B mid-market o enterprise, con ciclos de venta largos y muchos touchpoints (email, ads, contenido, ventas).',
          'Si tu equipo ya conoce HubSpot y la migración costaría más de lo que ahorrarías.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si tu canal principal de ventas/soporte es WhatsApp (típico en MX/LATAM).',
          'Si quieres precio plano en pesos mexicanos, sin convertir USD y sin escalar por contacto.',
          'Si valoras simplicidad: un dashboard, un buzón multicanal, bots visuales — sin armar un stack de 5 productos.',
          'Si necesitas el soporte y la documentación en español MX.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar HubSpot CRM gratis junto con Wapi101?', 'Técnicamente sí, vía Zapier o webhooks. Pero duplicas trabajo manteniendo dos sistemas. La mayoría de nuestros clientes ex-HubSpot migran 100%.'],
      ['¿Wapi101 reemplaza el marketing email de HubSpot?', 'No, Wapi101 es CRM conversacional (WhatsApp, Messenger, Instagram, Telegram). Si necesitas email marketing avanzado, recomendamos combinar Wapi101 con un email tool dedicado como Brevo o MailerLite (más baratos que HubSpot Marketing Hub).'],
      ['¿HubSpot tiene WhatsApp Business API nativo?', 'No directamente. HubSpot se conecta a WhatsApp vía partners (360dialog, Twilio). Wapi101 sí es Meta-Tech Provider directo, así que no hay intermediarios cobrando markup.'],
    ],
  },

  'vs/zoho': {
    type: 'vs',
    slug: 'vs/zoho',
    competitor: 'Zoho CRM',
    title: 'Wapi101 vs Zoho CRM: ¿Cuál conviene en México y LATAM?',
    description: 'Zoho CRM es barato y tiene mucho, pero su UI es fragmentada y WhatsApp requiere apps adicionales. Wapi101 es WhatsApp-first y enfocado en LATAM. Comparativa completa.',
    keywords: 'wapi101 vs zoho, zoho crm whatsapp, alternativa a zoho crm, zoho one comparacion',
    hero: 'Zoho es el "Walmart del software": muchas apps, precios bajos, mucha amplitud y poca profundidad por producto. Wapi101 va al revés: pocas cosas, hechas bien, enfocadas en LATAM conversacional. Aquí la comparación.',
    verdict: 'Zoho conviene si necesitas suite completa (CRM + contabilidad + RH + email + 40 apps más) y tu equipo puede tolerar UI inconsistente. Wapi101 conviene si tu prioridad es WhatsApp conversacional bien hecho y simplicidad.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes',                  'USD $14–$52 por usuario/mes'],
      ['Modelo de precio',         'Plano por workspace',            'Por usuario (escala rápido)'],
      ['WhatsApp Business API',    'Nativo Meta',                    'Vía Zoho SalesIQ + 3rd party (costo extra)'],
      ['Bot builder',              'Visual, ramas anidadas',         'Zia (IA) + SalesIQ chatbot (separado)'],
      ['Apps incluidas',           '1 producto enfocado',            '40+ apps (Zoho One USD $45/u/mes)'],
      ['UI consistente',           'Sí (un solo dashboard)',          'Inconsistente entre apps'],
      ['Origen / sede',            'México',                          'India'],
      ['Soporte en español MX',    'Equipo local',                    'Tickets globales (idioma EN/ES)'],
      ['Mejor para',               'PyMEs LATAM, WhatsApp-first',     'Empresas que necesitan suite completa'],
    ],
    sections: [
      {
        h: 'La promesa de "todo en uno" de Zoho',
        p: [
          'Zoho One es una suite de 40+ apps por USD $45/usuario/mes (con compromiso anual). Es genuinamente buena oferta si necesitas CRM + Books (contabilidad) + Desk (soporte) + Mail + Projects + Recruit, etc. Para 5 personas son USD $225/mes (≈ MXN $4,500).',
          'El problema: cada app tiene su propia UI, su propia curva de aprendizaje. Integrar WhatsApp requiere SalesIQ + un partner aggregator + plantillas configuradas en otra app más. Es poderoso pero pesado de mantener.',
        ],
      },
      {
        h: 'Wapi101: profundidad sobre amplitud',
        p: [
          'Wapi101 hace una cosa: CRM conversacional multicanal con WhatsApp en el centro. No tenemos email marketing avanzado, no tenemos contabilidad, no tenemos HR. Pero lo que sí tenemos (bots, pipelines, plantillas, multicanal) está pulido y enfocado.',
          'Para una PyME mexicana cuyo principal canal de ventas es WhatsApp, eso es lo que necesita. Si después necesitas contabilidad, combinas con Contpaqi/SAT-friendly y listo — son 200-500 MXN/mes adicionales, no $1000s.',
        ],
      },
      {
        h: '¿Cuándo elegir Zoho?',
        p: [
          'Si tu empresa necesita realmente 5+ herramientas del bundle de Zoho One y vas a usarlas.',
          'Si ya pagas Zoho y aprendiste la UI — no tiene caso cambiar.',
          'Si tu volumen WhatsApp es bajo (la integración Zoho aguanta).',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si WhatsApp es tu canal principal (50%+ de ventas o leads).',
          'Si valoras una UI consistente y soporte en español MX.',
          'Si quieres pagar en pesos mexicanos sin compromisos anuales.',
        ],
      },
    ],
    faqs: [
      ['¿Wapi101 puede integrarse con Zoho?', 'Sí, vía webhooks salientes y la API de Wapi101. Puedes mandar leads de Wapi101 a Zoho CRM cuando alcanzan ciertas etapas, o viceversa.'],
      ['¿Por qué Zoho es tan barato si tiene tantas apps?', 'Zoho opera a escala global con ingeniería en India y un modelo de upsell agresivo. Mucha funcionalidad existe pero es básica; la profundidad real está en los planes Enterprise.'],
      ['¿Zoho tiene WhatsApp Cloud API?', 'Indirectamente. Zoho SalesIQ se conecta a WhatsApp vía partners (similar a HubSpot). Wapi101 es Meta Tech Provider directo, sin capas intermedias.'],
    ],
  },

  'vs/pipedrive': {
    type: 'vs',
    slug: 'vs/pipedrive',
    competitor: 'Pipedrive',
    title: 'Wapi101 vs Pipedrive: Pipelines visuales + WhatsApp Business',
    description: 'Pipedrive es excelente para ventas tradicionales pero no tiene WhatsApp nativo. Wapi101 es WhatsApp-first con pipelines kanban incluidos. Comparativa para equipos de venta en LATAM.',
    keywords: 'wapi101 vs pipedrive, pipedrive whatsapp, crm pipeline whatsapp, alternativa pipedrive latam',
    hero: 'Pipedrive es probablemente el mejor CRM "vendedor-céntrico" del mundo: simple, visual, enfocado en cerrar deals. Pero no es WhatsApp-first. Wapi101 toma esa misma simplicidad de pipeline kanban y la combina con WhatsApp nativo. Aquí la comparación.',
    verdict: 'Pipedrive conviene si tu venta es por email + llamadas + reuniones (modelo tradicional B2B). Wapi101 conviene si tu venta es por chat/WhatsApp con ciclos cortos.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes',                      'USD $14–$99 por usuario/mes'],
      ['Modelo de precio',         'Plano por workspace',                'Por usuario'],
      ['Pipelines kanban',         'Ilimitados',                         'Ilimitados desde Essential'],
      ['WhatsApp Business API',    'Nativo Meta',                        'Solo vía 3rd party (Chatdaddy, Twilio)'],
      ['Messenger / IG / Telegram','✅ Incluidos',                       '❌ No nativos'],
      ['Bandeja unificada chat',   '✅ Multicanal',                       '❌ No tiene bandeja chat'],
      ['Bot builder',              'Visual, ramas anidadas',             'Workflow automation (no chat bot)'],
      ['Email tracking',           'Limitado',                            'Muy bueno'],
      ['Llamadas / Caller',        'No',                                  'Sí (add-on)'],
      ['Mejor para',               'Venta conversacional WhatsApp',       'Venta tradicional B2B email+calls'],
    ],
    sections: [
      {
        h: 'El "fit" de cada CRM',
        p: [
          'Pipedrive fue diseñado para vendedores B2B que cierran deals por email + llamadas + reuniones. Su pipeline kanban es legendario, su email tracking es de los mejores, y tiene calleer integrado. No nació para WhatsApp.',
          'Wapi101 nació en LATAM viendo que el 80% de las PyMEs venden por WhatsApp. Mismo concepto kanban, pero la conversación está en el centro: cada deal tiene su hilo WhatsApp/Messenger/IG/Telegram, los bots pueden mover deals entre etapas, y las plantillas WhatsApp se editan dentro del CRM.',
        ],
      },
      {
        h: '¿Cuándo elegir Pipedrive?',
        p: [
          'Si tu venta es B2B con tickets medianos-altos (>$1k USD) y ciclos largos.',
          'Si tu equipo trabaja por email + llamadas y necesita tracking serio.',
          'Si valoras integración profunda con Outlook/Gmail.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si tu venta es B2C o B2B SMB con tickets bajos-medianos y ciclos cortos (horas-días).',
          'Si WhatsApp es donde realmente conversan tus clientes.',
          'Si quieres pagar plano por workspace, no por usuario.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar Pipedrive + un conector WhatsApp?', 'Sí, pero terminas pagando 3 cosas: Pipedrive ($14-99/u), el conector (Chatdaddy ~$20/mes), y posiblemente un aggregator (Twilio ~$0.005/msg). En total >$60/usuario/mes vs $299 plano de Wapi101.'],
      ['¿Wapi101 hace tracking de email?', 'Básico. Si tu venta depende mucho de email, Pipedrive es mejor en ese aspecto. Si tu venta es por chat, Wapi101 es mejor.'],
      ['¿Puedo migrar de Pipedrive a Wapi101?', 'Sí. Exporta tus pipelines/deals/contactos de Pipedrive en CSV y nosotros los importamos en el onboarding. Toma 1-2 horas.'],
    ],
  },

  'vs/manychat': {
    type: 'vs',
    slug: 'vs/manychat',
    competitor: 'ManyChat',
    title: 'Wapi101 vs ManyChat: CRM vs Chat Marketing — ¿cuál necesitas?',
    description: 'ManyChat es excelente para bots de chat (Messenger, IG, WhatsApp) pero NO es un CRM completo. Wapi101 es CRM con pipelines, contactos y bots multicanal. Comparativa para entender cuál te conviene.',
    keywords: 'wapi101 vs manychat, manychat crm, alternativa manychat, chat marketing vs crm',
    hero: 'ManyChat es un excelente "chat marketing tool" — el rey de bots Messenger y de captura de leads. Pero no es un CRM. No tiene pipelines kanban, no maneja contactos con campos personalizados estructurados, no tiene reportería de ventas. Wapi101 sí. Aquí la diferencia.',
    verdict: 'Si solo necesitas bots de captura por WhatsApp/Messenger/IG y mandar broadcasts, ManyChat es más rápido de configurar. Si quieres gestionar el ciclo de venta completo (lead → calificación → propuesta → cierre), Wapi101 es CRM real.',
    compRows: [
      ['Tipo de producto',         'CRM multicanal completo',              'Chat marketing platform'],
      ['Pipelines / kanban',       '✅ Ilimitados',                        '❌ No tiene'],
      ['Gestión de contactos',     '✅ CRM completo con campos custom',    '⚠ Básico (suscriptores de chat)'],
      ['Bandeja unificada chat',   '✅ Multicanal en una bandeja',         '⚠ Por canal separado'],
      ['Bot builder',              '✅ Visual + condiciones anidadas',     '✅ Visual (flows)'],
      ['Precio inicial',           'MXN $149/mes',                          'USD $15/mes (1k contactos)'],
      ['Asignación a vendedor',    '✅ Sí, con notificaciones',             '⚠ Limitado'],
      ['Plantillas WhatsApp',      '✅ Editor + aprobación',                '✅ Sí'],
      ['Reportes de venta',        '✅ Ingresos, conversiones, embudo',     '❌ Solo métricas de chat'],
      ['Mejor para',               'Equipos de venta con seguimiento',     'Marketers solo bots/broadcast'],
    ],
    sections: [
      {
        h: 'CRM vs Chat Marketing: la diferencia clave',
        p: [
          'Un Chat Marketing Tool (como ManyChat) está optimizado para: capturar leads vía bots, mandarles broadcasts, automatizar flows de Messenger/WhatsApp. Su unidad básica es el "subscriber", no el "lead/deal".',
          'Un CRM (como Wapi101) está optimizado para: gestionar el ciclo de venta completo. Cada conversación se ata a un "lead" o "expediente", que vive en un pipeline, tiene etapas, valor estimado, vendedor asignado, historial de cada touchpoint. Los bots son una pieza, no el centro.',
        ],
      },
      {
        h: '¿Cuándo elegir ManyChat?',
        p: [
          'Si tu negocio es e-commerce alta-frecuencia y solo necesitas: captura de carrito abandonado, broadcast de promos, FAQ automatizada.',
          'Si no necesitas que vendedores humanos lleven seguimiento personalizado de cada deal.',
          'Si tu prioridad es velocidad de setup y simplicidad sobre profundidad.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si tienes vendedores humanos que dan seguimiento personalizado.',
          'Si necesitas saber en qué etapa está cada lead y cuánto vale el pipeline total.',
          'Si quieres reportes de "cuántos cerré este mes, cuánto vendí, qué vendedor convirtió mejor".',
          'Si tu venta requiere múltiples interacciones antes de cerrar (no solo "agrega al carrito").',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar ManyChat + Wapi101?', 'Sí, vía webhooks. Muchos clientes usan ManyChat para captura inicial y mandan el lead calificado a Wapi101 para seguimiento humano. Es un buen híbrido.'],
      ['¿Wapi101 tiene growth tools tipo ManyChat (ref-link, comments-to-DM)?', 'Algunos sí (link directo a WhatsApp con mensaje pre-cargado, captura por landing). Comments-to-DM de Instagram lo tenemos, broadcast segmentado también. Si dependes de growth tools muy específicos de ManyChat, evalúa el híbrido.'],
      ['¿ManyChat es CRM?', 'No. Es chat marketing. La distinción importa porque si crees que es CRM y construyes encima, vas a encontrarte con limitaciones al crecer (sin pipelines, sin reportes de venta, sin gestión de equipo).'],
    ],
  },

  'vs/leadsales': {
    type: 'vs',
    slug: 'vs/leadsales',
    competitor: 'Leadsales',
    title: 'Wapi101 vs Leadsales: CRM WhatsApp mexicano — comparativa 2026',
    description: 'Leadsales es un CRM WhatsApp popular en México. Wapi101 va más allá: multicanal (Messenger, IG, Telegram), bots con ramas anidadas y precio plano. Comparativa honesta.',
    keywords: 'wapi101 vs leadsales, leadsales alternativa, crm whatsapp mexico, crm mexicano whatsapp',
    hero: 'Leadsales y Wapi101 son los dos CRMs mexicanos enfocados en WhatsApp más conocidos en el mercado. Comparamos honestamente para que decidas según tu caso.',
    verdict: 'Leadsales conviene si solo usas WhatsApp y quieres una interfaz súper minimalista. Wapi101 conviene si vendes también por Messenger/IG/Telegram, necesitas bots con sub-menús o vas a crecer a equipo grande.',
    compRows: [
      ['Origen',                   'México',                              'México'],
      ['Precio inicial',           'MXN $149/mes',                        'USD $20+/usuario/mes'],
      ['Modelo de precio',         'Plano por workspace',                  'Por usuario'],
      ['WhatsApp Business API',    'Nativo Meta',                          'Sí'],
      ['Messenger',                '✅ Incluido',                          '❌ No'],
      ['Instagram',                '✅ Incluido',                          '❌ No'],
      ['Telegram',                 '✅ Incluido',                          '❌ No'],
      ['Bot builder visual',       'Sí, con ramas anidadas',                'Básico (no condiciones complejas)'],
      ['Plantillas WhatsApp',      'Editor + aprobación',                   'Sí'],
      ['Reportes',                 'Embudo, ingresos, vendedor',            'Reportes básicos'],
      ['Mejor para',               'PyMEs multicanal con sub-menús bots',  'Negocios solo-WhatsApp simples'],
    ],
    sections: [
      {
        h: 'Lo que comparten',
        p: [
          'Ambos son CRMs mexicanos, con WhatsApp Business API directo, en español MX, soporte local, precio en pesos. Para una PyME que solo usa WhatsApp y tiene flujos sencillos, los dos funcionan.',
        ],
      },
      {
        h: 'Diferencias clave',
        p: [
          'Wapi101 es multicanal: WhatsApp, Messenger, Instagram, Telegram en una sola bandeja. Si vendes también por DM de IG o Messenger, Wapi101 te ahorra cambiar de pestañas.',
          'Wapi101 tiene bots más potentes: condiciones anidadas, sub-menús (rama 1 → respuesta → sub-rama 1.1 → respuesta → etc), wait_response con timeout configurable, plantillas dinámicas con variables.',
          'Wapi101 cobra plano por workspace (1 precio para todo el equipo), Leadsales cobra por usuario (escala lineal con el equipo).',
        ],
      },
      {
        h: '¿Cuándo elegir Leadsales?',
        p: [
          'Si solo usas WhatsApp y no tienes planes de integrar otros canales.',
          'Si quieres una interfaz súper minimalista (Leadsales es de los más simples del mercado).',
          'Si tu equipo es de 1-2 personas y el costo por usuario no se siente.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si vendes también por Messenger/IG/Telegram (común en e-commerce y servicios).',
          'Si tus bots necesitan lógica condicional compleja (menús de productos con sub-opciones, calificación de leads con ramas).',
          'Si tienes equipo de 3+ personas y el precio plano te ahorra dinero.',
        ],
      },
    ],
    faqs: [
      ['¿Wapi101 importa contactos desde Leadsales?', 'Sí, vía CSV. Exportas tus contactos y leads de Leadsales en CSV, los importamos en el onboarding (gratis).'],
      ['¿Cuál tiene mejor soporte en español MX?', 'Ambos. Son empresas mexicanas con equipo local. Wapi101 atiende vía WhatsApp directamente (sí, dogfooding).'],
      ['¿Wapi101 es más nuevo, eso es riesgo?', 'Wapi101 lleva en producción desde 2024 con clientes activos. Es lean (single-dev) lo que significa iteración rápida según feedback, no startup desbocada quemando capital.'],
    ],
  },

  'vs/bitrix24': {
    type: 'vs',
    slug: 'vs/bitrix24',
    competitor: 'Bitrix24',
    title: 'Wapi101 vs Bitrix24: ¿CRM enfocado o suite todo-en-uno?',
    description: 'Bitrix24 ofrece CRM gratis + suite completa pero su UI es densa y WhatsApp requiere extras. Wapi101 es enfocado en WhatsApp y multicanal. Comparativa real.',
    keywords: 'wapi101 vs bitrix24, bitrix24 whatsapp, alternativa bitrix24 simple, crm gratis vs wapi101',
    hero: 'Bitrix24 tiene un plan gratis muy generoso y una suite completa: CRM, tareas, telefonía, chat, intranet. Pero la UI es densa, la curva de aprendizaje pronunciada, y WhatsApp requiere integraciones extra. Wapi101 va al revés: enfocado, simple, WhatsApp nativo.',
    verdict: 'Bitrix24 si necesitas suite empresarial (intranet + telefonía + tareas + CRM) y tu equipo soporta UI compleja. Wapi101 si quieres CRM conversacional simple y rápido de adoptar.',
    compRows: [
      ['Plan gratis',              '14 días prueba, luego plan pago',     '5 usuarios gratis (limitado)'],
      ['Precio pago inicial',      'MXN $149/mes',                         'USD $61/mes (5 users)'],
      ['Modelo de precio',         'Plano por workspace',                  'Plano por tier (de 5 a 100 users)'],
      ['WhatsApp Business API',    'Nativo Meta',                           'Vía marketplace apps'],
      ['Messenger/IG/Telegram',    '✅ Incluido',                           '✅ Vía Open Channel'],
      ['Bot builder',              'Visual, ramas anidadas',                'Básico (no chat-flow visual)'],
      ['Intranet/tareas/RH',       '❌ No (foco CRM)',                      '✅ Sí (suite completa)'],
      ['Telefonía VoIP',           '❌ No',                                 '✅ Sí (extra)'],
      ['Curva de aprendizaje',     'Suave',                                 'Pronunciada'],
      ['UI moderna',               '✅ Minimalista',                         '⚠ Densa y dated'],
    ],
    sections: [
      {
        h: 'Bitrix24: el "Microsoft Office" del CRM',
        p: [
          'Bitrix24 quiere ser todo: CRM, tareas, telefonía, intranet, sitios web, RH, contabilidad básica, BPM. Su plan gratis aguanta 5 usuarios y eso lo hace atractivo para iniciar.',
          'Pero la integración WhatsApp requiere apps del marketplace, la UI tiene 8 menús diferentes y configurar la primera vez puede tomar días. Es poderoso pero pesado.',
        ],
      },
      {
        h: '¿Cuándo elegir Bitrix24?',
        p: [
          'Si necesitas también telefonía VoIP, gestión de tareas, intranet corporativa.',
          'Si tu equipo soporta UI compleja con muchos módulos.',
          'Si quieres aprovechar el plan gratis para 5 usuarios.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si tu prioridad es WhatsApp/Messenger/IG/Telegram bien hechos.',
          'Si valoras UI minimalista que no toma capacitación pesada.',
          'Si pagas en pesos mexicanos y prefieres precio plano predecible.',
        ],
      },
    ],
    faqs: [
      ['¿El plan gratis de Bitrix24 sirve para una PyME?', 'Sirve para iniciar pero tiene límites: 5 GB storage, sin telefonía decente, soporte limitado. Cuando creces, el upgrade a pago es agresivo (de gratis a USD $61/mes y para arriba).'],
      ['¿Wapi101 va a sacar features de Bitrix24 (tareas, intranet)?', 'No tenemos planes de competir en intranet/RH. Nuestro foco es CRM conversacional. Si necesitas eso, recomendamos combinar Wapi101 + otra herramienta dedicada (más barato que un mega-suite).'],
    ],
  },

  // ── Páginas temáticas / nicho ──────────────────────────────────
  'crm-whatsapp-business': {
    type: 'topic',
    slug: 'crm-whatsapp-business',
    title: 'CRM para WhatsApp Business — Guía completa 2026 (con o sin Cloud API)',
    description: 'Todo sobre CRM para WhatsApp Business: WhatsApp Cloud API vs Web, qué buscar, plantillas aprobadas, bots, integración multicanal. Comparativa de las mejores opciones para México y LATAM.',
    keywords: 'crm whatsapp business, crm whatsapp api, crm whatsapp cloud, mejor crm whatsapp, whatsapp business api crm',
    hero: 'WhatsApp es el canal #1 de ventas en México y LATAM. Un CRM para WhatsApp Business te permite atender múltiples conversaciones desde un solo lugar, organizar leads en pipelines, automatizar respuestas con bots y mandar plantillas masivas. Esta guía explica qué buscar.',
    sections: [
      {
        h: '¿Qué es un CRM para WhatsApp Business?',
        p: [
          'Es un software que conecta tu cuenta de WhatsApp Business (o WhatsApp Cloud API) y te permite: ver todas las conversaciones en una bandeja, asignarlas a vendedores, organizar leads en etapas (pipelines kanban), automatizar respuestas con bots, mandar campañas con plantillas aprobadas por Meta.',
          'A diferencia de WhatsApp Web (que solo soporta 1 dispositivo y no escala), un CRM con WhatsApp Cloud API soporta múltiples agentes simultáneos, historial completo, automatizaciones y reportes.',
        ],
      },
      {
        h: 'WhatsApp Cloud API vs WhatsApp Web: ¿cuál usar?',
        p: [
          'Cloud API (oficial de Meta): permite múltiples usuarios atendiendo el mismo número, bots automáticos, plantillas masivas aprobadas, historial completo. Requiere un proveedor (como Wapi101) que sea Tech Provider o pasar por aggregator. Costo: gratis hasta 1,000 conversaciones de servicio/mes.',
          'WhatsApp Web (no oficial / Baileys): conecta tu WhatsApp normal vía sesión QR. Funciona para 1 dispositivo, limitado en automatización, riesgo de baneo de Meta si haces broadcast masivo. Útil solo para inicio o casos muy pequeños.',
          'Recomendación: si tu negocio depende de WhatsApp, usa Cloud API. Wapi101 te conecta directamente con Meta como Tech Provider, sin markup por mensaje.',
        ],
      },
      {
        h: 'Qué buscar en un CRM WhatsApp en 2026',
        p: [
          '1. **Cloud API nativo** (no vía aggregator que cobra markup).',
          '2. **Multi-agente**: varios vendedores atienden el mismo número con asignación automática.',
          '3. **Pipelines kanban**: ver leads por etapa (Nuevo → Calificado → Propuesta → Cerrado).',
          '4. **Bots visuales** con condiciones (menús, sub-menús, calificación de leads).',
          '5. **Plantillas WhatsApp** con editor y aprobación dentro del CRM.',
          '6. **Multicanal**: idealmente también Messenger, Instagram, Telegram en la misma bandeja.',
          '7. **Reportes**: conversaciones por vendedor, tiempo de respuesta, conversión por etapa.',
          '8. **Precio en pesos** y plano (no por usuario) si eres PyME.',
        ],
      },
      {
        h: 'Opciones disponibles en México y LATAM',
        p: [
          'Las más usadas: Wapi101, Kommo (ex-amoCRM), Leadsales, HubSpot (con add-on), Zoho (vía SalesIQ), Bitrix24 (vía marketplace).',
          'Wapi101 es la opción mexicana con WhatsApp Cloud API nativo, multicanal, precio plano en MXN. Compáralo lado a lado: [vs Kommo](/vs/kommo) · [vs HubSpot](/vs/hubspot) · [vs Leadsales](/vs/leadsales).',
        ],
      },
      {
        h: '¿Cómo empezar?',
        p: [
          '1. Define qué necesitas (multi-agente, bots, plantillas, multicanal).',
          '2. Verifica que el CRM tenga Cloud API nativo (pregunta directamente).',
          '3. Pide una prueba gratis y conecta tu número de WhatsApp Business.',
          '4. Importa 100 contactos de prueba.',
          '5. Crea 1 pipeline simple y 1 bot básico.',
          '6. Pruébalo con tu equipo 1 semana antes de decidir.',
          'Wapi101 ofrece 14 días gratis sin tarjeta. Conectas tu WhatsApp Business en 10 minutos.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar mi número actual de WhatsApp Business en un CRM?', 'Sí, pero hay que migrarlo a WhatsApp Cloud API (gratis vía Meta + tu proveedor CRM). El proceso toma 1-2 horas. Pierdes WhatsApp en tu celular pero ganas multi-agente, bots, plantillas y todo.'],
      ['¿Wapi101 cobra por mensaje?', 'No. Cobramos por workspace plano (MXN $149-$499/mes según plan). Los costos por mensaje son los oficiales de Meta (gratis las primeras 1000 conversaciones de servicio/mes; las de marketing tienen costo según país: ~$0.04 USD por mensaje en MX).'],
      ['¿Es legal mandar broadcast a mi base de clientes por WhatsApp?', 'Sí si usas plantillas aprobadas por Meta y mandas a contactos con consentimiento (opt-in). Hacer broadcast con plantillas no aprobadas o sin opt-in puede resultar en baneo. Wapi101 te guía en esto.'],
      ['¿Funciona con tienda online (Shopify, WooCommerce)?', 'Sí, vía webhooks. Cuando hay un carrito abandonado en tu tienda, el bot puede mandar mensaje automático por WhatsApp para recuperarlo.'],
    ],
  },

  'crm-para-pymes-mexico': {
    type: 'topic',
    slug: 'crm-para-pymes-mexico',
    title: 'CRM para PyMEs en México: 7 opciones evaluadas (precio, WhatsApp, fácil de usar)',
    description: '¿Buscas CRM en México para PyME? Comparamos 7 opciones reales: precios en MXN, WhatsApp Business, facilidad de uso y soporte local. Para empresas de 1 a 50 personas.',
    keywords: 'crm para pymes mexico, mejor crm mexico, crm barato mexico, crm whatsapp mexico, crm pyme cdmx',
    hero: 'En México hay decenas de CRMs disponibles, pero pocos están realmente pensados para PyMEs locales: precios en MXN, soporte en español MX, integración nativa con WhatsApp Business, y simples de adoptar. Evaluamos 7 opciones realmente usadas en el mercado mexicano.',
    sections: [
      {
        h: 'Las 7 opciones que conviene evaluar',
        p: [
          '**Wapi101** — CRM mexicano multicanal (WhatsApp, Messenger, IG, Telegram). Precio plano MXN $149-$499. Cloud API nativo. 14 días gratis.',
          '**Kommo (ex-amoCRM)** — Pipelines kanban maduros, Salesbot. ~USD $25/usuario/mes. WhatsApp vía aggregators.',
          '**Leadsales** — CRM mexicano enfocado WhatsApp. UI minimalista. USD $20+/usuario/mes.',
          '**HubSpot CRM** — Plan gratis muy bueno pero WhatsApp es add-on caro. Mejor para mid-market.',
          '**Zoho CRM** — Cheap suite todo-en-uno. Curva de aprendizaje media. WhatsApp vía SalesIQ.',
          '**Pipedrive** — Mejor pipeline kanban para venta B2B tradicional. Sin WhatsApp nativo.',
          '**Bitrix24** — Suite empresarial con plan gratis. UI densa. WhatsApp vía marketplace apps.',
        ],
      },
      {
        h: 'Criterios para elegir (para PyME mexicana)',
        p: [
          '1. **¿WhatsApp es tu canal principal?** Si sí, prioriza CRMs con Cloud API nativo (Wapi101, Leadsales).',
          '2. **¿Cuántos usuarios serán?** Si 1-5: prefiere precio plano (Wapi101) sobre por-usuario (Kommo, Pipedrive).',
          '3. **¿Necesitas multicanal?** Messenger, Instagram, Telegram además de WhatsApp: Wapi101 los tiene incluidos.',
          '4. **¿Capacitación corta?** Si tu equipo no es técnico, busca UI simple (Wapi101, Leadsales, Pipedrive).',
          '5. **¿Presupuesto MXN?** Verifica precio en pesos sin sorpresas por TC USD/MXN.',
        ],
      },
      {
        h: 'Tabla comparativa rápida',
        p: [
          'Solo WhatsApp simple → **Leadsales**',
          'WhatsApp + multicanal + bots → **Wapi101**',
          'Pipelines B2B email/llamada → **Pipedrive**',
          'Marketing automation completo → **HubSpot** (caro)',
          'Suite con tareas/intranet → **Bitrix24** o **Zoho One**',
          'Ya tienes Kommo entrenado → **Kommo**',
        ],
      },
      {
        h: 'Caso típico: PyME mexicana 3 personas, venta por WhatsApp',
        p: [
          'Perfil: Tienda de productos belleza con 3 vendedoras, ~200 contactos nuevos al mes, 60% de ventas por WhatsApp, 40% por Instagram DM.',
          'Recomendación: Wapi101 plan Pro (MXN $299/mes). Cubre las 3 usuarias (no se paga por usuario adicional), conecta WhatsApp + Instagram + Messenger en una sola bandeja, bots para FAQ automática, plantillas para promociones masivas.',
          'Costo anual: MXN $2,990 (con 20% off anual). Equivalente: ~USD $150/año. Comparable: Kommo para 3 usuarias = USD $900/año.',
        ],
      },
    ],
    faqs: [
      ['¿Necesito factura electrónica (CFDI) para CRM como gasto deducible?', 'Sí. Wapi101 emite CFDI 4.0 con uso "Adquisición de mercancías" o "Gastos en general" según convenga. Confirma con tu contador. La mayoría de los CRMs internacionales no emiten CFDI, solo factura USD.'],
      ['¿Cuál tiene mejor soporte en español MX?', 'Los mexicanos (Wapi101, Leadsales) tienen ventaja por husos horarios MX y referencias locales. Los globales tienen soporte multilingüe pero suelen ser tickets en EN/PT.'],
      ['¿Puedo migrar de Excel/Google Sheets a CRM fácilmente?', 'Sí. Casi todos importan CSV. Wapi101 te ayuda con el mapeo en el onboarding (gratis).'],
      ['¿Cuánto tarda implementar un CRM en una PyME?', 'Setup técnico: 1-2 horas (conectar WhatsApp, importar contactos, crear pipeline). Adopción real del equipo: 2-4 semanas con uso diario.'],
    ],
  },

  'mejor-crm-latam': {
    type: 'topic',
    slug: 'mejor-crm-latam',
    title: 'Mejor CRM para LATAM 2026: comparativa de las 7 opciones más usadas',
    description: 'Comparativa actualizada de los mejores CRMs para Latinoamérica: precios en moneda local, soporte español, integración WhatsApp, características multicanal. Para empresas en MX, CO, AR, PE, CL.',
    keywords: 'mejor crm latam, crm latinoamerica, crm whatsapp latam, mejor crm colombia, mejor crm argentina',
    hero: 'En Latinoamérica el contexto de ventas es único: WhatsApp es el rey (90%+ penetración), las PyMEs son la mayoría del mercado, los presupuestos son más sensibles al tipo de cambio USD/local, y el soporte en español MX/AR/CO importa. Aquí los 7 CRMs más usados en LATAM, comparados honestamente.',
    sections: [
      {
        h: 'El contexto LATAM 2026',
        p: [
          'Casi el 95% de las PyMEs LATAM venden vía WhatsApp en algún punto del funnel. WhatsApp Business API se popularizó rápidamente desde 2020, pero el costo de aggregators (Twilio, 360dialog) sigue siendo prohibitivo para muchos.',
          'Hay dos tipos de CRM en LATAM: los globales adaptados (HubSpot, Pipedrive, Zoho) y los nativos LATAM (Wapi101 MX, Leadsales MX, Sirena ARG, Yalo, etc).',
        ],
      },
      {
        h: 'Top 7 evaluados',
        p: [
          '**1. Wapi101 (México)** — Multicanal nativo (WhatsApp Cloud API + Messenger + IG + Telegram), precio plano en MXN ($149-$499/mes), bots visuales con condiciones anidadas, 14 días gratis sin tarjeta. Mejor para PyMEs MX y LATAM conversacionales.',
          '**2. Kommo (ex-amoCRM, global)** — Pipelines kanban maduros, Salesbot, marketplace de apps. USD $15-$45/u/mes. WhatsApp vía aggregators. Mejor para empresas con equipos ya entrenados.',
          '**3. Leadsales (México)** — CRM 100% WhatsApp, UI ultra-minimalista, en español MX. USD $20+/u/mes. Mejor para tiendas pequeñas solo-WhatsApp.',
          '**4. Sirena/Z-API (Argentina/Brasil)** — Foco en mensajería, popular en BR/AR. Precios en pesos AR / reais.',
          '**5. HubSpot CRM (global)** — Mejor ecosistema marketing+sales del mundo. CRM gratis. WhatsApp como add-on costoso. Mejor para mid-market B2B.',
          '**6. Pipedrive (global)** — Mejor pipeline visual B2B tradicional. Sin WhatsApp nativo. Para venta por email+llamada.',
          '**7. Zoho CRM (global)** — Suite completa muy barata. Curva media. WhatsApp vía SalesIQ.',
        ],
      },
      {
        h: 'Cómo elegir según tu país y caso',
        p: [
          '**México**: Si WhatsApp es tu canal principal → Wapi101 o Leadsales (locales) > Kommo > HubSpot.',
          '**Colombia/Perú**: Similar a México. Wapi101 acepta pagos en USD/local. Kommo y HubSpot son fuertes ahí también.',
          '**Argentina**: Sirena y Z-API tienen presencia. Wapi101 acepta pago en USD.',
          '**Brasil**: Mercado distinto (português). RD Station, Pipedrive y Z-API son fuertes. Wapi101 funciona pero la UI está en español.',
        ],
      },
      {
        h: 'Errores comunes al elegir CRM en LATAM',
        p: [
          'Elegir un CRM global pensando "es el más usado en el mundo" sin verificar que soporte WhatsApp Cloud API bien.',
          'Caer en planes "por usuario" sin sumar el costo real para tu equipo: a 5 personas, USD $25/u/mes = USD $125/mes = ~MXN $2,500/mes solo en licencias.',
          'Subestimar la importancia del soporte en horario local. Un bug crítico viernes 6pm en Kommo (sede en EU) puede esperar 12 horas.',
          'No probar con tu equipo real antes de comprometerte. Casi todos ofrecen 14 días gratis — úsalos.',
        ],
      },
    ],
    faqs: [
      ['¿Cuál es el CRM más usado en LATAM?', 'Por volumen total, Kommo, HubSpot y Salesforce dominan. Pero entre PyMEs específicamente, las opciones locales (Wapi101 MX, Leadsales MX, Sirena ARG) están ganando rápido por precio y enfoque WhatsApp.'],
      ['¿Necesito el CRM más caro para tener buenos resultados?', 'No. Para PyMEs LATAM, el CRM más adecuado suele ser uno enfocado y bien usado, no el más caro. Wapi101 a MXN $299/mes (≈ USD $15) cubre el 90% de necesidades de una PyME que vende por chat.'],
      ['¿Por qué los CRMs latinoamericanos son más baratos?', 'Tres razones: (1) costos operativos en LATAM más bajos que US/EU; (2) competencia feroz entre locales; (3) entendimiento del mercado: las PyMEs no pueden pagar precios per-seat USA-style.'],
    ],
  },

  'vs/whaticket': {
    type: 'vs',
    slug: 'vs/whaticket',
    competitor: 'Whaticket',
    title: 'Wapi101 vs Whaticket: Comparativa CRM WhatsApp LATAM 2026',
    description: 'Whaticket es CRM WhatsApp popular en LATAM con precio por usuario en USD. Wapi101 ofrece precio plano en MXN, multicanal nativo y bots con sub-menús. Comparativa honesta para PyMEs.',
    keywords: 'wapi101 vs whaticket, whaticket alternativa, crm whatsapp latam, whaticket precio, crm whatsapp multiagente, comparativa whaticket, mejor crm whatsapp pyme, whaticket vs wapi101 mexico',
    hero: 'Whaticket es uno de los CRMs WhatsApp más conocidos en LATAM, con presencia fuerte en México, Colombia, Perú y Argentina. Wapi101 nació también en México pero con enfoque multicanal y precio plano por workspace. Aquí la comparación honesta para que decidas según tu caso.',
    verdict: 'Whaticket conviene si quieres una solución probada con años de mercado, soporte robusto y solo necesitas WhatsApp. Wapi101 conviene si buscas multicanal real (WhatsApp + Messenger + IG + Telegram), precio plano que no escala por vendedor, y bots con condiciones anidadas.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes (workspace completo)',     'USD $39+/usuario/mes'],
      ['Modelo de precio',         'Plano por workspace',                    'Por usuario (escala lineal)'],
      ['Prueba gratis',            '14 días sin tarjeta',                    '7 días con tarjeta'],
      ['WhatsApp Business API',    'Cloud API nativo Meta',                  'Cloud API + Web (no oficial)'],
      ['Messenger',                'Incluido nativo',                        'Add-on en plan superior'],
      ['Instagram',                'Incluido nativo',                        'Add-on en plan superior'],
      ['Telegram',                 'Incluido',                               'No disponible'],
      ['Bot builder',              'Visual con ramas anidadas y wait',       'Chatbot básico (flujos lineales)'],
      ['Plantillas WhatsApp',      'Editor + envío a aprobación Meta',       'Sí, vía panel separado'],
      ['Pipelines kanban',         'Ilimitados con drag&drop',               'Sí, ilimitados'],
      ['CFDI 4.0 México',          'Sí, emisión automática',                 'Solo factura USD'],
      ['Soporte en español MX',    'Equipo en México, WhatsApp directo',     'Equipo LATAM (chat/email)'],
      ['Curva de aprendizaje',     'Suave (interfaz minimalista)',           'Media (más opciones avanzadas)'],
    ],
    sections: [
      {
        h: '¿Qué es cada uno y a quién apunta?',
        p: [
          'Whaticket es un CRM enfocado 100% en WhatsApp Business, con años de mercado en LATAM. Su fortaleza histórica fue ser de los primeros en ofrecer multi-agente en un mismo número WhatsApp, antes de que Cloud API se popularizara. Hoy soporta tanto WhatsApp Web como Cloud API, con planes que escalan por usuario y por número conectado.',
          'Wapi101 es un CRM mexicano más reciente (2024) que nació directamente sobre WhatsApp Cloud API oficial de Meta, con visión multicanal desde día uno: WhatsApp + Messenger + Instagram + Telegram en una sola bandeja unificada. Precio plano por workspace pensado para PyMEs que no quieren pagar por cada vendedor adicional.',
          'Ambos están hechos para PyMEs y agencias LATAM, pero atacan el problema desde ángulos distintos: Whaticket prioriza profundidad en WhatsApp con muchas opciones de configuración; Wapi101 prioriza simplicidad multicanal con UI moderna.',
        ],
      },
      {
        h: 'Precio real para una PyME de 5 personas',
        p: [
          'En Whaticket, el plan Profesional ronda USD $39 por usuario/mes (con algunos descuentos por volumen anual). Una PyME de 5 personas paga ≈ USD $195/mes = MXN $3,900/mes. Si necesitas conectar Messenger o IG además, suele ser plan superior o add-on adicional. En total fácilmente USD $250/mes (≈ MXN $5,000) para uso multicanal con 5 personas.',
          'En Wapi101 el plan Pro es MXN $299/mes plano para todo el workspace, incluyendo hasta 5 usuarios y los 4 canales (WhatsApp + Messenger + IG + Telegram). Sumando IVA queda en MXN $347/mes. Ahorro: ~MXN $4,600/mes vs Whaticket multicanal para el mismo equipo, manteniendo todas las funciones core.',
          'Esa diferencia se vuelve significativa si crecés: en Whaticket cada nuevo vendedor suma USD $39+, en Wapi101 el siguiente tier (Business MXN $499) aguanta hasta 15 usuarios sin sobrecosto por agente.',
        ],
      },
      {
        h: 'Multicanal: la diferencia técnica',
        p: [
          'Whaticket creció como solución WhatsApp-first y los otros canales (Messenger, IG) llegaron después como funcionalidades adicionales. Esto se nota en la UI: las conversaciones de cada canal suelen vivir en secciones separadas o requieren configuración aparte.',
          'Wapi101 fue diseñado desde día cero como multicanal. La bandeja unificada muestra WhatsApp, Messenger, IG DM y Telegram con el mismo cliente en una sola línea de tiempo. Si un lead te escribió primero por IG, luego por WhatsApp, ves toda la conversación junta sin saltar de pestaña.',
          'Para negocios que ya usan IG/Messenger además de WhatsApp (común en moda, belleza, restaurantes, gimnasios), Wapi101 ahorra mucha fricción operativa.',
        ],
      },
      {
        h: 'Bots: condiciones anidadas vs flujos lineales',
        p: [
          'Whaticket tiene chatbot funcional para FAQs y captura de leads, pero suele ser de flujos lineales (mensaje A → respuesta usuario → mensaje B) sin mucha lógica condicional.',
          'Wapi101 soporta sub-menús con condiciones anidadas: el bot pregunta "¿qué te interesa?" con opciones 1/2/3, según la respuesta entra a una rama distinta, y dentro de cada rama puede haber más sub-opciones, wait_response con timeout, asignación a vendedor específico según etiqueta, y handover a humano automático si detecta intent complejo.',
          'Si tu uso de bots es solo "saluda y manda menú", ambos sirven. Si necesitas calificación compleja de leads, agendas con sub-menús de servicios, o flujos de cotización con múltiples preguntas, Wapi101 es más potente.',
        ],
      },
      {
        h: '¿Cuándo elegir Whaticket?',
        p: [
          'Si ya estás en Whaticket con un equipo entrenado: el costo de cambio no compensa hasta cierto volumen.',
          'Si solo usás WhatsApp y no proyectás abrir otros canales pronto.',
          'Si tu prioridad es estabilidad de un producto con años de mercado y muchos clientes activos en LATAM.',
          'Si necesitás features muy específicos que Whaticket tiene maduros (campañas masivas avanzadas, segmentación super granular por etiquetas).',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si querés precio plano que no escala por cada nuevo vendedor.',
          'Si tu negocio vende por múltiples canales (no solo WhatsApp).',
          'Si necesitás CFDI 4.0 mexicano como gasto deducible.',
          'Si tu equipo es chico (1-10 personas) y querés UI moderna sin curva pesada.',
          'Si valorás bots con lógica condicional compleja para sub-menús de productos/servicios.',
          'Si pagás en pesos sin querer exponerte a tipo de cambio USD/MXN cada mes.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo migrar mis conversaciones y contactos de Whaticket a Wapi101?', 'Sí. Whaticket permite exportar contactos en CSV y nosotros los importamos en el onboarding gratis. El historial de chat queda en Whaticket (es contra políticas de Meta migrarlo entre proveedores), pero a partir del día 1 en Wapi101 tenés todo el historial nuevo. Tip: avisá a tus clientes por broadcast el día del switch para mantener continuidad.'],
      ['¿Whaticket tiene WhatsApp Cloud API oficial?', 'Sí, lo agregaron hace años. Históricamente operaban sobre WhatsApp Web (sesión QR no oficial), riesgosa para volumen alto. Hoy soportan ambos. Wapi101 es 100% Cloud API oficial Meta sin opción Web no oficial, lo que reduce riesgo de baneo y permite escalar sin límites.'],
      ['¿Cuál tiene mejor soporte en LATAM?', 'Ambos atienden en español y horario LATAM. Whaticket tiene equipo más grande por años de mercado; Wapi101 atiende directo por WhatsApp (sí, dogfooding) y tiempo de respuesta promedio menor a 30 min en horario laboral.'],
      ['¿Wapi101 puede manejar múltiples números WhatsApp?', 'Sí. En el plan Business podés conectar hasta 3 números distintos (por ejemplo: ventas, soporte, otra sucursal) en el mismo workspace, con asignación por número.'],
      ['¿Whaticket es más estable por tener más años?', 'Madurez no equivale a estabilidad. Wapi101 lleva 18 meses en producción con uptime arriba de 99.5%, cobertura de tests, monitoreo activo. Single-dev significa iteración rápida y respuesta inmediata a bugs.'],
      ['¿Cuál es mejor para agencias que manejan varios clientes?', 'Wapi101 cobra plano por workspace, así que cada cliente de tu agencia paga su propio workspace MXN $149-499. Whaticket por usuario suele encarecer rápido cuando manejás varios clientes. Para agencias chicas Wapi101 sale más barato; para agencias grandes con planes whitelabel, evaluá ambos.'],
      ['¿Funciona con tienda Shopify/WooCommerce?', 'Ambos sí, vía webhooks. Wapi101 tiene plugin nativo para WooCommerce (carrito abandonado, post-venta) y webhooks para Shopify. Whaticket también tiene integraciones similares.'],
      ['¿Wapi101 va a subir el precio en 12 meses?', 'No tenemos planes de subir precio en MXN. Si subiera, los clientes actuales mantienen su tarifa por al menos 24 meses (grandfathered).'],
      ['¿Whaticket o Wapi101 para un restaurante con pedidos por WhatsApp?', 'Wapi101: bots con sub-menús son perfectos para mostrar menú (entrantes/principales/postres) con condicional, mandar foto del platillo, calcular total, y derivar a humano para confirmar pedido. Vé también /crm-restaurantes para casos de uso.'],
    ],
  },

  'vs/respond-io': {
    type: 'vs',
    slug: 'vs/respond-io',
    competitor: 'Respond.io',
    title: 'Wapi101 vs Respond.io: Comparativa multicanal CRM 2026 LATAM',
    description: 'Respond.io es plataforma multicanal global desde USD $79/mes con UI sofisticada. Wapi101 ofrece multicanal en MXN $149/mes con simplicidad LATAM. Comparativa honesta de precios y features.',
    keywords: 'wapi101 vs respond.io, respond io alternativa, respond.io precio, crm multicanal latam, plataforma omnichannel mexico, respond io comparativa, mejor crm whatsapp multicanal, respond.io vs wapi101',
    hero: 'Respond.io es una plataforma multicanal global (Malaysia) con presencia creciente en LATAM, conocida por su UI sofisticada y capacidad omnichannel. Wapi101 es el equivalente mexicano más enfocado y económico. Aquí la comparación honesta para PyMEs LATAM.',
    verdict: 'Respond.io conviene si necesitás plataforma omnichannel completa (WhatsApp + Messenger + IG + Email + SMS + LINE + Viber + Telegram + WeChat) con automatizaciones avanzadas para empresas medianas globales. Wapi101 conviene si sos PyME LATAM enfocada en WhatsApp + 2-3 canales más, con precio plano en pesos y soporte en español MX.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes (≈ USD $7.5)',           'USD $79/mes (Team plan)'],
      ['Modelo de precio',         'Plano por workspace',                  'Plano + costo por contacto'],
      ['Prueba gratis',            '14 días sin tarjeta',                  '14 días sin tarjeta'],
      ['Canales incluidos',        'WhatsApp + Messenger + IG + Telegram', '10+ canales (más amplio)'],
      ['WhatsApp Cloud API',       'Nativo Meta',                          'Nativo Meta'],
      ['SMS / Email / LINE',       'No disponibles',                        'Sí (en plan Team+)'],
      ['Bot builder',              'Visual ramas anidadas',                 'Workflow builder muy avanzado'],
      ['Inteligencia Artificial',  'Asistente AI básico',                   'AI Agent avanzado (en Business+)'],
      ['Idioma de interfaz',       'Español MX nativo',                     'Inglés / español traducido'],
      ['CFDI 4.0',                 'Sí',                                    'Solo factura USD'],
      ['Soporte',                  'Español MX, WhatsApp directo',          'Global EN, español parcial'],
      ['Curva de aprendizaje',     'Suave (1 día)',                         'Media-alta (días-semanas)'],
      ['Mejor para',               'PyMEs LATAM WhatsApp-first',            'Empresas medianas omnichannel'],
    ],
    sections: [
      {
        h: 'Dos productos en ligas distintas',
        p: [
          'Respond.io es una plataforma robusta diseñada para empresas medianas y grandes globales que necesitan unificar 5-10 canales de mensajería (WhatsApp, Messenger, IG, SMS, Email, LINE, Viber, WeChat, Telegram, Apple Business). Su workflow builder es de los más potentes del mercado, con AI Agent que puede mantener conversaciones autónomas, lógica condicional súper avanzada, y reportería profunda.',
          'Wapi101 es una herramienta más enfocada para PyMEs LATAM cuyo mix realista de canales es: WhatsApp (canal principal), Messenger, IG DM, y a veces Telegram. No competimos con la amplitud omnichannel global de Respond.io; competimos con simplicidad, precio en pesos, y enfoque en el caso de uso del 95% de PyMEs mexicanas.',
          'Si estás en una empresa de 50+ personas con presencia en Asia + LATAM + Europa, Respond.io tiene sentido. Si sos una tienda mexicana con 3-10 vendedores que venden por WhatsApp + IG, Wapi101 es la opción.',
        ],
      },
      {
        h: 'Precio real comparado',
        p: [
          'Respond.io plan Team arranca en USD $79/mes (≈ MXN $1,580) e incluye limitaciones de contactos mensuales activos. Si superás el límite, hay costo extra por contacto. El plan Business sube a USD $249/mes (≈ MXN $4,980) con AI Agent y más capacidad. Para una PyME LATAM, fácilmente quedás en MXN $1,500-5,000/mes solo en licencia.',
          'Wapi101 plan Pro MXN $299/mes (con IVA ≈ MXN $347) sin límite de contactos, hasta 5 usuarios y 4 canales. Plan Business MXN $499/mes hasta 15 usuarios. Si tu empresa cabe en estos rangos, ahorrás entre 80% y 90% mensual respecto a Respond.io.',
          'La diferencia tiene sentido: Respond.io justifica precio con features avanzadas (AI Agent, 10 canales, reportería enterprise) que la mayoría de PyMEs no usan. Pagar por capacidad que no aprovechás es desperdicio.',
        ],
      },
      {
        h: 'Workflow builder vs Bot builder',
        p: [
          'Respond.io tiene uno de los workflow builders más potentes del mercado: nodos condicionales, integraciones HTTP nativas, manipulación de variables compleja, AI nodes que pueden generar respuestas con GPT/Claude, branching avanzado. Es comparable a Zapier o Make pero centrado en mensajería.',
          'Wapi101 tiene un bot builder visual más sencillo pero suficiente para 90% de casos: ramas anidadas, wait_response, plantillas dinámicas, asignación a vendedor, etiquetas, handover humano. No tenemos integración HTTP nativa en el builder visual (sí vía webhooks externos), no tenemos AI nodes (sí asistente AI separado).',
          'Si necesitás llamar APIs externas en medio de un flujo (ej: consultar stock en tu ERP y responder), Respond.io lo hace nativo, en Wapi101 hay que armarlo con webhook + service externo. Si tu flujo es solo conversacional sin integrar sistemas, Wapi101 alcanza.',
        ],
      },
      {
        h: 'Soporte e idioma',
        p: [
          'Respond.io es una empresa global con HQ en Malasia. El soporte es principalmente en inglés, con español parcial vía traducción. La documentación oficial está en inglés primero. Para equipos LATAM no técnicos, esto puede ser fricción.',
          'Wapi101 es 100% mexicano: equipo en MX, documentación en español MX, soporte vía WhatsApp directo (atendido por humanos en horario LATAM). Para equipos no bilingües, esto reduce mucho la curva.',
          'Otra cosa: las facturas. Respond.io factura desde Malasia/Singapur en USD. Si necesitás CFDI 4.0 para deducir el gasto en SAT, no lo tienen. Wapi101 emite CFDI mexicano automáticamente.',
        ],
      },
      {
        h: '¿Cuándo elegir Respond.io?',
        p: [
          'Si tu empresa tiene presencia internacional y necesitás 5+ canales de mensajería incluyendo SMS, Email, LINE, WeChat.',
          'Si tenés equipo técnico que va a aprovechar workflow builder avanzado e integraciones HTTP nativas.',
          'Si necesitás AI Agent autónomo (Business plan).',
          'Si tu volumen y presupuesto justifica USD $79-249+ mensual.',
          'Si el inglés no es problema para tu equipo.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si tu mix de canales realista es WhatsApp + Messenger + IG + Telegram (no necesitás SMS/Email/LINE).',
          'Si querés precio en pesos mexicanos con CFDI.',
          'Si tu equipo no es bilingüe y valora soporte/docs en español MX.',
          'Si tu prioridad es simplicidad y curva corta.',
          'Si no necesitás AI Agent autónomo (asistente AI básico es suficiente).',
          'Si pagás de tu bolsillo y cada dólar cuenta.',
        ],
      },
    ],
    faqs: [
      ['¿Respond.io tiene WhatsApp Cloud API oficial?', 'Sí, son Meta Business Partner. Es uno de sus puntos fuertes. Wapi101 también es Cloud API nativo directo con Meta, sin intermediarios cobrando markup por mensaje.'],
      ['¿Cuál tiene mejor AI integrado?', 'Respond.io en planes Business+ tiene AI Agent autónomo que puede sostener conversaciones completas. Wapi101 tiene asistente AI más básico (sugerencias de respuesta, resumen de conversación). Si AI es tu prioridad #1, Respond.io es más avanzado.'],
      ['¿Puedo migrar de Respond.io a Wapi101?', 'Sí. Exportás contactos y datos básicos en CSV desde Respond.io, los importamos en onboarding. Los workflows complejos no son portables 1:1 (son arquitecturas distintas), hay que reconstruirlos en Wapi101.'],
      ['¿Por qué Respond.io es tan caro comparado?', 'Tres razones: (1) target de mercado son empresas medianas-grandes globales que pueden pagar; (2) capacidad omnichannel real con 10 canales requiere infra distribuida costosa; (3) AI Agent y workflow avanzado son features premium. No es caro per se, está priced para su segmento.'],
      ['¿Wapi101 puede integrar SMS o LINE?', 'No, no es nuestro foco. SMS es muy poco usado en LATAM (la gente usa WhatsApp), y LINE es asiático. Si dependés de esos canales, Respond.io es la opción.'],
      ['¿Cuál tiene mejor reportería?', 'Respond.io tiene reportería más profunda (dashboards customizables, métricas por workflow, exports avanzados). Wapi101 tiene reportes esenciales: conversaciones/vendedor, tiempo respuesta, conversión por etapa, ingresos. Cubre el 80% de necesidades PyME.'],
      ['¿Funciona con Shopify o WooCommerce?', 'Ambos sí, vía integraciones. Wapi101 tiene plugin nativo WooCommerce con carrito abandonado y post-venta. Respond.io tiene integraciones más sofisticadas vía workflows.'],
      ['¿Cuál es más rápido de implementar?', 'Wapi101 toma 1-2 horas para setup completo (conectar WhatsApp, importar contactos, crear primer pipeline y bot). Respond.io con su capacidad mayor toma típicamente 1-2 semanas para configurar workflows decentes.'],
      ['¿Wapi101 va a agregar más canales?', 'Estamos evaluando WhatsApp Lite (Web) como complemento, posible TikTok DM cuando Meta lo libere. SMS y LINE no están en roadmap (no aplican LATAM).'],
    ],
  },

  'vs/cliengo': {
    type: 'vs',
    slug: 'vs/cliengo',
    competitor: 'Cliengo',
    title: 'Wapi101 vs Cliengo: Chatbots argentinos vs CRM mexicano 2026',
    description: 'Cliengo es plataforma argentina de chatbots web/WhatsApp desde USD $25/mes. Wapi101 es CRM mexicano multicanal con bots avanzados en MXN $149/mes. Comparativa para PyMEs LATAM.',
    keywords: 'wapi101 vs cliengo, cliengo precio, cliengo alternativa mexico, chatbot whatsapp argentina, cliengo crm, comparativa chatbot latam, mejor chatbot whatsapp pyme, cliengo vs wapi101',
    hero: 'Cliengo es una plataforma argentina de chatbots con presencia en LATAM, enfocada en captura de leads desde tu sitio web y WhatsApp. Wapi101 es CRM completo mexicano con bots, pipelines y multicanal nativo. Comparamos a quién le sirve cada uno.',
    verdict: 'Cliengo conviene si tu prioridad es capturar leads desde tu web (chatbot que aparece en tu sitio) y mandarlos a WhatsApp o email. Wapi101 conviene si querés gestionar el ciclo completo de venta: capturar + clasificar en pipeline + atender multicanal + cerrar deal con vendedores.',
    compRows: [
      ['Tipo de producto',         'CRM multicanal completo',              'Chatbot web + WhatsApp'],
      ['Precio inicial',           'MXN $149/mes',                          'USD $25+/mes (Starter)'],
      ['Modelo de precio',         'Plano por workspace',                   'Plano por tier + add-ons'],
      ['Chatbot web (site)',       'Widget básico',                         'Chatbot web maduro (su core)'],
      ['WhatsApp Business API',    'Cloud API nativo Meta',                 'Sí, en plan Pro+'],
      ['Messenger / IG / Telegram','Incluidos',                             'IG y Messenger en planes altos'],
      ['Pipelines kanban',         'Sí, ilimitados',                        'Limitados / vía integración CRM externo'],
      ['Bandeja unificada chat',   'Multicanal nativo',                     'Por canal'],
      ['Bot builder visual',       'Ramas anidadas + wait_response',         'Flujo conversacional bueno'],
      ['Plantillas WhatsApp',      'Editor + aprobación Meta',              'Sí'],
      ['CFDI 4.0',                 'Sí, automático',                        'Solo factura ARS/USD'],
      ['Origen / sede',            'México',                                'Argentina'],
      ['Mejor para',               'Ciclo venta completo multicanal',       'Captura de leads desde web'],
    ],
    sections: [
      {
        h: 'Cliengo y Wapi101 resuelven problemas distintos',
        p: [
          'Cliengo nació como chatbot para sitios web: ese widget que aparece abajo a la derecha en muchas páginas, captura visitantes y los manda a WhatsApp/email. Su fortaleza histórica es justamente eso: convertir tráfico web en leads vía chat. Después agregaron WhatsApp y otros canales, pero el corazón sigue siendo el chatbot web.',
          'Wapi101 nació como CRM conversacional multicanal: la idea es gestionar el ciclo completo de venta desde que el lead llega (por WhatsApp, IG, Messenger, Telegram, o web) hasta que cierra deal. Tenemos widget de chat web también, pero como una pieza más del CRM, no el centro.',
          'Si tu problema principal es "tengo tráfico en mi web pero no convierte", Cliengo es más especializado. Si tu problema es "tengo leads entrando por varios canales y no los administro bien", Wapi101 es más completo.',
        ],
      },
      {
        h: 'Precio y cobertura',
        p: [
          'Cliengo plan Starter ronda USD $25/mes (≈ MXN $500). Te da chatbot web + WhatsApp básico para 1 sitio y 1 número. Plan Pro USD $79+/mes agrega Messenger e IG. Plan Business USD $150+ agrega CRM más robusto y más integraciones.',
          'Wapi101 plan Lite MXN $149/mes (≈ USD $7.5) ya incluye WhatsApp + Messenger + IG + Telegram + pipelines + bots básicos. Plan Pro MXN $299 desbloquea bots avanzados y 5 usuarios. Plan Business MXN $499 hasta 15 usuarios.',
          'Para una PyME que quiere multicanal + pipeline completo, Wapi101 es 3-5x más barato. Para una empresa que solo quiere chatbot web bien hecho, Cliengo Starter puede ser suficiente.',
        ],
      },
      {
        h: 'Pipelines: el diferencial CRM',
        p: [
          'Cliengo se enfoca en captura: el lead entra, el chatbot lo califica básicamente, y lo manda a tu equipo o a un CRM externo (Pipedrive, HubSpot, etc.). Cliengo no es CRM completo, es complemento de CRM.',
          'Wapi101 incluye pipelines kanban ilimitados con drag&drop, etapas configurables (Nuevo → Calificado → Propuesta → Cerrado), valor estimado por deal, vendedor asignado, historial completo. Cada conversación se ata a un lead/expediente en el pipeline.',
          'Si ya tenés CRM (Pipedrive, HubSpot) y solo necesitás chatbot que capture y reenvíe, Cliengo es razonable. Si querés todo en uno (chatbot + CRM + pipeline + multicanal), Wapi101 elimina la integración.',
        ],
      },
      {
        h: 'Chatbot: web vs multicanal',
        p: [
          'Cliengo tiene chatbot web maduro: aparece tipo "Hola, ¿en qué puedo ayudarte?", captura nombre+email+teléfono, hace preguntas calificadoras, y agenda o manda al equipo. Tiene años puliendo esa UX.',
          'Wapi101 tiene widget de chat web pero más básico (sin la sofisticación de Cliengo en el chatbot web propiamente dicho). Donde Wapi101 brilla es en bots dentro de WhatsApp/Messenger/IG: una vez que el lead te escribe por ahí, el bot lo califica con sub-menús, lo asigna, le manda plantilla, etc.',
          'Recomendación honesta: si tu fuente principal de leads es tráfico web orgánico/pagado, Cliengo + un CRM (Wapi101 o Pipedrive) es buena combinación. Si tu fuente principal es WhatsApp/IG, Wapi101 solo te basta.',
        ],
      },
      {
        h: '¿Cuándo elegir Cliengo?',
        p: [
          'Si tenés tráfico web considerable (5k+ visitas/mes) y querés convertir mejor con chatbot.',
          'Si ya tenés CRM y solo necesitás herramienta de captura especializada.',
          'Si tu prioridad es chatbot web + WhatsApp básico y no necesitás pipelines.',
          'Si tu equipo ya conoce Cliengo y la curva de cambio no compensa.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si la mayoría de tus leads llegan por WhatsApp/IG/Messenger (no por web).',
          'Si querés CRM completo con pipelines + multicanal + bots en una sola herramienta.',
          'Si necesitás pagar en MXN con CFDI.',
          'Si tu equipo es de 3+ personas y necesitan trabajar coordinados con asignaciones y reportes.',
          'Si valorás simplicidad: una herramienta vs combinar Cliengo + CRM separado.',
        ],
      },
    ],
    faqs: [
      ['¿Puedo usar Cliengo + Wapi101 juntos?', 'Sí, es buena combinación: Cliengo para capturar leads en tu web vía chatbot, mandar el lead a Wapi101 vía webhook, y Wapi101 hace el seguimiento completo en pipeline + multicanal. Si tu volumen lo justifica, este híbrido funciona bien.'],
      ['¿Wapi101 tiene chatbot web como Cliengo?', 'Sí, tenemos widget de chat web embebible, pero más básico que Cliengo. Si tu fuente principal de leads es tráfico web, considerá Cliengo para esa pieza específica.'],
      ['¿Cliengo tiene CRM?', 'Cliengo tiene CRM "ligero" en sus planes superiores, pero no es comparable a un CRM dedicado. Está optimizado para gestionar leads capturados por chatbot, no ciclos de venta largos con múltiples vendedores y etapas.'],
      ['¿Cuál tiene mejor IA?', 'Ambos están agregando IA. Cliengo tiene asistente de IA en chatbot web (responde FAQs automáticamente). Wapi101 tiene asistente AI integrado en conversaciones (sugerencias, resúmenes). En este aspecto están parejos.'],
      ['¿Cliengo tiene Cloud API o WhatsApp Web?', 'Cliengo trabaja con Cloud API en planes Pro+. Los planes básicos pueden usar WhatsApp Web (no oficial). Wapi101 es 100% Cloud API oficial.'],
      ['¿Puedo migrar mis flujos de Cliengo a Wapi101?', 'No 1:1, son arquitecturas distintas. Pero podemos ayudarte a recrear los flujos críticos durante el onboarding gratis. Toma típicamente 2-4 horas.'],
      ['¿Cuál es más conocido en Argentina?', 'Cliengo es muy fuerte en Argentina (es su mercado origen). En México y Colombia, Wapi101 y otros mexicanos tienen presencia creciente.'],
      ['¿Cliengo factura en pesos argentinos?', 'Sí, en planes locales AR. Para México y otros países LATAM suele facturar en USD. Wapi101 emite CFDI mexicano (deducible SAT) en MXN.'],
      ['¿Cuál escala mejor?', 'Para captura web masiva (10k+ leads/mes), Cliengo está más especializado. Para gestión de ciclo de venta con equipos de 5-20 personas y multicanal, Wapi101 escala mejor por su modelo plano.'],
    ],
  },

  'vs/sleekflow': {
    type: 'vs',
    slug: 'vs/sleekflow',
    competitor: 'SleekFlow',
    title: 'Wapi101 vs SleekFlow: CRM mexicano vs plataforma asiática 2026',
    description: 'SleekFlow es plataforma multicanal asiática desde USD $99/mes. Wapi101 ofrece multicanal LATAM en MXN $149/mes con CFDI y soporte español MX. Comparativa honesta de precios y features.',
    keywords: 'wapi101 vs sleekflow, sleekflow precio, sleekflow alternativa, crm whatsapp asia vs latam, sleekflow mexico, comparativa sleekflow, plataforma omnichannel pyme, sleekflow vs wapi101',
    hero: 'SleekFlow es una plataforma omnichannel asiática (Hong Kong) que ganó tracción global con su UI moderna y capacidades de e-commerce. Wapi101 es el equivalente mexicano para PyMEs LATAM, con precio en pesos y soporte local. Comparamos para que decidas según contexto.',
    verdict: 'SleekFlow conviene si tu negocio es global o regional Asia/EU, vendés productos físicos por catálogo (Shopify) y necesitás integración profunda con commerce + 6+ canales. Wapi101 conviene si sos PyME LATAM enfocada en WhatsApp + IG + Messenger, querés CFDI y precio plano en MXN sin convertir USD.',
    compRows: [
      ['Precio inicial',           'MXN $149/mes (≈ USD $7.5)',           'USD $99/mes (Pro plan)'],
      ['Modelo de precio',         'Plano por workspace',                  'Plano + costo extra por usuario'],
      ['Prueba gratis',            '14 días sin tarjeta',                  '7 días sin tarjeta'],
      ['Canales',                  'WhatsApp + Messenger + IG + Telegram', '6+ canales (incluye LINE, WeChat)'],
      ['WhatsApp Cloud API',       'Nativo Meta',                          'Nativo Meta'],
      ['Catálogo / Commerce',      'Básico',                                'Avanzado (su fortaleza)'],
      ['Integración Shopify',      'Vía webhooks',                         'Nativa profunda'],
      ['Bot builder',              'Visual ramas anidadas',                 'Flow builder bueno'],
      ['AI / GPT integration',     'Asistente básico',                      'AI sales agent (en Pro+)'],
      ['CFDI 4.0',                 'Sí',                                    'Solo factura HK/USD'],
      ['Soporte español MX',       'Equipo en México',                      'Inglés, español limitado'],
      ['Origen',                   'México',                                'Hong Kong'],
      ['Mejor para',               'PyMEs LATAM WhatsApp-first',            'E-commerce global multi-canal'],
    ],
    sections: [
      {
        h: 'Origen y target distintos',
        p: [
          'SleekFlow nació en Hong Kong en 2019 y creció fuerte en Asia (Singapur, Malasia, Taiwán, Filipinas) sirviendo a empresas de e-commerce con presencia regional. Su producto refleja eso: integración nativa profunda con Shopify, catálogo de productos avanzado, soporte para canales asiáticos como LINE y WeChat, y UI muy pulida.',
          'Wapi101 nació en México en 2024 sirviendo a PyMEs LATAM que venden por WhatsApp + Messenger + IG. Nuestro target son negocios de 1-20 personas con ciclos de venta cortos-medios, no e-commerce global con catálogo de 10k SKUs.',
          'Ambos son productos buenos en su segmento, pero apuntan a problemas distintos. La pregunta no es "cuál es mejor" sino "cuál encaja con tu negocio".',
        ],
      },
      {
        h: 'Precio y modelo',
        p: [
          'SleekFlow plan Pro arranca en USD $99/mes (≈ MXN $1,980), incluye base de usuarios y luego cobra por usuario adicional (~USD $19/u extra). Plan Premium USD $299+/mes con AI Agent y más integraciones. Para una empresa de 5 personas con multicanal completo, fácilmente USD $200/mes (≈ MXN $4,000).',
          'Wapi101 plan Pro MXN $299/mes plano, incluye 5 usuarios y los 4 canales principales. Plan Business MXN $499 hasta 15 usuarios. Para PyMEs LATAM, ahorro de 70-85% mensual respecto a SleekFlow comparable.',
          'La diferencia se justifica: SleekFlow tiene features avanzadas (catálogo commerce profundo, AI sales agent, 6+ canales) que cobran su valor en empresas que las aprovechan. Si no las vas a usar, pagás por capacidad ociosa.',
        ],
      },
      {
        h: 'Commerce: la fortaleza de SleekFlow',
        p: [
          'Si tu negocio es e-commerce con Shopify y querés vender directo desde WhatsApp/IG con catálogo sincronizado, SleekFlow es de los más maduros del mercado. Sus features de "shop in chat" (mostrar productos, agregar al carrito, checkout desde WhatsApp) son robustas.',
          'Wapi101 tiene integración WooCommerce y Shopify vía webhooks: podés mostrar productos vía mensajes, mandar recordatorios de carrito abandonado, post-venta. Pero no tenemos catálogo nativo sincronizado bidireccional con stock en tiempo real. Si vendés productos físicos masivos con catálogo grande, SleekFlow es más fuerte.',
          'Para servicios, restaurantes, clínicas, inmobiliarias, agencias, consultoría (donde no hay "catálogo de productos" sino servicios o ofertas personalizadas), Wapi101 cubre perfecto.',
        ],
      },
      {
        h: 'Multicanal: ¿qué canales realmente usás?',
        p: [
          'SleekFlow incluye WhatsApp + Messenger + IG + LINE + WeChat + Telegram + Email + SMS. Los canales asiáticos (LINE, WeChat) son fuertes en su mercado origen pero poco usados en LATAM.',
          'Wapi101 incluye WhatsApp + Messenger + IG + Telegram. No tenemos LINE, WeChat, ni SMS porque no son relevantes en LATAM (WhatsApp tiene 95%+ penetración). Pagar por canales que no vas a usar es desperdicio.',
          'Si tu negocio tiene presencia en Asia o atiende clientes asiáticos en LATAM, SleekFlow tiene sentido. Si tu mercado es 100% LATAM, los canales extra de SleekFlow son ruido.',
        ],
      },
      {
        h: 'AI: capacidades comparadas',
        p: [
          'SleekFlow tiene AI Sales Agent (plan Pro+) que puede sostener conversaciones autónomas, recomendar productos del catálogo, manejar objeciones básicas, y derivar a humano si detecta complejidad. Es bastante avanzado.',
          'Wapi101 tiene asistente AI más básico: sugerencias de respuesta, resumen de conversación, generación de plantillas. No tenemos agente autónomo que pueda cerrar ventas solo.',
          'Si AI conversacional autónomo es prioridad, SleekFlow está más avanzado. Si querés AI como complemento (no reemplazo del vendedor), Wapi101 alcanza.',
        ],
      },
      {
        h: '¿Cuándo elegir SleekFlow?',
        p: [
          'Si tenés tienda Shopify con catálogo grande y querés vender desde WhatsApp/IG con sincronización profunda.',
          'Si tu negocio tiene presencia regional asiática (LINE, WeChat son relevantes).',
          'Si necesitás AI Sales Agent autónomo.',
          'Si tu equipo es bilingüe y la documentación en inglés no es problema.',
          'Si tu presupuesto soporta USD $100-300/mes en licencia.',
        ],
      },
      {
        h: '¿Cuándo elegir Wapi101?',
        p: [
          'Si tu mercado es 100% LATAM con WhatsApp como canal principal.',
          'Si tu negocio es servicios, restaurantes, clínicas, inmobiliarias, agencias (no e-commerce masivo).',
          'Si necesitás CFDI mexicano deducible.',
          'Si querés precio en pesos sin exposición a USD/MXN.',
          'Si valorás soporte y docs en español MX.',
          'Si tu equipo es chico-mediano (1-15 personas).',
        ],
      },
    ],
    faqs: [
      ['¿SleekFlow funciona bien para PyMEs mexicanas?', 'Funciona técnicamente pero el modelo de pricing en USD y soporte primario en inglés son fricciones reales para muchas PyMEs MX. Para empresas con equipo bilingüe y presupuesto holgado, sí. Para la mayoría de PyMEs locales, opciones mexicanas son más naturales.'],
      ['¿Puedo migrar de SleekFlow a Wapi101?', 'Sí. Exportás contactos y datos en CSV desde SleekFlow, los importamos en onboarding. Los flujos de bot no son portables 1:1 (arquitecturas distintas), hay que recrearlos.'],
      ['¿Cuál tiene mejor integración Shopify?', 'SleekFlow gana acá. Tienen integración nativa profunda con catálogo sincronizado, stock en tiempo real, y "shop in chat". Wapi101 tiene integración Shopify vía webhooks (carrito abandonado, post-venta) pero más básica.'],
      ['¿Cuál tiene mejor integración WooCommerce?', 'Wapi101 tiene plugin nativo WooCommerce con carrito abandonado, post-venta y sync básico. SleekFlow tiene WooCommerce pero su fuerte real es Shopify.'],
      ['¿Wapi101 va a competir con AI de SleekFlow?', 'Estamos agregando capacidades AI gradualmente: sugerencias de respuesta, resúmenes, generación de plantillas. AI Sales Agent autónomo no está en roadmap cercano. Si necesitás eso urgentemente, SleekFlow está más avanzado.'],
      ['¿SleekFlow tiene catálogo WhatsApp oficial?', 'Sí, ambos soportan catálogo WhatsApp oficial de Meta. SleekFlow tiene UI más sofisticada para administrarlo y sincronizarlo con Shopify.'],
      ['¿Cuál es más estable?', 'Ambos tienen buenos uptime (>99%). SleekFlow tiene más años (2019) y volumen global. Wapi101 lleva 18 meses en producción con uptime 99.5%+, monitoreo activo, deploys diarios sin downtime.'],
      ['¿Hay soporte en español MX en SleekFlow?', 'Limitado. Su HQ es Hong Kong, equipo mayormente inglés. Tienen español parcial vía traducción de UI y algunos agentes bilingües. Para soporte fluido en español MX, los mexicanos (Wapi101, Leadsales) tienen ventaja clara.'],
      ['¿Cuál escala mejor para una empresa creciendo?', 'Depende del tipo de crecimiento. SleekFlow escala bien si crece tu catálogo de productos y volumen omnichannel global. Wapi101 escala bien si crece tu equipo (modelo plano hasta 15 usuarios) y mantenés foco LATAM.'],
    ],
  },

  // ── Páginas temáticas /crm-* nicho ─────────────────────────────
  'crm-restaurantes': {
    type: 'topic',
    slug: 'crm-restaurantes',
    title: 'CRM para Restaurantes 2026: Reservas, menú y delivery por WhatsApp',
    description: 'CRM para restaurantes en México: gestiona reservas, muestra menú por WhatsApp, recibe pedidos de delivery, automatiza confirmaciones. Bots, plantillas y multicanal en MXN $149/mes.',
    keywords: 'crm restaurantes mexico, whatsapp restaurante reservas, menu por whatsapp, pedidos delivery whatsapp, crm restaurant pyme, software restaurante latam, gestion reservas whatsapp, bot whatsapp restaurante',
    hero: 'Los restaurantes mexicanos venden cada vez más por WhatsApp: reservas, menú a domicilio, pedidos de delivery, confirmaciones automáticas. Un CRM enfocado en restaurantes te permite atender múltiples mesas, mostrar tu menú con fotos, recibir pedidos y automatizar todo el flujo sin perder personalidad.',
    cta: 'Probar Wapi101 gratis 14 días para tu restaurante',
    features: [
      'Bot que muestra menú con fotos por categoría (entrantes, principales, postres)',
      'Captura de reservas con fecha, hora y número de personas',
      'Plantillas de confirmación automática y recordatorio 24h antes',
      'Pedidos de delivery con cálculo de total y dirección',
      'Pipeline kanban: Reservas confirmadas, En curso, Cerrada, No-show',
      'Multicanal: WhatsApp + Instagram (clientes te etiquetan en stories) + Messenger',
      'Plantillas masivas para promociones (martes 2x1, comida del día)',
      'Asignación a mesero/host según turno y disponibilidad',
    ],
    sections: [
      {
        h: 'Por qué los restaurantes necesitan CRM en 2026',
        p: [
          'Los restaurantes mexicanos pasaron de tomar reservas por teléfono y aceptar pedidos por mensajes desordenados a operar buena parte de su negocio por WhatsApp e Instagram. El problema: un encargado contestando 200 mensajes/día desde el celular pierde reservas, mezcla pedidos, olvida confirmar, y no tiene historial cuando un cliente vuelve.',
          'Un CRM enfocado en restaurantes resuelve eso: múltiples agentes atendiendo el mismo número, bots que muestran menú automáticamente, plantillas para confirmar reservas, recordatorios automáticos, pipeline visual de reservas del día. El cliente percibe profesionalismo, el restaurante opera con orden.',
          'Wapi101 atiende restaurantes desde tabernas familiares hasta cadenas de 5-10 sucursales. La configuración base toma 2-3 horas y deja al equipo listo para escalar sin colapsar.',
        ],
      },
      {
        h: 'Casos de uso concretos',
        p: [
          '**Reservas por WhatsApp**: El cliente escribe "Quiero reservar". Bot pregunta fecha, hora, personas. Verifica disponibilidad. Confirma con plantilla aprobada. Manda recordatorio 24h antes. Si cliente confirma, mueve a "Confirmada" en pipeline. Si no responde, etiqueta como "Posible no-show".',
          '**Menú a domicilio**: Cliente escribe "Menú". Bot muestra categorías (entrantes, principales, bebidas, postres). Cliente elige categoría, ve productos con foto y precio, selecciona items. Bot calcula total + envío, pide dirección, confirma pedido y deriva a cocina/repartidor.',
          '**Cobranza de reservas**: Para restaurantes premium que cobran señal, bot genera link de pago Stripe/MercadoPago, lo manda por WhatsApp, confirma al recibir pago, libera mesa solo cuando confirmado.',
          '**Promociones segmentadas**: Cliente vino hace 60+ días sin volver. Pipeline lo etiqueta automáticamente como "Inactivo". Plantilla WhatsApp masiva: "Te extrañamos, este viernes 20% off en cualquier plato". Quien responde entra a flujo de reactivación.',
        ],
      },
      {
        h: 'Plantillas WhatsApp típicas para restaurantes',
        p: [
          '**Confirmación de reserva**: "Hola {nombre}, confirmamos tu reserva para {fecha} a las {hora} para {personas} personas en {restaurante}. Si necesitas modificar responde a este mensaje. Te esperamos."',
          '**Recordatorio 24h**: "Hola {nombre}, te recordamos tu reserva mañana {fecha} a las {hora} en {restaurante}. Para confirmar responde SI, para cancelar responde NO."',
          '**Pedido recibido**: "¡Gracias {nombre}! Recibimos tu pedido: {items}. Total: ${total}. Tiempo estimado: 35-45 min. Te avisamos cuando salga del horno."',
          '**Pedido en camino**: "Tu pedido va en camino con {repartidor}. Tiempo aprox: {minutos}. Cualquier duda escríbenos."',
          '**Promo del día**: "{Nombre}, hoy martes 2x1 en pizzas! Para pedir responde MENÚ y elige tu favorita. Válido solo hoy hasta las 23h."',
          '**Después de visita**: "{Nombre}, ¿cómo te fue en {restaurante}? Tu opinión nos ayuda. Responde 1-5 estrellas y un comentario si quieres."',
        ],
      },
      {
        h: 'Ejemplo de bot: tomar pedido completo',
        p: [
          'Mensaje cliente: "Quiero pedir"',
          'Bot: "¡Hola! Te muestro nuestro menú. ¿Qué te gustaría? 1) Entradas 2) Principales 3) Pizzas 4) Bebidas 5) Postres"',
          'Cliente elige "3". Bot muestra catálogo de pizzas con foto y precio (vía catálogo WhatsApp oficial). Cliente elige pizza Margarita $180.',
          'Bot: "Listo, Margarita $180. ¿Algo más? Responde MÁS para agregar o LISTO para cerrar."',
          'Cliente: "LISTO". Bot: "Total: $180 + $40 envío = $220. ¿Confirmas tu dirección guardada Av. Reforma 123? SI/NO".',
          'Cliente confirma. Bot: "Perfecto, pedido confirmado. Tiempo estimado 35-45 min. Te avisamos cuando salga." Crea lead en pipeline "Pedido nuevo" y notifica a cocina.',
        ],
      },
      {
        h: 'Multicanal: WhatsApp + Instagram',
        p: [
          'En restaurantes, Instagram es casi tan importante como WhatsApp. Los clientes etiquetan al restaurante en stories cuando van, mandan DMs preguntando "abren hoy?", piden recomendaciones por DM. Si tu equipo no atiende IG con el mismo orden que WhatsApp, perdés conversiones.',
          'Wapi101 unifica ambos: las conversaciones de IG llegan a la misma bandeja que WhatsApp. Si un cliente te escribió primero por IG y después por WhatsApp, ves todo junto. Las plantillas funcionan en ambos (con adaptación). Los bots responden en ambos.',
          'Bonus: Messenger funciona también si tenés Facebook Page activa (común en restaurantes con publicidad Meta Ads). Telegram menos común pero útil para grupos VIP o canales privados.',
        ],
      },
      {
        h: 'Tablero kanban para reservas del día',
        p: [
          'Configurás un pipeline "Reservas Día" con columnas: Solicitadas / Confirmadas / Presentes / Cerradas / No-show. El host arrastra cada reserva entre columnas en tiempo real. Cuando llega cliente, mueve de "Confirmadas" a "Presentes". Al irse, "Cerradas". Si no llegó, "No-show" y se etiqueta el cliente para evitar reservas futuras o pedir señal.',
          'Reportes automáticos: % no-show por día, ticket promedio por mesa, mesas vacías por turno, clientes recurrentes vs nuevos. Información que antes no tenías para decidir si necesitás cobrar señal, abrir antes o después, etc.',
        ],
      },
    ],
    faqs: [
      ['¿Wapi101 reemplaza POS como SambaPOS o NCR Silver?', 'No. Wapi101 es CRM conversacional para el cliente, no sistema de punto de venta. Convive bien con tu POS: el POS maneja cuentas en mesa, factura, inventario; Wapi101 maneja la conversación con el cliente desde antes de la reserva hasta después de la visita. Vía webhooks pueden sincronizarse.'],
      ['¿Sirve para una taquería pequeña sin sistema?', 'Sí. Plan Lite MXN $149/mes cubre 1-2 usuarios y los 4 canales. Configurás bot básico, plantillas de menú diario, y arrancás. No necesitás integrar nada más.'],
      ['¿Cuánto tarda implementar en mi restaurante?', 'Setup técnico (conectar WhatsApp Business + Instagram + crear bot básico): 2-3 horas con nuestro onboarding. Adopción del equipo (host, meseros, cocina): 1-2 semanas con uso diario. La primera semana acompañamos vía WhatsApp directo.'],
      ['¿Puedo conectar mi número actual de WhatsApp Business?', 'Sí, migramos tu número actual a WhatsApp Cloud API oficial (proceso de Meta, gratis). Toma 1-2 horas. Perdés WhatsApp en el celular del encargado pero ganás multi-agente, bots, plantillas masivas y todo lo que necesita un restaurante moderno.'],
      ['¿Funciona para cadenas con varias sucursales?', 'Sí. Plan Business MXN $499 permite hasta 3 números WhatsApp (una sucursal por número) y 15 usuarios. Cada sucursal tiene su propio pipeline pero el reporte general es consolidado.'],
      ['¿Cómo manejo el menú si cambia diario?', 'Tenés dos opciones: (1) actualizar el bot diariamente con plantos del día (5 min de trabajo del host), (2) usar catálogo WhatsApp oficial que se actualiza desde el panel y el bot lo muestra automáticamente. Recomendamos opción 2 para restaurantes con menú dinámico.'],
      ['¿Puedo cobrar señales por reserva?', 'Sí, integramos con Stripe y MercadoPago. El bot genera link de pago, el cliente paga, se confirma reserva. Si no paga en X minutos, se libera la mesa automáticamente.'],
      ['¿Funciona para delivery con repartidores propios?', 'Sí. El pipeline tiene columna "En reparto" con repartidor asignado. Vía WhatsApp el repartidor recibe pedido, dirección y confirma entrega. El cliente recibe notificación automática.'],
      ['¿Y si uso UberEats o Rappi además de pedidos directos?', 'UberEats/Rappi manejan sus propios pedidos. Wapi101 maneja pedidos directos por WhatsApp/IG (que evitan comisión de plataformas). Muchos restaurantes usan ambos: plataformas para alcance, Wapi101 para clientes recurrentes que prefieren contactar directo.'],
      ['¿Tenés casos de éxito de restaurantes mexicanos?', 'Sí, varios. Desde tabernas familiares en CDMX hasta cadenas medianas (5-8 sucursales) en Monterrey y Guadalajara. Si querés referencias, las compartimos en una llamada.'],
    ],
  },

  'crm-clinicas': {
    type: 'topic',
    slug: 'crm-clinicas',
    title: 'CRM para Clínicas y Consultorios 2026: Citas y recordatorios WhatsApp',
    description: 'CRM para clínicas médicas, dentales, estéticas en México: agenda citas, manda recordatorios WhatsApp, gestiona expedientes de pacientes, multicanal. Desde MXN $149/mes.',
    keywords: 'crm clinicas mexico, software dental consultorio, agenda citas whatsapp, recordatorios citas medicas, crm consultorio medico, gestion pacientes whatsapp, no-show clinica, citas dentales whatsapp',
    hero: 'Las clínicas y consultorios en México pierden dinero todos los días por dos motivos: pacientes que no se presentan (no-show de 15-30%) y agenda que se gestiona desde papelitos o Excel. Un CRM para clínicas resuelve ambos: agenda digital, recordatorios automáticos WhatsApp y seguimiento que reduce no-show a menos del 8%.',
    cta: 'Probar Wapi101 gratis 14 días en tu clínica',
    features: [
      'Agenda de citas con asignación a doctor/profesional',
      'Recordatorios automáticos 24h y 2h antes de la cita',
      'Confirmación de cita vía WhatsApp (responde SI/NO)',
      'Pipeline de pacientes: Nuevo, Citado, Atendido, Seguimiento, Recurrente',
      'Plantillas WhatsApp para resultados, recetas, indicaciones',
      'Multicanal: WhatsApp + Instagram (clínicas estéticas reciben muchos DMs)',
      'Bots para FAQs (precios, horarios, ubicación) sin saturar al recepcionista',
      'Reportes: tasa no-show, ingresos por doctor, paciente nuevo vs recurrente',
    ],
    sections: [
      {
        h: 'El problema del no-show en clínicas mexicanas',
        p: [
          'En México, una clínica dental, médica o estética típica tiene 15-30% de no-show: pacientes que confirman cita y no se presentan. Cada no-show es ingreso perdido más el tiempo del profesional sin atender. En clínicas con tarifa de MXN $800-2,000 por sesión, son varios miles de pesos perdidos por mes.',
          'La causa principal: falta de recordatorios efectivos. Llamadas telefónicas son inefficientes (paciente no contesta), SMS poco leídos, email casi 0% apertura en este contexto. WhatsApp tiene 95%+ apertura en menos de 1 hora.',
          'Una clínica con CRM + recordatorios automáticos WhatsApp reduce no-show a 5-8%. Es la diferencia entre perder $20,000/mes y perder $5,000/mes en una clínica de tamaño mediano.',
        ],
      },
      {
        h: 'Casos de uso concretos para clínicas',
        p: [
          '**Agenda digital con recordatorios**: Recepcionista o paciente agenda cita. Sistema manda confirmación inmediata WhatsApp con fecha/hora/doctor. 24h antes manda recordatorio: "Mañana tienes cita con Dra. Pérez a las 10am. Responde SI para confirmar." 2h antes recordatorio final. Paciente que confirma raramente falta.',
          '**Captación nueva por WhatsApp**: Paciente pregunta por servicio (limpieza dental, consulta general, tratamiento estético). Bot muestra opciones, precios, duración. Si interesa, agenda directamente. Si no, queda como lead en pipeline para reactivar luego con promo.',
          '**Seguimiento post-tratamiento**: Después de tratamiento manda mensaje a las 24h: "¿Cómo te fuiste sintiendo, {nombre}? Si tienes molestia escríbenos." A los 7 días: "¿Te tomaste el medicamento como indicó la Dra.? ¿Alguna duda?" Mejora resultados clínicos y retención.',
          '**Renovación recurrente**: Limpieza dental cada 6 meses, control médico anual, retoque estético cada 8 semanas. Sistema detecta cuándo toca y manda recordatorio: "Hola {nombre}, hace 6 meses tuviste limpieza con Dra. Pérez. ¿Agendamos la siguiente?" Convierte 30-40% de recurrentes.',
        ],
      },
      {
        h: 'Plantillas WhatsApp típicas para clínicas',
        p: [
          '**Confirmación cita**: "Hola {nombre}, tu cita con {doctor} es el {fecha} a las {hora} en {clinica}. Dirección: {direccion}. Recuerda llegar 10 min antes. Para cambios responde a este mensaje."',
          '**Recordatorio 24h**: "Hola {nombre}, mañana {fecha} a las {hora} tienes cita con {doctor} en {clinica}. Responde SI para confirmar o NO si necesitas reagendar."',
          '**Recordatorio 2h**: "{Nombre}, te recordamos tu cita en 2 horas con {doctor}. Te esperamos en {clinica}."',
          '**Después de consulta**: "Hola {nombre}, gracias por tu visita hoy. Aquí van tus indicaciones: {indicaciones}. Si tienes dudas escríbenos. Próxima cita: {fecha_siguiente}."',
          '**Resultados de estudios**: "Hola {nombre}, ya están listos tus resultados de {estudio}. Te los manda {doctor} por este chat: {archivo}. Si tienes dudas responde a este mensaje."',
          '**Reactivación**: "Hola {nombre}, hace {meses} meses no te vemos por la clínica. Si te interesa agendar tu próxima visita responde SÍ y te damos opciones de horario."',
        ],
      },
      {
        h: 'Ejemplo de bot: agendar cita nueva',
        p: [
          'Paciente: "Quiero agendar cita"',
          'Bot: "¡Hola! Para agendar dime: 1) Servicio que necesitas, 2) Día preferido, 3) Tu nombre. Ejemplo: Limpieza dental, jueves, María García"',
          'Paciente: "Limpieza dental, jueves, María García"',
          'Bot: "Listo María. Tengo estos horarios disponibles el jueves 25/05: 9am, 11am, 4pm. ¿Cuál te queda?"',
          'Paciente: "11am"',
          'Bot: "Confirmado, jueves 25/05 a las 11am limpieza dental con Dra. López. Te llegará recordatorio 24h antes. Para cualquier cambio respondé acá. ¿Algo más?"',
          'En el pipeline aparece automáticamente "María García - Limpieza 25/05 11am - Nuevo paciente". Recepcionista solo valida disponibilidad real (algunos bots integran con Calendly o Google Calendar).',
        ],
      },
      {
        h: 'Tipos de clínicas que sirve Wapi101',
        p: [
          '**Dentales**: Consultorios privados, cadenas de clínicas, ortodoncia, periodoncia, estética dental. Gestionar agenda, recordatorios, post-tratamiento, recurrencia.',
          '**Médicos generales y especialistas**: Consultorios privados, médicos familiares, pediatras, ginecólogos, cardiólogos. Citas, resultados de estudios por WhatsApp (con consentimiento), seguimiento.',
          '**Estética y dermatología**: Clínicas de belleza, dermatólogos, depilación láser, tratamientos faciales. Bots para precios, agenda flexible, recordatorios, post-tratamiento.',
          '**Veterinarias**: Citas para mascotas, recordatorios de vacunas, seguimiento de tratamientos, urgencias por WhatsApp.',
          '**Fisioterapia y rehabilitación**: Sesiones recurrentes, recordatorios de paquetes, seguimiento de progreso.',
          '**Spa y wellness**: Reservas de masajes, paquetes, promociones segmentadas.',
        ],
      },
      {
        h: 'Privacidad y datos sensibles',
        p: [
          'Las clínicas manejan información sensible: diagnósticos, tratamientos, datos personales. Wapi101 cumple con buenas prácticas: datos cifrados en tránsito y reposo, accesos por rol (recepcionista ve agenda, doctor ve expediente, admin ve reportes), historial de auditoría.',
          'Para casos que requieren cumplimiento HIPAA estricto (clínicas que trabajan con seguros US o pacientes internacionales con expedientes formales), recomendamos evaluar planes Enterprise. Para clínicas mexicanas atendiendo pacientes locales, Wapi101 cubre el nivel de privacidad razonable.',
          'WhatsApp es cifrado E2E entre cliente y nosotros (Cloud API Meta), eso es estándar de la industria. Para enviar resultados médicos siempre con consentimiento expreso del paciente.',
        ],
      },
    ],
    faqs: [
      ['¿Wapi101 reemplaza el sistema de expediente clínico?', 'No. Wapi101 maneja la comunicación con el paciente y agenda. El expediente clínico formal (historia, diagnósticos, recetas) sigue en tu sistema médico (Dentrix, MedicalPro, expediente físico, etc.). Convivimos vía notas en el lead o webhooks de sincronización.'],
      ['¿Puedo mandar resultados médicos por WhatsApp?', 'Técnicamente sí (con plantilla aprobada y consentimiento del paciente). Legalmente debe estar autorizado por el paciente. Recomendamos un disclaimer al inicio de relación: "Acepto recibir comunicaciones y resultados por este medio". La mayoría de clínicas ya lo hace.'],
      ['¿Cómo reduzco el no-show con Wapi101?', 'Triple recordatorio: confirmación inmediata + 24h antes + 2h antes. Solicitar confirmación expresa ("Responde SI"). Si no confirma 2h antes, reagendar automáticamente y liberar slot. Esto reduce no-show de 25% a 5-8% típicamente.'],
      ['¿Puedo cobrar consulta con señal por WhatsApp?', 'Sí, integramos Stripe y MercadoPago. Bot genera link de pago, paciente paga señal (ej. MXN $200 de MXN $1,200 total), confirma cita. Reduce no-show casi a 0% en consultas con señal.'],
      ['¿Cómo cumplo con NOM-024-SSA3-2010 (expediente clínico)?', 'Esa norma aplica al expediente clínico formal, no a comunicación por WhatsApp. Tu expediente sigue en tu sistema médico autorizado. Wapi101 es complemento de comunicación.'],
      ['¿Funciona para una clínica grande con varios doctores?', 'Sí. Plan Business hasta 15 usuarios. Cada doctor tiene su agenda propia, sus pacientes asignados, su pipeline. Recepcionista ve consolidado.'],
      ['¿Cuánto tarda implementar?', 'Setup técnico (conectar WhatsApp, configurar bot, plantillas): 3-4 horas. Capacitación de recepcionistas y doctores: 1 semana con uso diario. Acompañamos por WhatsApp el primer mes.'],
      ['¿Y si el doctor no quiere usar el sistema?', 'No necesita usarlo. Es para recepcionistas y staff administrativo principalmente. El doctor solo recibe agenda al inicio del día por WhatsApp ("Hoy tienes: 9am Juan, 10am María, ...") y los recordatorios funcionan automático sin que toque nada.'],
      ['¿Tenés integración con Google Calendar?', 'Sí, vía sync. Las citas creadas en Wapi101 se reflejan en Google Calendar y viceversa. Útil para doctores acostumbrados a ver agenda en Calendar.'],
      ['¿Puedo mandar promociones masivas?', 'Sí, vía plantillas aprobadas. Importante: solo a pacientes con opt-in expreso (recomendamos pedirlo en consulta o ficha inicial). Promociones segmentadas (ej: "limpieza dental con 20% off para pacientes sin visita en 6+ meses") funcionan muy bien.'],
    ],
  },

  'crm-inmobiliaria': {
    type: 'topic',
    slug: 'crm-inmobiliaria',
    title: 'CRM Inmobiliario 2026: Leads, visitas y seguimiento por WhatsApp',
    description: 'CRM para inmobiliarias en México: captura leads de portales, agenda visitas por WhatsApp, asigna a asesor, sigue el deal hasta firma. Multicanal y bots desde MXN $149/mes.',
    keywords: 'crm inmobiliario mexico, software inmobiliaria pyme, leads inmobiliaria whatsapp, agendar visitas propiedades, crm broker bienes raices, gestion leads inmobiliaria, automatizar inmobiliaria whatsapp, crm agente inmobiliario',
    hero: 'En inmobiliarias mexicanas los leads llegan de mil lados: Inmuebles24, Vivanuncios, Facebook Ads, Instagram, sitio web, recomendaciones. El problema: el 40% se pierde porque nadie responde a tiempo o el seguimiento se diluye. Un CRM inmobiliario con WhatsApp captura, califica y nutre cada lead hasta cerrar.',
    cta: 'Probar Wapi101 gratis 14 días en tu inmobiliaria',
    features: [
      'Captura automática de leads desde portales (Inmuebles24, Vivanuncios, Lamudi)',
      'Asignación round-robin o por zona/tipo de propiedad a asesor',
      'Pipeline visual: Nuevo, Calificado, Visita agendada, Negociación, Cerrado',
      'Bot que pregunta presupuesto, zona, recamaras, tiempo de compra',
      'Agendar visitas con asesor + envío de ubicación + recordatorios',
      'Plantillas WhatsApp para fotos/videos de propiedades, fichas técnicas',
      'Multicanal: WhatsApp + Instagram (muchas inmobiliarias venden por IG)',
      'Reportes: lead por fuente, conversión por asesor, tiempo a cierre',
    ],
    sections: [
      {
        h: 'El embudo inmobiliario y dónde se pierden ventas',
        p: [
          'Una inmobiliaria mediana mexicana genera 100-300 leads/mes vía portales, redes y referidos. De esos, ~60% no obtienen respuesta en menos de 1 hora (cuando ya están viendo otras opciones). Otro 20% se pierde en el seguimiento (asesor olvida llamar, no manda fotos, no agenda visita). Resultado: ~20% se vuelve oportunidad real y de esas se cierran 10-20%.',
          'El CRM correcto cambia esos números: respuesta automática en menos de 30 segundos (bot da bienvenida y captura datos), asignación inmediata a asesor con notificación, seguimiento estructurado en pipeline. Inmobiliarias que implementan bien pasan de 2-3% conversión total a 5-8%, duplicando o triplicando cierres con el mismo flujo de leads.',
        ],
      },
      {
        h: 'Casos de uso concretos en inmobiliaria',
        p: [
          '**Captura desde portal**: Lead nuevo en Inmuebles24 llega vía webhook. Bot manda mensaje automático: "Hola {nombre}, gracias por tu interés en {propiedad}. Soy el asistente virtual de {inmobiliaria}. Cuéntame: ¿es para comprar o rentar?" Lead entra a pipeline "Nuevo", asignado a asesor de zona.',
          '**Calificación automática**: Bot pregunta: presupuesto (MXN/USD), zona deseada, recamaras, baños, tiempo de compra (ya, 3 meses, 6 meses), si tiene crédito aprobado o cash. Etiqueta lead como "Caliente" (compra en 30 días con crédito listo) o "Frío" (curiosidad sin presupuesto definido).',
          '**Mostrar propiedades**: Cliente pregunta "Departamentos 2 recámaras Polanco". Bot muestra catálogo de 3-5 propiedades con foto, precio, m², link a tour virtual. Si interesa alguna, "Quiero visitarla".',
          '**Agendar visita**: Bot pregunta día y horario preferido, valida con calendario del asesor, confirma. Manda ubicación de la propiedad. Recordatorio 24h antes y 2h antes.',
          '**Seguimiento post-visita**: 24h después de visita: "{Nombre}, ¿qué te pareció la propiedad? Cuéntame qué te gustó y qué no para mostrarte opciones mejores."',
          '**Nutrición a largo plazo**: Lead frío (compra en 6+ meses) entra a flujo automatizado de newsletter mensual con propiedades nuevas, tips de crédito, tendencias del mercado. Cuando reactiva interés vuelve a asesor.',
        ],
      },
      {
        h: 'Plantillas WhatsApp típicas inmobiliarias',
        p: [
          '**Bienvenida lead nuevo**: "Hola {nombre}, gracias por tu interés en {propiedad}. Soy {asesor} de {inmobiliaria}. Cuéntame qué buscas exactamente y te muestro las mejores opciones que tenemos disponibles."',
          '**Envío de propiedad**: "{Nombre}, mira esta propiedad: {nombre_prop} en {zona}. {recamaras} rec, {banos} baños, {m2}m². Precio: {precio}. Aquí va el tour virtual: {link}. ¿Te interesa visitarla?"',
          '**Confirmación de visita**: "{Nombre}, confirmamos visita el {fecha} a las {hora} en {direccion}. Te recibirá {asesor}. Aquí va la ubicación: {ubicacion}. Llega 10 min antes."',
          '**Recordatorio visita**: "Hola {nombre}, mañana {fecha} a las {hora} tienes visita a la propiedad en {direccion}. ¿Confirmas? Responde SÍ o reagendar."',
          '**Post-visita**: "{Nombre}, ¿cómo te pareció la propiedad de hoy? Cuéntame qué te gustó y qué te detiene. Si quieres ver opciones similares te las mando."',
          '**Cierre/firma**: "¡Felicidades {nombre}! Estás un paso de tu nuevo hogar. Para firmar contrato necesito: 1) Identificación oficial, 2) Comprobante de domicilio, 3) Comprobante de ingresos. Mándame fotos por aquí."',
          '**Reactivación lead frío**: "Hola {nombre}, hace meses platicamos sobre departamentos en {zona}. Tenemos nuevas opciones que podrían interesarte. ¿Sigues buscando?"',
        ],
      },
      {
        h: 'Ejemplo de bot: calificar lead nuevo',
        p: [
          'Lead nuevo entra desde Inmuebles24. Bot manda: "Hola {nombre}! Gracias por tu interés. Para mostrarte las mejores opciones cuéntame: ¿es para comprar o rentar?"',
          'Cliente: "Comprar"',
          'Bot: "Perfecto, ¿qué presupuesto manejas? 1) Hasta 2M, 2) 2-4M, 3) 4-7M, 4) 7M+"',
          'Cliente: "2"',
          'Bot: "Listo. ¿Qué zona te interesa? Polanco, Roma, Condesa, Del Valle, Coyoacán, Otra"',
          'Cliente: "Roma"',
          'Bot: "Genial. ¿Cuántas recámaras necesitas? 1, 2, 3, 4+"',
          'Cliente: "2"',
          'Bot: "¿En cuánto tiempo estás pensando comprar? 1) Ya tengo crédito aprobado, 2) En 1-3 meses, 3) En 6 meses, 4) Solo explorando"',
          'Cliente: "1"',
          'Bot: "Excelente, eres un lead caliente. {Asesor} te va a contactar en los próximos 15 minutos para mostrarte 3-5 opciones específicas. Mientras puedes ver nuestro catálogo: {link}"',
          'En el pipeline: Lead aparece automáticamente etiquetado "Caliente - Roma - 2 rec - 2-4M - Crédito listo". Asesor recibe notificación inmediata, abre conversación y continúa.',
        ],
      },
      {
        h: 'Asignación inteligente a asesores',
        p: [
          'Wapi101 soporta varios modelos de asignación: (1) **Round-robin**: cada lead nuevo va al siguiente asesor en lista, distribuyendo equitativamente. (2) **Por zona**: cada asesor cubre zonas específicas (Polanco → Carlos, Roma → Ana). (3) **Por tipo**: residencial → equipo A, comercial → equipo B. (4) **Por idioma**: leads en inglés → asesor bilingüe.',
          'Una vez asignado, el lead aparece en el pipeline personal del asesor. Si en 30 minutos no respondió, escalación automática a supervisor (configurable). Esto fuerza disciplina de respuesta rápida sin micromanagement.',
        ],
      },
      {
        h: 'Multicanal: Instagram y propiedades visuales',
        p: [
          'Inmobiliarias dependen mucho de fotos y videos: los clientes deciden visitar o no según lo que ven. Instagram es canal natural para esto. Las inmobiliarias publican reels, stories, posts de propiedades y reciben DMs preguntando "Cuánto?", "Disponible?", "Dónde queda?".',
          'Wapi101 unifica IG con WhatsApp: los DMs entran a la misma bandeja, mismos asesores responden, mismo pipeline. El lead que llegó por IG puede pasar a WhatsApp para la conversación más larga (mandar PDF de propiedad, fotos de alta resolución, contrato). Todo queda en el mismo expediente.',
          'Bonus: Messenger también si tenés Facebook Page con publicidad Meta. Telegram raramente útil en este vertical.',
        ],
      },
    ],
    faqs: [
      ['¿Cómo integro Wapi101 con Inmuebles24 o Vivanuncios?', 'Vía webhooks. Configurás un webhook en el portal apuntando a Wapi101 y cada lead nuevo entra automáticamente al pipeline. Si el portal no soporta webhook, podés usar Zapier o nuestro endpoint manual.'],
      ['¿Funciona para una inmobiliaria pequeña de 2 asesores?', 'Sí. Plan Pro MXN $299/mes cubre 5 usuarios. Pipeline simple, bot básico de captura, plantillas para mostrar propiedades. Listos en 1-2 días.'],
      ['¿Sirve para inmobiliarias comerciales (oficinas, locales)?', 'Sí. La estructura es similar: leads entran, calificación (m², ubicación, uso), agenda de visita, seguimiento, cierre. Ajustás campos del lead a tu vertical (m² ocupables, estacionamientos, contrato meses).'],
      ['¿Cómo gestiono catálogo de 200 propiedades?', 'Dos opciones: (1) Vía catálogo WhatsApp oficial sincronizado con tu base de propiedades (recomendado). (2) Plantillas pre-armadas por categoría que asesor manda manualmente. La opción 1 escala mejor.'],
      ['¿Puedo segmentar por etapa de compra?', 'Sí. Etiquetá automáticamente: "Curioso" (sin presupuesto definido), "Activo" (busca 1-3 meses), "Caliente" (con crédito aprobado), "Cerrando" (negociación). Cada segmento recibe comunicaciones distintas.'],
      ['¿Tenés reportería para gerentes de venta?', 'Sí: leads por fuente (Inmuebles24 vs Vivanuncios vs Facebook Ads vs orgánico), conversión por asesor, tiempo promedio a visita, tiempo a cierre, valor de pipeline. Datos para decisiones reales.'],
      ['¿Cómo manejo leads que no quieren comprar pronto?', 'Vía nutrición automática. Lead etiquetado "Frío" entra a flujo de newsletter mensual con propiedades nuevas, tips, tendencias. Si reactiva interés vuelve a asesor.'],
      ['¿Wapi101 reemplaza Salesforce o Bitrix para inmobiliaria?', 'Para inmobiliarias chicas-medianas (1-15 asesores), sí. Para corporativos con 50+ asesores, regiones, comisiones complejas, evaluá Salesforce con add-ons inmobiliarios.'],
      ['¿Tenés casos de éxito en inmobiliaria?', 'Sí, varios brokers en CDMX, Monterrey y Guadalajara. Mejoraron tiempo de respuesta de horas a minutos y conversión 2-3x. Compartimos referencias en llamada.'],
      ['¿Puedo cobrar apartado de propiedad por WhatsApp?', 'Sí. Integración Stripe/MercadoPago genera link, cliente paga apartado vía link, queda registrado en su expediente. Reduce mucho la fricción del proceso de cierre.'],
    ],
  },

  'crm-ecommerce': {
    type: 'topic',
    slug: 'crm-ecommerce',
    title: 'CRM para Ecommerce 2026: Carritos abandonados y post-venta WhatsApp',
    description: 'CRM ecommerce: recupera carritos abandonados con WhatsApp, automatiza post-venta, soporte multicanal, upsell. Integración Shopify/WooCommerce. Desde MXN $149/mes.',
    keywords: 'crm ecommerce mexico, carrito abandonado whatsapp, recuperacion carrito shopify, post venta whatsapp, crm woocommerce, soporte ecommerce whatsapp, automatizacion ecommerce latam, crm tienda online',
    hero: 'En ecommerce mexicano, el 70% de los carritos se abandonan sin comprar. WhatsApp tiene 95% apertura vs email 18%. Combiná las dos cosas con CRM y recuperá 15-25% de carritos perdidos. Más: post-venta, soporte, upsell, todo desde un solo dashboard multicanal.',
    cta: 'Probar Wapi101 gratis 14 días en tu tienda online',
    features: [
      'Integración nativa con WooCommerce (plugin oficial Wapi101)',
      'Webhooks para Shopify, Tiendanube, VTEX, BigCommerce',
      'Bot que recupera carrito abandonado a las 1h, 24h y 72h',
      'Post-venta automática: confirmación, envío, entrega, reseña',
      'Soporte multicanal: WhatsApp + Instagram + Messenger',
      'Plantillas para promociones segmentadas (clientes nuevos vs recurrentes)',
      'Atención por chat con catálogo de productos integrado',
      'Reportes: % recuperación carritos, ticket promedio, LTV cliente',
    ],
    sections: [
      {
        h: 'Carritos abandonados: el oro perdido del ecommerce',
        p: [
          'En ecommerce mexicano (Shopify, WooCommerce, Tiendanube, Mercado Libre propio), 65-75% de los clientes que agregan al carrito no completan compra. Las razones: distracción, comparar precios en otra pestaña, costos de envío sorpresa, dudas no resueltas, simplemente cambiar de opinión.',
          'Las herramientas tradicionales de recuperación son email (apertura 15-20%) y push notifications (apertura 5-10%). WhatsApp tiene 90%+ apertura en menos de 1 hora, lo que cambia completamente la economía: una secuencia bien diseñada puede recuperar 15-25% de carritos abandonados.',
          'Para una tienda con MXN $300,000/mes en ventas, recuperar 20% de carritos abandonados puede significar MXN $30,000-60,000 adicionales mensuales. ROI del CRM se paga en días.',
        ],
      },
      {
        h: 'Secuencia ideal de recuperación de carrito',
        p: [
          '**1 hora después del abandono**: Mensaje suave, recordatorio. "Hola {nombre}, vi que tenías {producto} en tu carrito. ¿Tuviste alguna duda? Estoy para ayudarte." Tasa de recuperación: 40% de los que recuperan.',
          '**24 horas después**: Mensaje con valor agregado. "Hola {nombre}, sigues interesado en {producto}? Te aplico envío gratis si terminas la compra hoy. Aquí va tu link: {link}". Tasa: 30% de los que recuperan.',
          '**72 horas después**: Última llamada con incentivo. "{Nombre}, tu carrito está por expirar. Si compras hoy te aplico 10% off. Código: VUELVE10. Link: {link}". Tasa: 20%.',
          '**1 semana después**: Si no recuperaste, lead pasa a flujo de nutrición general (newsletter, promos mensuales). 10% restante.',
          'Estas tasas son típicas. Tiendas con productos de ticket alto (>MXN $2,000) suelen recuperar más; tiendas con tickets bajos (<MXN $500) recuperan menos pero compensan por volumen.',
        ],
      },
      {
        h: 'Casos de uso en ecommerce',
        p: [
          '**Recuperación carrito Shopify/WooCommerce**: Cliente abandona en checkout. Webhook dispara secuencia automática WhatsApp. Cliente puede continuar con un click al link guardado. Recuperación 15-25%.',
          '**Confirmación de compra y tracking**: Compra exitosa → WhatsApp inmediato "Gracias por tu compra de {productos}. Total: {total}. Pago confirmado. Te aviso cuando envíe." Envío → "Tu paquete va en camino con {paqueteria}. Tracking: {link}." Entrega → "¿Recibiste tu pedido? ¿Cómo te fue?" Reduce 80% de los tickets "dónde está mi pedido".',
          '**Soporte conversacional**: Cliente pregunta antes de comprar ("Tallas disponibles?", "Color X tienen?", "Cuánto tarda envío a Tijuana?"). Bot responde automático con info de catálogo o deriva a humano. Resuelve 60% de consultas sin tocar tiempo del equipo.',
          '**Upsell y cross-sell**: Cliente compró {producto}. A los 7 días: "Hola {nombre}, hace una semana compraste {producto}. Te puede interesar {accesorio_complementario}. Llévatelo con 15% off." Aumenta LTV 20-30%.',
          '**Reseñas post-venta**: 7-14 días después de recibir producto: "¿Cómo te fue con {producto}? Si te gustó te invitamos a dejar reseña: {link}." Reseñas auténticas suben conversión de tienda.',
          '**Recuperación de clientes inactivos**: Cliente compró hace 90+ días y no volvió. Pipeline lo etiqueta "Inactivo". Promo segmentada: "Te extrañamos {nombre}! Tenemos novedades que podrían interesarte + 15% off. Mira: {link}".',
        ],
      },
      {
        h: 'Plantillas WhatsApp típicas ecommerce',
        p: [
          '**Recuperación carrito 1h**: "Hola {nombre}! Vi que dejaste {producto} en tu carrito. ¿Tuviste alguna duda? Recordá que tu carrito queda guardado: {link_carrito}"',
          '**Recuperación 24h con incentivo**: "{Nombre}, tu {producto} sigue esperándote. Si finalizás hoy te aplico envío gratis. Link: {link_carrito}"',
          '**Confirmación de pedido**: "¡Gracias por tu compra {nombre}! Pedido #{numero}: {productos}. Total: {total}. Pago confirmado. Te aviso cuando envíe."',
          '**Notificación de envío**: "Tu pedido #{numero} salió hoy con {paqueteria}. Llega en {dias_estimados}. Tracking: {link_tracking}"',
          '**Entrega**: "{Nombre}, ¿ya recibiste tu pedido? Cualquier problema escribime acá."',
          '**Post-venta reseña**: "Hola {nombre}, hace unos días recibiste {producto}. ¿Qué te pareció? Tu opinión nos ayuda. Si querés dejar reseña: {link_resena}"',
          '**Promo segmentada**: "{Nombre}, sabíamos que te gustaba {categoria}. Tenemos novedades + 15% off código BIENVENIDA15. Tienda: {link}"',
          '**Cliente inactivo**: "{Nombre}, hace tiempo que no te vemos por la tienda! Llegaron novedades y un descuento especial para vos: {link}"',
        ],
      },
      {
        h: 'Ejemplo de bot: asistente de compra con catálogo',
        p: [
          'Cliente: "Hola, busco una mochila para laptop"',
          'Bot: "¡Hola! Te muestro nuestras mochilas para laptop. ¿Qué tamaño de laptop tenés? 13", 14", 15", 16-17"?"',
          'Cliente: "15"',
          'Bot: "Perfecto, te muestro mochilas para 15": (muestra catálogo de 4-5 productos con foto, precio, link). ¿Alguna te interesa?"',
          'Cliente: "La negra que vale 890"',
          'Bot: "¡Buena elección! Esa mochila tiene compartimento acolchado, USB charging port, y 30L de capacidad. Disponible en negro y gris. ¿Querés que te genere link de compra?"',
          'Cliente: "Sí"',
          'Bot: "Listo {nombre}, aquí va tu link directo de compra: {link}. Si tenés código de descuento aplicalo en el checkout. Cualquier duda volvé a escribir!"',
        ],
      },
      {
        h: 'Integraciones técnicas',
        p: [
          '**WooCommerce**: Plugin oficial Wapi101 para WordPress. Instalación: 5 minutos. Sincroniza pedidos, clientes, carritos abandonados automáticamente. Webhooks bidireccionales.',
          '**Shopify**: Vía webhooks nativos Shopify y nuestro endpoint. Setup: 30 minutos. Cubre eventos: pedido nuevo, pago confirmado, envío, entrega, carrito abandonado.',
          '**Tiendanube**: Vía webhooks. Setup: 1 hora con nuestra ayuda.',
          '**VTEX, BigCommerce, Magento**: Vía webhooks personalizados. Setup: variable según plataforma.',
          '**Mercado Libre propio (no marketplace)**: Posible vía API pero más complejo. Consultá caso específico.',
        ],
      },
    ],
    faqs: [
      ['¿Funciona con mi Shopify actual?', 'Sí. Setup vía webhooks toma 30 min con nuestro onboarding. Sincronizamos pedidos, clientes, carritos abandonados, envíos. Funciona con Shopify estándar y Shopify Plus.'],
      ['¿Tengo WooCommerce, hay plugin?', 'Sí, plugin oficial Wapi101 para WordPress. Lo instalás como cualquier plugin, configurás API key, y listo. Sincroniza todo automáticamente.'],
      ['¿Qué tasa de recuperación de carritos puedo esperar?', '15-25% es el rango típico para tiendas que implementan secuencia de 3 mensajes (1h, 24h, 72h) bien diseñados. Algunos llegan a 30% en productos de ticket alto. <10% suele indicar que las plantillas no convencen o el incentivo no es atractivo.'],
      ['¿Es legal contactar a clientes de carrito abandonado por WhatsApp?', 'Sí si tienen opt-in expreso (checkbox en checkout: "Acepto recibir comunicaciones por WhatsApp"). Sin opt-in es contra políticas de Meta y puede resultar en baneo. Te ayudamos a configurar opt-in correcto.'],
      ['¿Puedo hacer broadcast a toda mi base de clientes?', 'Sí, vía plantillas aprobadas, segmentado por clientes con opt-in. NO hacer broadcast no segmentado a base completa (afecta tasa de queja y puede generar limitación de Meta). Recomendamos segmentos chicos-medianos con mensaje específico.'],
      ['¿Tenés integración con Mercado Pago / Stripe?', 'Sí. Bot puede generar link de pago vía MercadoPago/Stripe en medio de conversación. Útil para ventas que cierran en chat sin pasar por checkout web.'],
      ['¿Funciona para tienda con 10 productos vs 5000 productos?', 'Ambos. Para 10 productos: plantillas pre-armadas o bot que muestra todos. Para 5000: catálogo WhatsApp oficial sincronizado o el bot pregunta filtros antes de mostrar.'],
      ['¿Reemplaza Klaviyo o Mailchimp?', 'No directamente. Klaviyo/Mailchimp son fuertes en email. Wapi101 es WhatsApp/IG/Messenger. Estrategia ideal: usar ambos. Email para newsletters largos y nurturing, WhatsApp para acción inmediata (carritos, post-venta).'],
      ['¿Cuánto tarda implementar en mi tienda?', 'Para WooCommerce: 1-2 horas. Para Shopify: 2-3 horas. Para custom: 4-8 horas. Acompañamos por WhatsApp todo el setup gratis.'],
      ['¿Cuál es el ROI típico?', 'Depende del volumen. Tiendas con MXN $100k+ ventas mensuales recuperan la inversión en plan Pro (MXN $299) en la primera semana solo con carritos abandonados. Tiendas con MXN $500k+ típicamente sumar 10-15% a sus ventas totales en el primer mes.'],
    ],
  },

  'api-whatsapp-business': {
    type: 'topic',
    slug: 'api-whatsapp-business',
    title: 'API WhatsApp Business 2026: Guía completa Cloud API + Wapi101',
    description: 'Guía API WhatsApp Business 2026: Cloud API vs On-Premise, costos por mensaje, cómo conectar, multi-agente, bots, plantillas. Acceso a WhatsApp API oficial Meta desde MXN $149/mes.',
    keywords: 'api whatsapp business, whatsapp cloud api, whatsapp business api precio, conectar api whatsapp, tech provider whatsapp, api whatsapp mexico, whatsapp api oficial, integrar whatsapp business api',
    hero: 'WhatsApp Business API (oficialmente WhatsApp Cloud API) es la forma oficial de Meta para que empresas atiendan WhatsApp a escala: múltiples agentes, bots automáticos, plantillas masivas, integraciones. Esta guía explica todo: qué es, cuánto cuesta, cómo conectar, y por qué Wapi101 es la opción mexicana más simple.',
    cta: 'Probar Wapi101 con WhatsApp Cloud API gratis 14 días',
    features: [
      'Conexión directa con WhatsApp Cloud API oficial Meta (sin aggregators)',
      'Multi-agente: varios vendedores atienden el mismo número simultáneo',
      'Bots automáticos con condiciones y plantillas dinámicas',
      'Envío masivo de plantillas aprobadas (broadcast segmentado)',
      'Soporte tipo Meta Tech Provider para alta de números nuevos',
      'Migración de número existente de WhatsApp Business al API',
      'Integración con Shopify, WooCommerce, ERPs vía webhooks',
      'Costos transparentes de Meta sin markup adicional por mensaje',
    ],
    sections: [
      {
        h: '¿Qué es WhatsApp Business API?',
        p: [
          'WhatsApp Business API es el servicio oficial de Meta para que empresas se conecten a WhatsApp programáticamente: en vez de usar la app WhatsApp Business en un celular (limitada a 1 dispositivo, sin multi-agente), las empresas conectan vía API y pueden tener múltiples vendedores atendiendo, bots automáticos, broadcasts masivos.',
          'Existen dos versiones: **WhatsApp Cloud API** (la actual, hosteada por Meta, recomendada desde 2022) y **WhatsApp On-Premise API** (legacy, hosteada por el cliente, en deprecation gradual). La Cloud API es la forma estándar moderna.',
          'WhatsApp Business API NO es lo mismo que WhatsApp Web ni WhatsApp Business app. Es una API REST oficial Meta con flujos de aprobación, costos por mensaje según tipo, y reglas estrictas sobre lo que podés enviar.',
        ],
      },
      {
        h: '¿Cuánto cuesta WhatsApp Cloud API?',
        p: [
          'Meta cobra por **conversación** (no por mensaje individual). Una conversación dura 24 horas desde el primer mensaje empresa→cliente. Dentro de esas 24h podés mandar mensajes ilimitados sin costo adicional.',
          'Tipos de conversación y costos aproximados México (2026):',
          '- **Servicio** (iniciada por cliente): GRATIS las primeras 1,000/mes. Después ~MXN $0.10 por conversación.',
          '- **Marketing** (iniciada por empresa con plantilla): ~MXN $0.70-1.20 según país.',
          '- **Utilidad** (notificaciones de envío, recordatorios, post-venta): ~MXN $0.25-0.50.',
          '- **Autenticación** (códigos OTP): ~MXN $0.10-0.20.',
          'Estos son costos oficiales Meta. Algunos aggregators agregan markup encima (USD $0.005-0.02 por mensaje extra). **Wapi101 NO agrega markup**: pagás los costos oficiales Meta exactos.',
          'Para una PyME con 1,000-5,000 conversaciones/mes (mix servicio + utilidad + algunas marketing), el costo Meta mensual ronda MXN $300-1,500. Wapi101 cobra solo la licencia del software (MXN $149-499) sobre eso.',
        ],
      },
      {
        h: 'WhatsApp Cloud API vs WhatsApp Web (no oficial)',
        p: [
          'Algunas plataformas ofrecen "WhatsApp API" usando WhatsApp Web (Baileys, Whatsapp-Web.js, OpenWA). Conectan vía sesión QR como si fueras un celular, y simulan multi-agente.',
          '**Problemas de WhatsApp Web no oficial**: (1) Meta puede banear tu número en cualquier momento (es contra ToS), (2) Limitado en volumen de mensajes, (3) Sin plantillas masivas oficiales, (4) Sin garantía de uptime, (5) Riesgo legal y operativo.',
          '**WhatsApp Cloud API oficial**: (1) Aprobado por Meta, sin riesgo de baneo, (2) Multi-agente sin límite real, (3) Plantillas masivas aprobadas, (4) Uptime garantizado Meta SLA, (5) Cumplimiento legal y empresarial.',
          'Si tu negocio depende de WhatsApp para operar, Cloud API oficial es la única opción seria. WhatsApp Web es para experimentos o casos muy pequeños donde el riesgo de baneo no preocupa.',
        ],
      },
      {
        h: 'Cómo conectar WhatsApp Cloud API (vía Wapi101)',
        p: [
          '**Paso 1: Cuenta Meta Business Manager**. Si no tenés, creás una gratis en business.facebook.com. Toma 10 min.',
          '**Paso 2: Verificar negocio**. Meta requiere verificación de identidad del negocio (documentos: acta constitutiva o RFC, comprobante de domicilio comercial). Aprobación en 1-7 días.',
          '**Paso 3: Configurar número WhatsApp**. Podés migrar tu número actual de WhatsApp Business (perdés WhatsApp en celular, ganás Cloud API) o usar un número nuevo. Toma 1-2 horas.',
          '**Paso 4: Conectar a Wapi101**. Desde la app, seguís wizard de conexión: autorizás con Meta, elegís tu cuenta, listo. 5 minutos.',
          '**Paso 5: Configurar plantillas**. Diseñás plantillas (saludos, confirmaciones, promos) y las mandás a aprobación Meta desde dentro de Wapi101. Aprobación 1-24h.',
          '**Paso 6: Empezar a usar**. Multi-agente, bots, broadcasts. Tu equipo entrena 2-3 días.',
          'Total: implementación completa en 1-2 semanas si todo va bien (depende mayormente del tiempo de verificación Meta). Wapi101 te acompaña por WhatsApp directo durante todo el proceso.',
        ],
      },
      {
        h: 'Plantillas WhatsApp: qué son y por qué importan',
        p: [
          'Para iniciar conversación con un cliente (fuera de las 24h de respuesta libre), Meta requiere usar una **plantilla aprobada**. Es un mensaje pre-aprobado que podés mandar masivamente con variables ({nombre}, {fecha}, {producto}).',
          '**Ejemplos**: "Hola {nombre}, confirmamos tu cita el {fecha} a las {hora}", "Tu pedido #{numero} fue enviado, tracking: {link}", "Hola {nombre}, promo especial 20% off este viernes".',
          '**Proceso**: Diseñás plantilla en Wapi101, la mandás a aprobación Meta, esperás 1-24h, y queda disponible para envío masivo. Rechazos típicos: contenido promocional engañoso, mayúsculas excesivas, llamadas a acción agresivas.',
          'Wapi101 incluye editor visual de plantillas con preview, validación pre-envío, y tracking de aprobación. La mayoría de plantillas las aprueba Meta en menos de 4 horas si están bien diseñadas.',
        ],
      },
      {
        h: 'Casos de uso reales del API',
        p: [
          '**E-commerce**: Confirmación de pedido, tracking de envío, post-venta, recuperación de carrito, soporte. Una tienda típica manda 5-10 conversaciones por pedido completado.',
          '**Restaurantes**: Confirmación de reserva, recordatorios, menú del día, promociones masivas, post-visita.',
          '**Clínicas**: Confirmación de cita, recordatorios 24h y 2h, resultados de estudios, seguimiento post-tratamiento.',
          '**Inmobiliarias**: Captura de leads, mostrar propiedades, agenda de visitas, seguimiento, nutrición de leads fríos.',
          '**Bancos y fintech**: Códigos OTP de autenticación, alertas de movimientos, notificaciones de pago.',
          '**Educación**: Recordatorios de clase, envío de tareas, comunicación con padres, seguimiento académico.',
          '**Logística**: Tracking de paquetes, notificaciones de entrega, coordinación de horarios.',
          'En todos estos verticales, WhatsApp API es la forma estándar moderna de operar. Quien sigue gestionando WhatsApp desde celular pierde eficiencia y se queda atrás.',
        ],
      },
      {
        h: '¿Por qué Wapi101 vs otros proveedores de API?',
        p: [
          'En el mercado hay aggregators tradicionales (Twilio, MessageBird, 360dialog, Vonage) que cobran USD $0.005-0.02 markup por mensaje encima del costo Meta. Para volúmenes medianos (10k mensajes/mes) son USD $50-200 extra mensuales solo en markup.',
          'Wapi101 es Meta Tech Provider directo: pagás solo los costos oficiales Meta exactos, sin markup nuestro. Sumás MXN $149-499/mes de licencia software (no cobramos por mensaje).',
          'Además: aggregators son solo API, vos tenés que armar UI, bots, plantillas, multi-agente. Wapi101 te da el API + la aplicación CRM completa lista para usar. Para PyMEs es 10x más eficiente.',
          'Si sos empresa enterprise con dev team y querés solo API pelado para integrar en tu stack propio, Twilio/MessageBird tienen sentido. Si querés solución llave en mano, Wapi101.',
        ],
      },
    ],
    faqs: [
      ['¿Necesito ser Meta Tech Provider yo mismo?', 'No. Wapi101 es Tech Provider y te conecta directo. Vos solo necesitás cuenta Meta Business verificada. Eso lo hacés en 1-2 horas con nuestra ayuda.'],
      ['¿Puedo migrar mi número actual de WhatsApp Business?', 'Sí, es lo más común. Proceso oficial Meta, gratis. Toma 1-2 horas. Perdés WhatsApp en celular pero ganás multi-agente, bots, plantillas, todo. El número sigue siendo tuyo.'],
      ['¿Y si pierdo el celular o cambio de número?', 'El número en Cloud API está asociado a tu cuenta Meta Business, no a un celular físico. Si perdés celular no pasa nada. Si cambiás de número, hay proceso de migración (Meta requiere verificación adicional).'],
      ['¿Cuánto tardan en aprobar las plantillas?', 'Generalmente 1-4 horas para plantillas estándar bien diseñadas. Para plantillas promocionales o complejas, hasta 24h. Rechazos comunes: lenguaje engañoso, mayúsculas excesivas, llamadas a acción agresivas. Wapi101 valida antes de enviar a Meta.'],
      ['¿Puedo mandar mensajes a clientes que no me escribieron primero?', 'Sí, vía plantillas aprobadas y con opt-in del cliente (recomendado checkbox en checkout o ficha). Sin opt-in es contra políticas Meta y puede limitar tu cuenta.'],
      ['¿WhatsApp Cloud API soporta archivos, ubicación, contactos?', 'Sí: texto, imágenes, videos, audios, documentos PDF, ubicación geográfica, contactos vCard, stickers, plantillas con botones interactivos, carruseles de productos. La API es bastante completa.'],
      ['¿Hay límite de mensajes por día?', 'No hay límite duro. Hay tiers de calidad Meta: empezás en tier bajo (1k iniciaciones por día), si tu tasa de respuesta y queja es buena Meta te sube a 10k, 100k, ilimitado. Es proceso automático según comportamiento.'],
      ['¿Puedo conectar 2 números distintos en una cuenta?', 'Sí. En Wapi101 plan Business soportás hasta 3 números WhatsApp en el mismo workspace (ej: ventas, soporte, otra sucursal), cada uno con su pipeline y equipo.'],
      ['¿Y si Meta cambia las políticas?', 'Riesgo real pero bajo. Meta cambia detalles (costos, tipos de plantilla, features) pero los cambios suelen ser pre-anunciados con meses. Como Tech Provider, Wapi101 te avisa con tiempo y adapta el producto.'],
      ['¿Cómo empiezo si nunca tuve WhatsApp Business API?', 'Agendá una llamada con nosotros (link en wapi101.com). En 30 min te guiamos por todo: cuenta Meta, verificación, número, conexión a Wapi101, primeras plantillas. Setup completo en 3-5 días normalmente.'],
    ],
  },

};

module.exports = { PAGES, WAPI101 };
