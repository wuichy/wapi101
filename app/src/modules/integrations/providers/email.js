// Provider: Email IMAP/SMTP
// Soporta Gmail, Outlook, Yahoo, iCloud y cualquier servidor SMTP/IMAP genérico.
// Gmail y Outlook requieren "Contraseña de aplicación" (no la contraseña normal).

const PRESETS = {
  'gmail.com':        { imapHost: 'imap.gmail.com',            imapPort: 993, smtpHost: 'smtp.gmail.com',               smtpPort: 587 },
  'googlemail.com':   { imapHost: 'imap.gmail.com',            imapPort: 993, smtpHost: 'smtp.gmail.com',               smtpPort: 587 },
  'outlook.com':      { imapHost: 'outlook.office365.com',     imapPort: 993, smtpHost: 'smtp.office365.com',           smtpPort: 587 },
  'hotmail.com':      { imapHost: 'outlook.office365.com',     imapPort: 993, smtpHost: 'smtp.office365.com',           smtpPort: 587 },
  'live.com':         { imapHost: 'outlook.office365.com',     imapPort: 993, smtpHost: 'smtp.office365.com',           smtpPort: 587 },
  'yahoo.com':        { imapHost: 'imap.mail.yahoo.com',       imapPort: 993, smtpHost: 'smtp.mail.yahoo.com',          smtpPort: 465 },
  'yahoo.com.mx':     { imapHost: 'imap.mail.yahoo.com',       imapPort: 993, smtpHost: 'smtp.mail.yahoo.com',          smtpPort: 465 },
  'icloud.com':       { imapHost: 'imap.mail.me.com',          imapPort: 993, smtpHost: 'smtp.mail.me.com',             smtpPort: 587 },
  'me.com':           { imapHost: 'imap.mail.me.com',          imapPort: 993, smtpHost: 'smtp.mail.me.com',             smtpPort: 587 },
  'proton.me':        { imapHost: '127.0.0.1',                 imapPort: 1143, smtpHost: '127.0.0.1',                  smtpPort: 1025, note: 'Requiere Proton Mail Bridge instalado localmente.' },
};

module.exports = {
  meta: {
    key: 'email',
    name: 'Email (IMAP/SMTP)',
    description: 'Recibe y responde correos desde Gmail, Outlook, Yahoo o cualquier servidor de correo.',
    color: '#6366f1',
    initial: '@',
    authType: 'manual',
    docsUrl: 'https://support.google.com/accounts/answer/185833',
    setupSteps: [
      'Ingresa tu dirección de correo — los servidores se llenarán automáticamente.',
      '<b>Gmail/Outlook:</b> necesitas una <b>Contraseña de aplicación</b>, no tu contraseña normal. <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener">Cómo generarla →</a>',
      'Para servidores personalizados, llena manualmente los campos IMAP y SMTP.',
    ],
    presets: PRESETS,
  },
  fields: [
    { key: 'fromName',  label: 'Nombre del remitente', type: 'text',     required: true,  help: 'Ej: "Soporte Wapi101"' },
    { key: 'fromEmail', label: 'Correo electrónico',   type: 'text',     required: true,  help: 'tu@dominio.com' },
    { key: 'username',  label: 'Usuario IMAP/SMTP',    type: 'text',     required: true,  help: 'Generalmente igual al correo' },
    { key: 'password',  label: 'Contraseña de aplicación', type: 'password', required: true, secret: true,
      help: 'Gmail/Outlook: usa una contraseña de aplicación (no tu contraseña normal).' },
    { key: 'imapHost',  label: 'Servidor IMAP',        type: 'text',     required: true,  help: 'ej: imap.gmail.com' },
    { key: 'imapPort',  label: 'Puerto IMAP',          type: 'text',     required: true,  help: '993 (SSL) o 143 (STARTTLS)' },
    { key: 'smtpHost',  label: 'Servidor SMTP',        type: 'text',     required: true,  help: 'ej: smtp.gmail.com' },
    { key: 'smtpPort',  label: 'Puerto SMTP',          type: 'text',     required: true,  help: '587 (STARTTLS) o 465 (SSL)' },
  ],
  async test({ credentials }) {
    const { fromEmail, username, password, imapHost, imapPort } = credentials;
    if (!fromEmail || !username || !password || !imapHost || !imapPort) {
      return { ok: false, message: 'Completa todos los campos requeridos' };
    }
    try {
      const { ImapFlow } = require('imapflow');
      const client = new ImapFlow({
        host: imapHost,
        port: Number(imapPort),
        secure: Number(imapPort) === 993,
        auth: { user: username, pass: password },
        logger: false,
        connectionTimeout: 10000,
      });
      await client.connect();
      await client.logout();
      return { ok: true, displayName: fromEmail, externalId: fromEmail };
    } catch (err) {
      return { ok: false, message: `Error IMAP: ${err.message}` };
    }
  },
};
