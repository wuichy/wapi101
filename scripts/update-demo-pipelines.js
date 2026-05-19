// Actualiza los pipelines del tenant DEMO (id 107):
//   - Borra el pipeline "🌗 Clientes por Horario" (id=24) y reubica sus leads
//   - Crea "☀️ Clientes Tarde" con etapas Semana 1..4
//   - Crea "🌙 Clientes Noche" con etapas Semana 1..4
//   - Crea "💈 Barbería" con flujo cliente típico de barbería
//
// Uso (en droplet):
//   NODE_PATH=/root/wapi101/app/node_modules node /root/wapi101/scripts/update-demo-pipelines.js

const Database = require('better-sqlite3');

const DB_PATH = process.env.WAPI101_DB_PATH || '/root/.wapi101/data/wapi101.sqlite';
const TENANT_ID = 107;
const OLD_PIPELINE_ID = 24; // 🌗 Clientes por Horario (a borrar)

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function rand(n) { return Math.floor(Math.random() * n); }
function randItem(a) { return a[rand(a.length)]; }
function randColor() {
  const palette = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981',
                   '#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7',
                   '#d946ef','#ec4899','#f43f5e','#64748b','#475569'];
  return randItem(palette);
}

const NEW_PIPELINES = [
  {
    name: '☀️ Clientes Tarde',
    color: '#f59e0b',
    icon: '☀️',
    stages: [
      { name:'Semana 1', kind:'in_progress', color:'#fde68a' },
      { name:'Semana 2', kind:'in_progress', color:'#fbbf24' },
      { name:'Semana 3', kind:'in_progress', color:'#f59e0b' },
      { name:'Semana 4', kind:'in_progress', color:'#d97706' },
    ],
  },
  {
    name: '🌙 Clientes Noche',
    color: '#6366f1',
    icon: '🌙',
    stages: [
      { name:'Semana 1', kind:'in_progress', color:'#c7d2fe' },
      { name:'Semana 2', kind:'in_progress', color:'#818cf8' },
      { name:'Semana 3', kind:'in_progress', color:'#6366f1' },
      { name:'Semana 4', kind:'in_progress', color:'#4338ca' },
    ],
  },
  {
    // Flujo típico de barbería: capta nuevos clientes, agenda, atiende y
    // mantiene la recompra. Estados won/lost para clientes recurrentes vs perdidos.
    name: '💈 Barbería · Flujo Cliente',
    color: '#0f172a',
    icon: '💈',
    stages: [
      { name:'🆕 Nuevo Cliente',          kind:'in_progress', color:'#94a3b8' },
      { name:'📅 Agendado',                kind:'in_progress', color:'#0ea5e9' },
      { name:'✅ Confirmado (24h antes)',  kind:'in_progress', color:'#22c55e' },
      { name:'✂️ Atendido Hoy',            kind:'in_progress', color:'#f59e0b' },
      { name:'⭐ Cliente Frecuente',       kind:'won',         color:'#10b981' },
      { name:'💤 Sin volver (>30 días)',   kind:'in_progress', color:'#a78bfa' },
      { name:'❌ Cliente Perdido',         kind:'lost',        color:'#ef4444' },
    ],
  },
];

console.log('▶︎ Actualizando pipelines del tenant demo (id=107)...\n');

// 0. Sanity check: existe tenant y pipeline viejo
const tenant = db.prepare('SELECT id, slug, display_name FROM tenants WHERE id=?').get(TENANT_ID);
if (!tenant) { console.error(`❌ No existe tenant ${TENANT_ID}`); process.exit(1); }
console.log(`Tenant: ${tenant.display_name} (slug="${tenant.slug}")`);

const oldPipeline = db.prepare('SELECT id, name FROM pipelines WHERE id=? AND tenant_id=?').get(OLD_PIPELINE_ID, TENANT_ID);
if (oldPipeline) console.log(`Pipeline a borrar: "${oldPipeline.name}" (id=${OLD_PIPELINE_ID})`);

const orphanCount = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE tenant_id=? AND pipeline_id=?').get(TENANT_ID, OLD_PIPELINE_ID).n;
console.log(`Expedients en pipeline viejo: ${orphanCount}\n`);

