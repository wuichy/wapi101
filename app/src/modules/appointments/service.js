'use strict';

const TZ = process.env.TZ || 'America/Mexico_City';

function _fmtDate(unixTs) {
  const d = new Date(unixTs * 1000);
  return d.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ });
}

function _fmtTime(unixTs) {
  const d = new Date(unixTs * 1000);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

function _calcStartsAt(offsetDays, timeHHMM) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + Math.max(0, Number(offsetDays) || 1));
  const [h, m] = (timeHHMM || '10:00').split(':').map(n => parseInt(n, 10));
  target.setHours(h || 10, m || 0, 0, 0);
  // Si ya pasó el momento del día objetivo, avanzar un día más
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.floor(target.getTime() / 1000);
}

function book(db, tenantId, { contactId, expedientId, convoId, advisorId, offsetDays, time, durationMin, notes, createdVia }) {
  const dur     = Number(durationMin) || 30;
  const startsAt = _calcStartsAt(offsetDays, time);
  const endsAt   = startsAt + dur * 60;

  const res = db.prepare(`
    INSERT INTO appointments
      (tenant_id, contact_id, expedient_id, conversation_id, advisor_id,
       starts_at, ends_at, duration_min, status, notes, created_via)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
  `).run(tenantId, contactId || null, expedientId || null, convoId || null,
         advisorId || null, startsAt, endsAt, dur, notes || null, createdVia || 'bot');

  return {
    id: res.lastInsertRowid,
    startsAt,
    endsAt,
    fecha: _fmtDate(startsAt),
    hora:  _fmtTime(startsAt),
  };
}

function scheduleReminder(db, tenantId, appointmentId, { minutesBefore, recipient, messageTemplate }) {
  const appt = db.prepare('SELECT starts_at FROM appointments WHERE id = ? AND tenant_id = ?').get(appointmentId, tenantId);
  if (!appt) return null;
  const sendAt = appt.starts_at - Number(minutesBefore) * 60;
  if (sendAt <= Math.floor(Date.now() / 1000)) return null; // ya pasó
  db.prepare(`
    INSERT INTO appointment_reminders
      (tenant_id, appointment_id, kind, config_json, recipient, message_template, send_at)
    VALUES (?, ?, 'relative', ?, ?, ?, ?)
  `).run(tenantId, appointmentId,
         JSON.stringify({ minutesBefore: Number(minutesBefore) }),
         recipient || 'client', messageTemplate || null, sendAt);
  return sendAt;
}

function cancelLatest(db, tenantId, contactId) {
  const appt = db.prepare(`
    SELECT * FROM appointments
     WHERE contact_id = ? AND tenant_id = ? AND status IN ('scheduled','confirmed')
     ORDER BY starts_at DESC LIMIT 1
  `).get(contactId, tenantId);
  if (!appt) return null;
  db.prepare(`
    UPDATE appointments
       SET status = 'cancelled', cancelled_at = unixepoch(), cancelled_by = 'system', updated_at = unixepoch()
     WHERE id = ?
  `).run(appt.id);
  return { ...appt, fecha: _fmtDate(appt.starts_at), hora: _fmtTime(appt.starts_at) };
}

function reschedule(db, tenantId, { contactId, expedientId, convoId, advisorId, offsetDays, time, durationMin }) {
  const existing = db.prepare(`
    SELECT * FROM appointments
     WHERE contact_id = ? AND tenant_id = ? AND status IN ('scheduled','confirmed')
     ORDER BY starts_at DESC LIMIT 1
  `).get(contactId, tenantId);

  if (existing) {
    db.prepare(`UPDATE appointments SET status = 'rescheduled', updated_at = unixepoch() WHERE id = ?`).run(existing.id);
  }

  const dur      = Number(durationMin) || 30;
  const startsAt = _calcStartsAt(offsetDays, time);
  const endsAt   = startsAt + dur * 60;

  const res = db.prepare(`
    INSERT INTO appointments
      (tenant_id, contact_id, expedient_id, conversation_id, advisor_id,
       starts_at, ends_at, duration_min, status, rescheduled_from_id, created_via)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 'bot')
  `).run(tenantId, contactId || null, expedientId || null, convoId || null,
         advisorId || null, startsAt, endsAt, dur, existing?.id || null);

  return {
    id: res.lastInsertRowid,
    startsAt,
    endsAt,
    fecha: _fmtDate(startsAt),
    hora:  _fmtTime(startsAt),
    rescheduledFrom: existing?.id || null,
  };
}

