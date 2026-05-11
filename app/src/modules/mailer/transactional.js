// Email transaccional — soporta Resend (HTTP API) y SMTP (nodemailer).
//
// Orden de prioridad para la configuración:
//   1. cfg explícita (pasada en el call o via withConfig())
//   2. DB: system_settings key='mail_config' (configurable desde super-admin)
//   3. Variables de entorno (fallback legacy)
//
// Para conectar la DB: llamar setDb(db) una vez al inicio del servidor.
//
// Uso:
//   await sendPasswordReset({ to, name, resetUrl })
//   await sendSignupNotification({ tenantName, adminName, adminEmail, plan, slug })
//
// O con config explícita:
//   const m = withConfig(myCfg);
//   await m.sendPasswordReset({ to, name, resetUrl })

let _globalDb = null;

/**
 * Conectar DB para que el mailer pueda leer mail_config en caliente.
 * Llamar una vez desde server.js después de abrir la DB.
 */
function setDb(db) { _globalDb = db; }

// ─── Leer configuración ───────────────────────────────────────────────────────
function _readDbCfg(db = _globalDb) {
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'mail_config'").get();
    return row?.value ? JSON.parse(row.value) : null;
  } catch { return null; }
}

function _resolveCfg(overrideCfg) {
  const dbCfg = _readDbCfg();
  // Prioridad: override > DB > env
  const base = overrideCfg || dbCfg || {};
  return {
    provider:    base.provider    || (process.env.RESEND_API_KEY ? 'resend' : 'smtp'),
    resendApiKey: base.resendApiKey || process.env.RESEND_API_KEY || '',
    smtpHost:    base.smtpHost    || process.env.SMTP_HOST || '',
    smtpPort:    Number(base.smtpPort || process.env.SMTP_PORT || 587),
    smtpSecure:  base.smtpSecure  ?? (Number(base.smtpPort || process.env.SMTP_PORT) === 465),
    smtpUser:    base.smtpUser    || process.env.SMTP_USER || '',
    smtpPass:    base.smtpPass    || process.env.SMTP_PASS || '',
    fromName:    base.fromName    || process.env.MAIL_FROM_NAME  || 'Wapi101',
    fromEmail:   base.fromEmail   || process.env.MAIL_FROM_NOREPLY || 'noreply@wapi101.com',
    adminEmail:  base.adminEmail  || process.env.MAIL_ADMIN || 'luis@wapi101.com',
  };
}

// ─── Core sender ─────────────────────────────────────────────────────────────
async function sendTransactional({ from, to, subject, html, text, replyTo }, overrideCfg) {
  const cfg = _resolveCfg(overrideCfg);
  const fromAddr = from || `${cfg.fromName} <${cfg.fromEmail}>`;
  const recipients = Array.isArray(to) ? to : [to];

  if (cfg.provider === 'smtp') {
    return _sendViaSMTP({ from: fromAddr, to: recipients, subject, html, text, replyTo }, cfg);
  }
  if (cfg.provider === 'gmail_oauth') {
    return _sendViaGmailOAuth({ from: fromAddr, to: recipients, subject, html, text, replyTo }, cfg);
  }
  // Default: Resend
  return _sendViaResend({ from: fromAddr, to: recipients, subject, html, text, replyTo }, cfg);
}

// ─── Gmail OAuth2 vía integración del CRM ────────────────────────────────────
async function _sendViaGmailOAuth({ from, to, subject, html, text, replyTo }, cfg) {
  if (!_globalDb) throw new Error('DB no conectada al mailer — llamar setDb(db) al inicio');
  const integrationId = cfg.gmailIntegrationId;
  if (!integrationId) throw new Error('gmailIntegrationId no configurado en mail_config');

  // Leer credenciales encriptadas de la integración Gmail
  const row = _globalDb.prepare('SELECT external_id, credentials_enc FROM integrations WHERE id = ? AND provider = ?').get(integrationId, 'gmail');
  if (!row) throw new Error(`Integración Gmail id=${integrationId} no encontrada`);
  const { decryptJson } = require('../../security/crypto');
  const creds = decryptJson(row.credentials_enc);
  if (!creds?.refreshToken) throw new Error('Integración Gmail no tiene refreshToken — reconecta la cuenta');

  // Renovar access token
  const { refreshGoogleToken } = require('../integrations/providers/gmail');
  const accessToken = await refreshGoogleToken(creds.refreshToken);

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type:         'OAuth2',
      user:         creds.email || row.external_id,
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: creds.refreshToken,
      accessToken,
    },
  });

  const mailOptions = { from, to, subject, html };
  if (text)    mailOptions.text = text;
  if (replyTo) mailOptions.replyTo = replyTo;

  const info = await transporter.sendMail(mailOptions);
  console.log(`[mailer/gmail-oauth] enviado id=${info.messageId} to=${to} subject="${subject}"`);
  return { id: info.messageId, provider: 'gmail_oauth' };
}

