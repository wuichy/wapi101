// Provider: Email IMAP/SMTP
// Soporta cualquier servidor. Hace autodiscover igual que iOS Mail:
// 1. Presets conocidos (Gmail, Outlook, Yahoo, iCloud…)
// 2. Patrones comunes (imap.dominio, mail.dominio, …)
// 3. Si falla todo → muestra campos avanzados

const { ImapFlow } = require('imapflow');

const PRESETS = {
  'gmail.com':        { imapHost: 'imap.gmail.com',            imapPort: 993, smtpHost: 'smtp.gmail.com',           smtpPort: 587 },
  'googlemail.com':   { imapHost: 'imap.gmail.com',            imapPort: 993, smtpHost: 'smtp.gmail.com',           smtpPort: 587 },
  'outlook.com':      { imapHost: 'outlook.office365.com',     imapPort: 993, smtpHost: 'smtp.office365.com',       smtpPort: 587 },
  'hotmail.com':      { imapHost: 'outlook.office365.com',     imapPort: 993, smtpHost: 'smtp.office365.com',       smtpPort: 587 },
  'live.com':         { imapHost: 'outlook.office365.com',     imapPort: 993, smtpHost: 'smtp.office365.com',       smtpPort: 587 },
  'yahoo.com':        { imapHost: 'imap.mail.yahoo.com',       imapPort: 993, smtpHost: 'smtp.mail.yahoo.com',      smtpPort: 465 },
  'yahoo.com.mx':     { imapHost: 'imap.mail.yahoo.com',       imapPort: 993, smtpHost: 'smtp.mail.yahoo.com',      smtpPort: 465 },
  'icloud.com':       { imapHost: 'imap.mail.me.com',          imapPort: 993, smtpHost: 'smtp.mail.me.com',         smtpPort: 587 },
  'me.com':           { imapHost: 'imap.mail.me.com',          imapPort: 993, smtpHost: 'smtp.mail.me.com',         smtpPort: 587 },
  'mac.com':          { imapHost: 'imap.mail.me.com',          imapPort: 993, smtpHost: 'smtp.mail.me.com',         smtpPort: 587 },
  'proton.me':        { imapHost: '127.0.0.1',                 imapPort: 1143, smtpHost: '127.0.0.1',              smtpPort: 1025 },
  'protonmail.com':   { imapHost: '127.0.0.1',                 imapPort: 1143, smtpHost: '127.0.0.1',              smtpPort: 1025 },
};

// Patrones a probar cuando el dominio no está en presets
function candidatesFor(domain) {
  return [
    { imapHost: `imap.${domain}`,      imapPort: 993, smtpHost: `smtp.${domain}`,      smtpPort: 587 },
    { imapHost: `mail.${domain}`,      imapPort: 993, smtpHost: `mail.${domain}`,      smtpPort: 587 },
    { imapHost: `imap.mail.${domain}`, imapPort: 993, smtpHost: `smtp.mail.${domain}`, smtpPort: 587 },
    { imapHost: `mail.${domain}`,      imapPort: 993, smtpHost: `mail.${domain}`,      smtpPort: 465 },
  ];
}

async function tryImap(host, port, user, pass) {
  const client = new ImapFlow({
    host, port, secure: port === 993 || port === 465,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 6000,
  });
  try {
    await client.connect();
    await client.logout();
    return true;
  } catch {
    try { await client.logout(); } catch {}
    return false;
  }
}

module.exports = {
  meta: {
    key: 'email',
    name: 'Email (IMAP/SMTP)',
    description: 'Conecta cualquier correo: dominio propio, corporativo o proveedor no listado.',
    color: '#6366f1',
    initial: '@',
    authType: 'manual',
    docsUrl: 'https://support.google.com/accounts/answer/185833',
    setupSteps: [
      'Ingresa tu correo y contraseña — detectaremos los servidores automáticamente.',
      '<b>Gmail / Outlook / Yahoo / iCloud:</b> usa una <b>contraseña de aplicación</b>, no tu contraseña normal.',
      'Si la conexión falla, despliega <b>Configuración avanzada</b> e ingresa los servidores IMAP/SMTP manualmente.',
    ],
  },
  fields: [
    { key: 'fromName',  label: 'Nombre del remitente',      type: 'text',     required: true,  help: 'Ej: "Soporte Acme"' },
    { key: 'fromEmail', label: 'Correo electrónico',        type: 'text',     required: true,  help: 'tu@dominio.com' },
    { key: 'password',  label: 'Contraseña',                type: 'password', required: true,  secret: true,
      help: 'Gmail/Outlook/Yahoo/iCloud: usa una contraseña de aplicación.' },
    // Campos avanzados — ocultos por defecto, se muestran si el usuario los necesita
    { key: 'imapHost', label: 'Servidor IMAP', type: 'text', required: false, advanced: true, help: 'ej: imap.tudominio.com' },
    { key: 'imapPort', label: 'Puerto IMAP',   type: 'text', required: false, advanced: true, help: '993 (SSL)' },
    { key: 'smtpHost', label: 'Servidor SMTP', type: 'text', required: false, advanced: true, help: 'ej: smtp.tudominio.com' },
    { key: 'smtpPort', label: 'Puerto SMTP',   type: 'text', required: false, advanced: true, help: '587 o 465' },
  ],

  async test({ credentials }) {
    const { fromEmail, password, imapHost, imapPort } = credentials;
    if (!fromEmail || !password) {
      return { ok: false, message: 'Ingresa el correo y la contraseña.' };
    }
    const email  = fromEmail.trim().toLowerCase();
    const domain = email.split('@')[1] || '';

    // Si el usuario llenó los campos avanzados, usarlos directamente
    if (imapHost && imapPort) {
      const ok = await tryImap(imapHost, Number(imapPort), credentials.username || email, password);
      if (ok) return { ok: true, displayName: email, externalId: email };
      return { ok: false, message: 'No se pudo conectar con los servidores indicados. Verifica host, puerto y contraseña.' };
    }

    // 1. Presets conocidos
    const preset = PRESETS[domain];
    if (preset) {
      const ok = await tryImap(preset.imapHost, preset.imapPort, email, password);
      if (ok) return { ok: true, displayName: email, externalId: email, _servers: preset };
      return { ok: false, message: 'Credenciales incorrectas. Asegúrate de usar una contraseña de aplicación si tienes 2FA activado.' };
    }

    // 2. Autodiscover — probamos patrones comunes
    for (const candidate of candidatesFor(domain)) {
      const ok = await tryImap(candidate.imapHost, candidate.imapPort, email, password);
      if (ok) return { ok: true, displayName: email, externalId: email, _servers: candidate };
    }

    // 3. No encontramos nada
    return {
      ok: false,
      message: `No pudimos detectar los servidores de "${domain}" automáticamente. Despliega Configuración avanzada e ingrésalos manualmente.`,
    };
  },

  normalizeCredentials(raw, testResult) {
    const servers = testResult?._servers || {};
    return {
      fromName:  raw.fromName?.trim()  || '',
      fromEmail: raw.fromEmail?.trim().toLowerCase() || '',
      username:  raw.fromEmail?.trim().toLowerCase() || '',
      password:  raw.password || '',
      imapHost:  raw.imapHost  || servers.imapHost  || '',
      imapPort:  raw.imapPort  ? Number(raw.imapPort)  : (servers.imapPort  || 993),
      smtpHost:  raw.smtpHost  || servers.smtpHost  || '',
      smtpPort:  raw.smtpPort  ? Number(raw.smtpPort)  : (servers.smtpPort  || 587),
    };
  },
};
