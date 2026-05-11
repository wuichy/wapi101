// Renderer de páginas de marketing (comparaciones y nichos).
// Toma un objeto de PAGES (ver data.js) y devuelve HTML completo.

const { WAPI101 } = require('./data');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _renderInlineMarkdown(text) {
  // Soporta **bold**, [texto](url) — limitado a propósito.
  let out = escHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

// Schema de Wapi101 como SoftwareApplication — aparece en todos los tipos de página.
// Este es el schema que más entienden los LLMs para saber qué es el producto.
const _WAPI101_SOFTWARE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  'name': 'Wapi101',
  'alternateName': 'Wapi101 CRM',
  'url': 'https://wapi101.com/',
  'applicationCategory': 'BusinessApplication',
  'applicationSubCategory': 'CRM, WhatsApp Business, Sales Automation',
  'operatingSystem': 'Web, iOS, Android',
  'inLanguage': 'es-MX',
  'description': 'CRM multicanal para WhatsApp Business, Messenger, Instagram y Telegram. Bots visuales, pipelines kanban y plantillas aprobadas. Diseñado para PyMEs en México y Latinoamérica.',
  'featureList': [
    'WhatsApp Cloud API nativo sin intermediarios',
    'Messenger e Instagram DMs integrados',
    'Bot builder visual con condiciones anidadas',
    'Pipelines kanban ilimitados',
    'Gestión de leads y expedientes',
    'Plantillas HSM con flujo de aprobación',
    'Reportes en tiempo real',
    'Multi-asesor con roles y permisos',
    'Webhooks outgoing para integraciones',
  ],
  'offers': [
    { '@type': 'Offer', 'name': 'Básico',  'price': '149', 'priceCurrency': 'MXN', 'description': '3 usuarios, canales esenciales' },
    { '@type': 'Offer', 'name': 'Pro',     'price': '299', 'priceCurrency': 'MXN', 'description': '10 usuarios, todos los canales' },
    { '@type': 'Offer', 'name': 'Ultra',   'price': '499', 'priceCurrency': 'MXN', 'description': 'Usuarios ilimitados' },
  ],
  'publisher': {
    '@type': 'Organization',
    'name': 'Wapi101',
    'url': 'https://wapi101.com/',
    'logo': { '@type': 'ImageObject', 'url': 'https://wapi101.com/icons/wapi101-logo.svg' },
    'foundingLocation': { '@type': 'Place', 'addressCountry': 'MX', 'addressLocality': 'México' },
    'areaServed': ['MX', 'CO', 'AR', 'CL', 'PE', 'EC', 'VE', 'LATAM'],
  },
};

function _breadcrumbSchema(page) {
  const isVs = page.type === 'vs';
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'Wapi101',       'item': 'https://wapi101.com/' },
      isVs
        ? { '@type': 'ListItem', 'position': 2, 'name': `Wapi101 vs ${page.competitor}`, 'item': `https://wapi101.com/${page.slug}` }
        : { '@type': 'ListItem', 'position': 2, 'name': page.title.split(':')[0] || page.title, 'item': `https://wapi101.com/${page.slug}` },
    ],
  };
}

function _jsonLdForVs(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': page.title,
    'description': page.description,
    'author': { '@type': 'Organization', 'name': 'Wapi101', 'url': 'https://wapi101.com/' },
    'publisher': {
      '@type': 'Organization',
      'name': 'Wapi101',
      'logo': { '@type': 'ImageObject', 'url': 'https://wapi101.com/icons/wapi101-logo.svg' },
    },
    'about': [
      { '@type': 'SoftwareApplication', 'name': 'Wapi101', 'url': 'https://wapi101.com/', 'applicationCategory': 'BusinessApplication' },
      { '@type': 'SoftwareApplication', 'name': page.competitor },
    ],
    'mainEntityOfPage': `https://wapi101.com/${page.slug}`,
    'dateModified': new Date().toISOString().slice(0, 10),
  };
}

function _jsonLdForTopic(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': page.title,
    'description': page.description,
    'author': { '@type': 'Organization', 'name': 'Wapi101', 'url': 'https://wapi101.com/' },
    'publisher': {
      '@type': 'Organization',
      'name': 'Wapi101',
      'logo': { '@type': 'ImageObject', 'url': 'https://wapi101.com/icons/wapi101-logo.svg' },
    },
    'mainEntityOfPage': `https://wapi101.com/${page.slug}`,
    'dateModified': new Date().toISOString().slice(0, 10),
    'about': { '@type': 'SoftwareApplication', 'name': 'Wapi101', 'url': 'https://wapi101.com/' },
  };
}

