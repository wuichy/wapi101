const https = require('https');

const META_API_VERSION = 'v22.0';

function getWAConfig() {
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN || '',
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  };
}

function metaRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const { token } = getWAConfig();
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'graph.facebook.com',
      path: `/${META_API_VERSION}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Build Meta API components array from template fields
function buildComponents(template) {
  const components = [];
  if (template.header) {
    components.push({ type: 'HEADER', format: 'TEXT', text: template.header });
  }
  if (template.body) {
    components.push({ type: 'BODY', text: template.body });
  }
  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }
  return components;
}

function list(db, { type } = {}) {
  const where = type ? 'WHERE type = ?' : '';
  const params = type ? [type] : [];
  return db.prepare(`SELECT * FROM message_templates ${where} ORDER BY created_at DESC`).all(...params).map(row);
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
  return r ? row(r) : null;
}

function create(db, { type = 'free_form', name, displayName, category = 'UTILITY', language = 'es_MX', header, body, footer }) {
  if (!name?.trim()) throw new Error('El nombre es obligatorio');
  if (!body?.trim()) throw new Error('El cuerpo es obligatorio');
  const r = db.prepare(`
    INSERT INTO message_templates (type, name, display_name, category, language, header, body, footer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, name.trim(), displayName?.trim() || null, category, language, header?.trim() || null, body.trim(), footer?.trim() || null);
  return getById(db, r.lastInsertRowid);
}

function update(db, id, { name, displayName, category, language, header, body, footer, waStatus, waId, waRejectedReason }) {
  const existing = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
  if (!existing) return null;
  const fields = [];
  const params = [];
  if (name !== undefined)        { fields.push('name = ?');         params.push(name?.trim() || existing.name); }
  if (displayName !== undefined) { fields.push('display_name = ?'); params.push(displayName?.trim() || null); }
  if (category !== undefined)    { fields.push('category = ?');     params.push(category); }
  if (language !== undefined)    { fields.push('language = ?');     params.push(language); }
  if (header !== undefined)      { fields.push('header = ?');       params.push(header?.trim() || null); }
  if (body !== undefined)        { fields.push('body = ?');         params.push(body?.trim() || null); }
  if (footer !== undefined)      { fields.push('footer = ?');       params.push(footer?.trim() || null); }
  if (waStatus !== undefined)         { fields.push('wa_status = ?');           params.push(waStatus); }
  if (waId !== undefined)             { fields.push('wa_id = ?');               params.push(waId); }
  if (waRejectedReason !== undefined) { fields.push('wa_rejected_reason = ?');  params.push(waRejectedReason); }
  if (fields.length) {
    fields.push('updated_at = unixepoch()');
    params.push(id);
    db.prepare(`UPDATE message_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }
  return getById(db, id);
}

function remove(db, id) {
  return db.prepare('DELETE FROM message_templates WHERE id = ?').run(id).changes > 0;
}

// Submit template to Meta for approval
async function submitToMeta(db, id) {
  const tmpl = getById(db, id);
  if (!tmpl) throw new Error('Plantilla no encontrada');
  if (tmpl.type !== 'wa_api') throw new Error('Solo las plantillas de WhatsApp API pueden enviarse a Meta');

  const { wabaId } = getWAConfig();
  if (!wabaId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID no configurado');

  const components = buildComponents(tmpl);
  const payload = {
    name: tmpl.name,
    language: tmpl.language,
    category: tmpl.category,
    components,
  };

  const result = await metaRequest('POST', `/${wabaId}/message_templates`, payload);

  if (result.body?.id) {
    update(db, id, { waId: result.body.id, waStatus: 'pending' });
    return { success: true, waId: result.body.id, status: result.body.status };
  } else {
    const errMsg = result.body?.error?.message || JSON.stringify(result.body);
    throw new Error(`Meta API error: ${errMsg}`);
  }
}

// Sync approval status from Meta
async function syncFromMeta(db, id) {
  const tmpl = getById(db, id);
  if (!tmpl) throw new Error('Plantilla no encontrada');
  if (!tmpl.waId) throw new Error('Esta plantilla aún no se ha enviado a Meta');

  const result = await metaRequest('GET', `/${tmpl.waId}?fields=name,status,rejected_reason`);
  if (result.body?.status) {
    const statusMap = { APPROVED: 'approved', REJECTED: 'rejected', PENDING: 'pending', IN_APPEAL: 'pending', DELETED: 'draft' };
    const newStatus = statusMap[result.body.status] || 'pending';
    const rejectedReason = result.body.rejected_reason || null;
    update(db, id, { waStatus: newStatus, waRejectedReason: rejectedReason });
    return { success: true, status: newStatus, metaStatus: result.body.status, rejectedReason };
  } else {
    throw new Error(`Meta API error: ${result.body?.error?.message || JSON.stringify(result.body)}`);
  }
}

// Sync all pending WA templates at once
async function syncAll(db) {
  const pending = db.prepare(`SELECT * FROM message_templates WHERE type = 'wa_api' AND wa_id IS NOT NULL`).all().map(row);
  const results = [];
  for (const tmpl of pending) {
    try {
      const r = await syncFromMeta(db, tmpl.id);
      results.push({ id: tmpl.id, ...r });
    } catch (e) {
      results.push({ id: tmpl.id, success: false, error: e.message });
    }
  }
  return results;
}

function row(r) {
  return {
    id:          r.id,
    type:        r.type,
    name:        r.name,
    displayName: r.display_name || null,
    category:    r.category,
    language:    r.language,
    header:      r.header || null,
    body:        r.body,
    footer:      r.footer || null,
    waStatus:         r.wa_status,
    waId:             r.wa_id || null,
    waRejectedReason: r.wa_rejected_reason || null,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  };
}

module.exports = { list, getById, create, update, remove, submitToMeta, syncFromMeta, syncAll };
