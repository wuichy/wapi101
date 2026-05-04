// Bootstrap del subsistema WhatsApp Web (Baileys).
// Une el manager (sockets) con la DB y los servicios de conversaciones / bots.
// Se llama una vez al boot del server.

const path = require('path');
const fs = require('fs');
const manager = require('./manager');
const convoSvc = require('../../conversations/service');
const expedientSvc = require('../../expedients/service');
const botEngine = require('../../bot/engine');
const pushSvc = require('../../notifications/service');

function getRouting(db, integrationId) {
  if (!integrationId) return null;
  const row = db.prepare('SELECT config FROM integrations WHERE id = ?').get(integrationId);
  if (!row?.config) return null;
  try { return JSON.parse(row.config)?.routing || null; } catch { return null; }
}

function ensureExpedient(db, contactId, routing) {
  if (!routing?.pipelineId || !routing?.stageId) return;
  const existing = db.prepare(
    'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? LIMIT 1'
  ).get(contactId, routing.pipelineId);
  if (existing) return;
  try {
    expedientSvc.create(db, {
      contactId, pipelineId: routing.pipelineId, stageId: routing.stageId,
      name: null, value: 0, tags: [], fieldValues: {},
    });
  } catch (err) {
    console.warn('[wa-web] no se pudo crear expediente:', err.message);
  }
}

