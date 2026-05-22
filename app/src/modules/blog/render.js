// Renderer del blog de Wapi101.
// renderPost(post)  → HTML completo del artículo
// renderIndex(posts) → HTML del listado de blog en /blog

const { POSTS } = require('./data');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _renderInlineMarkdown(text) {
  let out = escHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

// Stylesheet común al artículo e índice — emoji-free, gris + azul Wapi.
const _BLOG_CSS = `
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  :root {
    --primary:#2563eb; --primary-dark:#1d4ed8; --accent:#10b981;
    --text:#0f172a; --text-soft:#334155; --text-muted:#64748b;
    --border:#e2e8f0; --bg:#ffffff; --bg-soft:#f8fafc;
  }
  body {
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    color:var(--text); background:var(--bg); line-height:1.65;
    -webkit-font-smoothing:antialiased;
  }
  .container { max-width:760px; margin:0 auto; padding:0 24px; }
  .container-wide { max-width:1100px; margin:0 auto; padding:0 24px; }

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

  .crumb { padding:18px 0 0; font-size:13px; color:var(--text-muted); }
  .crumb a { color:var(--text-muted); text-decoration:none; }
  .crumb a:hover { color:var(--primary); }

  .article-meta {
    display:flex; gap:14px; align-items:center; font-size:13px; color:var(--text-muted);
    margin:18px 0 20px;
  }
  .article-meta .cat-pill {
    background:#eff6ff; color:var(--primary); padding:4px 10px; border-radius:999px;
    font-weight:600; font-size:12px;
  }
  .article-meta .dot-sep::before { content:"·"; margin:0 4px; }

  .hero h1 { font-size:36px; font-weight:800; letter-spacing:-1px; margin:0 0 14px; line-height:1.2; }
  .hero p.lead { font-size:18px; color:var(--text-soft); margin:0 0 24px; }
  @media (max-width:640px) { .hero h1 { font-size:28px; } .hero p.lead { font-size:16px; } }

  .content-section { margin:32px 0; }
  .content-section h2 { font-size:24px; font-weight:700; margin:0 0 12px; letter-spacing:-.4px; line-height:1.3; }
  .content-section p { margin:0 0 14px; font-size:16px; color:var(--text-soft); }
  .content-section code { background:var(--bg-soft); padding:2px 6px; border-radius:4px; font-size:13px; }
  .content-section a { color:var(--primary); text-decoration:none; font-weight:500; }
  .content-section a:hover { text-decoration:underline; }

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

  .cta-final {
    margin:48px 0 16px;
    padding:36px 28px;
    background:linear-gradient(135deg, var(--primary), #0ea5e9);
    border-radius:14px;
    color:#fff; text-align:center;
  }
  .cta-final h2 { font-size:24px; font-weight:800; margin:0 0 8px; letter-spacing:-.4px; }
  .cta-final p { margin:0 0 18px; opacity:.95; font-size:15px; }
  .cta-final .btn-cta {
    background:#fff; color:var(--primary); padding:12px 24px; font-size:15px; font-weight:700;
    display:inline-block; border-radius:10px; text-decoration:none;
  }
  .cta-final .btn-cta:hover { background:#f0f9ff; }

  /* Index del blog: grid de cards */
  .blog-hero { padding:40px 0 20px; }
  .blog-hero h1 { font-size:38px; font-weight:800; margin:0 0 10px; letter-spacing:-1px; }
  .blog-hero p { font-size:17px; color:var(--text-soft); margin:0; }
  .post-grid {
    display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap:18px; margin:30px 0 50px;
  }
  .post-card {
    border:1px solid var(--border); border-radius:12px; padding:20px;
    background:#fff; text-decoration:none; color:inherit;
    transition: border-color .15s, transform .12s, box-shadow .15s;
    display:flex; flex-direction:column; gap:10px;
  }
  .post-card:hover { border-color:var(--primary); transform: translateY(-2px); box-shadow:0 4px 14px rgba(15,23,42,.06); }
  .post-card .cat-pill {
    align-self:flex-start;
    background:#eff6ff; color:var(--primary); padding:3px 9px; border-radius:999px;
    font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em;
  }
  .post-card h2 { font-size:17px; font-weight:700; margin:0; line-height:1.35; color:var(--text); }
  .post-card p { margin:0; font-size:14px; color:var(--text-soft); line-height:1.5; }
  .post-card .meta { font-size:12px; color:var(--text-muted); margin-top:auto; padding-top:6px; }

  .related-posts { margin:36px 0; padding:24px; background:var(--bg-soft); border-radius:12px; border:1px solid var(--border); }
  .related-posts h3 { margin:0 0 12px; font-size:15px; font-weight:700; }
  .related-posts ul { margin:0; padding:0; list-style:none; display:flex; gap:14px; flex-wrap:wrap; }
  .related-posts a {
    display:inline-block; padding:7px 14px; background:#fff;
    border:1px solid var(--border); border-radius:999px;
    color:var(--text-soft); text-decoration:none; font-size:13px; font-weight:500;
  }
  .related-posts a:hover { border-color:var(--primary); color:var(--primary); }

  footer {
    border-top:1px solid var(--border); margin-top:40px; padding:28px 0;
    color:var(--text-muted); font-size:13px;
  }
  footer .container-wide { display:flex; justify-content:space-between; flex-wrap:wrap; gap:20px; }
  footer a { color:var(--text-muted); text-decoration:none; }
  footer a:hover { color:var(--primary); }
  .footer-links { display:flex; gap:16px; flex-wrap:wrap; }
`;

function _topBarHtml() {
  return `
<nav class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="logo">Wapi101<span class="dot">.</span></a>
    <div class="top-nav">
      <a href="/#features">Funcionalidades</a>
      <a href="/#pricing">Precios</a>
      <a href="/blog">Blog</a>
      <a href="/developers">Developers</a>
      <a href="/signup" class="btn-cta">Probar gratis</a>
    </div>
  </div>
</nav>`;
}

function _footerHtml() {
  return `
<footer>
  <div class="container-wide">
    <div>© ${new Date().getFullYear()} Wapi101 · CRM para WhatsApp Business · Hecho en México</div>
    <div class="footer-links">
      <a href="/privacy">Privacidad</a>
      <a href="/terms">Términos</a>
      <a href="/blog">Blog</a>
      <a href="/developers">Developers</a>
      <a href="/signup">Probar gratis</a>
    </div>
  </div>
</footer>`;
}

function _articleSchema(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': post.title,
    'description': post.description,
    'image': post.featuredImage || 'https://wapi101.com/icons/wapi101-logo.svg',
    'datePublished': post.publishedAt,
    'dateModified': post.updatedAt || post.publishedAt,
    'author': { '@type': 'Organization', 'name': post.author || 'Equipo Wapi101', 'url': 'https://wapi101.com/' },
    'publisher': {
      '@type': 'Organization',
      'name': 'Wapi101',
      'logo': { '@type': 'ImageObject', 'url': 'https://wapi101.com/icons/wapi101-logo.svg' },
    },
    'mainEntityOfPage': `https://wapi101.com/blog/${post.slug}`,
    'inLanguage': 'es-MX',
    'articleSection': post.category || 'Guías',
  };
}

