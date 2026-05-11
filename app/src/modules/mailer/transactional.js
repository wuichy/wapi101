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
    // Gmail OAuth
    gmailIntegrationId: base.gmailIntegrationId ?? null,
    // Resend
    resendApiKey: base.resendApiKey || process.env.RESEND_API_KEY || '',
    // SMTP
    smtpHost:    base.smtpHost    || process.env.SMTP_HOST || '',
    smtpPort:    Number(base.smtpPort || process.env.SMTP_PORT || 587),
    smtpSecure:  base.smtpSecure  ?? (Number(base.smtpPort || process.env.SMTP_PORT) === 465),
    smtpUser:    base.smtpUser    || process.env.SMTP_USER || '',
    smtpPass:    base.smtpPass    || process.env.SMTP_PASS || '',
    // Comunes
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

// ─── Gmail REST API (HTTPS) vía integración del CRM ──────────────────────────
// Usa la API de Gmail en vez de SMTP — funciona aunque el droplet tenga
// bloqueados los puertos 465/587 (que Digital Ocean bloquea por defecto).
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

  const { refreshGoogleToken } = require('../integrations/providers/gmail');
  const accessToken = await refreshGoogleToken(creds.refreshToken);
  const senderEmail = creds.email || row.external_id;

  // Construir email RFC 2822
  // Los headers con caracteres no-ASCII (emojis, acentos) deben ir como
  // encoded-word RFC 2047: =?UTF-8?B?<base64>?=
  const _encodeHeader = (str) => `=?UTF-8?B?${Buffer.from(str).toString('base64')}?=`;

  const boundary = `__wapi101_${Date.now()}`;
  const recipients = Array.isArray(to) ? to.join(', ') : to;

  let rawParts = [
    `From: ${_encodeHeader(from)}`,
    `To: ${recipients}`,
    `Subject: ${_encodeHeader(subject)}`,
    `MIME-Version: 1.0`,
  ];
  if (replyTo) rawParts.push(`Reply-To: ${replyTo}`);

  if (html && text) {
    rawParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    rawParts.push('');
    rawParts.push(`--${boundary}`);
    rawParts.push('Content-Type: text/plain; charset=UTF-8');
    rawParts.push('');
    rawParts.push(text);
    rawParts.push(`--${boundary}`);
    rawParts.push('Content-Type: text/html; charset=UTF-8');
    rawParts.push('');
    rawParts.push(html);
    rawParts.push(`--${boundary}--`);
  } else if (html) {
    rawParts.push('Content-Type: text/html; charset=UTF-8');
    rawParts.push('');
    rawParts.push(html);
  } else {
    rawParts.push('Content-Type: text/plain; charset=UTF-8');
    rawParts.push('');
    rawParts.push(text || '');
  }

  const raw = rawParts.join('\r\n');
  // Base64url encoding (Gmail API requiere base64url sin padding)
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Gmail REST API — usa HTTPS (port 443), no SMTP
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail)}/messages/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log(`[mailer/gmail-api] enviado id=${data.id} to=${recipients} subject="${subject}"`);
  return { id: data.id, provider: 'gmail_oauth' };
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

// ─── Bienvenida al nuevo tenant ──────────────────────────────────────────────
async function sendWelcome({ to, name, companyName, plan, appUrl }, overrideCfg) {
  const planLabel = { free: 'Free', basico: 'Básico', pro: 'Pro', ultra: 'Ultra' }[plan] || plan;
  const isPaid = ['basico', 'pro', 'ultra'].includes(plan);
  const url = appUrl || 'https://wapi101.com/app';
  const html = _layout({
    title: `¡Bienvenido a Wapi101, ${name ? name.split(' ')[0] : ''}! 🎉`,
    preheader: `Tu CRM para WhatsApp ya está listo. Empieza en minutos.`,
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p>Tu workspace <strong>${companyName}</strong> ya está activo en Wapi101. Estas son las primeras cosas que te recomendamos hacer:</p>
      <ol style="padding-left:20px;color:#334155;font-size:15px;line-height:2">
        <li>Conecta tu número de WhatsApp Business</li>
        <li>Importa o crea tus primeros contactos</li>
        <li>Crea un pipeline de ventas para tus leads</li>
        <li>Configura tu primer bot de respuestas automáticas</li>
      </ol>
      ${isPaid ? `<p style="margin-top:18px;padding:14px 16px;background:#eff6ff;border-radius:8px;font-size:14px;color:#1e40af">
        🎁 Tu plan <strong>${planLabel}</strong> incluye 14 días de prueba sin cargo. Cancela en cualquier momento.
      </p>` : ''}
    `,
    ctaText: 'Abrir mi CRM',
    ctaUrl: url,
    footer: `¿Tienes dudas? Escríbenos a <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a> — respondemos en menos de 24h.`,
  });

  return sendTransactional({
    to,
    from: `Wapi101 <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: `¡Bienvenido a Wapi101, ${companyName}! Tu CRM ya está listo 🚀`,
    html,
    text: `Hola ${name || ''}, tu workspace ${companyName} está listo en Wapi101. Entra aquí: ${url}`,
    replyTo: 'soporte@wapi101.com',
  }, overrideCfg);
}

