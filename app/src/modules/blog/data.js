// Datos del blog de Wapi101 — guías técnicas y de marketing.
// Cada entry produce un artículo completo vía render.js.
//
// Estructura: cada POST tiene metadata + sections (h, p[]) + faqs ([q, a][]).
// Las sections son las que se renderizan como h2 + párrafos en el HTML.
// Los párrafos soportan markdown limitado: **bold** y [link](url).
//
// CRITERIO SEO:
//   - title 55-70 chars, incluye keyword principal + año / "México" / "LATAM"
//   - description 140-160 chars, incluye keyword + value prop
//   - 1800-3000 palabras en total (sections + faqs)
//   - 6-10 sections y 8-10 FAQs por artículo
//   - Internal linking a /signup, /vs/*, /crm-*, /developers
//
// Auditoría: revisar cada 6 meses por precios y features que cambien.

const POSTS = {

  // ─── Placeholder — el contenido real lo llena el agente o el equipo
  // de contenidos. Mantén este placeholder hasta que se publique al menos 1.
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
    hidden: true, // marca para NO listar en index ni sitemap
  },

};

module.exports = { POSTS };
