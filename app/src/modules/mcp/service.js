// MCP (Model Context Protocol) — definición de tools que exponemos a clientes
// MCP externos (Claude Desktop, Cursor, Claude Code) para que puedan interactuar
// con un tenant de wapi101 mediante un machine_token.
//
// Cada tool recibe (db, tenantId, args) y devuelve { content: [...] } al estilo
// MCP. Si lanza error, el wrapper en routes.js lo convierte en isError:true.

const customers       = require('../customers/service');
const conversations   = require('../conversations/service');
const expedients      = require('../expedients/service');
const sender          = require('../conversations/sender');

// ─── Definición de tools (JSONSchema) ─────────────────────────────────────
const TOOLS = [
  {
    name: 'list_contacts',
    description: 'Lista los contactos del CRM. Soporta búsqueda por nombre/teléfono y paginación.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Texto a buscar en nombre, teléfono o email' },
        page:   { type: 'integer', minimum: 1, default: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'search_contact',
    description: 'Busca UN contacto por teléfono exacto. Devuelve null si no existe.',
    inputSchema: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string', description: 'Teléfono en formato internacional (ej. +5215512345678)' },
      },
    },
  },
  {
    name: 'list_templates',
    description: 'Lista las plantillas de mensaje del tenant. Incluye tipo (wa_api / texto libre) y estado de aprobación de Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'send_message',
    description: 'Envía un mensaje a un contacto por su teléfono. Detecta automáticamente el canal según las integraciones activas. Si el contacto no existe, lo crea.',
    inputSchema: {
      type: 'object',
      required: ['phone', 'text'],
      properties: {
        phone: { type: 'string', description: 'Teléfono destino en formato internacional' },
        text:  { type: 'string', description: 'Texto del mensaje (1-4096 chars)' },
        contactName: { type: 'string', description: 'Nombre del contacto si hay que crearlo' },
      },
    },
  },
  {
    name: 'create_lead',
    description: 'Crea un lead/expediente en un pipeline + etapa específica. Si el contacto no existe (por teléfono), lo crea.',
    inputSchema: {
      type: 'object',
      required: ['pipelineId', 'stageId'],
      properties: {
        pipelineId: { type: 'integer' },
        stageId:    { type: 'integer' },
        name:       { type: 'string' },
        value:      { type: 'number', default: 0 },
        contactPhone: { type: 'string' },
        contactName:  { type: 'string' },
      },
    },
  },
  {
    name: 'move_lead_stage',
    description: 'Mueve un lead/expediente a otra etapa dentro del mismo o distinto pipeline.',
    inputSchema: {
      type: 'object',
      required: ['leadId', 'stageId'],
      properties: {
        leadId:  { type: 'integer', description: 'ID del expediente' },
        stageId: { type: 'integer', description: 'ID de la etapa destino' },
      },
    },
  },
  {
    name: 'list_pipelines',
    description: 'Lista los pipelines del tenant con sus etapas. Útil para resolver IDs antes de crear leads o moverlos.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_template',
    description: 'Envía una plantilla de WhatsApp API APROBADA por Meta a un contacto (sirve fuera de la ventana de 24h, ideal si el cliente no nos ha escrito). Usa list_templates para ver IDs y placeholders.',
    inputSchema: {
      type: 'object',
      required: ['phone', 'templateId'],
      properties: {
        phone:        { type: 'string', description: 'Teléfono destino en formato internacional' },
        templateId:   { type: 'integer', description: 'ID de la plantilla (de list_templates, debe ser wa_api approved)' },
        values:       { type: 'array', items: { type: 'string' }, description: 'Valores para los placeholders {{1}}, {{2}}... en orden' },
        contactName:  { type: 'string', description: 'Nombre del contacto si hay que crearlo' },
      },
    },
  },
  {
    name: 'list_conversations',
    description: 'Lista las conversaciones recientes (chats) del tenant. Soporta filtro por no leídas y búsqueda.',
    inputSchema: {
      type: 'object',
      properties: {
        search:     { type: 'string', description: 'Texto a buscar en nombre/teléfono' },
        unreadOnly: { type: 'boolean', description: 'Solo conversaciones con mensajes sin leer' },
        limit:      { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
    },
  },
  {
    name: 'read_conversation',
    description: 'Lee los últimos mensajes de una conversación por teléfono del contacto. Útil para que la IA entienda el contexto antes de responder.',
    inputSchema: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string', description: 'Teléfono del contacto en formato internacional' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: 'list_leads',
    description: 'Lista o busca leads/expedientes del tenant. Filtra por texto y/o pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        search:     { type: 'string' },
        pipelineId: { type: 'integer' },
        page:       { type: 'integer', minimum: 1, default: 1 },
        pageSize:   { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'add_tag_to_contact',
    description: 'Agrega una etiqueta a un contacto (por teléfono). Si la etiqueta no existe, se crea. No duplica.',
    inputSchema: {
      type: 'object',
      required: ['phone', 'tag'],
      properties: {
        phone: { type: 'string', description: 'Teléfono del contacto en formato internacional' },
        tag:   { type: 'string', description: 'Nombre de la etiqueta' },
      },
    },
  },
  {
    name: 'list_tags',
    description: 'Lista las etiquetas existentes del tenant (de contactos y de leads).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_contact',
    description: 'Actualiza datos de un contacto existente (nombre, email) buscándolo por teléfono.',
    inputSchema: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone:     { type: 'string', description: 'Teléfono del contacto a actualizar (debe existir)' },
        firstName: { type: 'string' },
        lastName:  { type: 'string' },
        email:     { type: 'string' },
      },
    },
  },
  {
    name: 'get_stats',
    description: 'Resumen rápido del CRM del tenant: nº de contactos, leads, conversaciones, y conversaciones sin leer.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function textContent(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function _findContactByPhone(db, tenantId, phoneRaw) {
  const phone = customers.normalizePhone(phoneRaw);
  if (!phone) return null;
  return db.prepare('SELECT * FROM contacts WHERE phone = ? AND tenant_id = ?').get(phone, tenantId);
}

function _ensureContact(db, tenantId, { phone, name }) {
  let row = _findContactByPhone(db, tenantId, phone);
  if (row) return row;
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/);
  const created = customers.create(db, tenantId, {
    firstName: firstName || 'Contacto',
    lastName:  rest.join(' ') || '',
    phone,
    email: null,
    tags: ['MCP'],
  });
  return customers.getById(db, tenantId, created.id);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────
async function callTool(db, tenantId, name, args = {}) {
  switch (name) {
    case 'list_contacts': {
      const out = customers.list(db, tenantId, {
        search:   args.search || '',
        page:     Number(args.page) || 1,
        pageSize: Math.min(Math.max(Number(args.pageSize) || 25, 1), 100),
      });
      const fullName = (c) => `${c.firstName || ''} ${c.lastName || ''}`.trim() || '(sin nombre)';
      return textContent({
        total: out.total,
        page:  out.page,
        items: (out.items || []).map(c => ({
          id: c.id, name: fullName(c), phone: c.phone, email: c.email,
          tags: Array.isArray(c.tags) ? c.tags.map(t => (typeof t === 'string' ? t : t.name)) : [],
        })),
      });
    }

    case 'search_contact': {
      const c = _findContactByPhone(db, tenantId, args.phone);
      if (!c) return textContent({ found: false });
      const full = customers.getById(db, tenantId, c.id);
      const name = `${full.firstName || ''} ${full.lastName || ''}`.trim() || '(sin nombre)';
      return textContent({
        found: true,
        contact: { id: full.id, name, phone: full.phone, email: full.email },
      });
    }

    case 'list_templates': {
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      const rows = db.prepare(`
        SELECT id, name, type, wa_status, body, created_at
        FROM message_templates
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(tenantId, limit);
      return textContent({
        total: rows.length,
        items: rows.map(r => ({
          id: r.id, name: r.name, type: r.type, status: r.wa_status,
          preview: (r.body || '').slice(0, 120),
        })),
      });
    }

    case 'send_message': {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('El parámetro "text" no puede estar vacío.');
      if (text.length > 4096) throw new Error('El mensaje excede 4096 caracteres.');
      const contact = _ensureContact(db, tenantId, { phone: args.phone, name: args.contactName });
      if (!contact) throw new Error('Teléfono inválido o contacto no encontrado.');
      // Auto-pick provider: preferir whatsapp si existe integración activa.
      const integ = db.prepare(`
        SELECT id, provider FROM integrations
        WHERE tenant_id = ? AND status='connected'
          AND provider IN ('whatsapp','whatsapp-lite')
        ORDER BY (provider='whatsapp') DESC, id ASC LIMIT 1
      `).get(tenantId);
      if (!integ) throw new Error('No hay integración de WhatsApp activa para este tenant.');
      const convo = conversations.findOrCreate(db, tenantId, {
        provider: integ.provider, integrationId: integ.id,
        contactPhone: contact.phone, contactName: contact.name, contactId: contact.id,
      });
      // sendMessage devuelve el external id (string). Persistir SIEMPRE el
      // resultado en el chat: antes el envío MCP salía al cliente pero el CRM
      // no lo mostraba → el asesor podía repetirle el mensaje.
      let externalId;
      try {
        externalId = await sender.sendMessage(db, convo, text);
      } catch (err) {
        try {
          conversations.addMessage(db, tenantId, convo.id, {
            direction: 'outgoing', provider: convo.provider, body: text,
            status: 'failed', errorReason: err.message,
          });
        } catch (_) { /* no enmascarar */ }
        throw err;
      }
      const msg = conversations.addMessage(db, tenantId, convo.id, {
        externalId, direction: 'outgoing', provider: convo.provider, body: text, status: 'sent',
      });
      return textContent({ ok: true, conversationId: convo.id, messageId: msg?.id || null });
    }

    case 'create_lead': {
      const pipelineId = Number(args.pipelineId);
      const stageId    = Number(args.stageId);
      if (!pipelineId || !stageId) throw new Error('pipelineId y stageId son requeridos.');
      let contactId = null;
      if (args.contactPhone) {
        const c = _ensureContact(db, tenantId, { phone: args.contactPhone, name: args.contactName });
        contactId = c?.id || null;
      }
      if (!contactId) throw new Error('Se requiere contactPhone para crear el lead.');
      const lead = expedients.create(db, tenantId, {
        contactId, pipelineId, stageId,
        name: args.name || null,
        value: Number(args.value) || 0,
      });
      return textContent({ ok: true, leadId: lead.id });
    }

    case 'move_lead_stage': {
      const leadId  = Number(args.leadId);
      const stageId = Number(args.stageId);
      if (!leadId || !stageId) throw new Error('leadId y stageId son requeridos.');
      const stage = db.prepare('SELECT id, pipeline_id FROM stages WHERE id=? AND tenant_id=?').get(stageId, tenantId);
      if (!stage) throw new Error(`Stage #${stageId} no existe en este tenant.`);
      expedients.update(db, tenantId, leadId, {
        pipelineId: stage.pipeline_id,
        stageId,
      });
      return textContent({ ok: true, leadId, stageId });
    }

    case 'list_pipelines': {
      const pipelines = db.prepare(`
        SELECT id, name, sort_order FROM pipelines
        WHERE tenant_id = ? ORDER BY sort_order, id
      `).all(tenantId);
      const result = pipelines.map(p => ({
        id: p.id, name: p.name,
        stages: db.prepare(`
          SELECT id, name, sort_order FROM stages
          WHERE pipeline_id=? AND tenant_id=? ORDER BY sort_order, id
        `).all(p.id, tenantId),
      }));
      return textContent({ pipelines: result });
    }

    case 'send_template': {
      const templateId = Number(args.templateId);
      if (!templateId) throw new Error('templateId es requerido.');
      const tpl = db.prepare(
        "SELECT id, type, wa_status FROM message_templates WHERE id=? AND tenant_id=?"
      ).get(templateId, tenantId);
      if (!tpl) throw new Error(`Plantilla #${templateId} no existe en este tenant.`);
      if (tpl.type !== 'wa_api' || String(tpl.wa_status).toLowerCase() !== 'approved') {
        throw new Error('La plantilla debe ser tipo WhatsApp API y estar aprobada por Meta.');
      }
      const contact = _ensureContact(db, tenantId, { phone: args.phone, name: args.contactName });
      if (!contact) throw new Error('Teléfono inválido.');
      const integ = db.prepare(`
        SELECT id FROM integrations WHERE tenant_id = ? AND status='connected'
          AND provider = 'whatsapp' ORDER BY id LIMIT 1
      `).get(tenantId);
      if (!integ) throw new Error('No hay integración WhatsApp API activa (las plantillas solo van por WhatsApp Cloud API).');
      const convo = conversations.findOrCreate(db, tenantId, {
        provider: 'whatsapp', integrationId: integ.id,
        contactPhone: contact.phone, contactName: contact.name, contactId: contact.id,
      });
      const result = await sender.sendWhatsAppTemplate(db, convo, templateId, Array.isArray(args.values) ? args.values : [], { autoFallback: true });
      conversations.addMessage(db, tenantId, convo.id, {
        externalId: result?.externalId, direction: 'outgoing', provider: 'whatsapp',
        body: result?.renderedBody || '', status: 'sent',
      });
      return textContent({ ok: true, conversationId: convo.id });
    }

    case 'list_conversations': {
      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      const out = conversations.list(db, tenantId, {
        search: args.search || '', unreadOnly: !!args.unreadOnly, page: 1, pageSize: limit,
      });
      return textContent({
        total: out.total,
        items: (out.items || []).map(c => ({
          id: c.id, name: c.name || c.contactName, phone: c.contactPhone,
          provider: c.provider, unread: c.unreadCount || 0,
          lastMessage: (c.lastMessage || '').slice(0, 120),
        })),
      });
    }

    case 'read_conversation': {
      const c = _findContactByPhone(db, tenantId, args.phone);
      if (!c) return textContent({ found: false, error: 'Contacto no encontrado' });
      const convo = db.prepare(
        'SELECT id, provider FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 1'
      ).get(c.id, tenantId);
      if (!convo) return textContent({ found: false, error: 'Sin conversación' });
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const msgs = db.prepare(`
        SELECT direction, body, status, created_at FROM messages
        WHERE conversation_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(convo.id, tenantId, limit);
      return textContent({
        found: true, conversationId: convo.id, provider: convo.provider,
        messages: msgs.reverse().map(m => ({
          from: m.direction === 'incoming' ? 'cliente' : 'nosotros',
          text: m.body, at: m.created_at,
        })),
      });
    }

    case 'list_leads': {
      const out = expedients.list(db, tenantId, {
        search: args.search || '',
        pipelineId: args.pipelineId ? Number(args.pipelineId) : null,
        page: Number(args.page) || 1,
        pageSize: Math.min(Math.max(Number(args.pageSize) || 25, 1), 100),
      });
      return textContent({
        total: out.total, page: out.page,
        items: (out.items || []).map(e => ({
          id: e.id, name: e.name, pipelineId: e.pipelineId, stageId: e.stageId,
          stageName: e.stageName || null, value: e.value || 0,
          contactName: e.contactName || null, contactPhone: e.contactPhone || null,
        })),
      });
    }

    case 'add_tag_to_contact': {
      const tag = String(args.tag || '').trim();
      if (!tag) throw new Error('tag es requerido.');
      const c = _findContactByPhone(db, tenantId, args.phone);
      if (!c) throw new Error('Contacto no encontrado por ese teléfono.');
      db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)').run(c.id, tag);
      return textContent({ ok: true, contactId: c.id, tag });
    }

    case 'list_tags': {
      const contactTags = db.prepare(`
        SELECT DISTINCT t.tag AS name FROM contact_tags t
        JOIN contacts c ON c.id = t.contact_id WHERE c.tenant_id = ? AND t.tag != ''
      `).all(tenantId).map(r => r.name);
      const leadTags = db.prepare(`
        SELECT DISTINCT t.tag AS name FROM expedient_tags t
        JOIN expedients e ON e.id = t.expedient_id WHERE e.tenant_id = ? AND t.tag != ''
      `).all(tenantId).map(r => r.name);
      const all = [...new Set([...contactTags, ...leadTags])].sort((a, b) => a.localeCompare(b));
      return textContent({ tags: all });
    }

    case 'update_contact': {
      const c = _findContactByPhone(db, tenantId, args.phone);
      if (!c) throw new Error('Contacto no encontrado por ese teléfono.');
      const patch = {};
      if (args.firstName !== undefined) patch.firstName = args.firstName;
      if (args.lastName  !== undefined) patch.lastName  = args.lastName;
      if (args.email     !== undefined) patch.email     = args.email;
      if (!Object.keys(patch).length) throw new Error('Nada que actualizar.');
      customers.update(db, tenantId, c.id, patch);
      return textContent({ ok: true, contactId: c.id });
    }

    case 'get_stats': {
      const contacts = db.prepare('SELECT COUNT(*) n FROM contacts WHERE tenant_id = ?').get(tenantId).n;
      const leads    = db.prepare('SELECT COUNT(*) n FROM expedients WHERE tenant_id = ?').get(tenantId).n;
      const convos   = db.prepare('SELECT COUNT(*) n FROM conversations WHERE tenant_id = ?').get(tenantId).n;
      const unread   = db.prepare('SELECT COUNT(*) n FROM conversations WHERE tenant_id = ? AND unread_count > 0').get(tenantId).n;
      return textContent({ contacts, leads, conversations: convos, unread });
    }

    default:
      throw new Error(`Tool desconocido: ${name}`);
  }
}

module.exports = { TOOLS, callTool };
