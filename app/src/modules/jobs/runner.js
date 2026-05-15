// Background job runner — corre en el server y sobrevive el cierre del
// navegador del usuario. Procesa operaciones largas (bulk move de leads,
// bulk delete, etc.) en chunks, actualizando progreso en DB para que el
// frontend lo polée.
//
// Diseño:
// - Worker corre cada WORKER_TICK_MS (1s) y procesa el siguiente chunk
//   de un solo job a la vez (single-worker model, simple y suficiente).
// - Cada item procesado actualiza bulk_jobs.processed/failed → la barra
//   de progreso del frontend lo ve en el próximo poll.
// - Si el server se reinicia, al boot se llama resumeOrphanJobs() que
//   re-marca jobs 'running' como 'queued' para que el worker los retome.

const expService = require('../expedients/service');
const activity   = require('../expedients/activity');
const botEngine  = require('../bot/engine');

const WORKER_TICK_MS = 1000;     // chequeo cada 1s
const CHUNK_SIZE     = 5;        // procesa 5 items por tick (evita bloquear event loop con 700)

let _dbRef    = null;
let _running  = false;
let _tickTimer = null;

/* ───────────────────────── enqueue API ───────────────────────── */

function enqueue(db, tenantId, { type, payload, label }) {
  if (!type || typeof type !== 'string') throw new Error('job type requerido');
  const json = JSON.stringify(payload || {});
  const total = Array.isArray(payload?.ids) ? payload.ids.length : 0;
  const result = db.prepare(`
    INSERT INTO bulk_jobs (tenant_id, type, payload, total, label, status)
    VALUES (?, ?, ?, ?, ?, 'queued')
  `).run(tenantId, type, json, total, label || null);
  return getJob(db, result.lastInsertRowid);
}

function getJob(db, jobId) {
  const row = db.prepare('SELECT * FROM bulk_jobs WHERE id = ?').get(jobId);
  if (!row) return null;
  return _hydrate(row);
}

function getActiveJobsForTenant(db, tenantId) {
  const rows = db.prepare(`
    SELECT * FROM bulk_jobs
     WHERE tenant_id = ? AND status IN ('queued', 'running')
     ORDER BY id DESC
  `).all(tenantId);
  return rows.map(_hydrate);
}

function cancelJob(db, tenantId, jobId) {
  const job = db.prepare('SELECT * FROM bulk_jobs WHERE id = ? AND tenant_id = ?').get(jobId, tenantId);
  if (!job) return null;
  if (job.status === 'done' || job.status === 'error') return _hydrate(job);
  db.prepare("UPDATE bulk_jobs SET status='cancelled', finished_at=unixepoch(), updated_at=unixepoch() WHERE id=?").run(jobId);
  return getJob(db, jobId);
}

function _hydrate(row) {
  return {
    id:         row.id,
    type:       row.type,
    total:      row.total,
    processed:  row.processed,
    failed:     row.failed,
    status:     row.status,
    label:      row.label,
    errorMsg:   row.error_msg,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
    finishedAt: row.finished_at,
  };
}

/* ───────────────────────── worker loop ───────────────────────── */

function start(db) {
  if (_running) return;
  _dbRef = db;
  _running = true;
  resumeOrphanJobs(db);
  _scheduleTick();
  console.log('[jobs-worker] started');
}

function _scheduleTick() {
  if (_tickTimer) clearTimeout(_tickTimer);
  _tickTimer = setTimeout(_tick, WORKER_TICK_MS);
}

async function _tick() {
  try {
    const job = _claimNextJob(_dbRef);
    if (job) {
      await _processJobChunk(_dbRef, job);
    }
  } catch (e) {
    console.error('[jobs-worker] tick error:', e.message);
  } finally {
    if (_running) _scheduleTick();
  }
}

// Toma el job más viejo en estado 'queued' o 'running' y lo marca como running.
function _claimNextJob(db) {
  // Preferir jobs que ya están running (continuar) sobre queued nuevos.
  const job = db.prepare(`
    SELECT * FROM bulk_jobs
     WHERE status IN ('queued', 'running')
     ORDER BY (status = 'running') DESC, id ASC
     LIMIT 1
  `).get();
  if (!job) return null;
  if (job.status === 'queued') {
    db.prepare("UPDATE bulk_jobs SET status='running', updated_at=unixepoch() WHERE id=?").run(job.id);
    job.status = 'running';
  }
  return job;
}

