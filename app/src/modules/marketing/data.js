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

};

module.exports = { PAGES, WAPI101 };
