// Genera N clientes falsos con datos realistas (México) y los inserta vía /api/customers/import.
// Uso:
//   node scripts/seed-fake-customers.js          → 500 clientes
//   node scripts/seed-fake-customers.js 1000     → 1000 clientes
//   node scripts/seed-fake-customers.js 100 http://localhost:3001  → cantidad + URL custom

const COUNT = Number(process.argv[2]) || 500;
const BASE_URL = process.argv[3] || 'http://localhost:3001';

const FIRST_NAMES = [
  'Juan', 'María', 'José', 'Carlos', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Laura', 'Jorge',
  'Sofía', 'Daniel', 'Patricia', 'Miguel', 'Andrea', 'Roberto', 'Gabriela', 'Fernando', 'Adriana', 'Ricardo',
  'Mónica', 'Alejandro', 'Verónica', 'Eduardo', 'Lucía', 'Raúl', 'Diana', 'Héctor', 'Beatriz', 'Arturo',
  'Claudia', 'Sergio', 'Rocío', 'Manuel', 'Elena', 'Francisco', 'Marisol', 'Antonio', 'Silvia', 'Javier',
  'Isabel', 'Rafael', 'Gloria', 'Enrique', 'Norma', 'Salvador', 'Teresa', 'Óscar', 'Cristina', 'Alberto'
];

const LAST_NAMES = [
  'García', 'Hernández', 'Martínez', 'López', 'González', 'Rodríguez', 'Pérez', 'Sánchez',
  'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Reyes', 'Cruz', 'Morales', 'Ortiz',
  'Gutiérrez', 'Chávez', 'Ruiz', 'Mendoza', 'Aguilar', 'Vázquez', 'Castillo', 'Jiménez', 'Moreno',
  'Romero', 'Álvarez', 'Vargas', 'Castro', 'Ramos', 'Herrera', 'Medina', 'Salazar', 'Guerrero',
  'Contreras', 'Espinoza', 'Domínguez', 'Núñez', 'Padilla', 'Rojas', 'Soto', 'Vega', 'Cabrera'
];

const DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'wapi101.com'];
const TAGS_POOL = ['nuevo', 'interesado', 'VIP', 'frecuente', 'mayorista', 'Bogotá', 'CDMX', 'Guadalajara', 'serum facial', 'crema corporal'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickMany(arr, max) {
  const n = Math.floor(Math.random() * (max + 1));
  const out = new Set();
  while (out.size < n) out.add(pick(arr));
  return [...out];
}
function randPhone() {
  // +52 + 10 dígitos
  let p = '+52';
  for (let i = 0; i < 10; i++) p += Math.floor(Math.random() * 10);
  return p;
}
function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function generate(count) {
  const rows = [];
  const seenEmails = new Set();
  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    let email = `${normalize(firstName)}.${normalize(lastName)}${i}@${pick(DOMAINS)}`;
    if (seenEmails.has(email)) email = `${i}_${email}`;
    seenEmails.add(email);
    rows.push({
      firstName,
      lastName,
      phone: randPhone(),
      email
    });
  }
  return rows;
}

(async () => {
  console.log(`Generando ${COUNT} clientes falsos…`);
  const rows = generate(COUNT);

  // Mandamos en batches de 100 para no sobrecargar
  const BATCH = 100;
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const bulkTag = `Demo ${new Date().toISOString().slice(0, 10)}`;
    const res = await fetch(`${BASE_URL}/api/contacts/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: batch, dupePolicy: 'skip', bulkTag })
    });
    if (!res.ok) {
      console.error(`Batch ${i / BATCH + 1} falló: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.error(text.slice(0, 200));
      process.exit(1);
    }
    const data = await res.json();
    created += data.created || 0;
    updated += data.updated || 0;
    skipped += data.skipped || 0;
    errors  += data.errors  || 0;
    process.stdout.write(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }

  console.log('\n✅ Listo.');
  console.log(`   Creados:      ${created}`);
  console.log(`   Actualizados: ${updated}`);
  console.log(`   Omitidos:     ${skipped}`);
  console.log(`   Errores:      ${errors}`);
})();
