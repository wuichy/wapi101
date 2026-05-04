function tagsFor(db, tenantId, botId) {
  return db.prepare(`
    SELECT t.id, t.name, t.color
    FROM bot_tags t
    JOIN salsbot_tag_assignments a ON a.tag_id = t.id
    WHERE a.bot_id = ? AND a.tenant_id = ?
    ORDER BY t.name COLLATE NOCASE
  `).all(botId, tenantId);
}

function setTags(db, tenantId, botId, tagIds) {
  const ids = Array.isArray(tagIds) ? [...new Set(tagIds.map(Number).filter(n => Number.isFinite(n)))] : null;
  if (ids === null) return;
  db.prepare('DELETE FROM salsbot_tag_assignments WHERE bot_id = ? AND tenant_id = ?').run(botId, tenantId);
  const ins = db.prepare('INSERT OR IGNORE INTO salsbot_tag_assignments (tenant_id, bot_id, tag_id) VALUES (?, ?, ?)');
  const txn = db.transaction((arr) => arr.forEach(tid => ins.run(tenantId, botId, tid)));
  txn(ids);
}

// Detecta referencias rotas en un bot (steps + trigger). Filtra todas las
// validaciones de templates/stages/pipelines/integrations/salsbots por tenant
// para que un bot del tenant A no "valide OK" porque haya un template con el
// mismo id en el tenant B.
function _validateBot(db, tenantId, bot) {
  const issues = [];
  const steps = Array.isArray(bot.steps) ? bot.steps : [];

  if (bot.trigger_type === 'pipeline_stage' && bot.trigger_value) {
    const stageId = Number(bot.trigger_value);
    const stage = stageId ? db.prepare('SELECT id FROM stages WHERE id = ? AND tenant_id = ?').get(stageId, tenantId) : null;
    if (!stage) {
      issues.push({
        stepId: null,
        kind: 'missing_trigger_stage',
        severity: 'error',
        message: `El disparador apunta a una etapa eliminada (id #${stageId}). El bot nunca se va a ejecutar.`,
      });
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = step._id || `s${i}`;
    const c = step.config || {};
    switch (step.type) {
      case 'template': {
        const tid = Number(c.templateId);
        if (!tid) {
          issues.push({ stepId, kind: 'missing_template', severity: 'error',
            message: 'No se eligió ninguna plantilla.' });
          break;
        }
        const tpl = db.prepare('SELECT id, type, wa_status FROM message_templates WHERE id = ? AND tenant_id = ?').get(tid, tenantId);
        if (!tpl) {
          issues.push({ stepId, kind: 'missing_template', severity: 'error',
            message: `La plantilla #${tid} fue eliminada.`, hint: 'Edita este paso y elige otra plantilla, o bórralo.' });
        } else if (tpl.type === 'wa_api' && tpl.wa_status !== 'approved') {
          issues.push({ stepId, kind: 'template_not_approved', severity: 'error',
            message: `La plantilla está en estado "${tpl.wa_status}". Meta solo deja enviar plantillas aprobadas.` });
        }
        break;
      }
      case 'stage': {
        const stId = Number(c.stageId);
        const plId = Number(c.pipelineId);
        if (!stId) {
          issues.push({ stepId, kind: 'missing_stage', severity: 'error',
            message: 'No se eligió ninguna etapa de destino.' });
          break;
        }
        const stage = db.prepare('SELECT id, pipeline_id FROM stages WHERE id = ? AND tenant_id = ?').get(stId, tenantId);
        if (!stage) {
          issues.push({ stepId, kind: 'missing_stage', severity: 'error',
            message: `La etapa #${stId} fue eliminada.`, hint: 'Edita este paso y elige otra.' });
        } else if (plId && stage.pipeline_id !== plId) {
          issues.push({ stepId, kind: 'stage_pipeline_mismatch', severity: 'warn',
            message: `La etapa ya no pertenece al pipeline configurado.` });
        }
        if (plId) {
          const pl = db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(plId, tenantId);
          if (!pl) {
            issues.push({ stepId, kind: 'missing_pipeline', severity: 'error',
              message: `El pipeline #${plId} fue eliminado.` });
          }
        }
        break;
      }
      case 'condition': {
        if (c.field === 'pipeline' && c.value) {
          const pl = db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(Number(c.value), tenantId);
          if (!pl) {
            issues.push({ stepId, kind: 'missing_pipeline', severity: 'error',
              message: `La condición compara contra un pipeline eliminado (#${c.value}).` });
          }
        }
        break;
      }
      case 'stop_and_start': {
        const targetId = Number(c.targetBotId);
        if (!targetId) {
          issues.push({ stepId, kind: 'missing_target_bot', severity: 'error',
            message: 'No se eligió bot destino.' });
          break;
        }
        const target = db.prepare('SELECT id, enabled FROM salsbots WHERE id = ? AND tenant_id = ?').get(targetId, tenantId);
        if (!target) {
          issues.push({ stepId, kind: 'missing_target_bot', severity: 'error',
            message: `El bot destino #${targetId} fue eliminado.` });
        } else if (!target.enabled) {
          issues.push({ stepId, kind: 'target_bot_disabled', severity: 'warn',
            message: 'El bot destino está desactivado — al ejecutarse no hará nada.' });
        }
        break;
      }
      case 'message': {
        if (c.channelId && c.channelId !== 'auto') {
          const integ = db.prepare('SELECT id, status FROM integrations WHERE id = ? AND tenant_id = ?').get(Number(c.channelId), tenantId);
          if (!integ) {
            issues.push({ stepId, kind: 'missing_integration', severity: 'error',
              message: `El canal de envío fue eliminado (integración #${c.channelId}).` });
          }
        }
        if (!(c.text || '').trim()) {
          issues.push({ stepId, kind: 'empty_message', severity: 'warn',
            message: 'El mensaje está vacío — no se enviará nada.' });
        }
        const fromTpl = Number(c.fromTemplateId || 0);
        if (fromTpl) {
          const tpl = db.prepare('SELECT id FROM message_templates WHERE id = ? AND tenant_id = ?').get(fromTpl, tenantId);
          if (!tpl) {
            issues.push({ stepId, kind: 'source_template_deleted', severity: 'warn',
              message: `La plantilla origen del texto fue eliminada (#${fromTpl}). El mensaje sigue funcionando pero ya no hay vínculo con la plantilla.`,
              hint: 'Si actualizaste la plantilla esperando que el bot reflejara el cambio, ahora tendrás que editar el texto a mano.' });
          }
        }
        break;
      }
      case 'tag': {
        const raw = c.tag;
        const incoming = Array.isArray(raw) ? raw : String(raw || '').split(',').map(t => t.trim()).filter(Boolean);
        if (!incoming.length) {
          issues.push({ stepId, kind: 'empty_tag', severity: 'warn',
            message: 'No hay etiquetas configuradas — este paso no hace nada.' });
        }
        break;
      }
      case 'timer': {
        const total = (Number(c.days)||0)*86400 + (Number(c.hours)||0)*3600 + (Number(c.minutes)||0)*60 + (Number(c.seconds)||0);
        if (!total) {
          issues.push({ stepId, kind: 'empty_timer', severity: 'warn',
            message: 'El temporizador está en 0 — no espera nada.' });
        }
        break;
      }
      case 'wait_response': {
        const tMin = Number(c.timeoutMinutes || 1440);
        if (tMin < 1) {
          issues.push({ stepId, kind: 'invalid_wait_timeout', severity: 'error',
            message: 'El timeout debe ser al menos 1 minuto.' });
        }
        const branches = c.branches || {};
        const allKeys = ['on_button_click', 'on_text_reply', 'on_timeout', 'on_delivery_fail'];
        const filledKeys = allKeys.filter(k => {
          const arr = Array.isArray(branches[k]) ? branches[k] : [];
          return arr.some(s => (s.config?.text || '').trim());
        });
        if (!filledKeys.length) {
          issues.push({ stepId, kind: 'wait_no_branches', severity: 'warn',
            message: 'Todas las ramas están vacías — el bot solo va a esperar y terminar.',
            hint: 'Configura al menos una rama (ej. "Responde con texto") para que el bot responda al lead.' });
        }
        break;
      }
    }
  }
  return issues;
}

function hydrate(db, tenantId, row) {
  const t = tenantId ?? row.tenant_id;
  const steps = JSON.parse(row.steps || '[]');
  const obj = {
    ...row,
    enabled: !!row.enabled,
    steps,
    tags: tagsFor(db, t, row.id),
  };
  obj.issues = _validateBot(db, t, obj);
  return obj;
}

function list(db, tenantId) {
  return db.prepare(`
    SELECT * FROM salsbots WHERE tenant_id = ?
    ORDER BY (sort_order IS NULL), sort_order ASC, created_at DESC
  `).all(tenantId).map(r => hydrate(db, tenantId, r));
}

function reorder(db, tenantId, orderedIds) {
  const stmt = db.prepare('UPDATE salsbots SET sort_order = ? WHERE id = ? AND tenant_id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, Number(id), tenantId));
  });
  trx();
}

