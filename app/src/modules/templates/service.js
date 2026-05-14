const https = require('https');
const { decryptJson } = require('../../security/crypto');
const { friendlyMetaError } = require('../integrations/meta-errors');

const META_API_VERSION = 'v22.0';

// Lee credenciales de Meta desde la integración WhatsApp activa del tenant,
// con fallback a .env. Cada tenant tiene su propia integración WhatsApp con
// su propio access token / WABA ID.
function getWAConfig(db, tenantId) {
  let token  = '';
  let wabaId = '';
  try {
    const row = db && db.prepare(
      `SELECT credentials_enc FROM integrations
        WHERE provider = 'whatsapp' AND tenant_id = ?
        ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END, id ASC LIMIT 1`
    ).get(tenantId);
    if (row?.credentials_enc) {
      const creds = decryptJson(row.credentials_enc) || {};
      if (creds.accessToken) token  = creds.accessToken;
      if (creds.wabaId)      wabaId = creds.wabaId;
    }
  } catch (_) { /* ignore — caemos al fallback */ }

  // Fallback solo se usa si no hay integración configurada — útil para Lucho
  // (tenant 1) que tiene credenciales históricas en .env.
  if (!token)  token  = process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (!wabaId) wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
  return { token, wabaId };
}

function metaRequest(db, tenantId, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const { token } = getWAConfig(db, tenantId);
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

  const ht = (template.headerType || 'TEXT').toUpperCase();
  if (ht === 'IMAGE' || ht === 'VIDEO' || ht === 'DOCUMENT') {
    if (!template.headerMediaHandle) {
      throw new Error(`Header tipo ${ht} requiere subir el archivo primero (header_handle)`);
    }
    components.push({
      type: 'HEADER',
      format: ht,
      example: { header_handle: [template.headerMediaHandle] },
    });
  } else if (template.header) {
    components.push({ type: 'HEADER', format: 'TEXT', text: template.header });
  }

  if (template.body) {
    const comp = { type: 'BODY', text: template.body };
    const varNums = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    if (varNums.length) {
      const max = Math.max(...varNums);
      let phs = template.bodyPlaceholders;
      if (typeof phs === 'string') {
        try { phs = JSON.parse(phs); } catch { phs = null; }
      }
      const examples = Array.from({ length: max }, (_, i) => {
        const ph = Array.isArray(phs) ? phs[i] : null;
        return (ph && typeof ph.example === 'string' && ph.example.trim()) ? ph.example.trim() : `Ejemplo ${i + 1}`;
      });
      comp.example = { body_text: [examples] };
    }
    components.push(comp);
  }

  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }

  let btns = template.buttons;
  if (typeof btns === 'string') {
    try { btns = JSON.parse(btns); } catch { btns = null; }
  }
  if (Array.isArray(btns) && btns.length) {
    const out = [];
    for (const b of btns) {
      if (!b || !b.text) continue;
      if (b.type === 'QUICK_REPLY') {
        out.push({ type: 'QUICK_REPLY', text: b.text });
      } else if (b.type === 'URL') {
        if (!b.url) continue;
        out.push({ type: 'URL', text: b.text, url: b.url });
      } else if (b.type === 'PHONE_NUMBER') {
        if (!b.phone_number) continue;
        out.push({ type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number });
      }
    }
    if (out.length) components.push({ type: 'BUTTONS', buttons: out });
  }

  return components;
}

