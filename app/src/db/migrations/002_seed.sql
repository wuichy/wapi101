-- Datos iniciales: pipeline "Ventas" con etapas, contactos demo y un par de leads.
-- Solo corre si no hay pipelines aún (idempotente).

INSERT INTO pipelines (id, name, color, sort_order)
SELECT 1, 'Ventas', '#2563eb', 0
WHERE NOT EXISTS (SELECT 1 FROM pipelines);

INSERT INTO stages (pipeline_id, name, color, sort_order, kind)
SELECT 1, 'Nuevo',       '#3b82f6', 0, 'in_progress' WHERE NOT EXISTS (SELECT 1 FROM stages WHERE pipeline_id = 1);
INSERT INTO stages (pipeline_id, name, color, sort_order, kind)
SELECT 1, 'Interesado',  '#f59e0b', 1, 'in_progress' WHERE (SELECT COUNT(*) FROM stages WHERE pipeline_id = 1) = 1;
INSERT INTO stages (pipeline_id, name, color, sort_order, kind)
SELECT 1, 'Cotizando',   '#a855f7', 2, 'in_progress' WHERE (SELECT COUNT(*) FROM stages WHERE pipeline_id = 1) = 2;
INSERT INTO stages (pipeline_id, name, color, sort_order, kind)
SELECT 1, 'Por pagar',   '#06b6d4', 3, 'in_progress' WHERE (SELECT COUNT(*) FROM stages WHERE pipeline_id = 1) = 3;
INSERT INTO stages (pipeline_id, name, color, sort_order, kind)
SELECT 1, 'Ganado',      '#10b981', 4, 'won'         WHERE (SELECT COUNT(*) FROM stages WHERE pipeline_id = 1) = 4;
INSERT INTO stages (pipeline_id, name, color, sort_order, kind)
SELECT 1, 'Perdido',     '#ef4444', 5, 'lost'        WHERE (SELECT COUNT(*) FROM stages WHERE pipeline_id = 1) = 5;

-- Contactos demo (solo si la tabla está vacía)
INSERT INTO contacts (first_name, last_name, phone, email)
SELECT 'María','González','+525512345678','maria@gmail.com'
WHERE NOT EXISTS (SELECT 1 FROM contacts);

INSERT INTO contacts (first_name, last_name, phone, email)
SELECT 'Carlos','Ramírez','+522223334444','carlos@gmail.com'
WHERE (SELECT COUNT(*) FROM contacts) = 1;

INSERT INTO contacts (first_name, last_name, phone, email)
SELECT 'Ana','Martínez','+525551112222','ana@hotmail.com'
WHERE (SELECT COUNT(*) FROM contacts) = 2;

-- Tags
INSERT OR IGNORE INTO contact_tags (contact_id, tag)
SELECT id, 'interesado' FROM contacts WHERE first_name='María';
INSERT OR IGNORE INTO contact_tags (contact_id, tag)
SELECT id, 'serum facial' FROM contacts WHERE first_name='María';
INSERT OR IGNORE INTO contact_tags (contact_id, tag)
SELECT id, 'VIP' FROM contacts WHERE first_name='Carlos';
INSERT OR IGNORE INTO contact_tags (contact_id, tag)
SELECT id, 'frecuente' FROM contacts WHERE first_name='Carlos';

-- Leads demo: María tiene 2 leads (en Interesado y en Cotizando), Carlos uno
INSERT INTO leads (contact_id, pipeline_id, stage_id, name, value)
SELECT c.id, 1, s.id, 'Serum Facial', 1250
FROM contacts c, stages s
WHERE c.first_name='María' AND s.pipeline_id=1 AND s.name='Interesado'
  AND NOT EXISTS (SELECT 1 FROM leads);

INSERT INTO leads (contact_id, pipeline_id, stage_id, name, value)
SELECT c.id, 1, s.id, 'Crema Corporal', 850
FROM contacts c, stages s
WHERE c.first_name='María' AND s.pipeline_id=1 AND s.name='Cotizando'
  AND (SELECT COUNT(*) FROM leads) = 1;

INSERT INTO leads (contact_id, pipeline_id, stage_id, name, value)
SELECT c.id, 1, s.id, 'Pedido recurrente', 3200
FROM contacts c, stages s
WHERE c.first_name='Carlos' AND s.pipeline_id=1 AND s.name='Por pagar'
  AND (SELECT COUNT(*) FROM leads) = 2;
