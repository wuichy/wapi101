const express = require('express');
const path = require('path');
const fs = require('fs');
const svc = require('./service');
const {
  sendMessage,
  sendWhatsAppTemplate,
  sendWhatsAppMedia,
  sendWhatsAppLiteMedia,
  sendMessengerMedia,
  sendInstagramMedia,
  sendTelegramMedia,
} = require('./sender');

// Persiste un envío FALLIDO como message row (status='failed') para que el
// chat muestre la burbuja roja y el badge deliveryFailure. Sin esto, un fallo
// síncrono de envío (token caducado, ventana 24h, bloqueo) solo vive en un
// toast de 3.5s y desaparece — el incidente del token 9-10 jun fue invisible.
// Nunca lanza: si el insert falla no debe enmascarar el error original.
function _persistFailedSend(db, tenantId, convoId, { provider, body, mediaUrl = null, errorReason }) {
  try {
    return svc.addMessage(db, tenantId, convoId, {
      direction: 'outgoing',
      provider,
      body: body || '',
      mediaUrl,
      status: 'failed',
      byAdvisor: true,
      errorReason,
    });
  } catch (persistErr) {
    console.error('[conversations] no se pudo persistir el envío fallido:', persistErr.message);
    return null;
  }
}

// Reglas por provider — formatos y tamaños máximos que aceptan.
const MEDIA_RULES = {
  whatsapp: {
    image:    { maxBytes: 5  * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] },
    document: { maxBytes: 100 * 1024 * 1024, mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain'] },
    video:    { maxBytes: 16 * 1024 * 1024, mimes: ['video/mp4', 'video/3gpp'] },
    audio:    { maxBytes: 16 * 1024 * 1024, mimes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/webm'] },
  },
  'whatsapp-lite': {
    image:    { maxBytes: 16 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
    document: { maxBytes: 100 * 1024 * 1024, mimes: null },
    video:    { maxBytes: 16 * 1024 * 1024, mimes: ['video/mp4'] },
    audio:    { maxBytes: 16 * 1024 * 1024, mimes: ['audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/webm'] },
  },
  messenger: {
    image:    { maxBytes: 8 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/gif'] },
    video:    { maxBytes: 25 * 1024 * 1024, mimes: ['video/mp4'] },
    audio:    { maxBytes: 25 * 1024 * 1024, mimes: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm'] },
    document: { maxBytes: 25 * 1024 * 1024, mimes: null },
  },
  instagram: {
    image:    { maxBytes: 8 * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] },
    video:    { maxBytes: 25 * 1024 * 1024, mimes: ['video/mp4'] },
    audio:    { maxBytes: 25 * 1024 * 1024, mimes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'] },
    // Instagram NO permite document
  },
  telegram: {
    image:    { maxBytes: 10 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] },
    video:    { maxBytes: 50 * 1024 * 1024, mimes: ['video/mp4'] },
    audio:    { maxBytes: 50 * 1024 * 1024, mimes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'] },
    document: { maxBytes: 50 * 1024 * 1024, mimes: null },
  },
};

function detectMediaType(mimetype) {
  if (!mimetype) return null;
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

module.exports = function createConversationsRouter(db) {
  const router = express.Router();
  // Carpeta para guardar adjuntos del chat (espejo local; lo enviado va por API
  // de Meta/Baileys directamente — guardamos copia para mostrar en el chat propio).
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
  const chatMediaDir = path.join(uploadsDir, 'chat-media');
  if (!fs.existsSync(chatMediaDir)) fs.mkdirSync(chatMediaDir, { recursive: true });
  const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

  // GET /api/conversations
  router.get('/', (req, res) => {
    const { q, provider, providersIn, unread, page, pageSize, contactId, pipelineIds, includeOrphans } = req.query;
    const parsedPipelineIds = pipelineIds
      ? pipelineIds.split(',').map(Number).filter(n => n > 0)
      : null;
    // providersIn = "gmail,outlook,icloud_mail" → array, evita N requests paralelos.
    const parsedProviderList = providersIn
      ? String(providersIn).split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const result = svc.list(db, req.tenantId, {
      search:         q || '',
      provider:       parsedProviderList || provider || '',
      unreadOnly:     unread === '1',
      contactId:      contactId ? Number(contactId) : null,
      page:           Number(page) || 1,
      pageSize:       Number(pageSize) || 50,
      pipelineIds:    parsedPipelineIds,
      includeOrphans: includeOrphans === '1',
    });
    result.totalAll    = db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?').get(req.tenantId).n;
    result.totalUnread = db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND unread_count > 0').get(req.tenantId).n;
    res.json(result);
  });

  // GET /api/conversations/:id
  router.get('/:id', (req, res) => {
    const convo = svc.getById(db, req.tenantId, Number(req.params.id));
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada', errorCode: 'CONVERSATION_NOT_FOUND' });
    res.json(convo);
  });

  // GET /api/conversations/:id/messages
  router.get('/:id/messages', (req, res) => {
    const { page, pageSize } = req.query;
    const result = svc.listMessages(db, req.tenantId, Number(req.params.id), {
      page:     Number(page) || 1,
      pageSize: Number(pageSize) || 60,
    });
    res.json(result);
  });

  router.patch('/:id/read', (req, res) => {
    svc.markRead(db, req.tenantId, Number(req.params.id));
    res.json({ ok: true });
  });

  router.patch('/:id/unread', (req, res) => {
    svc.markUnread(db, req.tenantId, Number(req.params.id));
    res.json({ ok: true });
  });

  router.patch('/:id/pin', (req, res) => {
    svc.setPinned(db, req.tenantId, Number(req.params.id), !!req.body?.pinned);
    res.json({ ok: true });
  });

  router.patch('/:id/archive', (req, res) => {
    svc.setArchived(db, req.tenantId, Number(req.params.id), !!req.body?.archived);
    res.json({ ok: true });
  });

  router.patch('/:id/mute', (req, res) => {
    const until = req.body?.until ? Number(req.body.until) : null;
    svc.setMutedUntil(db, req.tenantId, Number(req.params.id), until);
    res.json({ ok: true });
  });

  router.patch('/:id/bot-paused', (req, res) => {
    const { paused } = req.body;
    svc.setBotPaused(db, req.tenantId, Number(req.params.id), !!paused);
    res.json({ ok: true, paused: !!paused });
  });

  router.post('/:id/send-template', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, req.tenantId, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada', errorCode: 'CONVERSATION_NOT_FOUND' });

    const { templateId, manualValues = [] } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId requerido', errorCode: 'TEMPLATE_ID_REQUIRED' });
    if (convo.provider !== 'whatsapp') {
      return res.status(400).json({ error: 'Solo se pueden enviar templates wa_api en conversaciones whatsapp', errorCode: 'TEMPLATE_PROVIDER_MISMATCH' });
    }

    try {
      const result = await sendWhatsAppTemplate(db, convo, templateId, manualValues);
      const msg = svc.addMessage(db, req.tenantId, convoId, {
        externalId: result.externalId,
        direction:  'outgoing',
        provider:   'whatsapp',
        body:       result.renderedBody,
        status:     'sent',
        byAdvisor:  true,
      });
      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando template:', err.message);
      const failed = _persistFailedSend(db, req.tenantId, convoId, {
        provider: 'whatsapp',
        body: `📋 Plantilla #${templateId} (no enviada)`,
        errorReason: err.message,
      });
      res.status(500).json({ error: err.message, failedMessage: failed });
    }
  });

  router.post('/:id/media', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, req.tenantId, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada', errorCode: 'CONVERSATION_NOT_FOUND' });

    try {
      const { data, mimetype, filename, caption } = req.body || {};
      if (!data || !mimetype) return res.status(400).json({ error: 'data y mimetype son requeridos', errorCode: 'MEDIA_DATA_REQUIRED' });

      const cleanB64 = String(data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'Archivo vacío', errorCode: 'FILE_EMPTY' });

      // ─── Validación de magic bytes ───
      // El mimetype declarado por el cliente NO es confiable. Verificamos el
      // contenido real con file-type para detectar archivos disfrazados
      // (ej. .exe con extensión .jpg, o HTML/JS embebido en SVG).
      // Lista de MIME types confiables que aceptamos.
      const ALLOWED_MIMES = new Set([
        // Imágenes
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        // Video
        'video/mp4', 'video/webm', 'video/quicktime',
        // Audio
        'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm',
        // Documents
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/csv',
        // Archivos comprimidos comunes que sí son útiles compartir
        'application/zip',
      ]);
      try {
        const fileTypeModule = await import('file-type');
        const detected = await fileTypeModule.fileTypeFromBuffer(buffer);
        // Archivos de texto plano (CSV/TXT) NO tienen magic bytes — los aceptamos
        // solo si el mimetype declarado es text/plain o text/csv y el tamaño es chico.
        const isPlainText = !detected && (mimetype === 'text/plain' || mimetype === 'text/csv') && buffer.length < 10 * 1024 * 1024;
        if (!isPlainText) {
          if (!detected) {
            return res.status(400).json({ error: 'No se pudo detectar el tipo real del archivo. Sube un formato válido (imagen, video, PDF, etc.).', errorCode: 'FILE_TYPE_UNKNOWN' });
          }
          if (!ALLOWED_MIMES.has(detected.mime)) {
            return res.status(400).json({ error: `Tipo de archivo no permitido: ${detected.mime}. Permitidos: imágenes, video, audio, PDF, Office, ZIP.`, errorCode: 'FILE_TYPE_NOT_ALLOWED' });
          }
          if (detected.mime !== mimetype && !(mimetype === 'video/mp4' && detected.mime === 'video/x-m4v')) {
            // El cliente mintió sobre el mimetype → reescribimos al detectado real
            // No bloqueamos (puede ser variación válida como image/jpg vs image/jpeg)
            // pero usamos el detectado de aquí en adelante.
            console.warn(`[upload] mimetype declarado "${mimetype}" no matchea detectado "${detected.mime}" — usando el detectado`);
          }
        }
      } catch (ftErr) {
        console.error('[upload] file-type validation error:', ftErr.message);
        return res.status(500).json({ error: 'Error validando archivo', errorCode: 'FILE_VALIDATION_ERROR' });
      }

      const mediaType = detectMediaType(mimetype);
      const rules = MEDIA_RULES[convo.provider]?.[mediaType];
      if (!rules) {
        return res.status(400).json({ error: `${convo.provider} no soporta enviar archivos de tipo ${mediaType}`, errorCode: 'MEDIA_TYPE_UNSUPPORTED' });
      }
      if (rules.mimes && !rules.mimes.includes(mimetype)) {
        return res.status(400).json({ error: `Formato ${mimetype} no aceptado por ${convo.provider}. Permitidos: ${rules.mimes.join(', ')}`, errorCode: 'MEDIA_MIME_NOT_ACCEPTED' });
      }
      if (buffer.length > rules.maxBytes) {
        const maxMb = (rules.maxBytes / 1024 / 1024).toFixed(0);
        const myMb  = (buffer.length / 1024 / 1024).toFixed(1);
        return res.status(400).json({ error: `Archivo de ${myMb}MB excede el máximo (${maxMb}MB) para ${mediaType} en ${convo.provider}`, errorCode: 'MEDIA_SIZE_EXCEEDED' });
      }

      // Guardar copia local para mostrar en el chat propio
      const ext = (filename || '').match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]
                || mimetype.split('/')[1]?.split(';')[0]
                || 'bin';
      const localName = `c${convoId}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      fs.writeFileSync(path.join(chatMediaDir, localName), buffer);
      const localUrl = `/uploads/chat-media/${localName}`;

      // Enviar al destinatario por el provider correspondiente.
      // Messenger e Instagram requieren URL pública — usamos la URL local
      // expuesta por cloudflared via APP_BASE_URL.
      let externalMsgId = null;
      const publicUrl = APP_BASE_URL ? `${APP_BASE_URL}${localUrl}` : null;
      if (convo.provider === 'whatsapp') {
        externalMsgId = await sendWhatsAppMedia(db, convo, { buffer, mimetype, filename, caption, mediaType });
      } else if (convo.provider === 'whatsapp-lite') {
        externalMsgId = await sendWhatsAppLiteMedia(db, convo, { buffer, mimetype, filename, caption, mediaType });
      } else if (convo.provider === 'messenger') {
        if (!publicUrl) return res.status(500).json({ error: 'APP_BASE_URL no configurado — Messenger requiere URL pública' });
        externalMsgId = await sendMessengerMedia(db, convo, { publicUrl, mediaType });
        if (caption) {
          // Messenger no soporta caption en el attachment; mandar texto aparte
          try { await require('./sender').sendMessenger(db, convo, caption); } catch (_) {}
        }
      } else if (convo.provider === 'instagram') {
        if (!publicUrl) return res.status(500).json({ error: 'APP_BASE_URL no configurado — Instagram requiere URL pública' });
        externalMsgId = await sendInstagramMedia(db, convo, { publicUrl, mediaType });
        if (caption) {
          try { await require('./sender').sendInstagram(db, convo, caption); } catch (_) {}
        }
      } else if (convo.provider === 'telegram') {
        externalMsgId = await sendTelegramMedia(db, convo, { buffer, mimetype, filename, caption, mediaType });
      } else {
        return res.status(400).json({ error: `Envío de archivos para ${convo.provider} aún no implementado` });
      }

      const msg = svc.addMessage(db, req.tenantId, convoId, {
        externalId: externalMsgId,
        direction:  'outgoing',
        provider:   convo.provider,
        body:       caption || '',
        mediaUrl:   localUrl,
        status:     'sent',
        byAdvisor:  true,
      });
      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando media:', err.message);
      const failed = _persistFailedSend(db, req.tenantId, convoId, {
        provider: convo.provider,
        body: (req.body && req.body.caption) || '📎 Archivo (no enviado)',
        errorReason: err.message,
      });
      res.status(500).json({ error: err.message, failedMessage: failed });
    }
  });

  router.post('/:id/messages', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, req.tenantId, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada', errorCode: 'CONVERSATION_NOT_FOUND' });

    const { body, clientTs } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío', errorCode: 'MESSAGE_EMPTY' });

    // ─── Candado anti-atorados ─────────────────────────────────────
    // Caso real (Dora 11-jun): un envío desde otro dispositivo quedó atorado
    // (PWA suspendida / conexión flaky) y el navegador lo completó 17 MINUTOS
    // tarde — aterrizó como "respuesta" a una pregunta nueva, fuera de
    // contexto. Si el composer manda clientTs (hora en que se escribió) y el
    // request llega >3 min tarde, se rechaza con aviso en vez de enviarse.
    if (clientTs && Number(clientTs) > 0) {
      const ageMin = (Date.now() - Number(clientTs)) / 60000;
      if (ageMin > 3) {
        console.warn(`[conversations] envío descartado por viejo (${ageMin.toFixed(1)} min) convo ${convoId}`);
        return res.status(409).json({
          error: `Mensaje descartado: se escribió hace ${Math.round(ageMin)} min (request atorado de otra sesión). Si aún aplica, envíalo de nuevo.`,
          errorCode: 'STALE_SEND',
        });
      }
    }

    // ─── Candado anti-doble-tap ────────────────────────────────────
    // Texto idéntico al último saliente hace <2 min y SIN mensaje entrante en
    // medio = doble envío accidental (pasó 2 veces el 11-jun por conexión lenta).
    try {
      const last = db.prepare(
        'SELECT direction, body, created_at FROM messages WHERE conversation_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
      ).get(convoId, req.tenantId);
      if (last && last.direction === 'outgoing' && (last.body || '') === body.trim()
          && (Math.floor(Date.now() / 1000) - last.created_at) < 120) {
        return res.status(409).json({
          error: 'Este mensaje es idéntico al que acabas de enviar — se descartó para no duplicar.',
          errorCode: 'DUPLICATE_SEND',
        });
      }
    } catch (_) { /* guard best-effort */ }

    try {
      const externalMsgId = await sendMessage(db, convo, body.trim());

      const msg = svc.addMessage(db, req.tenantId, convoId, {
        externalId: externalMsgId,
        direction:  'outgoing',
        provider:   convo.provider,
        body:       body.trim(),
        status:     'sent',
        byAdvisor:  true,
      });

      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando mensaje:', err.message);
      const failed = _persistFailedSend(db, req.tenantId, convoId, {
        provider: convo.provider,
        body: body.trim(),
        errorReason: err.message,
      });
      res.status(500).json({ error: err.message, failedMessage: failed });
    }
  });

  // POST /cross-channel-send
  // Manda un mensaje al contacto usando UNA integración específica (no
  // necesariamente la de la conversación actual). Si el contacto NO tiene
  // convo con esa integración, la crea. Si SÍ tiene, manda ahí.
  //
  // Body: { contactId, integrationId, body }
  // Response: { message, conversation, created } — created=true si la convo
  // se creó nueva, false si reutilizó una existente.
  router.post('/cross-channel-send', async (req, res) => {
    const { contactId, integrationId, body, clientTs } = req.body || {};
    if (!contactId)     return res.status(400).json({ error: 'contactId requerido' });
    if (!integrationId) return res.status(400).json({ error: 'integrationId requerido' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'body vacío' });

    // Candado anti-atorados (mismo que /:id/messages — ver comentario ahí)
    if (clientTs && Number(clientTs) > 0) {
      const ageMin = (Date.now() - Number(clientTs)) / 60000;
      if (ageMin > 3) {
        console.warn(`[conversations] cross-channel descartado por viejo (${ageMin.toFixed(1)} min) contacto ${contactId}`);
        return res.status(409).json({
          error: `Mensaje descartado: se escribió hace ${Math.round(ageMin)} min (request atorado de otra sesión). Si aún aplica, envíalo de nuevo.`,
          errorCode: 'STALE_SEND',
        });
      }
    }

    // Validar contacto pertenece al tenant
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, req.tenantId);
    if (!contact) return res.status(404).json({ error: 'contacto no encontrado' });

    // Validar integración pertenece al tenant y está conectada
    const integ = db.prepare("SELECT * FROM integrations WHERE id = ? AND tenant_id = ? AND status = 'connected'").get(integrationId, req.tenantId);
    if (!integ) return res.status(404).json({ error: 'integración no encontrada o desconectada' });

    // Buscar convo existente del contacto con esa integración
    let convo = db.prepare(`
      SELECT * FROM conversations
      WHERE tenant_id = ? AND contact_id = ? AND integration_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(req.tenantId, contactId, integrationId);
    let created = false;

    if (!convo) {
      // Necesitamos un external_id para crear la convo. Para WhatsApp es el
      // teléfono del contacto. Para Messenger/IG/Telegram el contacto debe
      // haber escrito antes (no podemos iniciar conversación si no nos
      // dieron permiso vía mensaje previo en ese canal).
      const waProviders = ['whatsapp', 'whatsapp-lite'];
      if (!waProviders.includes(integ.provider)) {
        return res.status(400).json({
          error: `No se puede iniciar conversación en ${integ.provider} sin mensaje previo del contacto`,
          errorCode: 'PROVIDER_REQUIRES_INBOUND',
        });
      }
      if (!contact.phone) {
        return res.status(400).json({ error: 'el contacto no tiene teléfono' });
      }
      try {
        convo = svc.findOrCreate(db, req.tenantId, {
          provider:      integ.provider,
          externalId:    contact.phone,
          integrationId: integ.id,
          contactId:     contact.id,
          contactPhone:  contact.phone,
          contactName:   [contact.first_name, contact.last_name].filter(Boolean).join(' '),
        });
        created = true;
      } catch (err) {
        return res.status(500).json({ error: 'error creando conversación: ' + err.message });
      }
    }

    // Candado anti-doble-tap (texto idéntico al último saliente <2 min)
    try {
      const last = db.prepare(
        'SELECT direction, body, created_at FROM messages WHERE conversation_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
      ).get(convo.id, req.tenantId);
      if (last && last.direction === 'outgoing' && (last.body || '') === body.trim()
          && (Math.floor(Date.now() / 1000) - last.created_at) < 120) {
        return res.status(409).json({
          error: 'Este mensaje es idéntico al que acabas de enviar — se descartó para no duplicar.',
          errorCode: 'DUPLICATE_SEND',
        });
      }
    } catch (_) { /* guard best-effort */ }

    try {
      const externalMsgId = await sendMessage(db, convo, body.trim());
      const msg = svc.addMessage(db, req.tenantId, convo.id, {
        externalId: externalMsgId,
        direction:  'outgoing',
        provider:   convo.provider,
        body:       body.trim(),
        status:     'sent',
        byAdvisor:  true,
      });
      res.json({ message: msg, conversation: convo, created });
    } catch (err) {
      console.error('[conversations] cross-channel send error:', err.message);
      // La convo puede ser recién creada; NO se borra: con el mensaje failed
      // dentro ya no es "fantasma" — muestra exactamente qué pasó.
      const failed = _persistFailedSend(db, req.tenantId, convo.id, {
        provider: convo.provider,
        body: body.trim(),
        errorReason: err.message,
      });
      res.status(500).json({ error: err.message, failedMessage: failed, conversation: convo, created });
    }
  });

  return router;
};