async function uploadHeaderToMeta(db, tenantId, buffer, mimetype) {
  const { token } = getWAConfig(db, tenantId);
  if (!token) throw new Error('Sin access token de Meta');
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error('META_APP_ID no configurado en .env');

  const sessionUrl = `https://graph.facebook.com/${META_API_VERSION}/${appId}/uploads`
    + `?file_length=${buffer.length}`
    + `&file_type=${encodeURIComponent(mimetype)}`;
  const sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const sessionJson = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok || !sessionJson.id) {
    throw new Error(`Subiendo archivo a Meta: ${friendlyMetaError(sessionJson?.error)}`);
  }

  const uploadUrl = `https://graph.facebook.com/${META_API_VERSION}/${sessionJson.id}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: '0',
    },
    body: buffer,
  });
  const uploadJson = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || !uploadJson.h) {
    throw new Error(`Subiendo bytes a Meta: ${friendlyMetaError(uploadJson?.error)}`);
  }
  return uploadJson.h;
}

// Escanea bots del tenant y devuelve un map { templateId → [{ id, name }, ...] }
function _buildBotsByTplMap(db, tenantId) {
  const map = {};
  try {
    const bots = db.prepare('SELECT id, name, steps FROM salsbots WHERE tenant_id = ?').all(tenantId);
    for (const bot of bots) {
      let steps = [];
      try { steps = JSON.parse(bot.steps || '[]'); } catch { continue; }
      const seen = new Set();
      for (const s of (steps || [])) {
        if (s?.type !== 'template') continue;
        const tid = Number(s.config?.templateId);
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        if (!map[tid]) map[tid] = [];
        map[tid].push({ id: bot.id, name: bot.name });
      }
    }
  } catch (_) { /* tabla no existe o error — ignorar */ }
  return map;
}

function list(db, tenantId, { type } = {}) {
  const where = type ? 'WHERE tenant_id = ? AND type = ?' : 'WHERE tenant_id = ?';
  const params = type ? [tenantId, type] : [tenantId];
  const rows = db.prepare(`
    SELECT * FROM message_templates ${where}
    ORDER BY (sort_order IS NULL), sort_order ASC, created_at DESC
  `).all(...params);
  const tagsByTpl = {};
  try {
    const tagRows = db.prepare(`
      SELECT tta.template_id, tt.id, tt.name, tt.color
        FROM template_tag_assignments tta
        JOIN template_tags tt ON tt.id = tta.tag_id
       WHERE tta.tenant_id = ?
    `).all(tenantId);
    tagRows.forEach(r => {
      if (!tagsByTpl[r.template_id]) tagsByTpl[r.template_id] = [];
      tagsByTpl[r.template_id].push({ id: r.id, name: r.name, color: r.color });
    });
  } catch (_) { /* migration aún no aplicada */ }
  const botsByTpl = _buildBotsByTplMap(db, tenantId);
  return rows.map(r => ({
    ...row(r),
    tags: tagsByTpl[r.id] || [],
    usedByBots: botsByTpl[r.id] || [],
  }));
}

function getById(db, tenantId, id) {
  // Si tenantId es null, asume que el caller (ej. webhook) busca por id global.
  // En ese caso devuelve la plantilla y deja que el caller la valide.
  const r = tenantId == null
    ? db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM message_templates WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!r) return null;
  const out = row(r);
  const t = tenantId ?? r.tenant_id;
  try {
    out.tags = db.prepare(`
      SELECT tt.id, tt.name, tt.color
        FROM template_tag_assignments tta
        JOIN template_tags tt ON tt.id = tta.tag_id
       WHERE tta.template_id = ? AND tta.tenant_id = ?
       ORDER BY tt.name COLLATE NOCASE
    `).all(id, t);
  } catch (_) { out.tags = []; }
  out.usedByBots = _buildBotsByTplMap(db, t)[id] || [];
  return out;
}

function setTags(db, tenantId, templateId, tagIds) {
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM template_tag_assignments WHERE template_id = ? AND tenant_id = ?').run(templateId, tenantId);
    const ins = db.prepare('INSERT OR IGNORE INTO template_tag_assignments (tenant_id, template_id, tag_id) VALUES (?, ?, ?)');
    for (const t of (tagIds || [])) ins.run(tenantId, templateId, Number(t));
  });
  trx();
}

function create(db, tenantId, { type = 'free_form', name, displayName, category = 'UTILITY', language = 'es_MX',
                       header, body, footer,
                       headerType, headerMediaUrl, headerMediaHandle, buttons, bodyPlaceholders }) {
  if (!name?.trim()) throw new Error('El nombre es obligatorio');
  if (!body?.trim()) throw new Error('El cuerpo es obligatorio');
  const ht = (headerType || 'TEXT').toUpperCase();
  const btnsJson = (Array.isArray(buttons) && buttons.length) ? JSON.stringify(buttons) : null;
  const phsJson  = (Array.isArray(bodyPlaceholders) && bodyPlaceholders.length) ? JSON.stringify(bodyPlaceholders) : null;
  const r = db.prepare(`
    INSERT INTO message_templates
      (tenant_id, type, name, display_name, category, language, header, body, footer,
       header_type, header_media_url, header_media_handle, buttons, body_placeholders)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId,
    type, name.trim(), displayName?.trim() || null, category, language,
    header?.trim() || null, body.trim(), footer?.trim() || null,
    ht, headerMediaUrl || null, headerMediaHandle || null, btnsJson, phsJson,
  );
  return getById(db, tenantId, r.lastInsertRowid);
}

