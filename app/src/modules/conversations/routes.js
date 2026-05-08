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
    const { q, provider, unread, page, pageSize, contactId, pipelineIds, includeOrphans } = req.query;
    const parsedPipelineIds = pipelineIds
      ? pipelineIds.split(',').map(Number).filter(n => n > 0)
      : null;
    const result = svc.list(db, req.tenantId, {
      search:         q || '',
      provider:       provider || '',
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
    if (!convo) return res.status(404).json({ error: 'No encontrado' });
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
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { templateId, manualValues = [] } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId requerido' });
    if (convo.provider !== 'whatsapp') {
      return res.status(400).json({ error: 'Solo se pueden enviar templates wa_api en conversaciones whatsapp' });
    }

    try {
      const result = await sendWhatsAppTemplate(db, convo, templateId, manualValues);
      const msg = svc.addMessage(db, req.tenantId, convoId, {
        externalId: result.externalId,
        direction:  'outgoing',
        provider:   'whatsapp',
        body:       result.renderedBody,
        status:     'sent',
      });
      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando template:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/media', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, req.tenantId, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });

    try {
      const { data, mimetype, filename, caption } = req.body || {};
      if (!data || !mimetype) return res.status(400).json({ error: 'data y mimetype son requeridos' });

      const cleanB64 = String(data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'Archivo vacío' });

      const mediaType = detectMediaType(mimetype);
      const rules = MEDIA_RULES[convo.provider]?.[mediaType];
      if (!rules) {
        return res.status(400).json({ error: `${convo.provider} no soporta enviar archivos de tipo ${mediaType}` });
      }
      if (rules.mimes && !rules.mimes.includes(mimetype)) {
        return res.status(400).json({ error: `Formato ${mimetype} no aceptado por ${convo.provider}. Permitidos: ${rules.mimes.join(', ')}` });
      }
      if (buffer.length > rules.maxBytes) {
        const maxMb = (rules.maxBytes / 1024 / 1024).toFixed(0);
        const myMb  = (buffer.length / 1024 / 1024).toFixed(1);
        return res.status(400).json({ error: `Archivo de ${myMb}MB excede el máximo (${maxMb}MB) para ${mediaType} en ${convo.provider}` });
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
      });
      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando media:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/messages', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, req.tenantId, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

    try {
      const externalMsgId = await sendMessage(db, convo, body.trim());

      const msg = svc.addMessage(db, req.tenantId, convoId, {
        externalId: externalMsgId,
        direction:  'outgoing',
        provider:   convo.provider,
        body:       body.trim(),
        status:     'sent',
      });

      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando mensaje:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