// tenantId puede ser null en callers internos del engine (que ya cargaron
// el bot por su id directamente). En ese caso se deriva del row.
function getById(db, tenantId, id) {
  const row = tenantId == null
    ? db.prepare('SELECT * FROM salsbots WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM salsbots WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Salesbot no encontrado');
  return hydrate(db, tenantId ?? row.tenant_id, row);
}

function create(db, tenantId, { name, enabled = 0, trigger_type = 'keyword', trigger_value = '', steps = [], tagIds }) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido');
  const r = db.prepare(
    'INSERT INTO salsbots (tenant_id, name, enabled, trigger_type, trigger_value, steps) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(tenantId, name.trim(), enabled ? 1 : 0, trigger_type, trigger_value || '', JSON.stringify(steps));
  setTags(db, tenantId, r.lastInsertRowid, tagIds);
  return getById(db, tenantId, r.lastInsertRowid);
}

function update(db, tenantId, id, patch) {
  const current = getById(db, tenantId, id);
  const next = { ...current, ...patch };
  db.prepare(
    'UPDATE salsbots SET name=?, enabled=?, trigger_type=?, trigger_value=?, steps=?, updated_at=unixepoch() WHERE id=? AND tenant_id=?'
  ).run(
    (next.name || '').trim() || current.name,
    next.enabled ? 1 : 0,
    next.trigger_type || current.trigger_type,
    next.trigger_value ?? current.trigger_value,
    JSON.stringify(Array.isArray(next.steps) ? next.steps : current.steps),
    id, tenantId
  );
  if (Array.isArray(patch.tagIds)) setTags(db, tenantId, id, patch.tagIds);
  return getById(db, tenantId, id);
}

function remove(db, tenantId, id, { deletedBy } = {}) {
  const row = db.prepare('SELECT * FROM salsbots WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Salesbot no encontrado');

  try {
    const trashSvc = require('../trash/service');
    trashSvc.save(db, tenantId, {
      entityType: 'salsbot',
      entityId:   row.id,
      entityName: row.name,
      snapshot:   row,
      deletedById:   deletedBy?.id   || null,
      deletedByName: deletedBy?.name || null,
    });
  } catch (err) {
    console.warn('[bot/remove] no se pudo enviar a papelera:', err.message);
  }

  db.prepare('DELETE FROM salsbots WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

module.exports = { list, getById, create, update, remove, reorder };