// ─── Recibo de pago exitoso ───────────────────────────────────────────────────
async function sendPaymentReceipt({ to, name, companyName, amount, currency, plan, invoiceUrl, periodEnd }, overrideCfg) {
  const planLabel = { free: 'Free', basico: 'Básico', pro: 'Pro', ultra: 'Ultra' }[plan] || plan || '';
  const amountFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amount || 0);
  const periodFmt = periodEnd ? new Date(periodEnd * 1000).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  const html = _layout({
    title: '✅ Pago recibido',
    preheader: `Tu pago de ${amountFmt} fue procesado exitosamente.`,
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p>Tu pago fue procesado exitosamente. Aquí está el resumen:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#64748b;width:140px">Empresa</td><td style="padding:8px 0;font-weight:600">${companyName || ''}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Plan</td><td style="padding:8px 0">${planLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Monto</td><td style="padding:8px 0;font-weight:700;color:#10b981">${amountFmt}</td></tr>
        ${periodFmt ? `<tr><td style="padding:8px 0;color:#64748b">Próximo cobro</td><td style="padding:8px 0">${periodFmt}</td></tr>` : ''}
      </table>
    `,
    ctaText: invoiceUrl ? 'Ver factura' : 'Ver mi cuenta',
    ctaUrl: invoiceUrl || 'https://wapi101.com/app',
    footer: `Wapi101 · Tu CRM para WhatsApp · <a href="mailto:soporte@wapi101.com" style="color:#64748b">soporte@wapi101.com</a>`,
  });

  return sendTransactional({
    to,
    from: `Wapi101 Billing <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: `✅ Pago recibido — ${amountFmt} · Wapi101`,
    html,
    text: `Hola ${name || ''}, tu pago de ${amountFmt} fue procesado. Plan: ${planLabel}. ${invoiceUrl ? 'Factura: ' + invoiceUrl : ''}`,
  }, overrideCfg);
}

// ─── Pago fallido ─────────────────────────────────────────────────────────────
async function sendPaymentFailed({ to, name, companyName, attempt, nextAttempt, billingUrl }, overrideCfg) {
  const nextFmt = nextAttempt ? new Date(nextAttempt * 1000).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) : null;
  const url = billingUrl || 'https://wapi101.com/app';

  const html = _layout({
    title: '⚠️ No pudimos procesar tu pago',
    preheader: 'Actualiza tu método de pago para mantener tu cuenta activa.',
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p>Intentamos cobrar tu suscripción de <strong>${companyName || 'Wapi101'}</strong> pero el pago no fue procesado${attempt > 1 ? ` (intento ${attempt})` : ''}.</p>
      <p>Para evitar interrupciones en tu servicio, actualiza tu método de pago lo antes posible.</p>
      ${nextFmt ? `<p style="padding:12px 16px;background:#fef9c3;border-radius:8px;font-size:14px;color:#854d0e">
        ⏰ Haremos un nuevo intento el <strong>${nextFmt}</strong>.
      </p>` : ''}
      <p style="font-size:14px;color:#64748b;margin-top:16px">Si tu cuenta no se regulariza, será suspendida automáticamente por Stripe.</p>
    `,
    ctaText: 'Actualizar método de pago',
    ctaUrl: url,
    footer: `¿Necesitas ayuda? Escríbenos a <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a>`,
  });

  return sendTransactional({
    to,
    from: `Wapi101 Billing <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: `⚠️ Pago fallido — Actualiza tu método de pago en Wapi101`,
    html,
    text: `Hola ${name || ''}, no pudimos procesar tu pago de ${companyName || 'Wapi101'}. Actualiza tu tarjeta aquí: ${url}`,
    replyTo: 'soporte@wapi101.com',
  }, overrideCfg);
}