function init(db) {
  manager.setHandlers({
    onMessage: (integrationId, payload) => {
      try {
        // Dedup: si ya tenemos ese message_id no procesar otra vez
        if (payload.messageId) {
          const dup = db.prepare(
            'SELECT id FROM messages WHERE provider = ? AND external_id = ?'
          ).get('whatsapp-lite', payload.messageId);
          if (dup) return;
        }

        const convo = convoSvc.findOrCreate(db, null, {
          provider:      'whatsapp-lite',
          externalId:    payload.externalId,
          integrationId,
          contactPhone:  `+${payload.externalId}`,
          contactName:   payload.pushName,
        });

        convoSvc.addMessage(db, null, convo.id, {
          externalId: payload.messageId,
          direction:  'incoming',
          provider:   'whatsapp-lite',
          body:       payload.body,
          status:     'delivered',
          createdAt:  payload.timestamp,
        });

        const routing = getRouting(db, integrationId);
        ensureExpedient(db, convo.contact_id, routing);

        botEngine.triggerMessage(db, {
          convoId:       convo.id,
          contactId:     convo.contact_id,
          messageBody:   payload.body,
          provider:      'whatsapp-lite',
          integrationId,
        });

        // Push notification al iPhone/Mac/etc. (collapse por convo via tag)
        const senderName = payload.pushName || convo.contact_first_name || `+${payload.externalId}`;
        const preview = (payload.body || '📎 Adjunto').slice(0, 140);
        pushSvc.sendToAll(db, {
          title: senderName,
          body:  preview,
          tag:   `chat-${convo.id}`,    // colapsa pushes consecutivos del mismo chat
          url:   `/?view=chats&convo=${convo.id}`,
          chatId: convo.id,
        }, { kind: 'message' })
          .catch(err => console.warn('[push] msg:', err.message));

        console.log(`[wa-web ${integrationId}] msg ${payload.messageId} → convo #${convo.id}`);
      } catch (err) {
        console.error(`[wa-web ${integrationId}] error procesando mensaje:`, err.message);
      }
    },

    onConnected: (integrationId, session) => {
      try {
        const phone = session.phoneNumber || '';
        const display = phone ? `WhatsApp +${phone}` : 'WhatsApp Lite';
        const wasError = db.prepare("SELECT status FROM integrations WHERE id = ?").get(integrationId)?.status;
        db.prepare(`
          UPDATE integrations
          SET status = 'connected', display_name = ?, external_id = ?,
              connected_at = unixepoch(), updated_at = unixepoch(), last_error = NULL
          WHERE id = ?
        `).run(display, phone || null, integrationId);
        // Si veníamos de un estado de error/disconnected → push de "recuperado"
        if (wasError && wasError !== 'connected' && wasError !== 'connecting' && wasError !== 'pending') {
          pushSvc.sendToAll(db, {
            title: 'WhatsApp reconectado',
            body:  phone ? `+${phone} volvió a estar en línea ✓` : 'Volvió a estar en línea ✓',
            tag:   `wa-${integrationId}`,
            url:   '/',
          }, { kind: 'integration_recovered', cooldownKey: String(integrationId), cooldownMs: 60_000 })
            .catch(err => console.warn('[push] recovered:', err.message));
        }
      } catch (err) {
        console.error(`[wa-web ${integrationId}] onConnected DB error:`, err.message);
      }
    },

    onDisconnected: (integrationId, info) => {
      try {
        const row = db.prepare("SELECT display_name, external_id FROM integrations WHERE id = ?").get(integrationId);
        if (info.loggedOut) {
          db.prepare(`UPDATE integrations SET status = 'disconnected', last_error = ?, updated_at = unixepoch() WHERE id = ?`)
            .run('Sesión cerrada en el dispositivo', integrationId);
          pushSvc.sendToAll(db, {
            title: '⚠️ WhatsApp desconectado',
            body:  `${row?.display_name || 'WhatsApp Lite'} cerró sesión. Reconecta escaneando QR de nuevo.`,
            tag:   `wa-${integrationId}-logout`,
            url:   '/?view=integraciones',
          }, { kind: 'integration_down', cooldownKey: String(integrationId), cooldownMs: 5 * 60_000 })
            .catch(err => console.warn('[push] logout:', err.message));
        } else {
          db.prepare(`UPDATE integrations SET last_error = ?, updated_at = unixepoch() WHERE id = ?`)
            .run(info.message || 'Desconectado', integrationId);
          // Solo notificar si la desconexión es prolongada (cooldown 10 min evita spam de reintentos cortos)
          pushSvc.sendToAll(db, {
            title: '⚠️ WhatsApp desconectado',
            body:  `${row?.display_name || 'WhatsApp Lite'} perdió conexión. Reintentando…`,
            tag:   `wa-${integrationId}-down`,
            url:   '/?view=integraciones',
          }, { kind: 'integration_down', cooldownKey: String(integrationId), cooldownMs: 10 * 60_000 })
            .catch(err => console.warn('[push] disconnect:', err.message));
        }
      } catch (err) {
        console.error(`[wa-web ${integrationId}] onDisconnected DB error:`, err.message);
      }
    },
  });

  // Limpiar 'connecting' huérfanos: rows que quedaron en ese estado por
  // un crash/restart mientras el usuario estaba en el flujo de QR. Borrarlos
  // (con sus auth files) — si tienen creds parciales no son útiles.
  try {
    const SESSIONS_ROOT_C = (process.env.WA_SESSIONS_DIR || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'wa-sessions') : path.resolve(__dirname, '../../../../data/wa-sessions')));
    const orphans = db.prepare(
      "SELECT id FROM integrations WHERE provider = 'whatsapp-lite' AND status IN ('connecting','pending')"
    ).all();
    for (const o of orphans) {
      db.prepare('DELETE FROM integrations WHERE id = ?').run(o.id);
      const dir = path.join(SESSIONS_ROOT_C, String(o.id));
      try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      console.log(`[wa-web] limpiado huérfano connecting #${o.id}`);
    }
  } catch (err) {
    console.warn('[wa-web] cleanup orphans error:', err.message);
  }

  // Restaurar sesiones marcadas como 'connected' al boot
  try {
    const SESSIONS_ROOT = (process.env.WA_SESSIONS_DIR || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'wa-sessions') : path.resolve(__dirname, '../../../../data/wa-sessions')));
    const candidates = db.prepare(
      "SELECT id FROM integrations WHERE provider = 'whatsapp-lite' AND status = 'connected'"
    ).all().map(r => r.id);
    if (candidates.length) {
      const restorable = candidates.filter(id => {
        const dir = path.join(SESSIONS_ROOT, String(id));
        return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
      });
      if (restorable.length) {
        console.log(`[wa-web] restaurando ${restorable.length} sesión(es): ${restorable.join(', ')}`);
        manager.restoreAll(restorable).catch(err => console.error('[wa-web] restoreAll error:', err.message));
      }
    }
  } catch (err) {
    console.error('[wa-web] error restaurando sesiones:', err.message);
  }
}

module.exports = { init };