function update(db, tenantId, id, { name, displayName, category, language, header, body, footer,
                          headerType, headerMediaUrl, headerMediaHandle, headerMediaId, buttons, bodyPlaceholders,
                          waStatus, waId, waRejectedReason }) {
  // tenantId puede venir null cuando webhook actualiza estado de Meta —
  // en ese caso se busca solo por id (la plantilla ya tiene tenant fijo).
  const existing = tenantId == null
    ? db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM message_templates WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!existing) return null;
  const t = tenantId ?? existing.tenant_id;
  const fields = [];
  const params = [];
  if (name !== undefined)        { fields.push('name = ?');         params.push(name?.trim() || existing.name); }
  if (displayName !== undefined) { fields.push('display_name = ?'); params.push(displayName?.trim() || null); }
  if (category !== undefined)    { fields.push('category = ?');     params.push(category); }
  if (language !== undefined)    { fields.push('language = ?');     params.push(language); }
  if (header !== undefined)      { fields.push('header = ?');       params.push(header?.trim() || null); }
  if (body !== undefined)        { fields.push('body = ?');         params.push(body?.trim() || null); }
  if (footer !== undefined)      { fields.push('footer = ?');       params.push(footer?.trim() || null); }
  if (headerType !== undefined)        { fields.push('header_type = ?');         params.push(String(headerType).toUpperCase()); }
  if (headerMediaUrl !== undefined)    { fields.push('header_media_url = ?');    params.push(headerMediaUrl || null); }
  if (headerMediaHandle !== undefined) { fields.push('header_media_handle = ?'); params.push(headerMediaHandle || null); }
  if (headerMediaId !== undefined)     { fields.push('header_media_id = ?');     params.push(headerMediaId || null); }
  if (buttons !== undefined) {
    fields.push('buttons = ?');
    params.push(Array.isArray(buttons) && buttons.length ? JSON.stringify(buttons) : null);
  }
  if (bodyPlaceholders !== undefined) {
    fields.push('body_placeholders = ?');
    params.push(Array.isArray(bodyPlaceholders) && bodyPlaceholders.length ? JSON.stringify(bodyPlaceholders) : null);
  }
  if (waStatus !== undefined)         { fields.push('wa_status = ?');           params.push(waStatus); }
  if (waId !== undefined)             { fields.push('wa_id = ?');               params.push(waId); }
  if (waRejectedReason !== undefined) { fields.push('wa_rejected_reason = ?');  params.push(waRejectedReason); }
  if (fields.length) {
    fields.push('updated_at = unixepoch()');
    params.push(id, t);
    db.prepare(`UPDATE message_templates SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
  }
  return getById(db, t, id);
}

function remove(db, tenantId, id) {
  return db.prepare('DELETE FROM message_templates WHERE id = ? AND tenant_id = ?').run(id, tenantId).changes > 0;
}

async function submitToMeta(db, tenantId, id) {
  const tmpl = getById(db, tenantId, id);
  if (!tmpl) throw new Error('Plantilla no encontrada');
  if (tmpl.type !== 'wa_api') throw new Error('Solo las plantillas de WhatsApp API pueden enviarse a Meta');

  const { wabaId } = getWAConfig(db, tenantId);
  if (!wabaId) throw new Error('WABA ID no encontrado (revisa la integración WhatsApp o WHATSAPP_BUSINESS_ACCOUNT_ID en .env)');

  const components = buildComponents(tmpl);
  const payload = {
    name: tmpl.name,
    language: tmpl.language,
    category: tmpl.category,
    components,
  };

  const result = await metaRequest(db, tenantId, 'POST', `/${wabaId}/message_templates`, payload);

  if (result.body?.id) {
    update(db, tenantId, id, { waId: result.body.id, waStatus: 'pending' });
    return { success: true, waId: result.body.id, status: result.body.status };
  } else {
    throw new Error(friendlyMetaError(result.body?.error));
  }
}

async function syncFromMeta(db, tenantId, id) {
  const tmpl = getById(db, tenantId, id);
  if (!tmpl) throw new Error('Plantilla no encontrada');
  if (!tmpl.waId) throw new Error('Esta plantilla aún no se ha enviado a Meta');

  const result = await metaRequest(db, tenantId, 'GET', `/${tmpl.waId}?fields=name,status,rejected_reason`);
  if (result.body?.status) {
    const statusMap = { APPROVED: 'approved', REJECTED: 'rejected', PENDING: 'pending', IN_APPEAL: 'pending', DELETED: 'draft' };
    const newStatus = statusMap[result.body.status] || 'pending';
    const rejectedReason = result.body.rejected_reason || null;
    update(db, tenantId, id, { waStatus: newStatus, waRejectedReason: rejectedReason });
    return { success: true, status: newStatus, metaStatus: result.body.status, rejectedReason };
  } else {
    throw new Error(friendlyMetaError(result.body?.error));
  }
}

async function syncAll(db, tenantId) {
  const pending = db.prepare(
    `SELECT * FROM message_templates WHERE type = 'wa_api' AND wa_id IS NOT NULL AND tenant_id = ?`
  ).all(tenantId).map(row);
  const results = [];
  for (const tmpl of pending) {
    try {
      const r = await syncFromMeta(db, tenantId, tmpl.id);
      results.push({ id: tmpl.id, ...r });
    } catch (e) {
      results.push({ id: tmpl.id, success: false, error: e.message });
    }
  }
  return results;
}

// Busca una plantilla por su wa_id (id de Meta) — usado por webhooks que
// reciben actualizaciones de estado y no tienen tenantId. Devuelve la
// plantilla con su tenant_id propio para que el caller pueda continuar.
function findByWaId(db, waId) {
  const r = db.prepare('SELECT * FROM message_templates WHERE wa_id = ?').get(waId);
  return r ? { ...row(r), tenantId: r.tenant_id } : null;
}

function row(r) {
  let buttons = null;
  if (r.buttons) {
    try { buttons = JSON.parse(r.buttons); } catch { buttons = null; }
  }
  let bodyPlaceholders = null;
  if (r.body_placeholders) {
    try { bodyPlaceholders = JSON.parse(r.body_placeholders); } catch { bodyPlaceholders = null; }
  }
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
    headerType:        r.header_type || 'TEXT',
    headerMediaUrl:    r.header_media_url || null,
    headerMediaHandle: r.header_media_handle || null,
    headerMediaId:     r.header_media_id || null,
    buttons,
    bodyPlaceholders,
    waStatus:         r.wa_status,
    waId:             r.wa_id || null,
    waRejectedReason: r.wa_rejected_reason || null,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  };
}

function reorder(db, tenantId, orderedIds) {
  const stmt = db.prepare('UPDATE message_templates SET sort_order = ? WHERE id = ? AND tenant_id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, Number(id), tenantId));
  });
  trx();
}

module.exports = { list, getById, create, update, remove, reorder, setTags, submitToMeta, syncFromMeta, syncAll, uploadHeaderToMeta, findByWaId };
