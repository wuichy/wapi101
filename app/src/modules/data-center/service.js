// Data Center — orquestador de import/export unificado.
//
// Responsabilidades de este service:
//   1) Decidir qué cards mostrar para un tenant (basado en sus integraciones +
//      toggles + flags). El frontend lee esto en /api/data-center/available.
//   2) Parseo de archivos (CSV/XLSX/JSON) → estructura común
//   3) Auto-detección de formato de origen (Kommo, HubSpot, Pipedrive, wapi)
//   4) Generación de mapeo sugerido columnas → campos wapi
//   5) Preview + ejecución de imports (delegando a módulos existentes)
//   6) Exports con filtros + ZIP completo

// ─── Disponibilidad de cards (que se ve y que no) ─────────────────────

// Devuelve qué entidades están disponibles para im/export en este tenant.
// El frontend usa esto para renderizar solo los cards relevantes.
function getAvailableEntities(db, tenantId) {
  // Integraciones conectadas (para condicionar Pedidos, Email, Comentarios)
  const integs = db.prepare(`
    SELECT provider FROM integrations
    WHERE tenant_id = ? AND status = 'connected'
  `).all(tenantId).map(r => r.provider);

  const hasWoo  = integs.includes('woocommerce');
  const hasFb   = integs.includes('messenger');
  const hasIg   = integs.includes('instagram');
  const hasMail = ['email','gmail','outlook','icloud_mail','yahoo_mail']
    .some(p => integs.includes(p));

  // Tenant flags
  const t = db.prepare('SELECT whatsapp_catalog_enabled FROM tenants WHERE id = ?')
    .get(tenantId) || {};
  const catalogOn = t.whatsapp_catalog_enabled === 1;

  // Conteos para mostrar "X actualmente" en las cards
  const counts = _countsForTenant(db, tenantId, { hasWoo, hasMail });

  // Conteos adicionales para las nuevas entidades
  const q = (sql) => { try { return db.prepare(sql).get(tenantId)?.n || 0; } catch { return 0; } };
  const moreCounts = {
    advisors:       q('SELECT COUNT(*) AS n FROM advisors WHERE tenant_id=? AND active=1'),
    business_hours: q('SELECT COUNT(*) AS n FROM business_hours WHERE tenant_id=?'),
    appointments:   q('SELECT COUNT(*) AS n FROM appointments WHERE tenant_id=?'),
    tasks:          q('SELECT COUNT(*) AS n FROM tasks WHERE tenant_id=? AND completed=0'),
    custom_fields:  q('SELECT COUNT(*) AS n FROM custom_field_defs WHERE tenant_id=?'),
    webhooks:       q('SELECT COUNT(*) AS n FROM outgoing_webhooks WHERE tenant_id=?'),
    reports:        q('SELECT COUNT(*) AS n FROM reports WHERE tenant_id=?'),
    ai_knowledge:   q('SELECT COUNT(*) AS n FROM ai_knowledge_sources WHERE tenant_id=?'),
  };

  return {
    // Siempre disponibles (datos core del CRM)
    contacts:   { available: true,  count: counts.contacts },
    leads:      { available: true,  count: counts.leads },
    templates:  { available: true,  count: counts.templates },
    tags:       { available: true,  count: counts.tags },
    pipelines:  { available: true,  count: counts.pipelines },
    bots:       { available: true,  count: counts.bots },
    chats:      { available: true,  count: counts.conversations },
    advisors:   { available: true,  count: moreCounts.advisors },
    business_hours: { available: true, count: moreCounts.business_hours },
    appointments:   { available: true, count: moreCounts.appointments },
    tasks:          { available: true, count: moreCounts.tasks },
    custom_fields:  { available: true, count: moreCounts.custom_fields },
    webhooks:       { available: true, count: moreCounts.webhooks },
    reports:        { available: true, count: moreCounts.reports },
    ai_knowledge:   { available: true, count: moreCounts.ai_knowledge },
    // Condicionales (dependen del setup del tenant)
    catalog:    { available: catalogOn, count: catalogOn ? counts.products : 0,
                  reason: catalogOn ? null : 'Activa el catálogo en Configuración → Ajustes' },
    orders:     { available: hasWoo,    count: hasWoo ? counts.orders : 0,
                  reason: hasWoo ? null : 'Conecta WooCommerce en Integraciones' },
    woo_config: { available: hasWoo,    count: hasWoo ? 1 : 0,
                  reason: hasWoo ? null : 'Requiere WooCommerce conectado' },
    email:      { available: hasMail,   count: hasMail ? counts.emailConvos : 0,
                  reason: hasMail ? null : 'Conecta un proveedor de email' },
    comments:   { available: hasFb || hasIg, count: 0,
                  reason: (hasFb || hasIg) ? null : 'Conecta Facebook o Instagram' },
  };
}