async function _processJobChunk(db, job) {
  const payload = JSON.parse(job.payload || '{}');
  const handler = JOB_HANDLERS[job.type];
  if (!handler) {
    db.prepare("UPDATE bulk_jobs SET status='error', error_msg=?, finished_at=unixepoch(), updated_at=unixepoch() WHERE id=?")
      .run(`Tipo de job desconocido: ${job.type}`, job.id);
    return;
  }

  // Procesar siguiente chunk de items
  const ids = Array.isArray(payload.ids) ? payload.ids : [];
  const startIdx = job.processed + job.failed;
  if (startIdx >= ids.length) {
    db.prepare("UPDATE bulk_jobs SET status='done', finished_at=unixepoch(), updated_at=unixepoch() WHERE id=?").run(job.id);
    return;
  }

  const chunk = ids.slice(startIdx, startIdx + CHUNK_SIZE);
  let processedDelta = 0, failedDelta = 0;
  for (const itemId of chunk) {
    // Re-check status — el usuario pudo cancelar
    const fresh = db.prepare('SELECT status FROM bulk_jobs WHERE id = ?').get(job.id);
    if (!fresh || fresh.status === 'cancelled') return;
    try {
      await handler(db, job.tenant_id, itemId, payload);
      processedDelta++;
    } catch (e) {
      console.error(`[jobs-worker] item ${itemId} en job ${job.id}: ${e.message}`);
      failedDelta++;
    }
  }
  // Persistir progreso al final del chunk
  db.prepare(`
    UPDATE bulk_jobs
       SET processed = processed + ?,
           failed    = failed + ?,
           updated_at = unixepoch()
     WHERE id = ?
  `).run(processedDelta, failedDelta, job.id);

  // Si terminamos todos los items, marcar done
  const after = db.prepare('SELECT processed, failed, total FROM bulk_jobs WHERE id = ?').get(job.id);
  if (after && (after.processed + after.failed >= after.total)) {
    db.prepare("UPDATE bulk_jobs SET status='done', finished_at=unixepoch(), updated_at=unixepoch() WHERE id=?").run(job.id);
  }
}

// Al boot del server: jobs 'running' fueron interrumpidos → re-encolarlos.
function resumeOrphanJobs(db) {
  const updated = db.prepare("UPDATE bulk_jobs SET status='queued', updated_at=unixepoch() WHERE status='running'").run();
  if (updated.changes > 0) {
    console.log(`[jobs-worker] resumed ${updated.changes} orphan job(s) tras restart`);
  }
}

/* ───────────────────────── handlers ───────────────────────── */
// Cada handler procesa UN item. Recibe (db, tenantId, itemId, payload).
// Si lanza error, el item cuenta como failed.

const JOB_HANDLERS = {
  'expedients_move': async (db, tenantId, expedientId, payload) => {
    const stageId = Number(payload.stageId);
    if (!stageId) throw new Error('payload.stageId requerido');
    const prev = expService.getById(db, tenantId, Number(expedientId));
    if (!prev) throw new Error(`expedient ${expedientId} no encontrado`);
    const item = expService.update(db, tenantId, Number(expedientId), { stageId });
    if (!item) throw new Error(`update falló para ${expedientId}`);

    // Activity log
    try {
      if (prev.stageId !== item.stageId) {
        activity.log(db, {
          expedientId: item.id,
          contactId:   item.contactId,
          type: 'stage_change',
          description: `Etapa: "${prev.stageName || prev.stageId}" → "${item.stageName || item.stageId}"`,
        });
      }
    } catch (e) { /* no romper el job por activity */ }

    // Triggers de bots
    try {
      if (item.stageId && prev.stageId && item.stageId !== prev.stageId) {
        botEngine.triggerPipelineStageLeave(db, {
          expedientId: item.id,
          contactId:   item.contactId,
          pipelineId:  prev.pipelineId,
          stageId:     prev.stageId,
        });
        botEngine.triggerPipelineStage(db, {
          expedientId: item.id,
          contactId:   item.contactId,
          pipelineId:  item.pipelineId,
          stageId:     item.stageId,
        });
      }
    } catch (e) { /* triggers no rompen el job */ }
  },

  'expedients_delete': async (db, tenantId, expedientId, _payload) => {
    const exp = expService.getById(db, tenantId, Number(expedientId));
    if (!exp) throw new Error(`expedient ${expedientId} no encontrado`);
    // Soft-delete: lo manda a papelera. Usa el flow estándar de la service.
    if (typeof expService.softDelete === 'function') {
      expService.softDelete(db, tenantId, Number(expedientId));
    } else if (typeof expService.remove === 'function') {
      expService.remove(db, tenantId, Number(expedientId));
    } else {
      // Fallback: marca deleted_at directamente
      db.prepare("UPDATE expedients SET deleted_at = unixepoch() WHERE id = ? AND tenant_id = ?").run(expedientId, tenantId);
    }
  },
};

module.exports = {
  start,
  enqueue,
  getJob,
  getActiveJobsForTenant,
  cancelJob,
  resumeOrphanJobs,
};
