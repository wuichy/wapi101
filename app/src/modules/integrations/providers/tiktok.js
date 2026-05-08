// Provider: TikTok — lee comentarios de videos y permite responderlos desde el CRM.
// Docs: https://developers.tiktok.com/

// Scopes necesarios en el panel de TikTok Developer:
//   user.info.basic     — información del usuario
//   video.list          — listar videos propios
//   video.comment.read  — leer comentarios (requiere solicitud en TikTok Developer)
//   video.comment.manage — responder/gestionar comentarios (requiere solicitud)

module.exports = {
  meta: {
    key: 'tiktok',
    name: 'TikTok',
    description: 'Lee comentarios de tus videos de TikTok y respóndelos directamente desde el CRM.',
    color: '#000000',
    textColor: '#ffffff',
    initial: 'T',
    authType: 'oauth_tiktok',
    category: 'social',
    docsUrl: 'https://developers.tiktok.com/',
  },
  fields: [],
  test,
};

async function test({ credentials }) {
  const { accessToken, openId } = credentials;
  if (!accessToken) {
    return { ok: false, message: 'Aún no hay access_token. Completa el flujo OAuth primero.' };
  }
  try {
    const res = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    if (!res.ok || data?.error?.code) {
      return { ok: false, message: data?.error?.message || `HTTP ${res.status}` };
    }
    const user = data.data?.user || {};
    return {
      ok: true,
      displayName: user.display_name ? `@${user.display_name}` : `@${openId || 'tiktok'}`,
      externalId:  user.open_id || openId,
      details:     { avatarUrl: user.avatar_url },
    };
  } catch (err) {
    return { ok: false, message: `Red: ${err.message}` };
  }
}
