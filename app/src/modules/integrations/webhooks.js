// Webhooks receiver. Aislado: cada provider tiene su lógica de verificación.
// Reglas (lecciones aprendidas):
//   1. Verificar firma HMAC sobre el RAW body (no el parseado)
//   2. Responder 200 en menos de 2 segundos (procesar async)
//   3. Idempotencia: tabla webhook_events con UNIQUE(provider, external_id)
//   4. Errores nunca tumban el proceso — solo se loggean

const express = require('express');
const crypto = require('crypto');
const providers = require('./providers');
const { decryptJson } = require('../../security/crypto');
const convoSvc = require('../conversations/service');
const expedientSvc = require('../expedients/service');
const botEngine = require('../bot/engine');
const pushSvc = require('../notifications/service');

// Helper: push notification para mensaje entrante (colapsa por convo)
function pushIncomingMessage(db, convo, body, senderName) {
  try {
    const preview = (body || '📎 Adjunto').slice(0, 140);
    const name = senderName || `#${convo.id}`;
    pushSvc.sendToAll(db, null, {
      title: name,
      body:  preview,
      tag:   `chat-${convo.id}`,
      url:   `/?view=chats&convo=${convo.id}`,
      chatId: convo.id,
    }, { kind: 'message' }).catch(err => console.warn('[push] msg:', err.message));
  } catch (_) {}
}

