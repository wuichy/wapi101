const { getSession } = require('../modules/advisors/service');

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function authMiddleware(db) {
  return (req, res, next) => {
    const token = extractToken(req);
    const advisor = getSession(db, token);
    if (!advisor) {
      return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }
    req.advisor = advisor;
    next();
  };
}

module.exports = { authMiddleware, extractToken };