function _countsForTenant(db, tenantId, { hasWoo, hasMail }) {
  const q = (sql, ...args) => {
    try { return db.prepare(sql).get(tenantId, ...args)?.n || 0; } catch { return 0; }
  };
  return {
    contacts:      q('SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?'),
    leads:         q('SELECT COUNT(*) AS n FROM expedients WHERE tenant_id = ?'),
    templates:     q('SELECT COUNT(*) AS n FROM message_templates WHERE tenant_id = ?'),
    pipelines:     q('SELECT COUNT(*) AS n FROM pipelines WHERE tenant_id = ?'),
    bots:          q('SELECT COUNT(*) AS n FROM salsbots WHERE tenant_id = ?'),
    conversations: q('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?'),
    products:      q('SELECT COUNT(*) AS n FROM whatsapp_products WHERE tenant_id = ? AND is_active = 1'),
    orders:        hasWoo ? q('SELECT COUNT(*) AS n FROM woo_orders WHERE tenant_id = ?') : 0,
    emailConvos:   hasMail ? q(`SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND provider IN ('email','gmail','outlook')`) : 0,
    // tags vive en varias tablas — sumamos las que existen
    tags: (q('SELECT COUNT(*) AS n FROM bot_tags WHERE tenant_id = ?')
         + q('SELECT COUNT(DISTINCT tag) AS n FROM contact_tags WHERE tenant_id = ?')),
  };
}

// ─── Parseo de archivos ───────────────────────────────────────────────

// Parsea CSV simple (sin librerías externas — el dataset típico es chico).
// Soporta:
//   • Comas dentro de strings entrecomilladas: "García, Juan",+52...
//   • Saltos de línea reales y \n escapado
//   • Headers en la primera fila
function parseCSV(text) {
  const rows = [];
  let cur = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || cur.length > 0) {
          cur.push(field); field = '';
          if (cur.some(v => v !== '')) rows.push(cur);
          cur = [];
        }
        if (c === '\r' && text[i+1] === '\n') i++;
      } else { field += c; }
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    if (cur.some(v => v !== '')) rows.push(cur);
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  const [headers, ...data] = rows;
  return { headers, rows: data };
}

// Parsea JSON: acepta array de objetos directamente.
function parseJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    if (data && Array.isArray(data.items)) return { headers: Object.keys(data.items[0] || {}), rows: data.items.map(o => Object.values(o)), objects: data.items };
    throw new Error('JSON debe ser un array de objetos o {items: [...]}');
  }
  const headers = data.length ? Object.keys(data[0]) : [];
  const rows = data.map(o => headers.map(h => o[h] ?? ''));
  return { headers, rows, objects: data };
}

function parseFile({ filename, content }) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.json')) return { format: 'json', ...parseJSON(content) };
  // Default CSV (xlsx → CSV se hace en el frontend con una lib del browser)
  return { format: 'csv', ...parseCSV(content) };
}

// ─── Auto-detección de formato de origen ──────────────────────────────

// Heurísticas para identificar de dónde viene el archivo. Devuelve el mejor
// preset que matchea, o 'generic' si no hay match claro. Esto controla qué
// mapeo de columnas sugerimos en el wizard.
function detectSourceFormat(headers) {
  const lower = headers.map(h => String(h || '').toLowerCase());

  // Kommo: típicas columnas exportadas
  const kommoSignals = ['responsible_user_id', 'pipeline_id', 'status_id', 'kommo'];
  if (kommoSignals.some(s => lower.some(h => h.includes(s)))) return 'kommo';

  // HubSpot: tiene "First Name" + "Last Name" + "Email" + "HubSpot Score" típico
  if (lower.includes('first name') && lower.includes('last name') && lower.includes('email')) {
    if (lower.some(h => h.startsWith('hs_') || h.includes('hubspot'))) return 'hubspot';
  }

  // Pipedrive: columnas tipo "Deal title" + "Pipeline" + "Stage"
  if (lower.includes('deal title') && lower.includes('pipeline') && lower.includes('stage')) {
    return 'pipedrive';
  }

  // wapi-nativo (exportado del propio wapi): tiene "wapi_id" o "tenant_id"
  if (lower.includes('wapi_id') || lower.includes('contact_id') && lower.includes('phone')) {
    return 'wapi';
  }

  return 'generic';
}

