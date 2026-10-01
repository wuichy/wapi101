// casa-avisos — los avisos de la casa (smarthouse) al celular de Luis.
//
// Lo dispara el vigía de la casa (/usr/local/bin/vigia-casa, en este mismo VPS,
// cada minuto) cuando la casa se cae o vuelve: el servidor del iPhone dejó de
// contestar, se cayó el túnel, etc.
//
// CANAL: notificación push de wapi (iPhone y Mac de Luis, sus 2 suscripciones).
// Hasta el 30-sep-2026 salía por WhatsApp Lite, del +52 1 33 2294 9686
// (integración 37) a su personal +52 1 33 4965 7193 — y las 3 veces que mandó
// algo, WhatsApp desvinculó el 9686 a los 2-3 s (401 conflict: 29-sep 16:50,
// 30-sep 15:51 y 20:51). Ese número es el contacto público del sitio (burbuja,
// schema), así que no puede caerse cada vez que la casa parpadea. Mandar avisos
// automáticos por una línea vinculada por QR es justo lo que WhatsApp castiga;
// si se quieren por WhatsApp, la vía es la API oficial con plantilla de utilidad.
//
// Puerta angosta, mismo criterio que /group-notify y Chancluda:
//   1. El DESTINO y la LÍNEA son constantes de este módulo: nadie con la llave
//      puede apuntarle a otro número ni mandar por otra línea.
//   2. Llave en /root/.wapi101/casa-avisos.token (0600), la misma que lee el
//      vigía. Sin ese archivo no manda nada (403).
//   3. Antirrebote: el mismo texto en menos de 2 min se descarta.
//   4. Tope de 12 avisos por hora: un vigía descompuesto no puede inundar el chat.
//   5. Sale por pushSvc.sendToAll del tenant de Luis: no toca WhatsApp, ni
//      bots, ni IA, ni plantillas. Queda en la bitácora (alert_log, kind
//      'casa_aviso') y se ve en Monitor.

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');

const CANAL = 'push';                   // ver cabecera: NO por WhatsApp Lite
const TENANT = 1;                       // Luis (sus suscripciones push: iPhone y Mac)
const LLAVE_RUTA = process.env.CASA_AVISOS_TOKEN_FILE || '/root/.wapi101/casa-avisos.token';
const TOPE_HORA = 12;
const REBOTE_MS = 2 * 60 * 1000;

let _ultimo = { texto: null, t: 0 };
const _enviados = [];                    // marcas (ms) de lo mandado en la última hora

function _leerLlave() {
  try { return fs.readFileSync(LLAVE_RUTA, 'utf8').trim() || null; } catch { return null; }
}

function _iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function router(deps = {}) {
  const r = express.Router();
  const leerLlave = deps.leerLlave || _leerLlave;
  const enviar = deps.enviar || (async (texto) => {
    if (!deps.db) throw new Error('casa-avisos montado sin db');
    const r = await require('../notifications/service').sendToAll(deps.db, TENANT, {
      title: '🏠 Casa',
      body:  texto,
      tag:   'casa-avisos',          // el aviso nuevo reemplaza al anterior en la pantalla
      url:   '/app',
    }, { kind: 'casa_aviso' });
    if (r?.skipped) throw new Error('push no configurado (VAPID)');
    if (!r?.sent) throw new Error(`push sin entregar (${r?.failed || 0} fallidas)`);
    return `push ${r.sent}/${r.sent + (r.failed || 0)}`;
  });

  r.post('/aviso', express.json({ limit: '16kb' }), async (req, res) => {
    const llave = leerLlave();
    if (!llave) return res.status(403).json({ error: 'sin llave configurada' });
    const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m || !_iguales(m[1].trim(), llave)) return res.status(401).json({ error: 'llave inválida' });

    const texto = String(req.body?.text || '').trim();
    if (!texto) return res.status(400).json({ error: 'text vacío' });
    if (texto.length > 1000) return res.status(400).json({ error: 'text muy largo (máx 1000)' });

    const ahora = Date.now();
    if (_ultimo.texto === texto && ahora - _ultimo.t < REBOTE_MS) {
      return res.json({ ok: true, sent: false, reason: 'duplicado' });
    }
    while (_enviados.length && ahora - _enviados[0] > 3600 * 1000) _enviados.shift();
    if (_enviados.length >= TOPE_HORA) {
      console.warn('[casa-avisos] tope de %d por hora: se descarta', TOPE_HORA);
      return res.status(429).json({ error: 'tope por hora' });
    }

    try {
      const id = await enviar(texto);
      _ultimo = { texto, t: ahora };
      _enviados.push(ahora);
      console.log(`[casa-avisos] → ${CANAL} · ${texto.length} chars · ${id}`);
      res.json({ ok: true, sent: true, messageId: id });
    } catch (err) {
      console.error('[casa-avisos] no se pudo mandar:', err.message);
      res.status(502).json({ error: err.message });
    }
  });
  return r;
}

module.exports = {
  router, CANAL, TENANT, TOPE_HORA,
  _reset() { _ultimo = { texto: null, t: 0 }; _enviados.length = 0; },
};
