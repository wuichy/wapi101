'use strict';

// Herramientas disponibles para el Copiloto.
// Cada tool tiene: definición (para pasarle a la IA) + execute() para correrla.
// Las acciones de escritura verifican el config del tenant antes de ejecutarse.

const TOOL_DEFS = [
  {
    name: 'search_contacts',
    description: 'Busca contactos por nombre, teléfono o email. Devuelve hasta 8 resultados.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Texto a buscar (nombre, teléfono o email)' } },
      required: ['q'],
    },
  },
  {
    name: 'get_contact',
    description: 'Obtiene información completa de un contacto: datos, leads asociados y últimas conversaciones.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID del contacto' } },
      required: ['id'],
    },
  },
  {
    name: 'list_leads',
    description: 'Lista leads con filtros opcionales. Devuelve hasta 15 resultados.',
    input_schema: {
      type: 'object',
      properties: {
        search:     { type: 'string',  description: 'Texto libre para buscar en el nombre del lead o contacto' },
        pipelineId: { type: 'number',  description: 'Filtrar por pipeline' },
        stageId:    { type: 'number',  description: 'Filtrar por etapa específica' },
        advisorId:  { type: 'number',  description: 'Filtrar por asesor asignado' },
        tags:       { type: 'string',  description: 'Etiqueta para filtrar (una sola)' },
      },
    },
  },
  {
    name: 'get_lead',
    description: 'Obtiene todos los detalles de un lead: etapa, pipeline, campos personalizados, tags, asesor y actividad reciente.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID del lead' } },
      required: ['id'],
    },
  },
  {
    name: 'get_pipeline_summary',
    description: 'Resumen de un pipeline: número de leads por etapa.',
    input_schema: {
      type: 'object',
      properties: { pipelineId: { type: 'number', description: 'ID del pipeline. Si no se especifica, devuelve todos.' } },
    },
  },
  {
    name: 'get_stats',
    description: 'Estadísticas del CRM: leads creados, conversaciones, asesores activos en los últimos días.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Últimos N días (7 o 30). Default 7.' } },
    },
  },
  {
    name: 'list_advisors',
    description: 'Lista los asesores del equipo con su carga actual de leads.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'move_lead_stage',
    description: 'Mueve un lead a una etapa diferente dentro de su pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        leadId:  { type: 'number', description: 'ID del lead a mover' },
        stageId: { type: 'number', description: 'ID de la etapa destino' },
      },
      required: ['leadId', 'stageId'],
    },
  },
  {
    name: 'assign_lead',
    description: 'Asigna o reasigna un lead a un asesor.',
    input_schema: {
      type: 'object',
      properties: {
        leadId:    { type: 'number', description: 'ID del lead' },
        advisorId: { type: 'number', description: 'ID del asesor. 0 para quitar asignación.' },
      },
      required: ['leadId', 'advisorId'],
    },
  },
  {
    name: 'add_tag_to_lead',
    description: 'Agrega una etiqueta a un lead.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'number', description: 'ID del lead' },
        tag:    { type: 'string',  description: 'Nombre de la etiqueta a agregar' },
      },
      required: ['leadId', 'tag'],
    },
  },
  {
    name: 'add_note',
    description: 'Agrega una nota de actividad a un lead.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'number', description: 'ID del lead' },
        text:   { type: 'string',  description: 'Texto de la nota' },
      },
      required: ['leadId', 'text'],
    },
  },
  {
    name: 'list_pipelines',
    description: 'Lista todos los pipelines y sus etapas.',
    input_schema: { type: 'object', properties: {} },
  },
];

const WRITE_TOOLS = new Set(['move_lead_stage', 'assign_lead', 'add_tag_to_lead', 'add_note']);

function getEnabledTools(config = {}) {
  return TOOL_DEFS.filter(t => {
    if (!WRITE_TOOLS.has(t.name)) return true;
    if (t.name === 'move_lead_stage') return config.canMoveStage !== false;
    if (t.name === 'assign_lead')     return config.canAssign    !== false;
    if (t.name === 'add_tag_to_lead') return config.canAddTag    !== false;
    if (t.name === 'add_note')        return config.canAddNote   !== false;
    return true;
  });
}

