function tagsFor(db, botId) {
  return db.prepare(`
    SELECT t.id, t.name, t.color
    FROM bot_tags t
    JOIN salsbot_tag_assignments a ON a.tag_id = t.id
    WHERE a.bot_id = ?
    ORDER BY t.name COLLATE NOCASE
  `).all(botId);
}

function setTags(db, botId, tagIds) {
  const ids = Array.isArray(tagIds) ? [...new Set(tagIds.map(Number).filter(n => Number.isFinite(n)))] : null;
  if (ids === null) return;
  db.prepare('DELETE FROM salsbot_tag_assignments WHERE bot_id = ?').run(botId);
  const ins = db.prepare('INSERT OR IGNORE INTO salsbot_tag_assignments (bot_id, tag_id) VALUES (?, ?)');
  const txn = db.transaction((arr) => arr.forEach(tid => ins.run(botId, tid)));
  txn(ids);
}

// Detecta referencias rotas en un bot (steps + trigger). Devuelve array de
// issues con la forma { stepId|null, kind, severity, message, hint? }.
//   stepId   — si la issue es de un step, su _id; null si es del trigger
//   kind     — missing_template, missing_pipeline, missing_stage, missing_bot, etc.
//   severity — 'error' (no se ejecuta) o 'warn' (puede fallar parcial)
//   message  — texto humano-legible
function _validateBot(db, bot) {
  const issues = [];
  const steps = Array.isArray(bot.steps) ? bot.steps : [];

  // 1. Trigger pipeline_stage — verificar que la etapa exista
  if (bot.trigger_type === 'pipeline_stage' && bot.trigger_value) {
    const stageId = Number(bot.trigger_value);
    const stage = stageId ? db.prepare('SELECT id FROM stages WHERE id = ?').get(stageId) : null;
    if (!stage) {
      issues.push({
        stepId: null,
        kind: 'missing_trigger_stage',
        severity: 'error',
        message: `El disparador apunta a una etapa eliminada (id #${stageId}). El bot nunca se va a ejecutar.`,
      });
    }
  }

  // 2. Steps — validar referencias de cada uno.
  // El frontend asigna _id como `s${i}` al cargar (independiente del que venga
  // en JSON). Para que el frontend pueda mapear las issues a steps por _id,
  // generamos los _id aquí con la misma convención.
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
        const tpl = db.prepare('SELECT id, type, wa_status FROM message_templates WHERE id = ?').get(tid);
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
        const stage = db.prepare('SELECT id, pipeline_id FROM stages WHERE id = ?').get(stId);
        if (!stage) {
          issues.push({ stepId, kind: 'missing_stage', severity: 'error',
            message: `La etapa #${stId} fue eliminada.`, hint: 'Edita este paso y elige otra.' });
        } else if (plId && stage.pipeline_id !== plId) {
          issues.push({ stepId, kind: 'stage_pipeline_mismatch', severity: 'warn',
            message: `La etapa ya no pertenece al pipeline configurado.` });
        }
        if (plId) {
          const pl = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(plId);
          if (!pl) {
            issues.push({ stepId, kind: 'missing_pipeline', severity: 'error',
              message: `El pipeline #${plId} fue eliminado.` });
          }
        }
        break;
      }
      case 'condition': {
        // condition con campo "pipeline" → c.value es un pipelineId
        if (c.field === 'pipeline' && c.value) {
          const pl = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(Number(c.value));
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
        const target = db.prepare('SELECT id, enabled FROM salsbots WHERE id = ?').get(targetId);
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
        // Validar canal si está fijado a una integración específica
        if (c.channelId && c.channelId !== 'auto') {
          const integ = db.prepare('SELECT id, status FROM integrations WHERE id = ?').get(Number(c.channelId));
          if (!integ) {
            issues.push({ stepId, kind: 'missing_integration', severity: 'error',
              message: `El canal de envío fue eliminado (integración #${c.channelId}).` });
          }
        }
        if (!(c.text || '').trim()) {
          issues.push({ stepId, kind: 'empty_message', severity: 'warn',
            message: 'El mensaje está vacío — no se enviará nada.' });
        }
        // Si el texto vino de una plantilla básica (botón "Usar plantilla básica")
        // y esa plantilla fue eliminada, mostramos un AVISO (no error). El bot
        // sigue funcionando porque el texto ya está copiado, pero perdió la
        // trazabilidad con el original.
        const fromTpl = Number(c.fromTemplateId || 0);
        if (fromTpl) {
          const tpl = db.prepare('SELECT id FROM message_templates WHERE id = ?').get(fromTpl);
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
    }
  }
  return issues;
}

function hydrate(db, row) {
  const steps = JSON.parse(row.steps || '[]');
  const obj = {
    ...row,
    enabled: !!row.enabled,
    steps,
    tags: tagsFor(db, row.id),
  };
  obj.issues = _validateBot(db, obj);
  return obj;
}

function list(db) {
  // Orden por sort_order si está set; los nulos al final con desempate por created_at DESC.
  return db.prepare(`
    SELECT * FROM salsbots
    ORDER BY (sort_order IS NULL), sort_order ASC, created_at DESC
  `).all().map(r => hydrate(db, r));
}

// Persiste un orden manual de bots. Recibe array de ids en el orden deseado.
function reorder(db, orderedIds) {
  const stmt = db.prepare('UPDATE salsbots SET sort_order = ? WHERE id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, Number(id)));
  });
  trx();
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(id);
  if (!row) throw new Error('Salesbot no encontrado');
  return hydrate(db, row);
}

function create(db, { name, enabled = 0, trigger_type = 'keyword', trigger_value = '', steps = [], tagIds }) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido');
  const r = db.prepare(
    'INSERT INTO salsbots (name, enabled, trigger_type, trigger_value, steps) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), enabled ? 1 : 0, trigger_type, trigger_value || '', JSON.stringify(steps));
  setTags(db, r.lastInsertRowid, tagIds);
  return getById(db, r.lastInsertRowid);
}

function update(db, id, patch) {
  const current = getById(db, id);
  const next = { ...current, ...patch };
  db.prepare(
    'UPDATE salsbots SET name=?, enabled=?, trigger_type=?, trigger_value=?, steps=?, updated_at=unixepoch() WHERE id=?'
  ).run(
    (next.name || '').trim() || current.name,
    next.enabled ? 1 : 0,
    next.trigger_type || current.trigger_type,
    next.trigger_value ?? current.trigger_value,
    JSON.stringify(Array.isArray(next.steps) ? next.steps : current.steps),
    id
  );
  if (Array.isArray(patch.tagIds)) setTags(db, id, patch.tagIds);
  return getById(db, id);
}

function remove(db, id, { deletedBy } = {}) {
  const row = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(id);
  if (!row) throw new Error('Salesbot no encontrado');

  try {
    const trashSvc = require('../trash/service');
    trashSvc.save(db, {
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

  db.prepare('DELETE FROM salsbots WHERE id = ?').run(id);
}

module.exports = { list, getById, create, update, remove, reorder };