// 1. Crear los 3 pipelines nuevos en orden, después de los existentes
const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM pipelines WHERE tenant_id=?').get(TENANT_ID).m;
const newPipelines = []; // {name, id, stages:[{name,id}]}
db.transaction(() => {
  NEW_PIPELINES.forEach((p, idx) => {
    const pr = db.prepare(`
      INSERT INTO pipelines (name, color, icon, sort_order, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(p.name, p.color, p.icon, maxOrder + 1 + idx, TENANT_ID);
    const pid = pr.lastInsertRowid;
    const stages = [];
    p.stages.forEach((s, sIdx) => {
      const sr = db.prepare(`
        INSERT INTO stages (pipeline_id, name, color, sort_order, kind, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(pid, s.name, s.color, sIdx, s.kind, TENANT_ID);
      stages.push({ name: s.name, id: sr.lastInsertRowid, kind: s.kind });
    });
    newPipelines.push({ name: p.name, id: pid, stages });
    console.log(`  + Pipeline "${p.name}" (id=${pid}) → ${stages.length} stages`);
  });
})();

// 2. Reubicar expedients del pipeline viejo a los nuevos Tarde/Noche (50/50, semana 1)
if (orphanCount > 0) {
  const tarde = newPipelines.find(p => p.name.includes('Tarde'));
  const noche = newPipelines.find(p => p.name.includes('Noche'));
  const sTardeS1 = tarde.stages.find(s => s.name === 'Semana 1').id;
  const sNocheS1 = noche.stages.find(s => s.name === 'Semana 1').id;

  console.log(`\n  Reubicando ${orphanCount} leads (Tarde·S1=${sTardeS1} / Noche·S1=${sNocheS1})...`);
  const orphans = db.prepare('SELECT id FROM expedients WHERE tenant_id=? AND pipeline_id=?').all(TENANT_ID, OLD_PIPELINE_ID);
  db.transaction(() => {
    const upd = db.prepare('UPDATE expedients SET pipeline_id=?, stage_id=?, stage_entered_at=unixepoch() WHERE id=?');
    for (const e of orphans) {
      const goesTarde = Math.random() < 0.5;
      upd.run(goesTarde ? tarde.id : noche.id, goesTarde ? sTardeS1 : sNocheS1, e.id);
    }
  })();
  console.log(`  ${orphans.length} leads movidos`);
}

// 3. Borrar pipeline viejo (cascade limpia stages; FK ON DELETE CASCADE)
if (oldPipeline) {
  console.log(`\n  Borrando pipeline antiguo id=${OLD_PIPELINE_ID}...`);
  // Antes: limpiar bot_id si alguno apuntaba aquí (no debería pasar nada, pero por seguridad)
  db.prepare('UPDATE stages SET bot_id=NULL WHERE pipeline_id=? AND tenant_id=?').run(OLD_PIPELINE_ID, TENANT_ID);
  // No hay expedients ya (los movimos). Confirmamos:
  const remain = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE pipeline_id=? AND tenant_id=?').get(OLD_PIPELINE_ID, TENANT_ID).n;
  if (remain > 0) { console.error(`  ❌ Quedan ${remain} expedients en pipeline ${OLD_PIPELINE_ID}, abortando`); process.exit(2); }
  db.prepare('DELETE FROM pipelines WHERE id=? AND tenant_id=?').run(OLD_PIPELINE_ID, TENANT_ID);
  console.log(`  Pipeline ${OLD_PIPELINE_ID} eliminado (stages purgadas por cascade)`);
}

// 4. Resumen
console.log('\n✅ Actualización completa.\n');
console.log('Pipelines del tenant demo ahora:');
const finalPipelines = db.prepare(`
  SELECT p.id, p.name, COUNT(s.id) AS stages, (SELECT COUNT(*) FROM expedients WHERE pipeline_id=p.id) AS leads
    FROM pipelines p LEFT JOIN stages s ON s.pipeline_id=p.id
   WHERE p.tenant_id=?
   GROUP BY p.id
   ORDER BY p.sort_order, p.id
`).all(TENANT_ID);
finalPipelines.forEach(p => console.log(`  • ${p.name}  (${p.stages} stages, ${p.leads} leads)`));

db.close();
