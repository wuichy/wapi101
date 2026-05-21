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
      return textContent({
        total: out.total,
        page:  out.page,
        items: (out.items || []).map(c => ({
          id: c.id, name: c.name, phone: c.phone, email: c.email,
          tags: (c.tags || []).map(t => t.name || t),
        })),
      });
    }

    case 'search_contact': {
      const c = _findContactByPhone(db, tenantId, args.phone);
      if (!c) return textContent({ found: false });
      const full = customers.getById(db, tenantId, c.id);
      return textContent({
        found: true,
        contact: { id: full.id, name: full.name, phone: full.phone, email: full.email },
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
      const result = await sender.sendMessage(db, convo, text);
      return textContent({ ok: true, conversationId: convo.id, messageId: result?.id || null });
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

    default:
      throw new Error(`Tool desconocido: ${name}`);
  }
}

module.exports = { TOOLS, callTool };
