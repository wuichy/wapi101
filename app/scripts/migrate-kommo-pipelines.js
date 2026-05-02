// Migra SOLO pipelines + etapas desde Kommo → Reelance CRM.
// No toca leads, contactos, asesores ni nada más.
//
// Mapeo:
//   Kommo pipeline → reelance pipelines (name, sort_order desde sort)
//   Kommo status   → reelance stages
//     - status.id = 142 → kind='won'   (reservado por Kommo en TODO pipeline)
//     - status.id = 143 → kind='lost'  (reservado por Kommo)
//     - resto          → kind='in_progress'
//   Color heredado del status (Kommo expone color hex)
//
// Uso:
//   node scripts/migrate-kommo-pipelines.js          → dry run (no escribe)
//   node scripts/migrate-kommo-pipelines.js --apply  → ejecuta y commitea

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const APPLY = process.argv.includes('--apply');
const DB_PATH = path.resolve(__dirname, '../data/reelance.sqlite');
const KOMMO_STATE = '/Users/luismelchor/Desktop/ReelanceHub/data/app-state.json';

(async () => {
  // 1. Leer token de Kommo del proyecto viejo
  const kState = JSON.parse(fs.readFileSync(KOMMO_STATE, 'utf8'));
  const token = kState.kommo?.tokens?.access_token;
  const subdomain = kState.kommo?.subdomain;
  if (!token || !subdomain) throw new Error('Sin token/subdomain de Kommo');

  const base = `https://${subdomain}.kommo.com/api/v4`;
  const H = { Authorization: `Bearer ${token}` };

  // 2. Pull pipelines + statuses
  console.log(`[kommo] GET ${base}/leads/pipelines`);
  const r = await fetch(base + '/leads/pipelines', { headers: H });
  if (!r.ok) throw new Error(`Kommo HTTP ${r.status}`);
  const j = await r.json();
  const pipelines = j._embedded?.pipelines || [];
  console.log(`[kommo] ${pipelines.length} pipelines encontrados`);

  // 3. Conectar DB
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  // 4. Computar siguiente sort_order para no chocar con pipelines existentes
  const maxSortRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM pipelines').get();
  let nextSort = (maxSortRow?.m || -1) + 1;

  // 5. Plan
  const plan = [];
  for (const p of pipelines) {
    const stages = (p._embedded?.statuses || []).slice().sort((a, b) => a.sort - b.sort);
    plan.push({
      kommoId: p.id,
      name: p.name,
      sortOrder: nextSort++,
      isMain: !!p.is_main,
      stages: stages.map((st) => ({
        kommoId: st.id,
        name: st.name,
        sortOrder: st.sort,
        color: st.color || '#94a3b8',
        kind: st.id === 142 ? 'won' : st.id === 143 ? 'lost' : 'in_progress',
      })),
    });
  }

  // 6. Mostrar plan
  console.log(`\n=== PLAN DE MIGRACIÓN ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  for (const p of plan) {
    console.log(`+ Pipeline "${p.name}" (sort:${p.sortOrder}${p.isMain ? ', main' : ''})`);
    for (const s of p.stages) {
      console.log(`    + Stage "${s.name}" [${s.kind}] color:${s.color}`);
    }
  }
  console.log(`\nTotal: ${plan.length} pipelines, ${plan.reduce((n, p) => n + p.stages.length, 0)} etapas`);

  if (!APPLY) {
    console.log('\n→ Dry run. Sin cambios. Corre con --apply para ejecutar.');
    return;
  }

  // 7. Ejecutar en transacción
  const insP = db.prepare('INSERT INTO pipelines (name, color, sort_order) VALUES (?, ?, ?)');
  const insS = db.prepare('INSERT INTO stages (pipeline_id, name, color, sort_order, kind) VALUES (?, ?, ?, ?, ?)');

  const trx = db.transaction(() => {
    for (const p of plan) {
      const result = insP.run(p.name, '#2563eb', p.sortOrder);
      const newPipelineId = result.lastInsertRowid;
      for (const s of p.stages) {
        insS.run(newPipelineId, s.name, s.color, s.sortOrder, s.kind);
      }
    }
  });
  trx();

  console.log(`\n✅ Migración completada — ${plan.length} pipelines insertados`);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
