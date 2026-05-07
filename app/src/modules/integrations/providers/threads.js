// Provider: Threads API (Meta) — respuesta a menciones y comentarios.
// Docs: https://developers.facebook.com/docs/threads

module.exports = {
  meta: {
    key: 'threads',
    name: 'Threads',
    description: 'Recibe y responde menciones y comentarios en tu cuenta de Threads.',
    color: '#000000',
    initial: 'Th',
    authType: 'oauth_threads',
    docsUrl: 'https://developers.facebook.com/docs/threads',
    setupSteps: [],
  },
  fields: [],
  async test({ credentials }) {
    const { accessToken, threadsUserId } = credentials;
    if (!accessToken) return { ok: false, message: 'Falta access token. Completa el flujo OAuth.' };
    try {
      const res = await fetch(`https://graph.threads.net/me?fields=id,username,name&access_token=${accessToken}`);
      const data = await res.json();
      if (!res.ok || data.error) return { ok: false, message: data.error?.message || `HTTP ${res.status}` };
      return {
        ok: true,
        displayName: data.username ? `@${data.username}` : data.name || `Threads ${data.id}`,
        externalId: String(data.id || threadsUserId),
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  },
};