// ─── Trial terminando ─────────────────────────────────────────────────────────
async function sendTrialEnding({ to, name, companyName, plan, daysLeft, upgradeUrl }, overrideCfg) {
  const planLabel = { free: 'Free', basico: 'Básico', pro: 'Pro', ultra: 'Ultra' }[plan] || plan || '';
  const url = upgradeUrl || 'https://wapi101.com/app';
  const urgency = daysLeft <= 1;

  const html = _layout({
    title: urgency ? '🚨 Tu prueba termina hoy' : `⏳ Tu prueba termina en ${daysLeft} días`,
    preheader: `Activa tu suscripción para no perder acceso a Wapi101.`,
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p>Tu período de prueba de <strong>${companyName}</strong> en el plan <strong>${planLabel}</strong> ${urgency ? 'termina <strong>hoy</strong>' : `termina en <strong>${daysLeft} días</strong>`}.</p>
      ${urgency
        ? `<p style="padding:14px 16px;background:#fef2f2;border-radius:8px;font-size:14px;color:#991b1b">
            ⚠️ Si no activas tu suscripción antes de que termine el día, tu cuenta pasará al plan Free y perderás acceso a funciones avanzadas.
           </p>`
        : `<p>Activa tu suscripción ahora para seguir disfrutando de todas las funcionalidades sin interrupciones.</p>`
      }
    `,
    ctaText: 'Activar mi suscripción',
    ctaUrl: url,
    footer: `¿Tienes preguntas sobre los planes? Escríbenos a <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a>`,
  });

  return sendTransactional({
    to,
    from: `Wapi101 <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: urgency
      ? `🚨 Tu prueba de Wapi101 termina hoy — Activa tu plan`
      : `⏳ Tu prueba de Wapi101 termina en ${daysLeft} días`,
    html,
    text: `Hola ${name || ''}, tu período de prueba de ${companyName} termina en ${daysLeft} día(s). Activa tu plan: ${url}`,
    replyTo: 'soporte@wapi101.com',
  }, overrideCfg);
}

// ─── Suscripción cancelada ────────────────────────────────────────────────────
async function sendSubscriptionCancelled({ to, name, companyName, plan, periodEnd }, overrideCfg) {
  const planLabel = { free: 'Free', basico: 'Básico', pro: 'Pro', ultra: 'Ultra' }[plan] || plan || '';
  const periodFmt = periodEnd ? new Date(periodEnd * 1000).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  const html = _layout({
    title: 'Tu suscripción fue cancelada',
    preheader: `Tu suscripción de Wapi101 ha sido cancelada.`,
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p>Tu suscripción al plan <strong>${planLabel}</strong> de <strong>${companyName}</strong> en Wapi101 ha sido cancelada.</p>
      ${periodFmt ? `<p>Mantendrás acceso a todas las funciones hasta el <strong>${periodFmt}</strong>, cuando tu cuenta cambiará al plan Free.</p>` : ''}
      <p style="font-size:14px;color:#64748b">¿Fue un error o quieres reactivar? Escríbenos y lo resolvemos.</p>
    `,
    ctaText: 'Reactivar mi plan',
    ctaUrl: 'https://wapi101.com/app',
    footer: `¿Fue un error? Contáctanos en <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a>`,
  });

  return sendTransactional({
    to,
    from: `Wapi101 <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: `Tu suscripción de Wapi101 fue cancelada`,
    html,
    text: `Hola ${name || ''}, tu suscripción al plan ${planLabel} de ${companyName} en Wapi101 fue cancelada. ${periodFmt ? 'Acceso hasta: ' + periodFmt : ''} Reactiva en https://wapi101.com/app`,
    replyTo: 'soporte@wapi101.com',
  }, overrideCfg);
}

