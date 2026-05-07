// IMAP poller — revisa la bandeja de entrada de cada integración de email
// cada POLL_INTERVAL ms y convierte correos nuevos en mensajes del CRM.

const { ImapFlow } = require('imapflow');
const { decryptJson } = require('../../security/crypto');

const POLL_INTERVAL = 3 * 60 * 1000; // 3 minutos
const INITIAL_FETCH = 30; // al conectar por primera vez, solo los últimos N correos

let _db = null;
let _timer = null;

function start(db) {
  _db = db;
  poll();
  _timer = setInterval(poll, POLL_INTERVAL);
  console.log('[email-poller] iniciado (intervalo 3 min)');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function poll() {
  if (!_db) return;
  const integrations = _db.prepare(
    "SELECT * FROM integrations WHERE provider = 'email' AND status = 'connected'"
  ).all();
  for (const row of integrations) {
    try {
      await pollOne(row);
    } catch (err) {
      console.error(`[email-poller] error en integración ${row.id}:`, err.message);
    }
  }
}

async function pollOne(row) {
  const creds = decryptJson(row.credentials_enc);
  if (!creds) return;
  const { username, password, imapHost, imapPort } = creds;
  if (!username || !password || !imapHost) return;

  const client = new ImapFlow({
    host: imapHost,
    port: Number(imapPort) || 993,
    secure: Number(imapPort) !== 143 && Number(imapPort) !== 587,
    auth: { user: username, pass: password },
    logger: false,
    connectionTimeout: 15000,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const stateRow = _db.prepare('SELECT last_uid FROM email_imap_state WHERE integration_id = ?').get(row.id);
      const lastUid = stateRow?.last_uid || 0;

      let searchCriteria;
      if (lastUid === 0) {
        // Primera vez: solo los últimos N mensajes
        const status = await client.status('INBOX', { messages: true });
        const total = status.messages || 0;
        const seq = Math.max(1, total - INITIAL_FETCH + 1);
        searchCriteria = { seq: `${seq}:*` };
      } else {
        searchCriteria = { uid: `${lastUid + 1}:*` };
      }

      const msgs = [];
      for await (const msg of client.fetch(searchCriteria, {
        uid: true, envelope: true, bodyStructure: true,
        bodyParts: ['text'],
      })) {
        msgs.push(msg);
      }

      if (!msgs.length) return;

      // Importamos aquí para evitar dependencia circular al arrancar
      const convoSvc = require('../conversations/service');
      const { pushIncomingMessage } = require('../integrations/webhooks').getPushFn?.() || {};

      let maxUid = lastUid;
      for (const msg of msgs) {
        const uid = msg.uid;
        if (uid <= lastUid) continue;
        if (uid > maxUid) maxUid = uid;

        const env = msg.envelope || {};
        const from = env.from?.[0] || {};
        const senderEmail = from.address || '';
        if (!senderEmail) continue;

        const senderName = from.name || senderEmail;
        const subject = env.subject || '(Sin asunto)';
        const bodyPart = msg.bodyParts?.get('text') || msg.bodyParts?.get('TEXT');
        const rawBody = bodyPart ? bodyPart.toString('utf8') : '';
        const body = `📧 ${subject}\n\n${cleanEmailBody(rawBody)}`.trim();

        const tenantId = row.tenant_id;

        // Buscar o crear contacto por email
        let contact = _db.prepare('SELECT * FROM contacts WHERE email = ? AND tenant_id = ?').get(senderEmail, tenantId);
        if (!contact) {
          const parts = senderName.split(/\s+/);
          const result = _db.prepare(
            'INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES (?, ?, ?, ?)'
          ).run(tenantId, parts[0] || senderEmail, parts.slice(1).join(' ') || null, senderEmail);
          contact = _db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
        }

        const convo = convoSvc.findOrCreate(_db, tenantId, {
          provider:      'email',
          externalId:    senderEmail,
          integrationId: row.id,
          contactPhone:  null,
          contactName:   senderName,
        });

        // Asignar contact_id si falta
        if (!convo.contact_id && contact?.id) {
          _db.prepare('UPDATE conversations SET contact_id = ? WHERE id = ?').run(contact.id, convo.id);
        }

        const msgId = `email-${row.id}-${uid}`;
        convoSvc.addMessage(_db, tenantId, convo.id, {
          externalId: msgId,
          direction:  'incoming',
          provider:   'email',
          body,
          status:     'delivered',
          createdAt:  Math.floor((env.date?.getTime() || Date.now()) / 1000),
        });
      }

      // Persistir último UID procesado
      if (maxUid > lastUid) {
        _db.prepare(`
          INSERT INTO email_imap_state (integration_id, last_uid, updated_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT(integration_id) DO UPDATE SET last_uid = excluded.last_uid, updated_at = excluded.updated_at
        `).run(row.id, maxUid);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

function cleanEmailBody(text) {
  if (!text) return '';
  // Eliminar quoted replies (líneas que empiezan con >)
  return text
    .split('\n')
    .filter(l => !l.startsWith('>'))
    .join('\n')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

module.exports = { start, stop };
