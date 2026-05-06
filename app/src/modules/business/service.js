// Servicio de horarios del negocio + por asesor.
// Se usa para validar slots disponibles cuando el bot agenda citas.

const DAYS_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

// ─── Horario maestro del negocio ─────────────────────────────────────────
function getMasterHours(db, tenantId) {
  const rows = db.prepare('SELECT * FROM business_hours WHERE tenant_id = ? ORDER BY day_of_week').all(tenantId);
  return rows.map(r => ({
    dayOfWeek: r.day_of_week,
    dayLabel: DAYS_ES[r.day_of_week],
    openTime: r.open_time,
    closeTime: r.close_time,
    isClosed: !!r.is_closed,
    timezone: r.timezone,
  }));
}

function setMasterHours(db, tenantId, hours) {
  // hours: [{ dayOfWeek, openTime, closeTime, isClosed }]
  if (!Array.isArray(hours)) throw new Error('hours debe ser array');
  const upsert = db.prepare(`
    INSERT INTO business_hours (tenant_id, day_of_week, open_time, close_time, is_closed)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, day_of_week) DO UPDATE SET
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      is_closed = excluded.is_closed,
      updated_at = unixepoch()
  `);
  const trx = db.transaction((arr) => {
    for (const h of arr) {
      const dow = Number(h.dayOfWeek);
      if (!Number.isFinite(dow) || dow < 0 || dow > 6) continue;
      const closed = h.isClosed || (!h.openTime && !h.closeTime) ? 1 : 0;
      upsert.run(tenantId, dow,
        closed ? null : (h.openTime || null),
        closed ? null : (h.closeTime || null),
        closed
      );
    }
  });
  trx(hours);
  return getMasterHours(db, tenantId);
}

// ─── Horarios por asesor ─────────────────────────────────────────────────
// Devuelve [{ dayOfWeek, dayLabel, openTime, closeTime, isOff,
//   effectiveOpen, effectiveClose, effectiveClosed }]
// donde effective* es el horario realmente aplicable después de aplicar el
// override del asesor sobre el maestro.
function getAdvisorHours(db, tenantId, advisorId) {
  const master = getMasterHours(db, tenantId);
  const overrides = db.prepare('SELECT * FROM advisor_business_hours WHERE tenant_id = ? AND advisor_id = ?').all(tenantId, advisorId);
  const overrideByDay = new Map(overrides.map(o => [o.day_of_week, o]));
  return master.map(m => {
    const o = overrideByDay.get(m.dayOfWeek);
    if (!o) {
      return { ...m, hasOverride: false, effectiveOpen: m.openTime, effectiveClose: m.closeTime, effectiveClosed: m.isClosed };
    }
    if (o.is_off) {
      return { ...m, hasOverride: true, effectiveOpen: null, effectiveClose: null, effectiveClosed: true, isOff: true };
    }
    return {
      ...m,
      hasOverride: true,
      isOff: false,
      effectiveOpen: o.open_time || m.openTime,
      effectiveClose: o.close_time || m.closeTime,
      effectiveClosed: m.isClosed,
    };
  });
}

function setAdvisorHours(db, tenantId, advisorId, hours) {
  if (!Array.isArray(hours)) throw new Error('hours debe ser array');
  const adv = db.prepare('SELECT id FROM advisors WHERE id = ? AND tenant_id = ?').get(advisorId, tenantId);
  if (!adv) throw new Error('Asesor no encontrado');
  const upsert = db.prepare(`
    INSERT INTO advisor_business_hours (tenant_id, advisor_id, day_of_week, open_time, close_time, is_off)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, advisor_id, day_of_week) DO UPDATE SET
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      is_off = excluded.is_off,
      updated_at = unixepoch()
  `);
  const trx = db.transaction((arr) => {
    for (const h of arr) {
      const dow = Number(h.dayOfWeek);
      if (!Number.isFinite(dow) || dow < 0 || dow > 6) continue;
      const off = h.isOff ? 1 : 0;
      upsert.run(tenantId, advisorId, dow,
        off ? null : (h.openTime || null),
        off ? null : (h.closeTime || null),
        off
      );
    }
  });
  trx(hours);
  return getAdvisorHours(db, tenantId, advisorId);
}

