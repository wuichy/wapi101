// Burbuja flotante de soporte para las páginas PÚBLICAS de wapi101.com
// (home, signup, login, blog, /vs/*, /crm-*, about, developers…).
// Abre WhatsApp con Luis. Es un solo archivo para que todas las páginas
// compartan la misma burbuja: cambiar el número o el texto aquí basta.
//
// Dentro de la app (/app) NO se carga este archivo: ahí vive otra burbuja con
// lógica de tenant (setupSupportBubble en app.js).
(function () {
  if (document.getElementById('waSupportBubble')) return;   // idempotente

  var NUMERO = '523349657193';
  var ruta   = location.pathname === '/' ? 'la página principal' : location.pathname;
  var texto  = 'Hola Luis, estoy viendo wapi101.com (' + ruta + ') y tengo una duda: ';

  var css = document.createElement('style');
  css.textContent = [
    '.wa-sb{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;height:54px;',
    'border-radius:999px;background:#25D366;color:#fff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,',
    '"Segoe UI",Inter,Roboto,sans-serif;box-shadow:0 8px 24px rgba(37,211,102,.38),0 2px 6px rgba(0,0,0,.18);',
    'transition:transform .15s,box-shadow .15s}',
    '.wa-sb:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(37,211,102,.5),0 3px 8px rgba(0,0,0,.2)}',
    '.wa-sb-ic{width:54px;height:54px;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.wa-sb-lb{max-width:0;overflow:hidden;white-space:nowrap;font-size:14px;font-weight:600;padding-left:0;',
    'transition:max-width .25s ease,padding .25s ease}',
    '.wa-sb:hover .wa-sb-lb,.wa-sb:focus-visible .wa-sb-lb{max-width:200px;padding-left:16px}',
    '@media (max-width:720px){.wa-sb{right:14px;bottom:14px;height:48px}.wa-sb-ic{width:48px;height:48px}.wa-sb-lb{display:none}}',
  ].join('');
  document.head.appendChild(css);

  var a = document.createElement('a');
  a.id = 'waSupportBubble';
  a.className = 'wa-sb';
  a.href = 'https://wa.me/' + NUMERO + '?text=' + encodeURIComponent(texto);
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Escríbenos por WhatsApp');
  a.innerHTML =
    '<span class="wa-sb-lb">¿Dudas? Escríbenos</span>' +
    '<span class="wa-sb-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor">' +
    '<path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg></span>';
  (document.body || document.documentElement).appendChild(a);
})();
