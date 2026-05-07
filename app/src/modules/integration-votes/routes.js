const express = require('express');
const COOLDOWN_DAYS = 15;
const COOLDOWN_SECS = COOLDOWN_DAYS * 86400;

const VALID_KEYS = new Set([
  'mailchimp','sendgrid','brevo','resend','mandrill','postmark','mailjet',
  'mercadopago','paypal','conekta','clip','openpay','kueskipay',
  'twilio','vonage','telnyx',
  'n8n','make','zapier','activepieces',
  'hubspot','pipedrive','zoho','salesforce',
  'tiendanube','prestashop','vtex','magento',
  'google_sheets','airtable','notion','trello',
  'google_calendar','calendly','cal',
  'slack','discord',
  'custom',
]);

module.exports = function createIntegrationVotesRouter(db) {
  const router = express.Router();

  // GET /api/integration-votes — totales + estado del advisor actual
  router.get('/', (req, res) => {
    const votes = db.prepare(`
      SELECT integration_key, custom_name, COUNT(*) AS total
      FROM integration_votes
      GROUP BY integration_key, custom_name
      ORDER BY total DESC
    `).all();

    const myLast = db.prepare(`
      SELECT integration_key, custom_name, voted_at
      FROM integration_votes WHERE advisor_id = ?
      ORDER BY voted_at DESC LIMIT 1
    `).get(req.advisor.id);

    const now = Math.floor(Date.now() / 1000);
    const canVote = !myLast || (now - myLast.voted_at) >= COOLDOWN_SECS;
    const nextVoteAt = myLast ? myLast.voted_at + COOLDOWN_SECS : 0;

    res.json({ votes, myLast: myLast || null, canVote, nextVoteAt });
  });

  // POST /api/integration-votes — emitir voto
  router.post('/', (req, res) => {
    const { key, customName } = req.body || {};
    if (!key || !VALID_KEYS.has(key)) {
      return res.status(400).json({ error: 'Integración inválida' });
    }
    if (key === 'custom' && (!customName || customName.trim().length < 2)) {
      return res.status(400).json({ error: 'Escribe el nombre de la integración' });
    }

    const myLast = db.prepare(`
      SELECT voted_at FROM integration_votes WHERE advisor_id = ?
      ORDER BY voted_at DESC LIMIT 1
    `).get(req.advisor.id);

    const now = Math.floor(Date.now() / 1000);
    if (myLast && (now - myLast.voted_at) < COOLDOWN_SECS) {
      const nextVoteAt = myLast.voted_at + COOLDOWN_SECS;
      return res.status(429).json({ error: `Puedes volver a votar el ${new Date(nextVoteAt * 1000).toLocaleDateString('es-MX')}`, nextVoteAt });
    }

    db.prepare(`
      INSERT INTO integration_votes (advisor_id, tenant_id, integration_key, custom_name)
      VALUES (?, ?, ?, ?)
    `).run(req.advisor.id, req.tenantId, key, key === 'custom' ? customName.trim() : null);

    res.json({ ok: true });
  });

  return router;
};