function list(db, tenantId, { contactId, status, limit = 50, offset = 0 } = {}) {
  let where = 'WHERE a.tenant_id = ?';
  const params = [tenantId];
  if (contactId) { where += ' AND a.contact_id = ?'; params.push(Number(contactId)); }
  if (status)    { where += ' AND a.status = ?'; params.push(status); }
  params.push(Number(limit), Number(offset));
  return db.prepare(`
    SELECT a.*,
           c.first_name || ' ' || COALESCE(c.last_name, '') AS contact_name,
           c.phone AS contact_phone,
           ad.name AS advisor_name
      FROM appointments a
      LEFT JOIN contacts ad_c ON ad_c.id = a.contact_id
      LEFT JOIN contacts c ON c.id = a.contact_id
      LEFT JOIN advisors ad ON ad.id = a.advisor_id
     ${where}
     ORDER BY a.starts_at DESC
     LIMIT ? OFFSET ?
  `).all(...params);
}

function update(db, tenantId, id, { status, notes, advisorId }) {
  const fields = [];
  const vals   = [];
  if (status !== undefined) { fields.push('status = ?'); vals.push(status); }
  if (notes  !== undefined) { fields.push('notes = ?');  vals.push(notes);  }
  if (advisorId !== undefined) { fields.push('advisor_id = ?'); vals.push(advisorId || null); }
  if (!fields.length) return null;
  fields.push('updated_at = unixepoch()');
  vals.push(tenantId, id);
  db.prepare(`UPDATE appointments SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...vals);
  return db.prepare('SELECT * FROM appointments WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

// Slots disponibles para una fecha y asesor dados.
// Devuelve array de { time: 'HH:MM', available: bool, conflictWith: id|null }
function getAvailableSlots(db, tenantId, dateStr, advisorId, durationMin = 30) {
  const bizSvc = require('../business/service');
  const dur = Number(durationMin) || 30;

  // Parsear fecha en TZ local
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  const dayStart = new Date(yr, mo - 1, dy, 0, 0, 0);
  const dow = dayStart.getDay(); // 0=dom, 1=lun...

  // Horario del asesor (o maestro)
  const hours = advisorId
    ? bizSvc.getAdvisorHours(db, tenantId, Number(advisorId))
    : bizSvc.getMasterHours(db, tenantId);

  const dayHours = hours.find(h => h.dayOfWeek === dow);
  if (!dayHours || dayHours.isClosed) return [];

  // Generar slots desde open a close en intervalos de durationMin
  const [openH, openM]   = dayHours.openTime.split(':').map(Number);
  const [closeH, closeM] = dayHours.closeTime.split(':').map(Number);
  const openMin  = openH  * 60 + openM;
  const closeMin = closeH * 60 + closeM;

  // Citas existentes ese día para ese asesor
  const dayStartTs = Math.floor(dayStart.getTime() / 1000);
  const dayEndTs   = dayStartTs + 86400;
  const existing = db.prepare(`
    SELECT id, starts_at, ends_at FROM appointments
     WHERE tenant_id = ?
       AND status IN ('scheduled','confirmed')
       AND starts_at >= ? AND starts_at < ?
       ${advisorId ? 'AND advisor_id = ?' : ''}
  `).all(...[tenantId, dayStartTs, dayEndTs, ...(advisorId ? [Number(advisorId)] : [])]);

  const slots = [];
  for (let m = openMin; m + dur <= closeMin; m += dur) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const timeStr = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;

    // Calcular timestamp de este slot
    const slotTs = dayStartTs + m * 60;
    const slotEndTs = slotTs + dur * 60;

    // Verificar conflicto
    const conflict = existing.find(a =>
      (slotTs < a.ends_at && slotEndTs > a.starts_at)
    );

    slots.push({
      time:         timeStr,
      available:    !conflict,
      conflictWith: conflict?.id || null,
    });
  }
  return slots;
}

// Crear cita manualmente (desde modal receptionist)
function bookManual(db, tenantId, { contactId, expedientId, convoId, advisorId, date, time, durationMin, notes }) {
  const dur = Number(durationMin) || 30;
  const [yr, mo, dy] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const startsAt = Math.floor(new Date(yr, mo - 1, dy, h, m, 0).getTime() / 1000);
  const endsAt   = startsAt + dur * 60;

  const res = db.prepare(`
    INSERT INTO appointments
      (tenant_id, contact_id, expedient_id, conversation_id, advisor_id,
       starts_at, ends_at, duration_min, status, notes, created_via)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 'manual')
  `).run(tenantId, contactId || null, expedientId || null, convoId || null,
         advisorId || null, startsAt, endsAt, dur, notes || null);

  return {
    id:       res.lastInsertRowid,
    startsAt,
    endsAt,
    fecha:    _fmtDate(startsAt),
    hora:     _fmtTime(startsAt),
  };
}

module.exports = { book, bookManual, scheduleReminder, cancelLatest, reschedule, list, update, getAvailableSlots, _fmtDate, _fmtTime };
