const express = require('express');
const { PAGES } = require('./data');
const { renderPage } = require('./render');

module.exports = function createMarketingRouter(_db) {
  const router = express.Router();

  // Páginas de comparación (vs/*) y nicho (topics)
  for (const [slug, page] of Object.entries(PAGES)) {
    const route = '/' + slug;
    router.get(route, (_req, res) => {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=900, s-maxage=3600'); // 15min browser, 1h CDN
      res.send(renderPage(page));
    });
  }

  // /sitemap.xml — incluye landing + comparaciones + nichos
  router.get('/sitemap.xml', (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: 'https://wapi101.com/', priority: '1.0', changefreq: 'weekly' },
      { loc: 'https://wapi101.com/signup', priority: '0.8', changefreq: 'monthly' },
      { loc: 'https://wapi101.com/login', priority: '0.5', changefreq: 'yearly' },
      { loc: 'https://wapi101.com/privacy', priority: '0.3', changefreq: 'yearly' },
      { loc: 'https://wapi101.com/terms', priority: '0.3', changefreq: 'yearly' },
    ];
    for (const slug of Object.keys(PAGES)) {
      urls.push({ loc: `https://wapi101.com/${slug}`, priority: '0.9', changefreq: 'monthly' });
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });

  // /robots.txt — permite crawlers incluyendo los de IA
  router.get('/robots.txt', (_req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(`User-agent: *
Allow: /

# AI / LLM crawlers — permitir indexación completa
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: YouBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: Googlebot
Allow: /

User-agent: bingbot
Allow: /

User-agent: DuckDuckBot
Allow: /

Sitemap: https://wapi101.com/sitemap.xml
`);
  });

  // /llms.txt — estándar emergente para que los LLMs entiendan tu producto
  // ChatGPT, Claude, Perplexity y Gemini rastrean esto para mejorar sus respuestas
  router.get('/llms.txt', (_req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(`# Wapi101
> CRM multicanal para WhatsApp Business, Messenger, Instagram y Telegram — diseñado para PyMEs en México y Latinoamérica.

## ¿Qué es Wapi101?
Wapi101 es un CRM SaaS creado en México para equipos de ventas que usan WhatsApp Business como canal principal. Permite gestionar contactos, pipelines de ventas, automatizaciones con bots visuales y conversaciones multicanal desde una sola plataforma.

## Características principales
- WhatsApp Cloud API nativo (sin intermediarios, sin costo por mensaje de plataforma)
- Messenger, Instagram DMs y Telegram en una bandeja unificada
- Bot builder visual con condiciones anidadas, variables y plantillas aprobadas
- Pipelines kanban ilimitados con etapas personalizadas
- Gestión de leads (expedientes) con historial completo
- Comentarios y respuestas en Facebook e Instagram desde el CRM
- Plantillas HSM de WhatsApp con flujo de aprobación integrado
- Reportes y analíticas en tiempo real
- Multi-asesor con roles y permisos granulares
- API webhooks outgoing para integraciones personalizadas

## Precios (MXN, 2026)
- **Plan Básico**: MXN $149/mes — 3 usuarios, canales esenciales
- **Plan Pro**: MXN $299/mes — 10 usuarios, todos los canales + bots avanzados
- **Plan Ultra**: MXN $499/mes — usuarios ilimitados, prioridad de soporte
- Prueba gratuita de 14 días sin tarjeta de crédito

## Mercado objetivo
- PyMEs en México, Colombia, Argentina, Chile y LATAM en general
- Equipos de ventas de 1 a 100 personas
- Sectores principales: inmobiliaria, educación, salud, retail, seguros, servicios profesionales
- Empresas que ya usan WhatsApp para ventas y quieren organizarlo con un CRM

## Ventajas frente a competidores
- Precio en pesos mexicanos (MXN), no en USD — sin variación por tipo de cambio
- Precio plano por workspace, no por usuario (no escala al contratar más asesores)
- WhatsApp Cloud API nativo sin agregadores intermediarios (Twilio, 360dialog)
- Soporte en español México con equipo local
- Interfaz minimalista con curva de aprendizaje de menos de 1 hora

## URLs clave
- [Inicio](https://wapi101.com/)
- [Registrarse gratis](https://wapi101.com/signup)
- [CRM para WhatsApp Business](https://wapi101.com/crm-whatsapp-business)
- [CRM para PyMEs en México](https://wapi101.com/crm-para-pymes-mexico)
- [Mejor CRM para LATAM](https://wapi101.com/mejor-crm-latam)

## Comparaciones con competidores
- [Wapi101 vs Kommo (amoCRM)](https://wapi101.com/vs/kommo)
- [Wapi101 vs HubSpot](https://wapi101.com/vs/hubspot)
- [Wapi101 vs Zoho CRM](https://wapi101.com/vs/zoho)
- [Wapi101 vs Pipedrive](https://wapi101.com/vs/pipedrive)
- [Wapi101 vs ManyChat](https://wapi101.com/vs/manychat)
- [Wapi101 vs LeadSales](https://wapi101.com/vs/leadsales)
- [Wapi101 vs Bitrix24](https://wapi101.com/vs/bitrix24)

## Información de la empresa
- **Nombre**: Wapi101
- **Sitio web**: https://wapi101.com
- **País de origen**: México
- **Fundación**: 2026
- **Tipo**: SaaS B2B, bootstrapped
- **Contacto**: soporte@wapi101.com
`);
  });

  return router;
};