// ─── Disponibilidad: ¿está abierto/disponible en un timestamp? ───────────
// Comprueba contra el horario maestro o el del asesor si advisorId.
function isWithinHours(db, tenantId, dateMs, advisorId = null) {
  const d = new Date(dateMs);
  const dow = d.getDay();
  const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  let row;
  if (advisorId) {
    const advisorHours = getAdvisorHours(db, tenantId, advisorId).find(h => h.dayOfWeek === dow);
    if (!advisorHours) return false;
    if (advisorHours.effectiveClosed) return false;
    return hhmm >= (advisorHours.effectiveOpen || '00:00') && hhmm < (advisorHours.effectiveClose || '24:00');
  }
  row = db.prepare('SELECT * FROM business_hours WHERE tenant_id = ? AND day_of_week = ?').get(tenantId, dow);
  if (!row || row.is_closed) return false;
  return hhmm >= (row.open_time || '00:00') && hhmm < (row.close_time || '24:00');
}

// ─── Perfil del negocio (datos del tenant que el cliente edita) ─────────
function getProfile(db, tenantId) {
  const row = db.prepare(`
    SELECT id, slug, display_name, business_url, business_address,
           business_logo_url, business_phone
      FROM tenants
     WHERE id = ?
  `).get(tenantId);
  if (!row) return null;
  return {
    id:           row.id,
    slug:         row.slug,
    displayName:  row.display_name,
    url:          row.business_url     || '',
    address:      row.business_address || '',
    logoUrl:      row.business_logo_url|| '',
    phone:        row.business_phone   || '',
  };
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function setProfile(db, tenantId, payload = {}) {
  const fields = [];
  const params = [];

  if (payload.displayName !== undefined) {
    const v = String(payload.displayName).trim();
    if (!v) throw new Error('El nombre del negocio es obligatorio');
    fields.push('display_name = ?'); params.push(v);
  }
  if (payload.slug !== undefined) {
    const v = String(payload.slug).trim().toLowerCase();
    if (!SLUG_RE.test(v)) throw new Error('El slug solo permite letras, números y guiones (3 a 40 caracteres). Debe empezar con letra o número.');
    // Verificar unicidad (excluyendo el propio tenant)
    const dupe = db.prepare('SELECT id FROM tenants WHERE slug = ? AND id != ?').get(v, tenantId);
    if (dupe) throw new Error(`El slug "${v}" ya está en uso por otro negocio`);
    fields.push('slug = ?'); params.push(v);
  }
  if (payload.url !== undefined) {
    const v = String(payload.url).trim();
    if (v && !/^https?:\/\//i.test(v)) throw new Error('La URL debe empezar con http:// o https://');
    fields.push('business_url = ?'); params.push(v || null);
  }
  if (payload.address !== undefined) {
    const v = String(payload.address).trim();
    fields.push('business_address = ?'); params.push(v || null);
  }
  if (payload.logoUrl !== undefined) {
    const v = String(payload.logoUrl).trim();
    fields.push('business_logo_url = ?'); params.push(v || null);
  }
  if (payload.phone !== undefined) {
    const v = String(payload.phone).trim();
    fields.push('business_phone = ?'); params.push(v || null);
  }

  if (!fields.length) return getProfile(db, tenantId);

  fields.push('updated_at = unixepoch()');
  params.push(tenantId);
  db.prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getProfile(db, tenantId);
}

module.exports = {
  getMasterHours, setMasterHours,
  getAdvisorHours, setAdvisorHours,
  isWithinHours,
  getProfile, setProfile,
};