async function executeTool(db, tenantId, name, input, config = {}) {
  switch (name) {

    case 'search_contacts': {
      const q = String(input.q || '').trim().toLowerCase();
      const rows = db.prepare(`
        SELECT id, first_name, last_name, phone, email
          FROM contacts
         WHERE tenant_id = ?
           AND (LOWER(first_name||' '||COALESCE(last_name,'')) LIKE ? OR phone LIKE ? OR LOWER(COALESCE(email,'')) LIKE ?)
         ORDER BY first_name LIMIT 8
      `).all(tenantId, `%${q}%`, `%${q}%`, `%${q}%`);
      return rows.map(r => ({ id: r.id, name: `${r.first_name} ${r.last_name||''}`.trim(), phone: r.phone, email: r.email }));
    }

    case 'get_contact': {
      const c = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(input.id, tenantId);
      if (!c) return { error: 'Contacto no encontrado' };
      const leads = db.prepare(`
        SELECT e.id, e.name, s.name AS stage, p.name AS pipeline
          FROM expedients e
          LEFT JOIN pipeline_stages s ON s.id = e.stage_id
          LEFT JOIN pipelines p ON p.id = e.pipeline_id
         WHERE e.contact_id = ? AND e.tenant_id = ?
         ORDER BY e.updated_at DESC LIMIT 5
      `).all(c.id, tenantId);
      const convos = db.prepare(`
        SELECT id, provider, unread_count, last_message_at FROM conversations
         WHERE contact_id = ? AND tenant_id = ? ORDER BY last_message_at DESC LIMIT 3
      `).all(c.id, tenantId);
      return { id: c.id, name: `${c.first_name} ${c.last_name||''}`.trim(), phone: c.phone, email: c.email, leads, recentConversations: convos };
    }

    case 'list_leads': {
      let sql = `
        SELECT e.id, e.name, c.first_name||' '||COALESCE(c.last_name,'') AS contact,
               s.name AS stage, p.name AS pipeline, a.name AS advisor, e.tags
          FROM expedients e
          LEFT JOIN contacts c ON c.id = e.contact_id
          LEFT JOIN pipeline_stages s ON s.id = e.stage_id
          LEFT JOIN pipelines p ON p.id = e.pipeline_id
          LEFT JOIN advisors a ON a.id = e.assigned_advisor_id
         WHERE e.tenant_id = ?
      `;
      const params = [tenantId];
      if (input.pipelineId) { sql += ' AND e.pipeline_id = ?'; params.push(input.pipelineId); }
      if (input.stageId)    { sql += ' AND e.stage_id = ?';    params.push(input.stageId); }
      if (input.advisorId)  { sql += ' AND e.assigned_advisor_id = ?'; params.push(input.advisorId); }
      if (input.search)     { sql += ' AND (LOWER(e.name) LIKE ? OR LOWER(c.first_name||c.last_name) LIKE ?)'; params.push(`%${input.search.toLowerCase()}%`, `%${input.search.toLowerCase()}%`); }
      if (input.tags)       { sql += ' AND e.tags LIKE ?'; params.push(`%${input.tags}%`); }
      sql += ' ORDER BY e.updated_at DESC LIMIT 15';
      return db.prepare(sql).all(...params).map(r => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [] }));
    }

    case 'get_lead': {
      const e = db.prepare(`
        SELECT e.*, s.name AS stage_name, p.name AS pipeline_name,
               c.first_name||' '||COALESCE(c.last_name,'') AS contact_name, c.phone,
               a.name AS advisor_name
          FROM expedients e
          LEFT JOIN pipeline_stages s ON s.id = e.stage_id
          LEFT JOIN pipelines p ON p.id = e.pipeline_id
          LEFT JOIN contacts c ON c.id = e.contact_id
          LEFT JOIN advisors a ON a.id = e.assigned_advisor_id
         WHERE e.id = ? AND e.tenant_id = ?
      `).get(input.id, tenantId);
      if (!e) return { error: 'Lead no encontrado' };
      const activity = db.prepare(`
        SELECT type, description, advisor_name, created_at FROM expedient_activity
         WHERE expedient_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 5
      `).all(input.id, tenantId);
      return { ...e, tags: e.tags ? JSON.parse(e.tags) : [], recentActivity: activity };
    }

    case 'get_pipeline_summary': {
      const pipelines = input.pipelineId
        ? db.prepare('SELECT id, name FROM pipelines WHERE id = ? AND tenant_id = ?').all(input.pipelineId, tenantId)
        : db.prepare('SELECT id, name FROM pipelines WHERE tenant_id = ? ORDER BY sort_order').all(tenantId);
      return pipelines.map(p => {
        const stages = db.prepare(`
          SELECT s.name, COUNT(e.id) AS leads
            FROM pipeline_stages s
            LEFT JOIN expedients e ON e.stage_id = s.id AND e.tenant_id = s.tenant_id
           WHERE s.pipeline_id = ? AND s.tenant_id = ?
           GROUP BY s.id ORDER BY s.sort_order
        `).all(p.id, tenantId);
        return { pipeline: p.name, stages };
      });
    }

    case 'get_stats': {
      const days = Number(input.days) || 7;
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const leadsCreated  = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE tenant_id = ? AND created_at >= ?').get(tenantId, since)?.n || 0;
      const msgsSent      = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND created_at >= ? AND direction = 'outgoing'").get(tenantId, since)?.n || 0;
      const msgsReceived  = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND created_at >= ? AND direction = 'incoming'").get(tenantId, since)?.n || 0;
      const activeLeads   = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE tenant_id = ?').get(tenantId)?.n || 0;
      return { period: `últimos ${days} días`, leadsCreated, messagesSent: msgsSent, messagesReceived: msgsReceived, totalActiveLeads: activeLeads };
    }

    case 'list_advisors': {
      const advisors = db.prepare('SELECT id, name, email FROM advisors WHERE tenant_id = ? AND active = 1').all(tenantId);
      return advisors.map(a => {
        const leads = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE assigned_advisor_id = ? AND tenant_id = ?').get(a.id, tenantId)?.n || 0;
        return { id: a.id, name: a.name, email: a.email, assignedLeads: leads };
      });
    }

    case 'move_lead_stage': {
      if (config.canMoveStage === false) return { error: 'Acción no permitida por la configuración del Copiloto.' };
      const stage = db.prepare('SELECT id, name, pipeline_id FROM pipeline_stages WHERE id = ? AND tenant_id = ?').get(input.stageId, tenantId);
      if (!stage) return { error: 'Etapa no encontrada' };
      const lead = db.prepare('SELECT id, name FROM expedients WHERE id = ? AND tenant_id = ?').get(input.leadId, tenantId);
      if (!lead) return { error: 'Lead no encontrado' };
      db.prepare('UPDATE expedients SET stage_id = ?, pipeline_id = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
        .run(stage.id, stage.pipeline_id, input.leadId, tenantId);
      return { ok: true, message: `Lead "${lead.name}" movido a etapa "${stage.name}"` };
    }

    case 'assign_lead': {
      if (config.canAssign === false) return { error: 'Acción no permitida por la configuración del Copiloto.' };
      const lead = db.prepare('SELECT id, name FROM expedients WHERE id = ? AND tenant_id = ?').get(input.leadId, tenantId);
      if (!lead) return { error: 'Lead no encontrado' };
      const advisorId = input.advisorId || null;
      if (advisorId) {
        const adv = db.prepare('SELECT id FROM advisors WHERE id = ? AND tenant_id = ?').get(advisorId, tenantId);
        if (!adv) return { error: 'Asesor no encontrado' };
      }
      db.prepare('UPDATE expedients SET assigned_advisor_id = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
        .run(advisorId, input.leadId, tenantId);
      return { ok: true, message: advisorId ? `Lead "${lead.name}" asignado al asesor #${advisorId}` : `Lead "${lead.name}" sin asignar` };
    }

    case 'add_tag_to_lead': {
      if (config.canAddTag === false) return { error: 'Acción no permitida por la configuración del Copiloto.' };
      const lead = db.prepare('SELECT id, name, tags FROM expedients WHERE id = ? AND tenant_id = ?').get(input.leadId, tenantId);
      if (!lead) return { error: 'Lead no encontrado' };
      const tags = lead.tags ? JSON.parse(lead.tags) : [];
      const tag = String(input.tag || '').trim();
      if (!tag) return { error: 'Etiqueta vacía' };
      if (!tags.includes(tag)) {
        tags.push(tag);
        db.prepare('UPDATE expedients SET tags = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
          .run(JSON.stringify(tags), input.leadId, tenantId);
      }
      return { ok: true, message: `Etiqueta "${tag}" añadida al lead "${lead.name}"` };
    }

    case 'add_note': {
      if (config.canAddNote === false) return { error: 'Acción no permitida por la configuración del Copiloto.' };
      const lead = db.prepare('SELECT id, name, contact_id FROM expedients WHERE id = ? AND tenant_id = ?').get(input.leadId, tenantId);
      if (!lead) return { error: 'Lead no encontrado' };
      const text = String(input.text || '').trim();
      if (!text) return { error: 'Nota vacía' };
      db.prepare(`
        INSERT INTO expedient_activity (tenant_id, expedient_id, contact_id, type, description, advisor_name, created_at)
        VALUES (?, ?, ?, 'note', ?, 'Copiloto IA', unixepoch())
      `).run(tenantId, lead.id, lead.contact_id, text);
      return { ok: true, message: `Nota añadida al lead "${lead.name}"` };
    }

    case 'list_pipelines': {
      const pipelines = db.prepare('SELECT id, name FROM pipelines WHERE tenant_id = ? ORDER BY sort_order').all(tenantId);
      return pipelines.map(p => {
        const stages = db.prepare('SELECT id, name, sort_order FROM pipeline_stages WHERE pipeline_id = ? AND tenant_id = ? ORDER BY sort_order').all(p.id, tenantId);
        return { id: p.id, name: p.name, stages };
      });
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { TOOL_DEFS, getEnabledTools, executeTool };
