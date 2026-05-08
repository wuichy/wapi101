// Provider: iCloud Mail — recibe y responde correos de @icloud.com / @me.com.
// Usa IMAP/SMTP de Apple con Contraseña de Aplicación (no la contraseña del Apple ID).
// Docs: https://support.apple.com/en-us/102654

const IMAP_HOST = 'imap.mail.me.com';
const IMAP_PORT = 993;
const SMTP_HOST = 'smtp.mail.me.com';
const SMTP_PORT = 587;

module.exports = {
  meta: {
    key: 'icloud_mail',
    name: 'iCloud Mail',
    description: 'Recibe y responde correos de tu cuenta @icloud.com o @me.com directamente desde el CRM.',
    color: '#1c1c1e',
    textColor: '#ffffff',
    initial: '🍎',
    authType: 'manual',
    category: 'email',
    docsUrl: 'https://support.apple.com/en-us/102654',
    setupSteps: [
      '🍎 Abre <a href="https://appleid.apple.com" target="_blank" rel="noopener"><b>appleid.apple.com</b></a> en una pestaña nueva e inicia sesión con tu Apple ID.',
      'En el menú izquierdo haz clic en <b>Sign‑In and Security</b> (o "Acceso con Apple ID").',
      'Baja hasta la sección <b>App‑Specific Passwords</b> y haz clic en ella.',
      'Clic en el botón <b>+</b> (o "Generate an App‑Specific Password"), escribe un nombre como <i>"Wapi101"</i> y presiona <b>Create</b>.',
      'Apple te mostrará una contraseña con formato <code>xxxx-xxxx-xxxx-xxxx</code>. <b>Cópiala ahora</b> — solo se muestra una vez.',
      'Regresa aquí y pégala en el campo <b>Contraseña de aplicación</b>. <b>No uses tu contraseña normal del Apple ID</b>, Apple la rechazará.',
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
      label: 'Correo iCloud',
      type: 'text',
      required: true,
      help: 'tu@icloud.com o tu@me.com',
    },
    {
      key: 'appPassword',
      label: 'Contraseña de aplicación',
      type: 'password',
      required: true,
      secret: true,
      help: 'Genera una en appleid.apple.com → Contraseñas de aplicación. NO uses tu contraseña del Apple ID.',
    },
  ],
  async test({ credentials }) {
    const { fromEmail, appPassword } = credentials;
    if (!fromEmail || !appPassword) {
      return { ok: false, message: 'Completa el correo y la contraseña de aplicación.' };
    }
    const email = fromEmail.trim().toLowerCase();
    if (!email.endsWith('@icloud.com') && !email.endsWith('@me.com') && !email.endsWith('@mac.com')) {
      return { ok: false, message: 'El correo debe ser @icloud.com, @me.com o @mac.com.' };
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
      if (msg.includes('Invalid credentials') || msg.includes('AUTHENTICATIONFAILED')) {
        return { ok: false, message: 'Credenciales incorrectas. Verifica que usas una Contraseña de aplicación (no tu contraseña del Apple ID).' };
      }
      return { ok: false, message: `Error IMAP: ${msg}` };
    }
  },

  // Normaliza credenciales al guardar — inyecta los servidores fijos para que
  // el poller y el sender los usen igual que el provider genérico de email.
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
