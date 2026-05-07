'use strict';

// Límites por plan. null = sin límite.
const PLAN_LIMITS = {
  owner:     { contacts: null,   leads: null,  users: null },
  ejecutivo: { contacts: null,   leads: null,  users: null },
  ultra:     { contacts: 100000, leads: 50000, users: 2 },
  pro:       { contacts: 30000,  leads: 15000, users: 2 },
  basico:    { contacts: 8000,   leads: 4000,  users: 2 },
  free:      { contacts: 300,    leads: 100,   users: 1 },
};

function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

// Verifica si el tenant puede crear más de un recurso.
// extraUsers: columna extra_users del tenant (slots comprados).
// Devuelve null si OK, o string con el mensaje de error.
function checkLimit(db, tenantId, plan, resource, extraUsers = 0) {
  const limits = getLimits(plan);
  const cap = limits[resource];
  if (cap === null) return null; // ilimitado

  let effective = cap;
  if (resource === 'users') effective = cap + Number(extraUsers || 0);

  let count;
  if (resource === 'contacts') {
    count = db.prepare('SELECT COUNT(*) as n FROM contacts WHERE tenant_id = ?').get(tenantId)?.n || 0;
  } else if (resource === 'leads') {
    count = db.prepare('SELECT COUNT(*) as n FROM expedients WHERE tenant_id = ?').get(tenantId)?.n || 0;
  } else if (resource === 'users') {
    count = db.prepare('SELECT COUNT(*) as n FROM advisors WHERE tenant_id = ? AND active = 1').get(tenantId)?.n || 0;
  } else {
    return null;
  }

  if (count >= effective) {
    const labels = { contacts: 'contactos', leads: 'leads', users: 'usuarios' };
    return `Límite de ${labels[resource]} alcanzado (${effective}). Actualiza tu plan para continuar.`;
  }
  return null;
}

module.exports = { PLAN_LIMITS, getLimits, checkLimit };