// ─── Resend HTTP API ──────────────────────────────────────────────────────────
async function _sendViaResend({ from, to, subject, html, text, replyTo }, cfg) {
  if (!cfg.resendApiKey) throw new Error('RESEND_API_KEY no configurado');
  const body = { from, to, subject, html };
  if (text)    body.text = text;
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.resendApiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log(`[mailer/resend] enviado id=${data.id} to=${to} subject="${subject}"`);
  return data;
}

// ─── SMTP vía nodemailer ──────────────────────────────────────────────────────
async function _sendViaSMTP({ from, to, subject, html, text, replyTo }, cfg) {
  if (!cfg.smtpHost) throw new Error('SMTP_HOST no configurado');
  const nodemailer = require('nodemailer');

  let auth = undefined;
  if (cfg.smtpUser && cfg.smtpPass) {
    auth = { user: cfg.smtpUser, pass: cfg.smtpPass };
  }

  const transporter = nodemailer.createTransport({
    host:   cfg.smtpHost,
    port:   cfg.smtpPort,
    secure: cfg.smtpSecure,
    ...(auth ? { auth } : {}),
  });

  const mailOptions = { from, to, subject, html };
  if (text)    mailOptions.text = text;
  if (replyTo) mailOptions.replyTo = replyTo;

  const info = await transporter.sendMail(mailOptions);
  console.log(`[mailer/smtp] enviado id=${info.messageId} to=${to} subject="${subject}"`);
  return { id: info.messageId, provider: 'smtp' };
}

// ─── Layout HTML compartido ───────────────────────────────────────────────────
function _layout({ title, preheader, body, ctaText, ctaUrl, footer }) {
  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;line-height:1.6">
<div style="display:none;max-height:0;overflow:hidden">${preheader || ''}</div>
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="padding:24px 28px;background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#fff">
      <div style="font-size:22px;font-weight:800;letter-spacing:-.5px">Wapi101<span style="color:#10b981">.</span></div>
    </div>
    <div style="padding:28px">
      <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;letter-spacing:-.3px">${title}</h1>
      <div style="font-size:15px;color:#334155">${body}</div>
      ${ctaText && ctaUrl ? `
        <div style="margin:28px 0 8px">
          <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">${ctaText}</a>
        </div>
        <div style="margin-top:14px;font-size:12px;color:#64748b">O copia y pega esta URL en tu navegador:<br/>
          <a href="${ctaUrl}" style="color:#2563eb;word-break:break-all">${ctaUrl}</a>
        </div>` : ''}
    </div>
    ${footer ? `<div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">${footer}</div>` : ''}
  </div>
  <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:18px">
    Wapi101 · CRM para WhatsApp Business · Hecho en México 🇲🇽<br/>
    ¿Dudas? <a href="mailto:soporte@wapi101.com" style="color:#64748b">soporte@wapi101.com</a>
  </div>
</div>
</body>
</html>`;
}

// ─── Reset de contraseña ──────────────────────────────────────────────────────
async function sendPasswordReset({ to, name, resetUrl }, overrideCfg) {
  const html = _layout({
    title: 'Restablece tu contraseña',
    preheader: `Hola ${name || ''}, recibimos una solicitud para restablecer tu contraseña.`,
    body: `
      <p>Hola ${name ? name : ''},</p>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta Wapi101. Para crear una nueva contraseña, dale clic al botón:</p>
      <p style="margin:18px 0 0;font-size:13px;color:#64748b">⏱ El link expira en <strong>1 hora</strong> por seguridad.</p>
    `,
    ctaText: 'Restablecer contraseña',
    ctaUrl: resetUrl,
    footer: `Si no solicitaste este cambio, ignora este correo — tu contraseña no cambiará.<br/>¿Sospechas que alguien intenta entrar a tu cuenta? Escríbenos a <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a>.`,
  });

  const cfg = _resolveCfg(overrideCfg);
  return sendTransactional({
    to,
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    subject: 'Restablece tu contraseña de Wapi101',
    html,
    text: `Hola ${name || ''}, para restablecer tu contraseña ve a: ${resetUrl}\n\nEl link expira en 1 hora. Si no fuiste tú, ignora este correo.`,
    replyTo: 'soporte@wapi101.com',
  }, overrideCfg);
}

// ─── Notificación de nuevo signup ─────────────────────────────────────────────
async function sendSignupNotification({ tenantName, adminName, adminEmail, plan, slug }, overrideCfg) {
  const cfg = _resolveCfg(overrideCfg);
  const planLabel = { free: 'Free', basico: 'Básico', pro: 'Pro', ultra: 'Ultra' }[plan] || plan;
  const html = _layout({
    title: '🎉 Nuevo signup en Wapi101',
    preheader: `${tenantName} acaba de crear cuenta`,
    body: `
      <p>Un nuevo workspace se acaba de registrar:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:120px">Empresa</td><td style="padding:8px 0;font-weight:600">${tenantName}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Slug</td><td style="padding:8px 0;font-family:monospace">${slug}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Admin</td><td style="padding:8px 0">${adminName}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Email</td><td style="padding:8px 0"><a href="mailto:${adminEmail}" style="color:#2563eb">${adminEmail}</a></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Plan</td><td style="padding:8px 0"><span style="background:#eff6ff;color:#2563eb;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:600">${planLabel}</span></td></tr>
      </table>
    `,
    ctaText: 'Ver en Super Admin',
    ctaUrl: 'https://wapi101.com/super',
    footer: `Tip: en los primeros 7 días considera mandarles un mensaje de bienvenida personal. Es la diferencia entre churn y cliente Founder.`,
  });

  return sendTransactional({
    to: cfg.adminEmail,
    from: `Wapi101 Notifications <${cfg.fromEmail}>`,
    subject: `🎉 Nuevo signup: ${tenantName} (${planLabel})`,
    html,
    text: `Nuevo signup en Wapi101:\n\nEmpresa: ${tenantName}\nSlug: ${slug}\nAdmin: ${adminName}\nEmail: ${adminEmail}\nPlan: ${planLabel}\n\nVer: https://wapi101.com/super`,
  }, overrideCfg);
}

