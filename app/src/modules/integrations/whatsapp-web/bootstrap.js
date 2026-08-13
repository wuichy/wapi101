// Bootstrap del subsistema WhatsApp Web (Baileys).
// Une el manager (sockets) con la DB y los servicios de conversaciones / bots.
// Se llama una vez al boot del server.

const path = require('path');
const fs = require('fs');
const manager = require('./manager');
const convoSvc = require('../../conversations/service');
const expedientSvc = require('../../expedients/service');
const botEngine = require('../../bot/engine');
const inboundRouter = require('../../inbound-router/service');
const pushSvc = require('../../notifications/service');
const customerSvc = require('../../customers/service');

function getIntegrationContext(db, integrationId) {
  if (!integrationId) return { tenantId: null, routing: null };
  const row = db.prepare('SELECT tenant_id, config FROM integrations WHERE id = ?').get(integrationId);
  if (!row) return { tenantId: null, routing: null };
  let routing = null;
  try { routing = row.config ? (JSON.parse(row.config)?.routing || null) : null; } catch {}
  return { tenantId: row.tenant_id, routing };
}

// Grupos de WhatsApp que el usuario autorizó para esta integración.
// Vive en integrations.config.groups = ['1203...@g.us', ...]. Vacío = ninguno.
function getIntegrationGroups(db, integrationId) {
  try {
    const row = db.prepare('SELECT config FROM integrations WHERE id = ?').get(integrationId);
    const g = row?.config ? JSON.parse(row.config)?.groups : null;
    return Array.isArray(g) ? g : [];
  } catch (_) { return []; }
}

function ensureExpedient(db, tenantId, contactId, routing) {
  if (!routing?.pipelineId || !routing?.stageId) return;
  if (!tenantId || !contactId) return;
  // Verificar si el contacto ya tiene CUALQUIER lead (no solo en el pipeline de routing).
  // Si ya tiene uno (aunque WooCommerce lo haya movido a otro pipeline), no crear duplicado.
  const existing = db.prepare(
    'SELECT id FROM expedients WHERE contact_id = ? AND tenant_id = ? LIMIT 1'
  ).get(contactId, tenantId);
  if (existing) return;
  try {
    expedientSvc.create(db, tenantId, {
      contactId, pipelineId: routing.pipelineId, stageId: routing.stageId,
      name: null, value: 0, tags: [], fieldValues: {},
    });
  } catch (err) {
    console.warn('[wa-web] no se pudo crear expediente:', err.message);
  }
}

// ── Ventana de gracia para las desconexiones de WA Lite ───────────────────
// Baileys se cae y se reconecta solo TODO el tiempo, y cada caída mandaba un
// push. Medido en el journal del server (2026-08-12): 6 caídas, la más corta
// 2.7s, la más larga 5.9s, promedio 4.6s — TODAS se recuperaron solas. O sea:
// el 100% de esas notificaciones era ruido.
//
// Ahora la alerta no sale al instante: se PROGRAMA. Si el canal se reconecta
// antes de que venza la ventana, se cancela y nadie se entera. Si vence y
// sigue caído, entonces sí es un problema de verdad y se avisa (diciendo
// cuánto lleva caído).
//
// EXCEPCIÓN: `loggedOut` (cerraron la sesión desde el celular) avisa AL
// INSTANTE — eso no se arregla solo, necesita escanear el QR otra vez.
//
// Ajustable con WA_DOWN_GRACE_MIN en .env (minutos). Con los datos de arriba
// hasta 1 minuto bastaría; 10 da margen para que el celular se quede sin
// internet un rato sin que te llegue una falsa alarma.
const DOWN_GRACE_MS = Math.max(1, Number(process.env.WA_DOWN_GRACE_MIN) || 10) * 60_000;
const _groupNames = new Map(); // groupJid → nombre, para no pedirlo en cada mensaje
const _downPending = new Map(); // integrationId → { timer, since }
const _downAlerted = new Set(); // integrationId que YA alertó (para avisar cuando vuelva)

function _clearDownTimer(integrationId) {
  const p = _downPending.get(integrationId);
  if (p) { clearTimeout(p.timer); _downPending.delete(integrationId); }
  return p || null;
}

