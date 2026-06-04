/* Tracker de visitantes de la landing pública de wapi101.com.
 * Se incluye SOLO en páginas públicas (landing, signup, login, etc.), NUNCA en
 * /app (el CRM) ni /super. Manda pageviews + heartbeat a POST /api/track.
 * Privacidad: respeta Do Not Track y Global Privacy Control. */
(function () {
  try {
    // No trackear el CRM ni el panel admin (por si el script se incluye por error).
    var p = location.pathname || '/';
    if (/^\/(app|super|api|preview)/.test(p)) return;

    // Respetar señales de privacidad del navegador.
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
        navigator.globalPrivacyControl === true) return;

    // sessionId persistente (un visitante = un id).
    var KEY = 'wapi_vid';
    var sid = '';
    try { sid = localStorage.getItem(KEY) || ''; } catch (e) {}
    if (!sid) {
      sid = (crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      try { localStorage.setItem(KEY, sid); } catch (e) {}
    }

    // UTM solo en la primera vista de esta sesión de navegador.
    var qp = new URLSearchParams(location.search);
    var firstTouch = false;
    try { firstTouch = !sessionStorage.getItem('wapi_vit'); sessionStorage.setItem('wapi_vit', '1'); } catch (e) { firstTouch = true; }

    function send(extra) {
      var body = Object.assign({
        sessionId: sid,
        path: location.pathname,
        title: document.title,
        referrer: document.referrer || '',
        userAgent: navigator.userAgent || '',
      }, extra || {});
      if (firstTouch) {
        body.utmSource   = qp.get('utm_source')   || undefined;
        body.utmMedium   = qp.get('utm_medium')   || undefined;
        body.utmCampaign = qp.get('utm_campaign') || undefined;
        body.utmContent  = qp.get('utm_content')  || undefined;
      }
      try {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    }

    // Pageview inicial.
    send();
    firstTouch = false;

    // Heartbeat: cada 20s mientras la pestaña esté visible → solo refresca
    // last_seen_at (mide duración incluso en visitas de 1 página).
    var hb = setInterval(function () {
      if (document.visibilityState === 'visible') {
        send({ ping: true });
      }
    }, 20000);

    // Ping final al ocultar/cerrar (sendBeacon es más confiable al salir).
    function bye() {
      try {
        var data = JSON.stringify({ sessionId: sid, ping: true });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/track', new Blob([data], { type: 'application/json' }));
        }
      } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') bye();
    });
    window.addEventListener('pagehide', bye);
    void hb;
  } catch (e) { /* nunca romper la página por el tracker */ }
})();
