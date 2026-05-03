const express = require('express');
const path = require('path');
const fs = require('fs');
const svc = require('./service');
const { sendMessage, sendWhatsAppTemplate, sendWhatsAppMedia, sendWhatsAppLiteMedia } = require('./sender');

// Reglas por provider — formatos y tamaños máximos que aceptan.
const MEDIA_RULES = {
  whatsapp: {
    image:    { maxBytes: 5  * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] },
    document: { maxBytes: 100 * 1024 * 1024, mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain'] },
    video:    { maxBytes: 16 * 1024 * 1024, mimes: ['video/mp4', 'video/3gpp'] },
    audio:    { maxBytes: 16 * 1024 * 1024, mimes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'] },
  },
  'whatsapp-lite': {
    image:    { maxBytes: 16 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
    document: { maxBytes: 100 * 1024 * 1024, mimes: null },
    video:    { maxBytes: 16 * 1024 * 1024, mimes: ['video/mp4'] },
    audio:    { maxBytes: 16 * 1024 * 1024, mimes: ['audio/ogg', 'audio/mp4', 'audio/mpeg'] },
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
    const { q, provider, unread, page, pageSize, contactId } = req.query;
    const result = svc.list(db, {
      search:     q || '',
      provider:   provider || '',
      unreadOnly: unread === '1',
      contactId:  contactId ? Number(contactId) : null,
      page:       Number(page) || 1,
      pageSize:   Number(pageSize) || 50,
    });
    // Siempre incluir totales globales (sin filtro) para los badges
    result.totalAll    = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
    result.totalUnread = db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE unread_count > 0').get().n;
    res.json(result);
  });

  // GET /api/conversations/:id
  router.get('/:id', (req, res) => {
    const convo = svc.getById(db, Number(req.params.id));
    if (!convo) return res.status(404).json({ error: 'No encontrado' });
    res.json(convo);
  });

  // GET /api/conversations/:id/messages
  router.get('/:id/messages', (req, res) => {
    const { page, pageSize } = req.query;
    const result = svc.listMessages(db, Number(req.params.id), {
      page:     Number(page) || 1,
      pageSize: Number(pageSize) || 60,
    });
    res.json(result);
  });

  // PATCH /api/conversations/:id/read
  router.patch('/:id/read', (req, res) => {
    svc.markRead(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // PATCH /api/conversations/:id/bot-paused
  router.patch('/:id/bot-paused', (req, res) => {
    const { paused } = req.body;
    svc.setBotPaused(db, Number(req.params.id), !!paused);
    res.json({ ok: true, paused: !!paused });
  });

  // POST /api/conversations/:id/send-template — enviar plantilla wa_api APROBADA
  // Body: { templateId, manualValues?: [..valores para los placeholders Manual..] }
  // El sender resuelve los mapeados (contactField) leyendo el contacto.
  router.post('/:id/send-template', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { templateId, manualValues = [] } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId requerido' });
    if (convo.provider !== 'whatsapp') {
      return res.status(400).json({ error: 'Solo se pueden enviar templates wa_api en conversaciones whatsapp' });
    }

    try {
      const result = await sendWhatsAppTemplate(db, convo, templateId, manualValues);
      // Guardar como mensaje saliente con el body renderizado
      const msg = svc.addMessage(db, convoId, {
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

  // POST /api/conversations/:id/media — enviar archivo (imagen/PDF/video/audio).
  // Body: { data: <base64>, mimetype, filename, caption? }
  router.post('/:id/media', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, convoId);
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

      // Enviar al destinatario por el provider correspondiente
      let externalMsgId = null;
      if (convo.provider === 'whatsapp') {
        externalMsgId = await sendWhatsAppMedia(db, convo, { buffer, mimetype, filename, caption, mediaType });
      } else if (convo.provider === 'whatsapp-lite') {
        externalMsgId = await sendWhatsAppLiteMedia(db, convo, { buffer, mimetype, filename, caption, mediaType });
      } else {
        return res.status(400).json({ error: `Envío de archivos para ${convo.provider} aún no implementado` });
      }

      const msg = svc.addMessage(db, convoId, {
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

  // POST /api/conversations/:id/messages — enviar mensaje saliente
  router.post('/:id/messages', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

    try {
      const externalMsgId = await sendMessage(db, convo, body.trim());

      const msg = svc.addMessage(db, convoId, {
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
