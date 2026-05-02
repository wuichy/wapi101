// Provider: TikTok for Developers (Login Kit + Display + Content Posting).
// Docs: https://developers.tiktok.com/

module.exports = {
  meta: {
    key: 'tiktok',
    name: 'TikTok',
    description: 'Publica videos y lee información de tu cuenta TikTok.',
    color: '#000000',
    initial: 'T',
    authType: 'oauth_tiktok',
    docsUrl: 'https://developers.tiktok.com/'
  },
  fields: [
    { key: 'clientKey',    label: 'Client Key',     type: 'text',     required: true,
      help: 'En developers.tiktok.com → tu app → Basic information' },
    { key: 'clientSecret', label: 'Client Secret',  type: 'password', required: true, secret: true },
    { key: 'accessToken',  label: 'Access Token',   type: 'password', required: false, secret: true,
      help: 'Se obtiene tras OAuth. Déjalo vacío al inicio.' },
    { key: 'refreshToken', label: 'Refresh Token',  type: 'password', required: false, secret: true },
    { key: 'openId',       label: 'Open ID',        type: 'text',     required: false,
      help: 'ID del usuario TikTok autorizado.' }
  ],
  async test({ credentials }) {
    const { accessToken, openId } = credentials;
    if (!accessToken) {
      return { ok: false, message: 'Aún no hay access_token. Completa el flujo OAuth primero.' };
    }
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (!res.ok || data?.error?.code) {
        return { ok: false, message: data?.error?.message || `HTTP ${res.status}` };
      }
      const user = data.data?.user;
      return {
        ok: true,
        displayName: user?.display_name || `@${openId || 'tiktok'}`,
        externalId: user?.open_id || openId,
        details: { avatarUrl: user?.avatar_url }
      };
    } catch (err) {
      return { ok: false, message: `Red: ${err.message}` };
    }
  }
};
