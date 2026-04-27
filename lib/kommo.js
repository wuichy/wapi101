const crypto = require('crypto');
const axios = require('axios');
const config = require('./config');
const store = require('./store');

function getSubdomain() {
  const state = store.readState();
  return config.kommo.subdomain || state.kommo.subdomain;
}

function getBaseUrl() {
  const subdomain = getSubdomain();

  if (!subdomain) {
    throw new Error('Falta configurar KOMMO_SUBDOMAIN o conectar la cuenta por OAuth.');
  }

  return `https://${subdomain}.kommo.com`;
}

function summarizeKommoError(error) {
  const status = error.response?.status || null;
  const data = error.response?.data || null;
  const detail = typeof data === 'string'
    ? data
    : data?.detail || data?.title || data?.error || null;

  return {
    message: error.message || 'Error desconocido al conectar con Kommo.',
    status,
    detail
  };
}

function buildAuthUrl() {
  if (!config.kommo.clientId) {
    throw new Error('Falta KOMMO_CLIENT_ID en .env');
  }

  const state = crypto.randomBytes(16).toString('hex');

  store.updateState((current) => {
    current.oauth.state = state;
    current.oauth.requestedAt = Date.now();
  });

  const params = new URLSearchParams({
    client_id: config.kommo.clientId,
    redirect_uri: config.kommo.redirectUri,
    state,
    mode: 'popup'
  });

  return `https://www.kommo.com/oauth?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, referer }) {
  let subdomain = referer || getSubdomain() || '';

  if (subdomain.startsWith('http://') || subdomain.startsWith('https://')) {
    subdomain = new URL(subdomain).hostname;
  }

  subdomain = subdomain.replace('.kommo.com', '');

  if (!subdomain) {
    throw new Error('Kommo no devolvió el subdominio de la cuenta.');
  }

  const response = await axios.post(`https://${subdomain}.kommo.com/oauth2/access_token`, {
    client_id: config.kommo.clientId,
    client_secret: config.kommo.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.kommo.redirectUri
  });

  store.updateState((state) => {
    state.kommo.subdomain = subdomain;
    state.kommo.tokens = {
      ...response.data,
      expires_at: Date.now() + (response.data.expires_in * 1000)
    };
  });
  store.clearKommoLastError();

  return response.data;
}

async function refreshTokens() {
  const state = store.readState();
  const refreshToken = state.kommo.tokens?.refresh_token;
  const subdomain = getSubdomain();

  if (!refreshToken || !subdomain) {
    throw new Error('No hay refresh token disponible. Vuelve a conectar Kommo.');
  }

  const response = await axios.post(`https://${subdomain}.kommo.com/oauth2/access_token`, {
    client_id: config.kommo.clientId,
    client_secret: config.kommo.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: config.kommo.redirectUri
  });

  store.updateState((current) => {
    current.kommo.tokens = {
      ...response.data,
      expires_at: Date.now() + (response.data.expires_in * 1000)
    };
  });
  store.clearKommoLastError();

  return response.data.access_token;
}

async function getValidAccessToken() {
  const state = store.readState();
  const tokens = state.kommo.tokens;

  if (!tokens?.access_token) {
    throw new Error('La app aún no está conectada a Kommo.');
  }

  const expiresSoon = !tokens.expires_at || tokens.expires_at <= Date.now() + 60_000;

  if (expiresSoon) {
    return refreshTokens();
  }

  return tokens.access_token;
}

async function apiRequest(method, pathname, data) {
  const baseUrl = getBaseUrl();
  let token = await getValidAccessToken();

  try {
    const response = await axios({
      method,
      url: `${baseUrl}${pathname}`,
      data,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    store.clearKommoLastError();
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      try {
        token = await refreshTokens();
        const retry = await axios({
          method,
          url: `${baseUrl}${pathname}`,
          data,
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        store.clearKommoLastError();
        return retry.data;
      } catch (retryError) {
        store.setKommoLastError({
          ...summarizeKommoError(retryError),
          at: Date.now()
        });
        throw retryError;
      }
    }

    store.setKommoLastError({
      ...summarizeKommoError(error),
      at: Date.now()
    });
    throw error;
  }
}

async function fetchAccountInfo() {
  const account = await apiRequest('get', '/api/v4/account');

  store.updateState((state) => {
    state.kommo.account = {
      id: account.id,
      name: account.name
    };
  });

  return account;
}

async function fetchContact(contactId) {
  if (!contactId) {
    return null;
  }

  try {
    return await apiRequest('get', `/api/v4/contacts/${contactId}`);
  } catch (error) {
    return null;
  }
}

async function listContactFields() {
  return apiRequest('get', '/api/v4/contacts/custom_fields?limit=250');
}

async function listSources() {
  return apiRequest('get', '/api/v4/sources');
}

async function fetchChatMessages(chatId, limit = 50) {
  return apiRequest('get', `/api/v4/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`);
}

async function callReturnUrl(returnUrl, payload) {
  const token = await getValidAccessToken();
  const response = await axios.post(returnUrl, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    timeout: 8000
  });
  return response.data;
}

async function launchSalesbot(entityId, entityType) {
  if (!config.kommo.salesbotId) {
    throw new Error('Falta KOMMO_SALESBOT_ID en .env para enviar respuestas.');
  }

  const body = [
    {
      bot_id: config.kommo.salesbotId,
      entity_id: Number(entityId),
      entity_type: entityType === 'contact' ? 1 : 2
    }
  ];

  return apiRequest('post', '/api/v2/salesbot/run', body);
}

function parseJwtPayload(token) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    throw new Error('JWT inválido');
  }

  const payload = parts[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');

  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

function parseJwtHeader(token) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    throw new Error('JWT inválido');
  }

  const header = parts[0]
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(parts[0].length / 4) * 4, '=');

  return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    return false;
  }

  let algorithm = 'sha256';

  try {
    const header = parseJwtHeader(token);

    if (header.alg === 'HS512') {
      algorithm = 'sha512';
    } else if (header.alg === 'HS256') {
      algorithm = 'sha256';
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }

  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto
    .createHmac(algorithm, secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return expected === parts[2];
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchAccountInfo,
  fetchContact,
  listContactFields,
  listSources,
  fetchChatMessages,
  launchSalesbot,
  callReturnUrl,
  parseJwtPayload,
  verifyJwt,
  getSubdomain,
  apiRequest
};
