// Endpoints del Dashboard Analytics.
//   GET /api/analytics/dashboard?period=today&advisorId=&compare=1
//     - admin sin advisorId: métricas del equipo + breakdown por advisor
//     - admin con advisorId: filtra a un advisor específico
//     - asesor: ignora advisorId y fuerza al propio
//   GET /api/analytics/advisors  lista resumida de advisors para selector

const express = require('express');
const service = require('./service');

module.exports = function createAnalyticsRouter(db) {
  const router = express.Router();

  router.get('/dashboard', (req, res) => {
    const { period = 'today', advisorId, compare } = req.query;
    const isAdmin = req.advisor?.role === 'admin';
    // Asesor solo puede ver sus propias métricas — ignoramos advisorId
    let effectiveAdvisorId = isAdmin && advisorId ? Number(advisorId) : (isAdmin ? null : req.advisor?.id);
    if (!Number.isFinite(effectiveAdvisorId)) effectiveAdvisorId = null;

    try {
      const opts = { period, advisorId: effectiveAdvisorId, isAdmin };
      const data = compare === '1'
        ? service.getDashboardWithComparison(db, req.tenantId, opts)
        : service.getDashboardData(db, req.tenantId, opts);
      res.json(data);
    } catch (err) {
      console.error('[analytics/dashboard]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Lista mínima de advisors para el selector del filtro (sólo admin)
  router.get('/advisors', (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo admins' });
    }
    const items = db.prepare(`
      SELECT id, name, username, role, active
        FROM advisors
       WHERE tenant_id = ? AND active = 1
       ORDER BY id ASC
    `).all(req.tenantId);
    res.json({ items });
  });

  return router;
};