function _faqSchema(faqs) {
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

function _breadcrumbSchema(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'Wapi101', 'item': 'https://wapi101.com/' },
      { '@type': 'ListItem', 'position': 2, 'name': 'Blog', 'item': 'https://wapi101.com/blog' },
      { '@type': 'ListItem', 'position': 3, 'name': post.title.split(':')[0] || post.title, 'item': `https://wapi101.com/blog/${post.slug}` },
    ],
  };
}

function _relatedPostsHtml(currentSlug, suggested) {
  const allSlugs = Object.keys(POSTS).filter(s =>
    s !== currentSlug && s !== '_placeholder' && !POSTS[s].hidden
  );
  let chosen = Array.isArray(suggested) ? suggested.filter(s => allSlugs.includes(s)) : [];
  // Completar con otros si no hay suficientes
  for (const s of allSlugs) {
    if (chosen.length >= 6) break;
    if (!chosen.includes(s)) chosen.push(s);
  }
  if (!chosen.length) return '';
  const items = chosen.slice(0, 6).map(s => {
    const p = POSTS[s];
    return `<li><a href="/blog/${s}">${escHtml(p.title.split(':')[0])}</a></li>`;
  }).join('');
  return `<div class="related-posts">
      <h3>Sigue leyendo</h3>
      <ul>${items}</ul>
    </div>`;
}

