// Outlook / Hotmail via Microsoft OAuth2
// Credentials stored: { email, name, refreshToken }
// IMAP: outlook.office365.com:993 via XOAUTH2
// SMTP: smtp.office365.com:587 via nodemailer OAuth2

async function refreshMicrosoftToken(refreshToken) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
      scope:         'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Error renovando token de Microsoft');
  return data.access_token;
}

async function test(credentials) {
  const { ImapFlow } = require('imapflow');
  if (!credentials.refreshToken) throw new Error('Sin refresh token de Microsoft');
  const accessToken = await refreshMicrosoftToken(credentials.refreshToken);
  const client = new ImapFlow({
    host: 'outlook.office365.com', port: 993, secure: true,
    auth: { user: credentials.email, accessToken },
    logger: false, connectionTimeout: 15000,
  });
  await client.connect();
  await client.logout();
}

module.exports = {
  meta: {
    key:         'outlook',
    name:        'Outlook / Hotmail',
    description: 'Conecta Outlook, Hotmail o Live con Microsoft Sign-In',
    color:       '#0078D4',
    textColor:   '#fff',
    initial:     'O',
    authType:    'oauth_microsoft',
    category:    'email',
  },
  fields: [],
  test,
  refreshMicrosoftToken,
};