module.exports = function createWebhooksRouter(db) {
  const router = express.Router();

  // ─── Helpers ───
  function findIntegration(provider, externalId) {
    if (!externalId) return null;
    // whatsapp and whatsapp-lite are the same channel
    const providerList = provider === 'whatsapp' ? ['whatsapp', 'whatsapp-lite'] : [provider];
    const placeholders = providerList.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT * FROM integrations WHERE provider IN (${placeholders}) AND external_id = ? LIMIT 1`
    ).get(...providerList, String(externalId));
    if (!row) return null;
    return { ...row, credentials: row.credentials_enc ? (decryptJson(row.credentials_enc) || {}) : {} };
  }

  function findIntegrationByProvider(provider) {
    // Para whatsapp también busca whatsapp-lite (mismo canal, diferente modo de conexión)
    const providers = provider === 'whatsapp'
      ? ['whatsapp', 'whatsapp-lite']
      : [provider];
    const placeholders = providers.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT * FROM integrations WHERE provider IN (${placeholders}) AND status = ? ORDER BY id ASC LIMIT 1`
    ).get(...providers, 'connected');
    if (!row) return null;
    return { ...row, credentials: row.credentials_enc ? (decryptJson(row.credentials_enc) || {}) : {} };
  }

  // Idempotencia: si ya existe (provider, eventId), devuelve true → ya procesado
  function alreadyProcessed(provider, eventId) {
    if (!eventId) return false;
    try {
      db.prepare(`
        INSERT INTO webhook_events (provider, external_id) VALUES (?, ?)
      `).run(provider, String(eventId));
      return false;
    } catch (err) {
      // Violación UNIQUE → ya existe
      return /UNIQUE/i.test(err.message);
    }
  }

  function logEvent(provider, eventId, payload) {
    try {
      db.prepare(`
        UPDATE webhook_events SET payload = ?, processed_at = unixepoch()
        WHERE provider = ? AND external_id = ?
      `).run(JSON.stringify(payload).slice(0, 10000), provider, String(eventId));
    } catch (_) { /* ignore */ }
  }

  function hmacB64(secret, body, algo = 'sha256') {
    return crypto.createHmac(algo, secret).update(body).digest('base64');
  }
  function hmacHex(secret, body, algo = 'sha256') {
    return crypto.createHmac(algo, secret).update(body).digest('hex');
  }
  function safeEqual(a, b) {
    const aBuf = Buffer.from(String(a || ''));
    const bBuf = Buffer.from(String(b || ''));
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }

  // ─── Meta (WhatsApp / Messenger / Instagram) ───
  // Verificación GET: hub.challenge si hub.verify_token coincide
  // Verificación POST: X-Hub-Signature-256 = hmac_sha256(app_secret, raw_body)
  function metaGetHandler(provider) {
    return (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode !== 'subscribe' || !token) return res.sendStatus(400);

      // Fallback: token global de entorno
      const envToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
      if (envToken && safeEqual(envToken, token)) {
        return res.status(200).send(String(challenge || ''));
      }

      // Buscar cualquier integración del provider que tenga ese verify token
      const rows = db.prepare('SELECT credentials_enc FROM integrations WHERE provider = ?').all(provider);
      for (const row of rows) {
        const creds = row.credentials_enc ? decryptJson(row.credentials_enc) : null;
        if (creds && creds.webhookVerifyToken && safeEqual(creds.webhookVerifyToken, token)) {
          return res.status(200).send(String(challenge || ''));
        }
      }
      return res.sendStatus(403);
    };
  }

  function metaPostHandler(provider) {
    return (req, res) => {
      const raw = req.body; // Buffer (express.raw)
      const signature = String(req.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
      const payload = (() => { try { return JSON.parse(raw.toString('utf8')); } catch { return null; } })();

      // Identificar la integración por external_id en el payload
      let integration = null;
      let externalId = null;
      if (provider === 'whatsapp' || provider === 'whatsapp-lite') {
        externalId = payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      } else if (provider === 'messenger') {
        externalId = payload?.entry?.[0]?.id; // page_id
      } else if (provider === 'instagram') {
        externalId = payload?.entry?.[0]?.id; // ig_user_id (cuando usas IG Login)
      }
      integration = externalId ? (findIntegration(provider, externalId) || findIntegrationByProvider(provider)) : findIntegrationByProvider(provider);

      // Verificar firma con app_secret (integración primero, .env como fallback global Meta)
      const appSecret = integration?.credentials?.appSecret || process.env.META_APP_SECRET;
      if (appSecret) {
        const expected = hmacHex(appSecret, raw);
        if (!safeEqual(signature, expected)) {
          console.warn(`[webhook ${provider}] firma inválida`);
          return res.sendStatus(401);
        }
      } else {
        console.warn(`[webhook ${provider}] sin appSecret configurado, no se verificó firma`);
      }

      // Idempotencia: usamos message_id (incoming), status_id+state (delivery status)
      // o entry.id+changes.field (otros eventos)
      const _change = payload?.entry?.[0]?.changes?.[0];
      const _statusEvt = _change?.value?.statuses?.[0];
      const eventId = _change?.value?.messages?.[0]?.id
                   || (_statusEvt ? `status-${_statusEvt.id}-${_statusEvt.status}` : null)
                   || payload?.entry?.[0]?.messaging?.[0]?.message?.mid
                   || `${provider}-${payload?.entry?.[0]?.id}-${payload?.entry?.[0]?.time}`;

      res.sendStatus(200); // CRÍTICO: responder rápido

      if (alreadyProcessed(provider, eventId)) return;
      logEvent(provider, eventId, payload);

      // Procesar mensajes entrantes de WhatsApp en conversaciones
      if (provider === 'whatsapp' || provider === 'whatsapp-lite') {
        // Cambio de estado de plantilla
        const change = payload?.entry?.[0]?.changes?.[0];
        if (change?.field === 'message_template_status_update') {
          processTemplateStatusUpdate(change.value);
        } else if (change?.value?.statuses?.length) {
          // Webhook de delivery status (sent / delivered / read / failed)
          processWhatsAppStatuses(change.value);
        } else {
          processWhatsAppMessages(payload, integration);
        }
      } else if (provider === 'messenger') {
        processMessengerMessages(payload, integration);
      } else if (provider === 'instagram') {
        processInstagramMessages(payload, integration);
      }

      console.log(`[webhook ${provider}] evento ${eventId} procesado`);
    };
  }

  function getIntegrationRouting(integrationId) {
    if (!integrationId) return null;
    const row = db.prepare('SELECT config FROM integrations WHERE id = ?').get(integrationId);
    if (!row?.config) return null;
    try { return JSON.parse(row.config)?.routing || null; } catch { return null; }
  }

  function ensureExpedient(contactId, routing) {
    if (!routing?.pipelineId || !routing?.stageId) return;
    // Solo crear si el contacto NO tiene NINGÚN expediente ABIERTO
    // (en etapa kind='in_progress'). Esto evita duplicados al cambiar
    // el routing de la integración entre pipelines distintos.
    // Caso permitido: si TODOS los expedientes anteriores del contacto
    // están cerrados (won/lost), se crea uno nuevo — es un contacto
    // recurrente con un deal/caso nuevo.
    const existing = db.prepare(`
      SELECT e.id, e.pipeline_id
        FROM expedients e
        JOIN stages s ON s.id = e.stage_id
       WHERE e.contact_id = ?
         AND COALESCE(s.kind, 'in_progress') = 'in_progress'
       LIMIT 1
    `).get(contactId);
    if (existing) {
      console.log(`[webhook] contacto ${contactId} ya tiene expediente abierto (id=${existing.id} en pipeline ${existing.pipeline_id}). No se crea duplicado.`);
      return;
    }

    try {
      expedientSvc.create(db, {
        contactId,
        pipelineId: routing.pipelineId,
        stageId:    routing.stageId,
        name:       null,
        value:      0,
        tags:       [],
        fieldValues: {},
      });
      console.log(`[webhook] expediente creado para contacto ${contactId} en pipeline ${routing.pipelineId}`);
    } catch (err) {
      console.warn('[webhook] no se pudo crear expediente:', err.message);
    }
  }

  function processTemplateStatusUpdate(value) {
    // value.message_template_id  → wa_id en message_templates
    // value.event                → APPROVED | REJECTED | PENDING_DELETION | FLAGGED
    // value.reason               → razón de rechazo (solo en REJECTED)
    try {
      const waId    = String(value?.message_template_id || '');
      const event   = String(value?.event || '').toUpperCase();
      const reason  = value?.reason || null;
      if (!waId || !event) return;

      const statusMap = { APPROVED: 'approved', REJECTED: 'rejected', FLAGGED: 'rejected', PENDING_DELETION: 'rejected' };
      const newStatus = statusMap[event] || 'pending';

      const row = db.prepare('SELECT id FROM message_templates WHERE wa_id = ?').get(waId);
      if (!row) {
        console.warn(`[webhook template] no se encontró plantilla con wa_id=${waId}`);
        return;
      }

      db.prepare(
        'UPDATE message_templates SET wa_status = ?, wa_rejected_reason = ?, updated_at = unixepoch() WHERE id = ?'
      ).run(newStatus, reason, row.id);

      console.log(`[webhook template] plantilla ${waId} → ${event} (${newStatus})${reason ? ` razón: ${reason}` : ''}`);
    } catch (err) {
      console.error('[webhook template] error procesando status update:', err.message);
    }
  }

  // Detecta el tipo de media en un mensaje entrante de WhatsApp y devuelve
  // { mediaId, mimetype, ext, caption, type } o null si no es media.
  function _extractWhatsAppMedia(msg) {
    const types = ['image', 'video', 'audio', 'document', 'sticker', 'voice'];
    for (const t of types) {
      const m = msg[t];
      if (m && m.id) {
        const ext = (m.mime_type || '').split('/')[1]?.split(';')[0]
                  || (t === 'image' ? 'jpg' : t === 'video' ? 'mp4' : t === 'audio' ? 'ogg' : 'bin');
        return {
          type: t === 'sticker' ? 'image' : (t === 'voice' ? 'audio' : t),
          mediaId: m.id,
          mimetype: m.mime_type || 'application/octet-stream',
          filename: m.filename || `${t}-${Date.now()}.${ext}`,
          caption: m.caption || msg.caption || '',
          ext,
        };
      }
    }
    return null;
  }

  // Descarga el archivo desde Meta (URL temporal de 5min, requiere token).
  // Lo guarda en data/uploads/chat-media/ y actualiza la columna media_url
  // del mensaje recién insertado.
  async function _downloadAndStoreWhatsAppMedia(integration, msgRow, media) {
    try {
      const path = require('path');
      const fs = require('fs');
      const accessToken = integration?.credentials?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
      if (!accessToken) { console.warn('[webhook media] sin access token, no se puede descargar'); return; }
      const version = process.env.META_GRAPH_VERSION || 'v22.0';

      // Step 1 — obtener URL temporal
      const metaRes = await fetch(`https://graph.facebook.com/${version}/${media.mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const metaJson = await metaRes.json().catch(() => ({}));
      if (!metaJson.url) { console.warn(`[webhook media] no se obtuvo URL para media ${media.mediaId}`); return; }

      // Step 2 — descargar bytes (mismo token)
      const dlRes = await fetch(metaJson.url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!dlRes.ok) { console.warn(`[webhook media] descarga falló: HTTP ${dlRes.status}`); return; }
      const buffer = Buffer.from(await dlRes.arrayBuffer());

      // Step 3 — guardar local con extensión correcta
      const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
      const chatMediaDir = path.join(uploadsDir, 'chat-media');
      if (!fs.existsSync(chatMediaDir)) fs.mkdirSync(chatMediaDir, { recursive: true });
      const safeExt = media.ext.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin';
      const localName = `in-${msgRow.id}-${Date.now()}.${safeExt}`;
      fs.writeFileSync(path.join(chatMediaDir, localName), buffer);
      const localUrl = `/uploads/chat-media/${localName}`;

      // Step 4 — actualizar el mensaje con la URL local
      db.prepare('UPDATE messages SET media_url = ? WHERE id = ?').run(localUrl, msgRow.id);
      console.log(`[webhook media] msg #${msgRow.id} → ${localUrl} (${(buffer.length/1024).toFixed(1)}KB)`);
    } catch (err) {
      console.error('[webhook media] error descargando:', err.message);
    }
  }

  function processWhatsAppMessages(payload, integration) {
    try {
      const routing = getIntegrationRouting(integration?.id);
      const entries = payload?.entry || [];
      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          const value = change.value || {};
          for (const msg of (value.messages || [])) {
            const waId    = msg.from;
            const media   = _extractWhatsAppMedia(msg);
            // body = caption (si existe) o '' si solo media. Para texto puro usa msg.text
            const body    = msg.text?.body || media?.caption || msg.caption || '';
            const msgId   = msg.id;
            const ts      = msg.timestamp ? Number(msg.timestamp) : Math.floor(Date.now() / 1000);
            const profile = value.contacts?.find((c) => c.wa_id === waId);
            const name    = profile?.profile?.name || null;

            const convo = convoSvc.findOrCreate(db, null, {
              provider:      'whatsapp',
              externalId:    waId,
              integrationId: integration?.id || null,
              contactPhone:  `+${waId}`,
              contactName:   name,
            });

            const insertedMsg = convoSvc.addMessage(db, null, convo.id, {
              externalId: msgId,
              direction:  'incoming',
              provider:   'whatsapp',
              body,
              status:     'delivered',
              createdAt:  ts,
            });

            // Si el mensaje trae media, descargar de Meta async y guardar local.
            // No bloqueamos el webhook (Meta tiene timeout corto).
            if (media && insertedMsg) {
              _downloadAndStoreWhatsAppMedia(integration, insertedMsg, media);
            }

            // Crear expediente si la integración tiene routing configurado
            ensureExpedient(convo.contact_id, routing);

            botEngine.triggerMessage(db, {
              convoId:       convo.id,
              contactId:     convo.contact_id,
              messageBody:   body,
              provider:      'whatsapp',
              integrationId: integration?.id || null,
            });
            // Resumir wait_response del bot si el lead estaba en pausa
            // esperando una respuesta (rama on_text_reply / on_button_click)
            try {
              const branch = msg.button ? 'on_button_click' : 'on_text_reply';
              botEngine.resumeWaitsForContact(db, convo.contact_id, branch, { messageBody: body });
            } catch (_) {}

            const previewByType = { image: '📷 Imagen', video: '🎬 Video', audio: '🎵 Audio', document: '📎 Documento' };
            const pushBody = body || (media ? (previewByType[media.type] || '📎 Archivo') : '');
            pushIncomingMessage(db, convo, pushBody, name || `+${waId}`);
          }
        }
      }
    } catch (err) {
      console.error('[webhook whatsapp] error procesando mensajes:', err.message);
    }
  }

  // Códigos de error de Meta más comunes en delivery → texto amigable.
  function friendlyDeliveryError(code, fallbackTitle, fallbackDetails) {
    const codeNum = Number(code);
    const map = {
      131026: 'Número sin WhatsApp activo o el lead te bloqueó',
      131047: 'El lead no acepta mensajes de WhatsApp Business',
      131051: 'Tipo de mensaje no soportado por el destinatario',
      131052: 'El lead bloqueó tus mensajes',
      131053: 'No se pudo enviar el archivo (formato no soportado por Meta)',
      131056: 'Pareja de números bloqueada (rate limit)',
      131057: 'Cuenta del lead pausada o suspendida',
      132000: 'Plantilla expiró o ya no está aprobada',
      132001: 'Categoría de plantilla incorrecta',
      132005: 'Variable de plantilla con texto demasiado largo',
      132007: 'Idioma de plantilla no soportado',
      133000: 'El lead no recibe mensajes (cuenta suspendida)',
      133010: 'Número del lead no es válido',
      133015: 'Número no registrado en WhatsApp',
      470:    'Ventana de 24h cerrada — solo plantillas aprobadas',
    };
    return map[codeNum] || fallbackTitle || fallbackDetails || `Error ${code || 'desconocido'}`;
  }

  // Procesa value.statuses[] del webhook de WhatsApp (delivery status).
  // Cada entry trae { id, status: 'sent'|'delivered'|'read'|'failed', recipient_id, errors? }.
  // Actualiza la columna status del mensaje saliente correspondiente.
  function processWhatsAppStatuses(value) {
    const statuses = value.statuses || [];
    // Orden lógico: failed siempre gana; en otros casos no retroceder.
    const order = { sent: 1, delivered: 2, read: 3, failed: 4 };
    for (const s of statuses) {
      try {
        const id     = s.id;
        const status = s.status;
        if (!id || !status) continue;
        let errorReason = null;
        if (status === 'failed' && Array.isArray(s.errors) && s.errors.length) {
          const err = s.errors[0];
          errorReason = friendlyDeliveryError(err.code, err.title, err.error_data?.details || err.message);
        }
        const msg = db.prepare("SELECT id, status FROM messages WHERE external_id = ? AND provider = 'whatsapp'").get(id);
        if (!msg) {
          // Mensaje aún no existe — puede llegar el status antes que el insert (raro). Lo ignoramos.
          continue;
        }
        const cur = order[msg.status] || 0;
        const incoming = order[status] || 0;
        if (incoming < cur) continue; // no retroceder (ej. ya leído, llega delivered viejo)
        if (errorReason) {
          db.prepare('UPDATE messages SET status = ?, error_reason = ? WHERE id = ?').run(status, errorReason, msg.id);
        } else {
          db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, msg.id);
        }
        console.log(`[webhook status] msg wa_id=${id} → ${status}${errorReason ? ` (${errorReason})` : ''}`);

        // Si el mensaje falló, resumir cualquier wait_response del bot que
        // estuviera esperando con la rama on_delivery_fail.
        if (status === 'failed') {
          try {
            const ctxRow = db.prepare(`
              SELECT c.contact_id FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
               WHERE m.id = ?
            `).get(msg.id);
            if (ctxRow?.contact_id) {
              botEngine.resumeWaitsForContact(db, ctxRow.contact_id, 'on_delivery_fail', { errorReason });
            }
          } catch (_) {}
        }
      } catch (err) {
        console.error('[webhook status] error procesando status:', err.message);
      }
    }
  }

  function processMessengerMessages(payload, integration) {
    try {
      for (const entry of (payload?.entry || [])) {
        for (const event of (entry.messaging || [])) {
          if (!event.message) continue;
          const senderId = event.sender?.id;
          const body     = event.message?.text || '';
          const msgId    = event.message?.mid;
          const ts       = event.timestamp ? Math.floor(event.timestamp / 1000) : Math.floor(Date.now() / 1000);

          const convo = convoSvc.findOrCreate(db, null, {
            provider:      'messenger',
            externalId:    senderId,
            integrationId: integration?.id || null,
            contactPhone:  null,
            contactName:   null,
          });

          convoSvc.addMessage(db, null, convo.id, {
            externalId: msgId,
            direction:  'incoming',
            provider:   'messenger',
            body,
            status:     'delivered',
            createdAt:  ts,
          });

          botEngine.triggerMessage(db, {
            convoId:       convo.id,
            contactId:     convo.contact_id,
            messageBody:   body,
            provider:      'messenger',
            integrationId: integration?.id || null,
          });
          try { botEngine.resumeWaitsForContact(db, convo.contact_id, 'on_text_reply', { messageBody: body }); } catch (_) {}

          pushIncomingMessage(db, convo, body, `Messenger #${senderId}`);
        }
      }
    } catch (err) {
      console.error('[webhook messenger] error procesando mensajes:', err.message);
    }
  }

  function processInstagramMessages(payload, integration) {
    try {
      for (const entry of (payload?.entry || [])) {
        for (const event of (entry.messaging || [])) {
          if (!event.message) continue;
          const senderId = event.sender?.id;
          const body     = event.message?.text || '';
          const msgId    = event.message?.mid;
          const ts       = event.timestamp ? Math.floor(event.timestamp / 1000) : Math.floor(Date.now() / 1000);

          const convo = convoSvc.findOrCreate(db, null, {
            provider:      'instagram',
            externalId:    senderId,
            integrationId: integration?.id || null,
            contactPhone:  null,
            contactName:   null,
          });

          convoSvc.addMessage(db, null, convo.id, {
            externalId: msgId,
            direction:  'incoming',
            provider:   'instagram',
            body,
            status:     'delivered',
            createdAt:  ts,
          });

          botEngine.triggerMessage(db, {
            convoId:       convo.id,
            contactId:     convo.contact_id,
            messageBody:   body,
            provider:      'instagram',
            integrationId: integration?.id || null,
          });
          try { botEngine.resumeWaitsForContact(db, convo.contact_id, 'on_text_reply', { messageBody: body }); } catch (_) {}

          pushIncomingMessage(db, convo, body, `Instagram #${senderId}`);
        }
      }
    } catch (err) {
      console.error('[webhook instagram] error procesando mensajes:', err.message);
    }
  }

  // ─── Shopify ───
  // X-Shopify-Hmac-Sha256 = hmac_sha256_b64(webhook_secret, raw_body)
  function shopifyHandler(req, res) {
    const raw = req.body;
    const signature = String(req.get('x-shopify-hmac-sha256') || '');
    const shopDomain = String(req.get('x-shopify-shop-domain') || '');

    const integration = findIntegration('shopify', shopDomain) || findIntegrationByProvider('shopify');
    if (!integration?.credentials?.webhookSecret) {
      console.warn('[webhook shopify] sin webhookSecret, no verificado');
    } else {
      const expected = hmacB64(integration.credentials.webhookSecret, raw);
      if (!safeEqual(signature, expected)) return res.sendStatus(401);
    }

    const eventId = req.get('x-shopify-webhook-id') || `shopify-${Date.now()}`;
    res.sendStatus(200);
    if (alreadyProcessed('shopify', eventId)) return;
    let payload = null;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (_) {}
    logEvent('shopify', eventId, payload);
    console.log(`[webhook shopify] evento ${eventId} (${req.get('x-shopify-topic')}) recibido`);
  }

  // ─── WooCommerce ───
  // X-WC-Webhook-Signature = base64(hmac_sha256(secret, raw_body))
  function wooHandler(req, res) {
    const raw = req.body;
    const signature = String(req.get('x-wc-webhook-signature') || '');
    const source = String(req.get('x-wc-webhook-source') || '');

    const integration = findIntegration('woocommerce', source) || findIntegrationByProvider('woocommerce');
    if (!integration?.credentials?.webhookSecret) {
      console.warn('[webhook woocommerce] sin webhookSecret, no verificado');
    } else {
      const expected = hmacB64(integration.credentials.webhookSecret, raw);
      if (!safeEqual(signature, expected)) return res.sendStatus(401);
    }

    const eventId = req.get('x-wc-webhook-delivery-id') || `wc-${Date.now()}`;
    res.sendStatus(200);
    if (alreadyProcessed('woocommerce', eventId)) return;
    let payload = null;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (_) {}
    logEvent('woocommerce', eventId, payload);
    console.log(`[webhook woocommerce] evento ${eventId} (${req.get('x-wc-webhook-topic')}) recibido`);
  }

  // ─── Square ───
  // X-Square-Hmacsha256-Signature = base64url(hmac_sha256(signature_key, notification_url + raw_body))
  function squareHandler(req, res) {
    const raw = req.body;
    const signature = String(req.get('x-square-hmacsha256-signature') || '');
    const integration = findIntegrationByProvider('square');

    if (integration?.credentials?.webhookSignatureKey) {
      // Square firma URL + body
      const fullUrl = `${process.env.APP_BASE_URL || ''}/webhooks/square`;
      const expected = crypto
        .createHmac('sha256', integration.credentials.webhookSignatureKey)
        .update(fullUrl + raw.toString('utf8'))
        .digest('base64');
      if (!safeEqual(signature, expected)) {
        console.warn('[webhook square] firma inválida');
        return res.sendStatus(401);
      }
    } else {
      console.warn('[webhook square] sin webhookSignatureKey, no verificado');
    }

    let payload = null;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (_) {}
    const eventId = payload?.event_id || `square-${Date.now()}`;
    res.sendStatus(200);
    if (alreadyProcessed('square', eventId)) return;
    logEvent('square', eventId, payload);
    console.log(`[webhook square] evento ${eventId} (${payload?.type}) recibido`);
  }

  // ─── Telegram ───
  function telegramHandler(req, res) {
    const raw = req.body;
    const sentSecret = String(req.get('x-telegram-bot-api-secret-token') || '');

    let payload = null;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (_) {}

    const integration = findIntegrationByProvider('telegram');
    if (integration?.credentials?.webhookSecret) {
      if (!safeEqual(sentSecret, integration.credentials.webhookSecret)) {
        console.warn('[webhook telegram] secret token inválido');
        return res.sendStatus(401);
      }
    }

    const eventId = payload?.update_id ? `tg-${payload.update_id}` : `tg-${Date.now()}`;
    res.sendStatus(200);
    if (alreadyProcessed('telegram', eventId)) return;
    logEvent('telegram', eventId, payload);

    if (payload?.message) {
      processTelegramMessages(payload, integration);
    }
  }

  function processTelegramMessages(payload, integration) {
    try {
      const routing = getIntegrationRouting(integration?.id);
      const msg  = payload.message;
      if (!msg) return;

      const chatId   = String(msg.chat?.id);
      const body     = msg.text || msg.caption || '';
      const msgId    = `tg-${payload.update_id}`;
      const ts       = msg.date || Math.floor(Date.now() / 1000);
      const from     = msg.from || {};
      const name     = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null;

      const convo = convoSvc.findOrCreate(db, null, {
        provider:      'telegram',
        externalId:    chatId,
        integrationId: integration?.id || null,
        contactPhone:  null,
        contactName:   name,
      });

      convoSvc.addMessage(db, null, convo.id, {
        externalId: msgId,
        direction:  'incoming',
        provider:   'telegram',
        body,
        status:     'delivered',
        createdAt:  ts,
      });

      ensureExpedient(convo.contact_id, routing);

      botEngine.triggerMessage(db, {
        convoId:       convo.id,
        contactId:     convo.contact_id,
        messageBody:   body,
        provider:      'telegram',
        integrationId: integration?.id || null,
      });
      try { botEngine.resumeWaitsForContact(db, convo.contact_id, 'on_text_reply', { messageBody: body }); } catch (_) {}

      pushIncomingMessage(db, convo, body, name || `Telegram ${chatId}`);
    } catch (err) {
      console.error('[webhook telegram] error procesando mensaje:', err.message);
    }
  }

  // ─── TikTok ───
  // TikTok firma con SHA256 del client_secret + timestamp + body
  function tiktokHandler(req, res) {
    const raw = req.body;
    let payload = null;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (_) {}
    const eventId = payload?.event_id || payload?.user_openid + '-' + (payload?.timestamp || Date.now());
    res.sendStatus(200);
    if (alreadyProcessed('tiktok', eventId)) return;
    logEvent('tiktok', eventId, payload);
    console.log(`[webhook tiktok] evento ${eventId} recibido`);
  }

  // ─── Rutas ───
  // body crudo solo aquí; el resto del server usa express.json() global
  const raw = express.raw({ type: '*/*', limit: '5mb' });

  router.get('/whatsapp',      metaGetHandler('whatsapp'));
  router.get('/whatsapp-lite', metaGetHandler('whatsapp-lite'));
  router.get('/messenger',     metaGetHandler('messenger'));
  router.get('/instagram',     metaGetHandler('instagram'));

  router.post('/whatsapp',      raw, metaPostHandler('whatsapp'));
  router.post('/whatsapp-lite', raw, metaPostHandler('whatsapp-lite'));
  router.post('/messenger',     raw, metaPostHandler('messenger'));
  router.post('/instagram',     raw, metaPostHandler('instagram'));
  router.post('/shopify',      raw, shopifyHandler);
  router.post('/woocommerce',  raw, wooHandler);
  router.post('/square',       raw, squareHandler);
  router.post('/telegram',     raw, telegramHandler);
  router.post('/tiktok',       raw, tiktokHandler);

  // Endpoint de inspección (auth gateado en el futuro): últimos 50 eventos
  router.get('/_debug', (_req, res) => {
    const items = db.prepare(
      'SELECT id, provider, external_id, received_at, processed_at FROM webhook_events ORDER BY id DESC LIMIT 50'
    ).all();
    res.json({ items });
  });

  return router;
};
