-- Migration 048: módulo de citas + horarios de negocio
--
-- Permite que el bot agende citas para los clientes contra la disponibilidad
-- configurada del negocio y de cada asesor.
--
-- Tablas:
--   business_hours              horario maestro del negocio (1 fila por
--                               (tenant, day_of_week, kind='base'))
--   advisor_business_hours      override por asesor (medios turnos, especiales)
--   appointments                citas agendadas (con cliente, asesor, fecha,
--                               vinculadas a contacto/lead/conversación)
--   appointment_reminders       recordatorios programados (1h antes, etc.)

-- ─── 1. Horarios del negocio (maestro) ─────────────────────────────────
-- day_of_week: 0=domingo, 1=lunes, ..., 6=sábado
CREATE TABLE IF NOT EXISTS business_hours (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL DEFAULT 1,
  day_of_week  INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  open_time    TEXT,                          -- HH:MM (ej. "09:00") o NULL si cerrado
  close_time   TEXT,                          -- HH:MM (ej. "18:00") o NULL si cerrado
  is_closed    INTEGER NOT NULL DEFAULT 0,    -- 0=abierto, 1=cerrado todo el día
  timezone     TEXT,                          -- IANA tz (ej. "America/Mexico_City"). NULL = usar TZ del proceso
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(tenant_id, day_of_week)
);

-- ─── 2. Horarios por asesor (override del maestro) ─────────────────────
CREATE TABLE IF NOT EXISTS advisor_business_hours (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL DEFAULT 1,
  advisor_id   INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  open_time    TEXT,                          -- HH:MM o NULL si no trabaja ese día
  close_time   TEXT,
  is_off       INTEGER NOT NULL DEFAULT 0,    -- 1 = no trabaja ese día (override del maestro)
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(tenant_id, advisor_id, day_of_week)
);

-- ─── 3. Citas agendadas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL DEFAULT 1,
  contact_id      INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  expedient_id    INTEGER REFERENCES expedients(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  advisor_id      INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  starts_at       INTEGER NOT NULL,                       -- unix ts
  ends_at         INTEGER NOT NULL,
  duration_min    INTEGER NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','confirmed','cancelled','rescheduled','completed','no_show')),
  notes           TEXT,
  created_by_advisor_id  INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  created_via            TEXT,                            -- 'bot' | 'manual' | 'api'
  cancelled_at    INTEGER,
  cancelled_by    TEXT,                                   -- 'client' | 'advisor' | 'system'
  cancellation_reason TEXT,
  rescheduled_from_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant       ON appointments(tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_advisor      ON appointments(advisor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_contact      ON appointments(contact_id);
CREATE INDEX IF NOT EXISTS idx_appointments_expedient    ON appointments(expedient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status       ON appointments(tenant_id, status, starts_at);

-- ─── 4. Recordatorios de citas ─────────────────────────────────────────
-- Cuando un bot ejecuta el step "Temporizador de Cita", crea filas aquí
-- con send_at calculado. Un poller backend escanea y envía cuando vence.
CREATE TABLE IF NOT EXISTS appointment_reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL DEFAULT 1,
  appointment_id  INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,                         -- 'relative' | 'fixed'
  config_json     TEXT NOT NULL,                         -- {minutesBefore: 60} o {fixedHour: '21:00', daysBefore: 1}
  recipient       TEXT NOT NULL,                         -- 'client' | 'advisor' | 'both'
  message_template TEXT,                                 -- texto custom o NULL para usar default
  send_at         INTEGER NOT NULL,                      -- unix ts calculado al crear
  sent            INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER,
  error           TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_app_reminders_send ON appointment_reminders(sent, send_at);
CREATE INDEX IF NOT EXISTS idx_app_reminders_appt ON appointment_reminders(appointment_id);

-- ─── 5. Default: insertar horario base L-V 9-18 para cada tenant ───────
INSERT OR IGNORE INTO business_hours (tenant_id, day_of_week, open_time, close_time, is_closed)
SELECT t.id, d.dow,
       CASE WHEN d.dow IN (0, 6) THEN NULL ELSE '09:00' END,
       CASE WHEN d.dow IN (0, 6) THEN NULL ELSE '18:00' END,
       CASE WHEN d.dow IN (0, 6) THEN 1 ELSE 0 END
  FROM tenants t
  CROSS JOIN (
    SELECT 0 AS dow UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL
    SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
  ) d;
