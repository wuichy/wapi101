// Servicio de fuentes de conocimiento para la IA — multi-tenant.
// Cada tenant tiene su propia base de conocimiento dividida en fuentes
// titulables y categorizables. La IA las concatena al generar respuestas.

function _hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category || null,
    content: row.content,
    active: !!row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function list(db, tenantId, { activeOnly = false } = {}) {
  const conds = ['tenant_id = ?'];
  const params = [tenantId];
  if (activeOnly) conds.push('active = 1');
  return db.prepare(`SELECT * FROM ai_knowledge_sources WHERE ${conds.join(' AND ')} ORDER BY sort_order ASC, id ASC`)
    .all(...params).map(_hydrate);
}

function getById(db, tenantId, id) {
  const row = db.prepare('SELECT * FROM ai_knowledge_sources WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  return _hydrate(row);
}

function create(db, tenantId, { title, category, content, active = true }) {
  if (!title || !title.trim()) throw new Error('El título es requerido');
  if (!content || !content.trim()) throw new Error('El contenido es requerido');
  const max = db.prepare('SELECT MAX(sort_order) AS m FROM ai_knowledge_sources WHERE tenant_id = ?').get(tenantId);
  const nextSort = (max?.m || 0) + 1;
  const r = db.prepare(`
    INSERT INTO ai_knowledge_sources (tenant_id, title, category, content, active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, title.trim(), category?.trim() || null, content.trim(), active ? 1 : 0, nextSort);
  return getById(db, tenantId, r.lastInsertRowid);
}

function update(db, tenantId, id, patch = {}) {
  const row = db.prepare('SELECT * FROM ai_knowledge_sources WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Fuente no encontrada');
  const fields = [];
  const params = [];
  if (patch.title !== undefined) {
    if (!patch.title || !patch.title.trim()) throw new Error('El título no puede estar vacío');
    fields.push('title = ?'); params.push(patch.title.trim());
  }
  if (patch.category !== undefined) { fields.push('category = ?'); params.push(patch.category?.trim() || null); }
  if (patch.content !== undefined) {
    if (!patch.content || !patch.content.trim()) throw new Error('El contenido no puede estar vacío');
    fields.push('content = ?'); params.push(patch.content.trim());
  }
  if (patch.active !== undefined) { fields.push('active = ?'); params.push(patch.active ? 1 : 0); }
  if (patch.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(Number(patch.sortOrder)); }
  if (!fields.length) return getById(db, tenantId, id);
  fields.push('updated_at = unixepoch()');
  params.push(id, tenantId);
  db.prepare(`UPDATE ai_knowledge_sources SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
  return getById(db, tenantId, id);
}

function remove(db, tenantId, id) {
  db.prepare('DELETE FROM ai_knowledge_sources WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

// Helper para que el módulo de IA arme el prompt con todas las fuentes activas.
// Devuelve un string concatenado tipo:
//   "## Productos\n[contenido]\n\n## Políticas\n[contenido]\n\n..."
function buildContext(db, tenantId) {
  const sources = list(db, tenantId, { activeOnly: true });
  if (!sources.length) return '';
  return sources.map(s => {
    const heading = s.category ? `## ${s.category} — ${s.title}` : `## ${s.title}`;
    return `${heading}\n${s.content}`;
  }).join('\n\n');
}

module.exports = { list, getById, create, update, remove, buildContext };