// Manda la alerta de canal caído por push + campanita in-app.
function _alertDown(db, tenantId, integrationId, title, body) {
  pushSvc.sendToAll(db, tenantId, {
    title, body,
    tag: `wa-${integrationId}-down`,
    url: '/?view=integraciones',
    // Sin integrationId a propósito: aunque el canal esté silenciado con la
    // campanita, si se CAE hay que enterarse o pierdes mensajes sin saberlo.
  }, { kind: 'integration_down', cooldownKey: String(integrationId), cooldownMs: 5 * 60_000 })
    .catch(err => console.warn('[push] down:', err.message));

  if (!tenantId) return;
  try {
    for (const adv of db.prepare('SELECT id FROM advisors WHERE tenant_id = ?').all(tenantId)) {
      pushSvc.createNotification(db, {
        tenantId, advisorId: adv.id, type: 'general',
        title: '⚠️ Integración desconectada', body, link: '/?view=integraciones',
      });
    }
  } catch (ne) { console.warn('[wa-web] in-app notif error:', ne.message); }
}

function init(db) {
  manager.setHandlers({
    // Acks de salida (delivered/read) — actualiza el status del mensaje en DB
    // con orden monotónico (un 'delivered' tardío no pisa un 'read').
    onMessageStatus: (integrationId, { messageId, status }) => {
      try {
        const { tenantId } = getIntegrationContext(db, integrationId);
        if (!tenantId || !messageId) return;
        const rank = { pending: 0, sent: 1, delivered: 2, read: 3 };
        const row = db.prepare(
          "SELECT id, status FROM messages WHERE provider = 'whatsapp-lite' AND external_id = ? AND tenant_id = ? AND direction = 'outgoing'"
        ).get(String(messageId), tenantId);
        if (!row) return;
        if ((rank[status] ?? 0) <= (rank[row.status] ?? 0)) return;
        db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, row.id);
      } catch (_) { /* ack perdido no es crítico */ }
    },
    onMessage: (integrationId, payload) => {
      try {
        const { tenantId, routing } = getIntegrationContext(db, integrationId);
        if (!tenantId) {
          console.warn(`[wa-web ${integrationId}] integración sin tenant — ignorando mensaje`);
          return;
        }

        // ── Grupos: solo entran los que el usuario eligió ──
        // NUNCA entran todos solos. Este número puede ser el celular personal
        // y sus grupos (familia, cuates) no tienen por qué acabar en el CRM.
        // La lista vive en integrations.config.groups (JSON, sin migración).
        if (payload.isGroup) {
          const permitidos = getIntegrationGroups(db, integrationId);
          if (!permitidos.includes(payload.externalId)) return;
        }

        // Dedup: si ya tenemos ese message_id en ESTE tenant no procesar otra vez
        if (payload.messageId) {
          const dup = db.prepare(
            'SELECT id FROM messages WHERE provider = ? AND external_id = ? AND tenant_id = ?'
          ).get('whatsapp-lite', payload.messageId, tenantId);
          if (dup) return;
        }

        // En un grupo el "contacto" ES el grupo: un grupo = un lead. No tiene
        // teléfono, así que se identifica por su JID (el external_id de la
        // conversación) y se nombra con el asunto del grupo.
        const convo = convoSvc.findOrCreate(db, tenantId, {
          provider:      'whatsapp-lite',
          externalId:    payload.externalId,
          integrationId,
          contactPhone:  payload.isGroup ? null : `+${payload.externalId}`,
          contactName:   payload.isGroup
            ? (_groupNames.get(payload.externalId) || 'Grupo de WhatsApp')
            : payload.pushName,
        });

        // El nombre real del grupo se pide una vez a WhatsApp (async) y se
        // guarda en el contacto. Sin esto quedaría como "Grupo de WhatsApp".
        if (payload.isGroup && convo.contact_id && !_groupNames.has(payload.externalId)) {
          manager.getGroupName(integrationId, payload.externalId).then(nombre => {
            if (!nombre) return;
            _groupNames.set(payload.externalId, nombre);
            try {
              db.prepare('UPDATE contacts SET first_name = ? WHERE id = ? AND tenant_id = ?')
                .run(nombre, convo.contact_id, tenantId);
            } catch (_) {}
          }).catch(() => {});
        }

        // Fire-and-forget: jala la foto de perfil de WhatsApp si el contacto
        // no tiene una o lleva más de 7 días sin actualizarse.
        if (convo.contact_id) {
          const c = db.prepare('SELECT avatar_url, avatar_updated_at FROM contacts WHERE id = ?').get(convo.contact_id);
          const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
          if (!c?.avatar_url || (c.avatar_updated_at && c.avatar_updated_at < sevenDaysAgo)) {
            manager.getProfilePicUrl(integrationId, payload.externalId)
              .then(url => { if (url) customerSvc.setAvatar(db, tenantId, convo.contact_id, url); })
              .catch(() => {});
          }
        }

        // ── Lo escribiste TÚ desde la app de WhatsApp del celular ──
        // Se guarda como saliente y AQUÍ SE ACABA: no es un mensaje del
        // cliente, así que nada de bots, IA, push ni crear leads.
        if (payload.fromMe) {
          convoSvc.addMessage(db, tenantId, convo.id, {
            externalId: payload.messageId,
            direction:  'outgoing',
            provider:   'whatsapp-lite',
            body:       payload.body,
            status:     'sent',        // los acuses llegan por messages.update
            createdAt:  payload.timestamp,
            // byAdvisor: lo mandó un humano. Además de marcarlo como tal, esto
            // arranca la "ventana humano" (last_human_msg_at) para que la IA y
            // los bots NO contesten encima de lo que ya respondiste desde el
            // celu, y limpia el 🚨 de urgente.
            byAdvisor:  true,
          });
          // Si contestaste desde el celular, ese chat ya lo viste.
          try { convoSvc.markRead(db, tenantId, convo.id); } catch (_) {}
          console.log(`[wa-web ${integrationId}] saliente desde el celu → convo #${convo.id}`);
          return;
        }

        // En grupo, anteponer quién escribió. v1 pragmático: va en el propio
        // body para que se vea sin tocar el frontend.
        const autor = payload.isGroup
          ? (payload.authorName || (payload.authorPhone ? `+${payload.authorPhone}` : null))
          : null;
        convoSvc.addMessage(db, tenantId, convo.id, {
          externalId: payload.messageId,
          direction:  'incoming',
          provider:   'whatsapp-lite',
          body:       autor ? `${autor}: ${payload.body}` : payload.body,
          status:     'delivered',
          createdAt:  payload.timestamp,
        });

        ensureExpedient(db, tenantId, convo.contact_id, routing);

        // ── Los grupos terminan aquí ──
        // Nada de inbound router ni bots: una respuesta automática dentro de un
        // grupo le llega a TODOS sus miembros. El candado de verdad está en
        // sender.js (_assertCanSendToGroup, bloqueado por defecto); esto evita
        // además que se arranquen runs de bot que igual no podrían mandar.
        if (payload.isGroup) {
          console.log(`[wa-web ${integrationId}] grupo ${payload.externalId} → convo #${convo.id}`);
          return;
        }

        inboundRouter.handleInboundMessage(db, {
          convoId:       convo.id,
          contactId:     convo.contact_id,
          messageBody:   payload.body,
          provider:      'whatsapp-lite',
          integrationId,
        });

        // Despertar bots suspendidos esperando respuesta (wait_response /
        // template con botones). Los demás canales lo hacen en webhooks.js —
        // sin esto, un bot por WA Lite quedaba colgado hasta el timeout aunque
        // el cliente contestara.
        try {
          botEngine.resumeWaitsForContact(db, convo.contact_id, 'on_text_reply', { messageBody: payload.body });
        } catch (_) {}

        const senderName = payload.pushName || convo.contact_first_name || `+${payload.externalId}`;
        const preview = (payload.body || '📎 Adjunto').slice(0, 140);
        // Si la convo está marcada urgente (handover disparado), prefijar 🚨
        let isUrgent = false;
        try {
          const row = db.prepare('SELECT is_urgent FROM conversations WHERE id = ?').get(convo.id);
          isUrgent = !!(row && row.is_urgent);
        } catch (_) {}
        pushSvc.sendToAll(db, tenantId, {
          title: isUrgent ? `🚨 ${senderName}` : senderName,
          body:  preview,
          tag:   `chat-${convo.id}`,
          url:   `/?view=chats&convo=${convo.id}`,
          chatId: convo.id,
          // integrationId → sendToAll respeta la campanita del canal.
        }, { kind: 'message', integrationId })
          .catch(err => console.warn('[push] msg:', err.message));

        console.log(`[wa-web ${integrationId}] msg ${payload.messageId} → convo #${convo.id} (tenant ${tenantId})`);
      } catch (err) {
        // El número y la dirección son lo primero que necesitas para diagnosticar:
        // sin ellos, un "UNIQUE constraint failed" no dice a quién le pasó.
        console.error(`[wa-web ${integrationId}] error procesando mensaje`
          + ` (${payload?.fromMe ? 'saliente' : 'entrante'} ${payload?.externalId || '?'}):`, err.message);
      }
    },

    onConnected: (integrationId, session) => {
      try {
        const { tenantId } = getIntegrationContext(db, integrationId);
        const phone = session.phoneNumber || '';
        const display = phone ? `WhatsApp +${phone}` : 'WhatsApp Lite';
        db.prepare(`
          UPDATE integrations
          SET status = 'connected', display_name = ?, external_id = ?,
              connected_at = unixepoch(), updated_at = unixepoch(), last_error = NULL
          WHERE id = ?
        `).run(display, phone || null, integrationId);

        // Se reconectó antes de que venciera la gracia → cancelar la alerta
        // programada. Este es el caso normal (caídas de ~5s).
        const pending = _clearDownTimer(integrationId);
        if (pending) {
          const seg = Math.round((Date.now() - pending.since) / 1000);
          console.log(`[wa-web ${integrationId}] reconectó en ${seg}s — alerta cancelada`);
        }

        // Solo avisamos "reconectado" si de verdad llegamos a alertar de la
        // caída. Antes esto se decidía leyendo integrations.status, que en las
        // caídas transitorias NUNCA cambiaba de 'connected' → el aviso de
        // recuperación no salió jamás (1 solo registro en 3 meses de alert_log).
        if (_downAlerted.delete(integrationId)) {
          pushSvc.sendToAll(db, tenantId, {
            title: '✅ WhatsApp reconectado',
            body:  phone ? `+${phone} volvió a estar en línea` : 'Volvió a estar en línea',
            tag:   `wa-${integrationId}-down`,
            url:   '/?view=integraciones',
          }, { kind: 'integration_recovered', cooldownKey: String(integrationId), cooldownMs: 60_000 })
            .catch(err => console.warn('[push] recovered:', err.message));
        }
      } catch (err) {
        console.error(`[wa-web ${integrationId}] onConnected DB error:`, err.message);
      }
    },

    onDisconnected: (integrationId, info) => {
      try {
        const { tenantId } = getIntegrationContext(db, integrationId);
        const row = db.prepare("SELECT display_name, external_id FROM integrations WHERE id = ?").get(integrationId);
        const displayName = row?.display_name || 'WhatsApp Lite';

        // ── Cerraron sesión desde el celular: esto NO se arregla solo ──
        if (info.loggedOut) {
          _clearDownTimer(integrationId);
          db.prepare(`UPDATE integrations SET status = 'disconnected', last_error = ?, updated_at = unixepoch() WHERE id = ?`)
            .run('Sesión cerrada en el dispositivo', integrationId);
          _downAlerted.add(integrationId);
          _alertDown(db, tenantId, integrationId, '⚠️ WhatsApp desconectado',
            `${displayName} cerró sesión. Reconecta escaneando QR de nuevo.`);
          return;
        }

        // ── Caída transitoria: NO avisar todavía ──
        db.prepare(`UPDATE integrations SET last_error = ?, updated_at = unixepoch() WHERE id = ?`)
          .run(info.message || 'Desconectado', integrationId);

        // Ya hay una cuenta regresiva corriendo → no reiniciarla. Si no, el
        // ciclo caída→reintento→caída la reiniciaría eternamente y la alerta
        // no saldría nunca aunque el canal lleve horas muerto.
        if (_downPending.has(integrationId)) return;

        const since = Date.now();
        const timer = setTimeout(() => {
          _downPending.delete(integrationId);
          try {
            // ¿Sigue caído de verdad? Le preguntamos al manager, que es quien
            // tiene el estado en vivo — no a la DB, que en las transitorias
            // se queda en 'connected'.
            if (manager.getStatus(integrationId)?.status === 'connected') return;
            const min = Math.round((Date.now() - since) / 60000);
            _downAlerted.add(integrationId);
            _alertDown(db, tenantId, integrationId, '⚠️ WhatsApp lleva rato caído',
              `${displayName} no se ha podido reconectar en ${min} min. Revisa que el celular tenga internet.`);
          } catch (e) {
            console.warn(`[wa-web ${integrationId}] alerta de caída:`, e.message);
          }
        }, DOWN_GRACE_MS);
        timer.unref?.();
        _downPending.set(integrationId, { timer, since });
        console.log(`[wa-web ${integrationId}] caído — alerta programada en ${DOWN_GRACE_MS / 60000} min si no reconecta`);
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