// ─── Cambio de plan ───────────────────────────────────────────────────────────
async function sendPlanChanged({ to, name, companyName, oldPlan, newPlan }, overrideCfg) {
  const labels = { free: 'Free', basico: 'Básico', pro: 'Pro', ultra: 'Ultra' };
  const oldLabel = labels[oldPlan] || oldPlan || '';
  const newLabel = labels[newPlan] || newPlan || '';
  const isUpgrade = ['free','basico','pro'].indexOf(oldPlan) < ['free','basico','pro','ultra'].indexOf(newPlan);

  const html = _layout({
    title: isUpgrade ? `🚀 Plan actualizado a ${newLabel}` : `Plan cambiado a ${newLabel}`,
    preheader: `Tu plan de Wapi101 cambió de ${oldLabel} a ${newLabel}.`,
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p>El plan de <strong>${companyName}</strong> en Wapi101 ha sido actualizado:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#64748b;width:100px">Plan anterior</td><td style="padding:8px 0">${oldLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Plan nuevo</td><td style="padding:8px 0;font-weight:700;color:${isUpgrade ? '#10b981' : '#ef4444'}">${newLabel}</td></tr>
      </table>
      ${isUpgrade ? `<p>¡Gracias por confiar en Wapi101! Ya puedes disfrutar de todas las funciones de tu nuevo plan.</p>` : ''}
    `,
    ctaText: 'Ver mi cuenta',
    ctaUrl: 'https://wapi101.com/app',
    footer: `¿Tienes preguntas? <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a>`,
  });

  return sendTransactional({
    to,
    from: `Wapi101 <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: isUpgrade ? `🚀 Tu plan de Wapi101 es ahora ${newLabel}` : `Tu plan de Wapi101 cambió a ${newLabel}`,
    html,
    text: `Hola ${name || ''}, el plan de ${companyName} cambió de ${oldLabel} a ${newLabel}. Ver cuenta: https://wapi101.com/app`,
  }, overrideCfg);
}

// ─── Nuevo asesor invitado ────────────────────────────────────────────────────
async function sendAdvisorInvited({ to, name, inviterName, companyName, loginUrl, password }, overrideCfg) {
  const url = loginUrl || 'https://wapi101.com/login';

  const html = _layout({
    title: `Te invitaron a ${companyName} en Wapi101`,
    preheader: `${inviterName || 'Tu equipo'} te agregó como asesor en Wapi101.`,
    body: `
      <p>Hola ${name ? name.split(' ')[0] : ''},</p>
      <p><strong>${inviterName || 'Un administrador'}</strong> te agregó como asesor en el workspace de <strong>${companyName}</strong> en Wapi101.</p>
      ${password ? `
      <p>Tus credenciales de acceso:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:6px;font-family:monospace;font-size:15px;letter-spacing:.5px">${password}</td></tr>
      </table>
      <p style="font-size:13px;color:#64748b">Te recomendamos cambiar tu contraseña al ingresar por primera vez.</p>
      ` : ''}
    `,
    ctaText: 'Entrar a Wapi101',
    ctaUrl: url,
    footer: `¿No reconoces este mensaje? Ignóralo o escríbenos a <a href="mailto:soporte@wapi101.com" style="color:#2563eb">soporte@wapi101.com</a>`,
  });

  return sendTransactional({
    to,
    from: `${companyName} via Wapi101 <${_resolveCfg(overrideCfg).fromEmail}>`,
    subject: `${inviterName || 'Tu equipo'} te invitó a ${companyName} en Wapi101`,
    html,
    text: `Hola ${name || ''}, ${inviterName || 'un admin'} te agregó a ${companyName} en Wapi101. Entra aquí: ${url}${password ? '\nTu contraseña temporal: ' + password : ''}`,
    replyTo: 'soporte@wapi101.com',
  }, overrideCfg);
}

// ─── Factory: withConfig(cfg) ─────────────────────────────────────────────────
// Útil cuando ya tienes el config y no quieres pasarlo en cada llamada.
function withConfig(cfg) {
  return {
    sendTransactional:       (opts) => sendTransactional(opts, cfg),
    sendPasswordReset:       (opts) => sendPasswordReset(opts, cfg),
    sendSignupNotification:  (opts) => sendSignupNotification(opts, cfg),
    sendTestEmail:           (opts) => sendTestEmail(opts, cfg),
    sendWelcome:             (opts) => sendWelcome(opts, cfg),
    sendPaymentReceipt:      (opts) => sendPaymentReceipt(opts, cfg),
    sendPaymentFailed:       (opts) => sendPaymentFailed(opts, cfg),
    sendTrialEnding:         (opts) => sendTrialEnding(opts, cfg),
    sendSubscriptionCancelled:(opts)=> sendSubscriptionCancelled(opts, cfg),
    sendPlanChanged:         (opts) => sendPlanChanged(opts, cfg),
    sendAdvisorInvited:      (opts) => sendAdvisorInvited(opts, cfg),
  };
}

module.exports = {
  setDb,
  sendTransactional,
  sendPasswordReset,
  sendSignupNotification,
  sendTestEmail,
  sendWelcome,
  sendPaymentReceipt,
  sendPaymentFailed,
  sendTrialEnding,
  sendSubscriptionCancelled,
  sendPlanChanged,
  sendAdvisorInvited,
  withConfig,
};