// ─── Mapeo de columnas según preset ───────────────────────────────────

// Por preset y por entidad destino (contacts/leads/etc), devuelve el mapeo
// columna → campo wapi sugerido. El usuario lo puede ajustar después.
const MAPPING_PRESETS = {
  contacts: {
    kommo: {
      'name':            'firstName',
      'phone':           'phone',
      'email':           'email',
      'company':         null,  // ignorar
    },
    hubspot: {
      'first name':      'firstName',
      'last name':       'lastName',
      'phone number':    'phone',
      'mobile phone':    'phone',
      'email':           'email',
    },
    pipedrive: {
      'name':            'firstName',
      'phone':           'phone',
      'email':           'email',
    },
    wapi: {
      'first_name':      'firstName',
      'last_name':       'lastName',
      'phone':           'phone',
      'email':           'email',
    },
    generic: {
      // El generic intenta matchear por nombres comunes en español + inglés
      'nombre':          'firstName',
      'first_name':      'firstName',
      'firstname':       'firstName',
      'apellido':        'lastName',
      'last_name':       'lastName',
      'lastname':        'lastName',
      'telefono':        'phone',
      'teléfono':        'phone',
      'phone':           'phone',
      'celular':         'phone',
      'movil':           'phone',
      'móvil':           'phone',
      'whatsapp':        'phone',
      'correo':          'email',
      'email':           'email',
      'mail':            'email',
      'e-mail':          'email',
    },
  },
  leads: {
    kommo: {
      'lead_name':       'name',
      'name':            'name',
      'price':           'value',
      'sale':            'value',
      'pipeline':        'pipelineName',
      'stage':           'stageName',
      'status':          'stageName',
      'contact_name':    'contactName',
      'phone':           'contactPhone',
    },
    generic: {
      'nombre':          'name',
      'name':            'name',
      'valor':           'value',
      'value':           'value',
      'pipeline':        'pipelineName',
      'etapa':           'stageName',
      'stage':           'stageName',
      'contacto':        'contactName',
      'telefono':        'contactPhone',
      'phone':           'contactPhone',
    },
  },
};

function suggestMapping(entity, format, headers) {
  const preset = MAPPING_PRESETS[entity]?.[format] || MAPPING_PRESETS[entity]?.generic || {};
  const suggestion = {};
  for (const h of headers) {
    const key = String(h || '').toLowerCase().trim();
    suggestion[h] = preset[key] || null;
  }
  return suggestion;
}

// ─── Análisis (paso 1 del wizard) ─────────────────────────────────────

// Análisis inicial del archivo: detecta formato, sugiere mapeo, cuenta filas.
function analyzeFile(db, tenantId, entity, { filename, content }) {
  const { format: parseFormat, headers, rows } = parseFile({ filename, content });
  const sourceFormat = detectSourceFormat(headers);
  const suggestedMapping = suggestMapping(entity, sourceFormat, headers);

  // Para detectar conflictos: cargar phones/emails existentes del tenant
  // Solo contactos por ahora — leads/etc. tienen su propia lógica.
  let conflicts = { duplicates: 0, total: 0 };
  if (entity === 'contacts') {
    conflicts = _scanContactConflicts(db, tenantId, headers, rows, suggestedMapping);
  }

  return {
    format: parseFormat,
    sourceFormat,
    headers,
    suggestedMapping,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 5),
    conflicts,
  };
}

function _scanContactConflicts(db, tenantId, headers, rows, mapping) {
  // Identificar qué columna es 'phone'
  const phoneCol = Object.entries(mapping).find(([_, v]) => v === 'phone')?.[0];
  if (!phoneCol) return { duplicates: 0, total: rows.length };
  const phoneIdx = headers.indexOf(phoneCol);
  if (phoneIdx === -1) return { duplicates: 0, total: rows.length };

  const phones = rows.map(r => _normalizePhone(r[phoneIdx])).filter(Boolean);
  if (phones.length === 0) return { duplicates: 0, total: rows.length };

  // Query existentes
  const placeholders = phones.map(() => '?').join(',');
  const existing = db.prepare(`
    SELECT phone FROM contacts WHERE tenant_id = ? AND phone IN (${placeholders})
  `).all(tenantId, ...phones);
  return { duplicates: existing.length, total: rows.length };
}

function _normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[^0-9]/g, '');
  if (s.length < 10) return null;
  return s.length === 10 ? '521' + s : s;
}

module.exports = {
  getAvailableEntities,
  parseFile,
  detectSourceFormat,
  suggestMapping,
  analyzeFile,
};
