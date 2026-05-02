const crypto = require('crypto');
const https = require('https');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const store = require('./store');

// Agente HTTPS propio: mantiene keep-alive controlado para no reusar
// conexiones que Kommo ya cerró del otro lado (causa típica de
// "Error: socket hang up" / ECONNRESET intermitente).
const kommoHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 20_000
});

const KOMMO_REQUEST_TIMEOUT_MS = 20_000;

function isTransientNetworkError(error) {
  if (!error) return false;
  // Si Kommo respondió con un status, NO es transitorio de red — es lógica.
  if (error.response) return false;
  const code = error.code || '';
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('socket hang up') || msg.includes('network socket disconnected');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function doKommoCall(method, pathname, data, token) {
  const baseUrl = getBaseUrl();
  return axios({
    method,
    url: `${baseUrl}${pathname}`,
    data,
    headers: {
      Authorization: `Bearer ${token}`
    },
    httpsAgent: kommoHttpsAgent,
    timeout: KOMMO_REQUEST_TIMEOUT_MS
  });
}

async function apiRequest(method, pathname, data) {
  let token = await getValidAccessToken();

  // Reintenta UNA vez ante errores transitorios de red (socket hang up,
  // ECONNRESET, timeout). No reintenta errores 4xx/5xx con respuesta.
  let response;
  try {
    response = await doKommoCall(method, pathname, data, token);
  } catch (error) {
    if (isTransientNetworkError(error)) {
      await sleep(300);
      try {
        response = await doKommoCall(method, pathname, data, token);
      } catch (retryNetError) {
        store.setKommoLastError({
          ...summarizeKommoError(retryNetError),
          at: Date.now()
        });
        throw retryNetError;
      }
    } else if (error.response?.status === 401) {
      try {
        token = await refreshTokens();
        response = await doKommoCall(method, pathname, data, token);
      } catch (retryError) {
        store.setKommoLastError({
          ...summarizeKommoError(retryError),
          at: Date.now()
        });
        throw retryError;
      }
    } else {
      store.setKommoLastError({
        ...summarizeKommoError(error),
        at: Date.now()
      });
      throw error;
    }
  }

  store.clearKommoLastError();
  return response.data;
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

async function fetchLeadTags(leadId) {
  if (!leadId) {
    return [];
  }

  try {
    const lead = await apiRequest('get', `/api/v4/leads/${leadId}?with=tags`);
    const tags = lead?._embedded?.tags || [];
    return tags.map((t) => ({
      id: t.id,
      name: String(t.name || '').trim(),
      color: t.color || null
    })).filter((t) => t.name);
  } catch (error) {
    return [];
  }
}

// Devuelve tags + pipeline_id + status_id en una sola llamada
async function fetchLeadDetail(leadId) {
  if (!leadId) {
    return { tags: [], pipelineId: null, statusId: null };
  }

  try {
    const lead = await apiRequest('get', `/api/v4/leads/${leadId}?with=tags`);
    const rawTags = lead?._embedded?.tags || [];
    const tags = rawTags.map((t) => ({
      id: t.id,
      name: String(t.name || '').trim(),
      color: t.color || null
    })).filter((t) => t.name);
    return {
      tags,
      pipelineId: lead?.pipeline_id ? Number(lead.pipeline_id) : null,
      statusId: lead?.status_id ? Number(lead.status_id) : null
    };
  } catch (error) {
    return { tags: [], pipelineId: null, statusId: null };
  }
}

// Devuelve estructura plana { pipelineId: { name, statuses: { statusId: name } } }
async function fetchPipelinesMap() {
  try {
    const resp = await apiRequest('get', '/api/v4/leads/pipelines');
    const pipelines = resp?._embedded?.pipelines || [];
    const map = {};
    for (const p of pipelines) {
      const statuses = {};
      const stArr = p?._embedded?.statuses || [];
      for (const s of stArr) {
        statuses[Number(s.id)] = String(s.name || '').trim();
      }
      map[Number(p.id)] = {
        name: String(p.name || '').trim(),
        statuses
      };
    }
    return map;
  } catch (error) {
    return {};
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

// Sube un archivo a Kommo para enviarlo como media real de WhatsApp.
// Devuelve { uuid, type, name, size }. Lanza excepción si falla (no atrapa internamente).
async function uploadChatFile(buffer, filename, mimeType, chatId) {
  const token = await getValidAccessToken();
  const baseUrl = getBaseUrl();
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });
  const url = chatId
    ? `${baseUrl}/api/v4/chat/uploads?chat_id=${encodeURIComponent(chatId)}`
    : `${baseUrl}/api/v4/chat/uploads`;
  const response = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${token}`
    },
    timeout: 30000
  });
  return response.data;
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
  fetchLeadTags,
  fetchLeadDetail,
  fetchPipelinesMap,
  listContactFields,
  listSources,
  fetchChatMessages,
  uploadChatFile,
  launchSalesbot,
  callReturnUrl,
  getValidAccessToken,
  getBaseUrl,
  parseJwtPayload,
  verifyJwt,
  getSubdomain,
  apiRequest
};
