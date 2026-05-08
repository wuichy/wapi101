// Gmail via Google OAuth2 — no manual fields, everything comes from OAuth flow.
// Credentials stored: { email, name, refreshToken }

async function refreshGoogleToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Error renovando token de Google');
  return data.access_token;
}

async function test(credentials) {
  const { ImapFlow } = require('imapflow');
  if (!credentials.refreshToken) throw new Error('Sin refresh token de Google');
  const accessToken = await refreshGoogleToken(credentials.refreshToken);
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: credentials.email, accessToken },
    logger: false, connectionTimeout: 15000,
  });
  await client.connect();
  await client.logout();
}

module.exports = {
  meta: {
    key:         'gmail',
    name:        'Gmail',
    description: 'Conecta Gmail con Google Sign-In',
    color:       '#EA4335',
    textColor:   '#fff',
    initial:     'G',
    authType:    'oauth_google',
    category:    'email',
  },
  fields: [],
  test,
  refreshGoogleToken,
};
