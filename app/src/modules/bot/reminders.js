'use strict';
const { sendMessage } = require('../conversations/sender');
const { _fmtDate, _fmtTime } = require('../appointments/service');

let _reminderTimer = null;

function startAppointmentReminderPoller(db) {
  if (_reminderTimer) return;

  _reminderTimer = setInterval(async () => {
    try {
      const due = db.prepare(`
        SELECT ar.id, ar.tenant_id, ar.message_template,
               a.conversation_id, a.contact_id, a.starts_at
          FROM appointment_reminders ar
          JOIN appointments a ON a.id = ar.appointment_id
         WHERE ar.sent = 0 AND ar.send_at <= unixepoch()
         LIMIT 20
      `).all();

      for (const rem of due) {
        try {
          const fecha = _fmtDate(rem.starts_at);
          const hora  = _fmtTime(rem.starts_at);

          let msg = (rem.message_template || 'Recordatorio: tienes una cita el {fecha_cita} a las {hora_cita}.')
            .replace(/\{fecha_cita\}/g, fecha)
            .replace(/\{hora_cita\}/g, hora);

          if (rem.conversation_id) {
            const convo = db.prepare(
              'SELECT * FROM conversations WHERE id = ? AND tenant_id = ?'
            ).get(rem.conversation_id, rem.tenant_id);
            if (convo) await sendMessage(db, convo, msg);
          }

          db.prepare(`UPDATE appointment_reminders SET sent = 1, sent_at = unixepoch() WHERE id = ?`).run(rem.id);
        } catch (err) {
          console.error('[reminders] error en recordatorio', rem.id, err.message);
          db.prepare(`UPDATE appointment_reminders SET error = ? WHERE id = ?`).run(err.message.slice(0, 200), rem.id);
        }
      }
    } catch (err) {
      console.error('[reminders] poller error:', err.message);
    }
  }, 60_000);

  _reminderTimer.unref?.();
  console.log('[reminders] appointment reminder poller iniciado (cada 60s)');
}

module.exports = { startAppointmentReminderPoller };
