// Provider: Telegram Bot API.
// Setup: habla con @BotFather → /newbot → copia el token → pégalo aquí.
// El webhook se registra automáticamente al conectar.

async function setWebhook(botToken, webhookUrl, secret) {
  const params = new URLSearchParams({ url: webhookUrl, allowed_updates: JSON.stringify(['message', 'callback_query']) });
  if (secret) params.set('secret_token', secret);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?${params}`);
  return res.json();
}

module.exports = {
  meta: {
    key: 'telegram',
    name: 'Telegram',
    description: 'Conecta un bot de Telegram para recibir y responder mensajes.',
    color: '#0088cc',
    initial: 'T',
    docsUrl: 'https://core.telegram.org/bots/api',
    setupSteps: [
      'Abre Telegram y busca <b>@BotFather</b>',
      'Escribe <code>/newbot</code> y sigue las instrucciones',
      'Copia el token que te da (formato: <code>123456:ABCdef…</code>)',
      'Pégalo aquí — el webhook se registra automáticamente',
    ],
    webhooks: {
      events: ['message', 'callback_query'],
      signatureHeader: 'x-telegram-bot-api-secret-token',
    }
  },
  fields: [
    {
      key: 'botToken',
      label: 'Bot Token',
      type: 'password',
      required: true,
      secret: true,
      help: 'Lo obtienes de @BotFather → /newbot (formato 123456:ABCdef…)',
    },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret (opcional)',
      type: 'password',
      required: false,
      secret: true,
      help: 'String que tú eliges para verificar que los updates vienen de Telegram. Recomendado.',
    },
  ],
  async test({ credentials }) {
    const { botToken } = credentials;
    if (!botToken) return { ok: false, message: 'Falta el Bot Token' };
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      return { ok: false, message: 'Token con formato inválido (debe ser "123456789:ABC...")' };
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await res.json();
      if (!data.ok) return { ok: false, message: data.description || `HTTP ${res.status}` };
      const bot = data.result;
      return {
        ok: true,
        displayName: bot.username ? `@${bot.username}` : bot.first_name,
        externalId: String(bot.id),
        details: { firstName: bot.first_name, username: bot.username },
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  },
  setWebhook,
};