function renderPost(post) {
  if (!post) return '';
  const url = `https://wapi101.com/blog/${post.slug}`;
  const articleSchema = _articleSchema(post);
  const faqSchema = _faqSchema(post.faqs);
  const breadcrumbSchema = _breadcrumbSchema(post);

  const sectionsHtml = (post.sections || []).map(s => `
    <section class="content-section">
      <h2>${escHtml(s.h)}</h2>
      ${(s.p || []).map(p => `<p>${_renderInlineMarkdown(p)}</p>`).join('')}
    </section>`).join('');

  const faqHtml = Array.isArray(post.faqs) && post.faqs.length ? `
    <section class="faq-section">
      <h2>Preguntas frecuentes</h2>
      <div class="faq-list">
        ${post.faqs.map(([q, a]) => `
          <details class="faq-item">
            <summary>${escHtml(q)}</summary>
            <p>${_renderInlineMarkdown(a)}</p>
          </details>`).join('')}
      </div>
    </section>` : '';

  const dateFmt = (() => {
    try {
      return new Date(post.publishedAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return post.publishedAt || ''; }
  })();

  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${escHtml(post.title)}</title>
  <meta name="description" content="${escHtml(post.description)}" />
  ${post.keywords ? `<meta name="keywords" content="${escHtml(post.keywords)}" />` : ''}
  <link rel="canonical" href="${url}" />
  <meta name="theme-color" content="#2563eb" />
  <link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />
  <meta name="author" content="${escHtml(post.author || 'Equipo Wapi101')}" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Wapi101" />
  <meta property="og:title" content="${escHtml(post.title)}" />
  <meta property="og:description" content="${escHtml(post.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${escHtml(post.featuredImage || 'https://wapi101.com/icons/wapi101-logo.svg')}" />
  <meta property="og:locale" content="es_MX" />
  <meta property="article:published_time" content="${escHtml(post.publishedAt || '')}" />
  ${post.updatedAt ? `<meta property="article:modified_time" content="${escHtml(post.updatedAt)}" />` : ''}
  <meta property="article:section" content="${escHtml(post.category || 'Guías')}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escHtml(post.title)}" />
  <meta name="twitter:description" content="${escHtml(post.description)}" />

  <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  ${faqSchema ? `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>` : ''}

  <style>${_BLOG_CSS}</style>
</head>
<body>

${_topBarHtml()}

<div class="container">

  <nav class="crumb" aria-label="breadcrumb">
    <a href="/">Inicio</a> · <a href="/blog">Blog</a> · ${escHtml(post.title.split(':')[0])}
  </nav>

  <header class="hero" style="padding:30px 0 14px">
    <h1>${escHtml(post.title)}</h1>
    <p class="lead">${escHtml(post.description)}</p>
    <div class="article-meta">
      <span class="cat-pill">${escHtml(post.category || 'Guías')}</span>
      <span>${escHtml(dateFmt)}</span>
      ${post.readingTime ? `<span class="dot-sep"></span><span>${escHtml(post.readingTime)} de lectura</span>` : ''}
    </div>
  </header>

  ${sectionsHtml}
  ${faqHtml}

  ${_relatedPostsHtml(post.slug, post.relatedSlugs)}

  <section class="cta-final">
    <h2>Pruébalo 14 días gratis</h2>
    <p>Sin tarjeta. Conecta tu WhatsApp Business en 10 minutos.</p>
    <a href="/signup" class="btn-cta">Empezar gratis</a>
  </section>

</div>

${_footerHtml()}

</body>
</html>`;
}

function renderIndex() {
  const visiblePosts = Object.values(POSTS)
    .filter(p => p && p.slug && p.slug !== '_placeholder' && !p.hidden)
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  const cardsHtml = visiblePosts.length
    ? visiblePosts.map(p => `
      <a class="post-card" href="/blog/${p.slug}">
        <span class="cat-pill">${escHtml(p.category || 'Guías')}</span>
        <h2>${escHtml(p.title.split(':')[0])}</h2>
        <p>${escHtml(p.excerpt || p.description || '')}</p>
        <div class="meta">${escHtml(p.publishedAt || '')} · ${escHtml(p.readingTime || '5 min')}</div>
      </a>`).join('')
    : '<p style="color:#64748b">Próximamente — el primer artículo se publica esta semana.</p>';

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'Wapi101', 'item': 'https://wapi101.com/' },
      { '@type': 'ListItem', 'position': 2, 'name': 'Blog', 'item': 'https://wapi101.com/blog' },
    ],
  };

  // Blog schema (puede ser CollectionPage)
  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    'name': 'Blog de Wapi101',
    'url': 'https://wapi101.com/blog',
    'description': 'Guías técnicas y de marketing sobre WhatsApp Business, CRM y automatización de ventas en México y LATAM.',
    'inLanguage': 'es-MX',
    'publisher': { '@type': 'Organization', 'name': 'Wapi101', 'url': 'https://wapi101.com/' },
    'blogPost': visiblePosts.map(p => ({
      '@type': 'BlogPosting',
      'headline': p.title,
      'url': `https://wapi101.com/blog/${p.slug}`,
      'datePublished': p.publishedAt,
    })),
  };

  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Blog Wapi101 · Guías de WhatsApp Business, CRM y automatización</title>
  <meta name="description" content="Guías técnicas y prácticas sobre WhatsApp Business API, CRM, bots, plantillas aprobadas, automatización de ventas y mejores prácticas para PyMEs de México y LATAM." />
  <meta name="keywords" content="blog whatsapp business, guia whatsapp api, blog crm latam, automatizar ventas whatsapp, plantillas hsm whatsapp, blog wapi101" />
  <link rel="canonical" href="https://wapi101.com/blog" />
  <meta name="theme-color" content="#2563eb" />
  <link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Wapi101" />
  <meta property="og:title" content="Blog Wapi101 · Guías de WhatsApp Business y CRM" />
  <meta property="og:description" content="Aprende a vender más por WhatsApp con guías paso a paso, comparativas y mejores prácticas." />
  <meta property="og:url" content="https://wapi101.com/blog" />
  <meta property="og:image" content="https://wapi101.com/icons/wapi101-logo.svg" />
  <meta property="og:locale" content="es_MX" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Blog Wapi101" />
  <meta name="twitter:description" content="Guías de WhatsApp Business, CRM y automatización para PyMEs LATAM." />

  <script type="application/ld+json">${JSON.stringify(blogSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>

  <style>${_BLOG_CSS}</style>
</head>
<body>

${_topBarHtml()}

<div class="container-wide">

  <nav class="crumb" aria-label="breadcrumb">
    <a href="/">Inicio</a> · Blog
  </nav>

  <header class="blog-hero">
    <h1>Blog de Wapi101</h1>
    <p>Guías de WhatsApp Business, CRM, bots y automatización de ventas para PyMEs en México y LATAM.</p>
  </header>

  <div class="post-grid">
    ${cardsHtml}
  </div>

</div>

${_footerHtml()}

</body>
</html>`;
}

// Listar slugs publicados (no placeholder, no hidden) para sitemap
function listPublishedSlugs() {
  return Object.values(POSTS)
    .filter(p => p && p.slug && p.slug !== '_placeholder' && !p.hidden)
    .map(p => p.slug);
}

module.exports = { renderPost, renderIndex, listPublishedSlugs };
