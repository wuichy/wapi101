// Provider: Yahoo Mail — recibe y responde correos de @yahoo.com, @yahoo.com.mx, @ymail.com, etc.
// Yahoo requiere Contraseña de aplicación cuando tiene verificación en 2 pasos activada.
// Docs: https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html

const IMAP_HOST = 'imap.mail.yahoo.com';
const IMAP_PORT = 993;
const SMTP_HOST = 'smtp.mail.yahoo.com';
const SMTP_PORT = 465;

const YAHOO_DOMAINS = ['yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.com.ar', 'yahoo.com.br', 'ymail.com', 'rocketmail.com'];

module.exports = {
  meta: {
    key: 'yahoo_mail',
    name: 'Yahoo Mail',
    description: 'Recibe y responde correos de tu cuenta Yahoo directamente desde el CRM.',
    color: '#6001D2',
    textColor: '#ffffff',
    initial: 'Y',
    authType: 'manual',
    category: 'email',
    docsUrl: 'https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html',
    setupSteps: [
      '🟣 Abre <a href="https://login.yahoo.com" target="_blank" rel="noopener"><b>login.yahoo.com</b></a> e inicia sesión con tu cuenta Yahoo.',
      'Haz clic en tu nombre/avatar (arriba a la derecha) → <b>Manage your account</b> → pestaña <b>Security</b>.',
      'Asegúrate de tener activada la <b>verificación en 2 pasos</b>. Si no la tienes, actívala primero — Yahoo la exige para generar contraseñas de app.',
      'En esa misma sección <b>Security</b>, baja hasta <b>Generate app password</b>, selecciona <b>Other App</b> en el menú, escribe <i>"Wapi101"</i> y haz clic en <b>Generate</b>.',
      'Yahoo te mostrará una contraseña de 16 caracteres. <b>Cópiala ahora</b> — solo aparece una vez.',
      'Regresa aquí y pégala en el campo <b>Contraseña de aplicación</b>. <b>No uses tu contraseña normal de Yahoo</b>, será rechazada.',
    ],
  },
  fields: [
    {
      key: 'fromName',
      label: 'Nombre del remitente',
      type: 'text',
      required: true,
      help: 'Ej: "Soporte Acme"',
    },
    {
      key: 'fromEmail',
      label: 'Correo Yahoo',
      type: 'text',
      required: true,
      help: 'tu@yahoo.com, tu@yahoo.com.mx, tu@ymail.com…',
    },
    {
      key: 'appPassword',
      label: 'Contraseña de aplicación',
      type: 'password',
      required: true,
      secret: true,
      help: 'Genérala en Yahoo → Security → Generate app password. NO uses tu contraseña normal de Yahoo.',
    },
  ],
  async test({ credentials }) {
    const { fromEmail, appPassword } = credentials;
    if (!fromEmail || !appPassword) {
      return { ok: false, message: 'Completa el correo y la contraseña de aplicación.' };
    }
    const email = fromEmail.trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!YAHOO_DOMAINS.includes(domain)) {
      return { ok: false, message: `Dominio no reconocido como Yahoo (${domain}). Usa @yahoo.com, @ymail.com, etc.` };
    }
    try {
      const { ImapFlow } = require('imapflow');
      const client = new ImapFlow({
        host: IMAP_HOST,
        port: IMAP_PORT,
        secure: true,
        auth: { user: email, pass: appPassword },
        logger: false,
        connectionTimeout: 12000,
      });
      await client.connect();
      await client.logout();
      return {
        ok: true,
        displayName: fromEmail,
        externalId: email,
      };
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('Invalid credentials') || msg.includes('AUTHENTICATIONFAILED') || msg.includes('[AUTH]')) {
        return { ok: false, message: 'Credenciales incorrectas. Asegúrate de usar una Contraseña de aplicación (no tu contraseña de Yahoo).' };
      }
      return { ok: false, message: `Error IMAP: ${msg}` };
    }
  },

  normalizeCredentials(raw) {
    return {
      fromName:  raw.fromName?.trim() || '',
      fromEmail: raw.fromEmail?.trim().toLowerCase() || '',
      username:  raw.fromEmail?.trim().toLowerCase() || '',
      password:  raw.appPassword || '',
      imapHost:  IMAP_HOST,
      imapPort:  IMAP_PORT,
      smtpHost:  SMTP_HOST,
      smtpPort:  SMTP_PORT,
    };
  },
};
