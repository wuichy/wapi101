const https = require('https');
const { decryptJson } = require('../../security/crypto');

const META_API_VERSION = 'v22.0';

// Lee credenciales de Meta desde la integración WhatsApp activa en DB,
// con fallback a .env. La integración suele tener el token vigente que
// pegó el usuario en el form; el .env queda como respaldo histórico.
function getWAConfig(db) {
  let token  = '';
  let wabaId = '';
  try {
    const row = db && db.prepare(
      `SELECT credentials_enc FROM integrations
        WHERE provider = 'whatsapp' AND status = 'connected'
        ORDER BY id ASC LIMIT 1`
    ).get();
    if (row?.credentials_enc) {
      const creds = decryptJson(row.credentials_enc) || {};
      if (creds.accessToken) token  = creds.accessToken;
      if (creds.wabaId)      wabaId = creds.wabaId;
    }
  } catch (_) { /* ignore — caemos al fallback */ }

  if (!token)  token  = process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (!wabaId) wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
  return { token, wabaId };
}

function metaRequest(db, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const { token } = getWAConfig(db);
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

  // HEADER — TEXT | IMAGE | VIDEO | DOCUMENT
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

  // BODY (siempre). Si tiene variables {{1}}, {{2}}, … Meta exige un example.
  if (template.body) {
    const comp = { type: 'BODY', text: template.body };
    const varNums = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    if (varNums.length) {
      const max = Math.max(...varNums);
      // Genera ejemplos placeholder ("Ejemplo 1", "Ejemplo 2", ...) — Meta solo
      // los necesita para que su revisor entienda el formato.
      const examples = Array.from({ length: max }, (_, i) => `Ejemplo ${i + 1}`);
      comp.example = { body_text: [examples] };
    }
    components.push(comp);
  }

  // FOOTER
  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }

  // BUTTONS — array de hasta 3 (3 QUICK_REPLY, o mix con máx 2 CTA según política Meta)
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

// Sube un archivo a Meta usando la Resumable Upload API.
// Para CREAR plantillas con header media (IMAGE/VIDEO/DOCUMENT),
// Meta requiere un "header_handle" obtenido por este flujo.
//
// Pasos:
//   1) POST /v22.0/<APP_ID>/uploads?file_length=N&file_type=mime → devuelve session id
//   2) POST /v22.0/<session_id> con Authorization: OAuth <token> y body raw
//      → devuelve { h: "<header_handle>" }
async function uploadHeaderToMeta(db, buffer, mimetype) {
  const { token } = getWAConfig(db);
  if (!token) throw new Error('Sin access token de Meta');
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error('META_APP_ID no configurado en .env');

  // Step 1 — start upload session
  const sessionUrl = `https://graph.facebook.com/${META_API_VERSION}/${appId}/uploads`
    + `?file_length=${buffer.length}`
    + `&file_type=${encodeURIComponent(mimetype)}`;
  const sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const sessionJson = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok || !sessionJson.id) {
    const msg = sessionJson?.error?.message || JSON.stringify(sessionJson);
    throw new Error(`Resumable upload init failed: ${msg}`);
  }

  // Step 2 — upload bytes (note: header is OAuth, NOT Bearer, per Meta spec)
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
    const msg = uploadJson?.error?.message || JSON.stringify(uploadJson);
    throw new Error(`Resumable upload bytes failed: ${msg}`);
  }
  return uploadJson.h;
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

function create(db, { type = 'free_form', name, displayName, category = 'UTILITY', language = 'es_MX',
                       header, body, footer,
                       headerType, headerMediaUrl, headerMediaHandle, buttons }) {
  if (!name?.trim()) throw new Error('El nombre es obligatorio');
  if (!body?.trim()) throw new Error('El cuerpo es obligatorio');
  const ht = (headerType || 'TEXT').toUpperCase();
  const btnsJson = (Array.isArray(buttons) && buttons.length) ? JSON.stringify(buttons) : null;
  const r = db.prepare(`
    INSERT INTO message_templates
      (type, name, display_name, category, language, header, body, footer,
       header_type, header_media_url, header_media_handle, buttons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type, name.trim(), displayName?.trim() || null, category, language,
    header?.trim() || null, body.trim(), footer?.trim() || null,
    ht, headerMediaUrl || null, headerMediaHandle || null, btnsJson,
  );
  return getById(db, r.lastInsertRowid);
}

function update(db, id, { name, displayName, category, language, header, body, footer,
                          headerType, headerMediaUrl, headerMediaHandle, headerMediaId, buttons,
                          waStatus, waId, waRejectedReason }) {
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
  if (headerType !== undefined)        { fields.push('header_type = ?');         params.push(String(headerType).toUpperCase()); }
  if (headerMediaUrl !== undefined)    { fields.push('header_media_url = ?');    params.push(headerMediaUrl || null); }
  if (headerMediaHandle !== undefined) { fields.push('header_media_handle = ?'); params.push(headerMediaHandle || null); }
  if (headerMediaId !== undefined)     { fields.push('header_media_id = ?');     params.push(headerMediaId || null); }
  if (buttons !== undefined) {
    fields.push('buttons = ?');
    params.push(Array.isArray(buttons) && buttons.length ? JSON.stringify(buttons) : null);
  }
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

  const { wabaId } = getWAConfig(db);
  if (!wabaId) throw new Error('WABA ID no encontrado (revisa la integración WhatsApp o WHATSAPP_BUSINESS_ACCOUNT_ID en .env)');

  const components = buildComponents(tmpl);
  const payload = {
    name: tmpl.name,
    language: tmpl.language,
    category: tmpl.category,
    components,
  };

  const result = await metaRequest(db, 'POST', `/${wabaId}/message_templates`, payload);

  if (result.body?.id) {
    update(db, id, { waId: result.body.id, waStatus: 'pending' });
    return { success: true, waId: result.body.id, status: result.body.status };
  } else {
    // Construir mensaje detallado para que el usuario sepa qué arreglar.
    const err = result.body?.error || {};
    const parts = [];
    if (err.message) parts.push(err.message);
    if (err.error_user_msg) parts.push(`(${err.error_user_msg})`);
    if (err.error_data?.details) parts.push(`— ${err.error_data.details}`);
    if (!parts.length) parts.push(JSON.stringify(result.body));
    throw new Error(`Meta API error: ${parts.join(' ')}`);
  }
}

// Sync approval status from Meta
async function syncFromMeta(db, id) {
  const tmpl = getById(db, id);
  if (!tmpl) throw new Error('Plantilla no encontrada');
  if (!tmpl.waId) throw new Error('Esta plantilla aún no se ha enviado a Meta');

  const result = await metaRequest(db, 'GET', `/${tmpl.waId}?fields=name,status,rejected_reason`);
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
  let buttons = null;
  if (r.buttons) {
    try { buttons = JSON.parse(r.buttons); } catch { buttons = null; }
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
    waStatus:         r.wa_status,
    waId:             r.wa_id || null,
    waRejectedReason: r.wa_rejected_reason || null,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  };
}

module.exports = { list, getById, create, update, remove, submitToMeta, syncFromMeta, syncAll, uploadHeaderToMeta };