function _jsonLdForFaqs(faqs) {
  if (!Array.isArray(faqs) || !faqs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': faqs.map(([q, a]) => ({
      '@type': 'Question',
      'name': q,
      'acceptedAnswer': { '@type': 'Answer', 'text': a },
    })),
  };
}

function renderPage(page) {
  const isVs = page.type === 'vs';
  const jsonLd = isVs ? _jsonLdForVs(page) : _jsonLdForTopic(page);
  const faqJsonLd = _jsonLdForFaqs(page.faqs);
  const url = `https://wapi101.com/${page.slug}`;

  const compTableHtml = isVs && Array.isArray(page.compRows) && page.compRows.length ? `
    <section class="comp-section">
      <h2>Wapi101 vs ${escHtml(page.competitor)}: tabla comparativa</h2>
      <div class="comp-table-wrap">
        <table class="comp-table">
          <thead>
            <tr>
              <th></th>
              <th class="us"><span class="brand-pill brand-wapi">Wapi101</span></th>
              <th class="them"><span class="brand-pill brand-them">${escHtml(page.competitor)}</span></th>
            </tr>
          </thead>
          <tbody>
            ${page.compRows.map(row => `
              <tr>
                <td class="label">${escHtml(row[0])}</td>
                <td class="us">${escHtml(row[1])}</td>
                <td class="them">${escHtml(row[2])}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>` : '';

  const sectionsHtml = (page.sections || []).map(s => `
    <section class="content-section">
      <h2>${escHtml(s.h)}</h2>
      ${(s.p || []).map(p => `<p>${_renderInlineMarkdown(p)}</p>`).join('')}
    </section>`).join('');

  const verdictHtml = page.verdict ? `
    <aside class="verdict-box" aria-label="Veredicto rápido">
      <div class="verdict-label">Veredicto rápido</div>
      <p>${escHtml(page.verdict)}</p>
    </aside>` : '';

  const faqHtml = Array.isArray(page.faqs) && page.faqs.length ? `
    <section class="faq-section">
      <h2>Preguntas frecuentes</h2>
      <div class="faq-list">
        ${page.faqs.map(([q, a]) => `
          <details class="faq-item">
            <summary>${escHtml(q)}</summary>
            <p>${_renderInlineMarkdown(a)}</p>
          </details>`).join('')}
      </div>
    </section>` : '';

  // Breadcrumb interno
  const crumbLabel = isVs ? `Wapi101 vs ${escHtml(page.competitor)}` : escHtml(page.title.split(':')[0] || page.title);

  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${escHtml(page.title)}</title>
  <meta name="description" content="${escHtml(page.description)}" />
  ${page.keywords ? `<meta name="keywords" content="${escHtml(page.keywords)}" />` : ''}
  <link rel="canonical" href="${url}" />
  <meta name="theme-color" content="#2563eb" />
  <link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Wapi101" />
  <meta property="og:title" content="${escHtml(page.title)}" />
  <meta property="og:description" content="${escHtml(page.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="https://wapi101.com/icons/wapi101-logo.svg" />
  <meta property="og:locale" content="es_MX" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escHtml(page.title)}" />
  <meta name="twitter:description" content="${escHtml(page.description)}" />

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <script type="application/ld+json">${JSON.stringify(_WAPI101_SOFTWARE_SCHEMA)}</script>
  <script type="application/ld+json">${JSON.stringify(_breadcrumbSchema(page))}</script>
  ${faqJsonLd ? `<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>` : ''}

  <style>
    *,*::before,*::after { box-sizing: border-box; }
    html,body { margin:0; padding:0; }
    :root {
      --primary:#2563eb; --primary-dark:#1d4ed8; --accent:#10b981;
      --text:#0f172a; --text-soft:#475569; --text-muted:#64748b;
      --border:#e2e8f0; --bg:#ffffff; --bg-soft:#f8fafc;
    }
    body {
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      color:var(--text); background:var(--bg); line-height:1.6;
      -webkit-font-smoothing:antialiased;
    }
    .container { max-width:980px; margin:0 auto; padding:0 24px; }

    /* ── Top bar ── */
    .top-bar {
      position:sticky; top:0; z-index:50;
      background:rgba(255,255,255,.95); backdrop-filter:blur(8px);
      border-bottom:1px solid var(--border);
    }
    .top-bar-inner {
      max-width:1200px; margin:0 auto; padding:14px 24px;
      display:flex; align-items:center; justify-content:space-between; gap:16px;
    }
    .logo { font-weight:800; font-size:20px; color:var(--primary); text-decoration:none; letter-spacing:-.5px; }
    .logo span.dot { color:var(--accent); }
    .top-nav { display:flex; gap:20px; align-items:center; }
    .top-nav a { color:var(--text-soft); text-decoration:none; font-size:14px; font-weight:500; }
    .top-nav a:hover { color:var(--text); }
    .btn-cta {
      background:var(--primary); color:#fff; padding:9px 18px; border-radius:8px;
      font-size:14px; font-weight:600; text-decoration:none;
      transition:background .2s;
    }
    .btn-cta:hover { background:var(--primary-dark); }
    @media (max-width:720px) { .top-nav a:not(.btn-cta) { display:none; } }

    /* ── Breadcrumb ── */
    .crumb { padding:18px 0 0; font-size:13px; color:var(--text-muted); }
    .crumb a { color:var(--text-muted); text-decoration:none; }
    .crumb a:hover { color:var(--primary); }

    /* ── Hero ── */
    .hero { padding:36px 0 24px; }
    .hero h1 { font-size:38px; font-weight:800; letter-spacing:-1px; margin:0 0 16px; line-height:1.2; }
    .hero p.lead { font-size:18px; color:var(--text-soft); margin:0; }
    @media (max-width:640px) { .hero h1 { font-size:28px; } .hero p.lead { font-size:16px; } }

    /* ── Verdict box ── */
    .verdict-box {
      margin:28px 0;
      padding:20px 22px;
      background:linear-gradient(135deg,#eff6ff,#ecfdf5);
      border:1px solid #bfdbfe;
      border-left:4px solid var(--primary);
      border-radius:12px;
    }
    .verdict-label {
      font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.2px;
      color:var(--primary); margin-bottom:8px;
    }
    .verdict-box p { margin:0; font-size:16px; color:var(--text); }

    /* ── Comparison table ── */
    .comp-section { margin:48px 0 32px; }
    .comp-section h2 { font-size:26px; font-weight:700; margin:0 0 18px; }
    .comp-table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
    .comp-table { width:100%; border-collapse:collapse; font-size:14px; min-width:560px; }
    .comp-table th { text-align:left; padding:14px 16px; background:var(--bg-soft); border-bottom:1px solid var(--border); }
    .comp-table td { padding:13px 16px; border-bottom:1px solid var(--border); vertical-align:top; }
    .comp-table tr:last-child td { border-bottom:none; }
    .comp-table td.label { font-weight:600; color:var(--text); width:30%; }
    .comp-table td.us { background:#f0f9ff; color:var(--text); }
    .comp-table td.them { color:var(--text-soft); }
    .brand-pill {
      display:inline-block; padding:4px 10px; border-radius:999px;
      font-weight:700; font-size:12px;
    }
    .brand-wapi { background:var(--primary); color:#fff; }
    .brand-them { background:#e2e8f0; color:#334155; }

    /* ── Content sections ── */
    .content-section { margin:36px 0; }
    .content-section h2 {
      font-size:24px; font-weight:700; margin:0 0 14px; letter-spacing:-.4px;
    }
    .content-section p { margin:0 0 14px; font-size:16px; color:var(--text-soft); }
    .content-section a { color:var(--primary); text-decoration:none; font-weight:500; }
    .content-section a:hover { text-decoration:underline; }

    /* ── FAQ ── */
    .faq-section { margin:48px 0; padding:32px 0; border-top:1px solid var(--border); }
    .faq-section h2 { font-size:26px; font-weight:700; margin:0 0 20px; }
    .faq-list { display:flex; flex-direction:column; gap:10px; }
    .faq-item {
      border:1px solid var(--border); border-radius:10px; padding:14px 18px;
      background:#fff; transition:border-color .15s;
    }
    .faq-item[open] { border-color:var(--primary); background:#fafbff; }
    .faq-item summary {
      cursor:pointer; font-weight:600; font-size:15px; color:var(--text);
      list-style:none; outline:none;
    }
    .faq-item summary::-webkit-details-marker { display:none; }
    .faq-item summary::after { content:'+'; float:right; color:var(--primary); font-size:18px; font-weight:700; }
    .faq-item[open] summary::after { content:'−'; }
    .faq-item p { margin:10px 0 0; color:var(--text-soft); font-size:15px; }

    /* ── CTA final ── */
    .cta-final {
      margin:48px 0 16px;
      padding:40px 32px;
      background:linear-gradient(135deg, var(--primary), #0ea5e9);
      border-radius:16px;
      color:#fff; text-align:center;
    }
    .cta-final h2 { font-size:28px; font-weight:800; margin:0 0 10px; letter-spacing:-.5px; }
    .cta-final p { margin:0 0 22px; opacity:.95; font-size:16px; }
    .cta-final .btn-cta {
      background:#fff; color:var(--primary); padding:13px 26px; font-size:16px; font-weight:700;
      display:inline-block; border-radius:10px; text-decoration:none;
    }
    .cta-final .btn-cta:hover { background:#f0f9ff; }
    .cta-final .small { display:block; margin-top:10px; font-size:13px; opacity:.85; }

    /* ── Footer ── */
    footer {
      border-top:1px solid var(--border); margin-top:40px; padding:28px 0;
      color:var(--text-muted); font-size:13px;
    }
    footer .container { display:flex; justify-content:space-between; flex-wrap:wrap; gap:20px; }
    footer a { color:var(--text-muted); text-decoration:none; }
    footer a:hover { color:var(--primary); }
    .footer-links { display:flex; gap:16px; flex-wrap:wrap; }
    .related-links {
      margin:36px 0; padding:24px; background:var(--bg-soft); border-radius:12px; border:1px solid var(--border);
    }
    .related-links h3 { margin:0 0 12px; font-size:15px; font-weight:700; color:var(--text); }
    .related-links ul { margin:0; padding:0; list-style:none; display:flex; gap:14px; flex-wrap:wrap; }
    .related-links a {
      display:inline-block; padding:6px 14px; background:#fff;
      border:1px solid var(--border); border-radius:999px;
      color:var(--text-soft); text-decoration:none; font-size:13px; font-weight:500;
    }
    .related-links a:hover { border-color:var(--primary); color:var(--primary); }
  </style>
</head>
<body>

<nav class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="logo">Wapi101<span class="dot">.</span></a>
    <div class="top-nav">
      <a href="/#features">Funcionalidades</a>
      <a href="/#pricing">Precios</a>
      <a href="/crm-whatsapp-business">CRM WhatsApp</a>
      <a href="/signup" class="btn-cta">Probar gratis</a>
    </div>
  </div>
</nav>

<div class="container">

  <nav class="crumb" aria-label="breadcrumb">
    <a href="/">Inicio</a> · ${crumbLabel}
  </nav>

  <header class="hero">
    <h1>${escHtml(page.title.split(':')[0])}${page.title.includes(':') ? `:<br/><span style="color:var(--text-soft);font-weight:600">${escHtml(page.title.split(':').slice(1).join(':').trim())}</span>` : ''}</h1>
    <p class="lead">${escHtml(page.hero || page.description)}</p>
  </header>

  ${verdictHtml}
  ${compTableHtml}
  ${sectionsHtml}
  ${faqHtml}

  <div class="related-links">
    <h3>Comparativas relacionadas</h3>
    <ul>
      <li><a href="/vs/kommo">vs Kommo</a></li>
      <li><a href="/vs/hubspot">vs HubSpot</a></li>
      <li><a href="/vs/zoho">vs Zoho</a></li>
      <li><a href="/vs/pipedrive">vs Pipedrive</a></li>
      <li><a href="/vs/manychat">vs ManyChat</a></li>
      <li><a href="/vs/leadsales">vs Leadsales</a></li>
      <li><a href="/vs/bitrix24">vs Bitrix24</a></li>
      <li><a href="/crm-whatsapp-business">CRM WhatsApp Business</a></li>
      <li><a href="/crm-para-pymes-mexico">CRM para PyMEs México</a></li>
      <li><a href="/mejor-crm-latam">Mejor CRM LATAM</a></li>
    </ul>
  </div>

  <section class="cta-final">
    <h2>Pruébalo 14 días gratis</h2>
    <p>Sin tarjeta. Conecta tu WhatsApp Business en 10 minutos. Importamos tus contactos sin costo.</p>
    <a href="/signup" class="btn-cta">Empezar gratis</a>
    <span class="small">Cancelas cuando quieras · Soporte en español MX</span>
  </section>

</div>

<footer>
  <div class="container">
    <div>© ${new Date().getFullYear()} Wapi101 · CRM para WhatsApp Business · Hecho en México 🇲🇽</div>
    <div class="footer-links">
      <a href="/privacy">Privacidad</a>
      <a href="/terms">Términos</a>
      <a href="/signup">Probar gratis</a>
      <a href="/login">Iniciar sesión</a>
    </div>
  </div>
</footer>

</body>
</html>`;
}

module.exports = { renderPage };