// ─── Email de prueba (desde super-admin) ─────────────────────────────────────
async function sendTestEmail({ to }, overrideCfg) {
  const cfg = _resolveCfg(overrideCfg);
  const html = _layout({
    title: '✅ Configuración de email correcta',
    preheader: 'El servidor de Wapi101 puede enviar emails correctamente.',
    body: `
      <p>Este es un email de prueba enviado desde el Super Admin de Wapi101.</p>
      <p>Si lo recibiste, la configuración de email está funcionando correctamente.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
        <tr><td style="padding:6px 0;color:#64748b;width:130px">Proveedor</td><td style="padding:6px 0;font-weight:600">${cfg.provider === 'smtp' ? `SMTP (${cfg.smtpHost}:${cfg.smtpPort})` : 'Resend API'}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Desde</td><td style="padding:6px 0">${cfg.fromName} &lt;${cfg.fromEmail}&gt;</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Para</td><td style="padding:6px 0">${to}</td></tr>
      </table>
    `,
    footer: `Enviado desde wapi101.com/super el ${new Date().toLocaleString('es-MX')}`,
  });

  return sendTransactional({
    to,
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    subject: '✅ Test email — Wapi101 Super Admin',
    html,
    text: `Test email de Wapi101. Si lo recibiste, la configuración de email funciona correctamente.\nProveedor: ${cfg.provider}\nDesde: ${cfg.fromEmail}`,
  }, overrideCfg);
}

// ─── Factory: withConfig(cfg) ─────────────────────────────────────────────────
// Útil cuando ya tienes el config y no quieres pasarlo en cada llamada.
function withConfig(cfg) {
  return {
    sendTransactional: (opts)  => sendTransactional(opts, cfg),
    sendPasswordReset: (opts)  => sendPasswordReset(opts, cfg),
    sendSignupNotification: (opts) => sendSignupNotification(opts, cfg),
    sendTestEmail: (opts)      => sendTestEmail(opts, cfg),
  };
}

module.exports = {
  setDb,
  sendTransactional,
  sendPasswordReset,
  sendSignupNotification,
  sendTestEmail,
  withConfig,
};
