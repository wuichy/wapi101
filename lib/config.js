const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function required(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

module.exports = {
  appVersion: String(packageJson.version || '1.0.0'),
  port: Number(process.env.PORT || 3000),
  appBaseUrl: required('APP_BASE_URL', 'http://localhost:3000'),
  storageFile: path.join(process.cwd(), 'data', 'app-state.json'),
  auth: {
    password: required('APP_PASSWORD', ''),
    sessionSecret: required('APP_SESSION_SECRET', ''),
    cookieName: 'rh_session',
    sessionDurationMs: 30 * 24 * 60 * 60 * 1000
  },
  kommo: {
    subdomain: required('KOMMO_SUBDOMAIN'),
    clientId: required('KOMMO_CLIENT_ID'),
    clientSecret: required('KOMMO_CLIENT_SECRET'),
    redirectUri: required('KOMMO_REDIRECT_URI'),
    salesbotId: process.env.KOMMO_SALESBOT_ID ? Number(process.env.KOMMO_SALESBOT_ID) : null,
    sourceId: process.env.KOMMO_SOURCE_ID ? Number(process.env.KOMMO_SOURCE_ID) : null
  },
  push: {
    publicKey: required('VAPID_PUBLIC_KEY', ''),
    privateKey: required('VAPID_PRIVATE_KEY', ''),
    subject: required('VAPID_SUBJECT', 'mailto:admin@example.com')
  }
};
