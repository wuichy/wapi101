'use strict';

// Endpoint PÚBLICO de ingesta de analítica de visitantes. Se monta ANTES del
// authMiddleware (en /api/track) — la landing pública no tiene token.
const express = require('express');
const svc = require('./service');

function geoFromCloudflare(req) {
  // Cloudflare manda CF-IPCountry siempre. region/city requieren el Managed
  // Transform "Add visitor location headers" activado en Cloudflare.
  return {
    country: (req.headers['cf-ipcountry'] || '').toUpperCase() || null,
    region:  req.headers['cf-region'] || req.headers['cf-region-code'] || null,
    city:    req.headers['cf-ipcity'] || null,
  };
}

function publicRouter(db) {
  const router = express.Router();
  router.post('/', express.json({ limit: '64kb' }), (req, res) => {
    try {
      const out = svc.track(db, req.body || {}, geoFromCloudflare(req));
      // 204 sin cuerpo — el tracker no necesita respuesta (beacon-friendly).
      res.status(204).end();
      void out;
    } catch (err) {
      // Nunca fallar ruidoso en el tracker — solo loguear.
      console.error('[visitors] track error:', err.message);
      res.status(204).end();
    }
  });
  return router;
}

module.exports = { publicRouter };
