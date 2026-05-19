// Seed para un tenant de PRÁCTICA / TUTORIALES.
// Crea tenant + 3 advisors + 4 pipelines + 1000 contactos + 1000 expedients + 120 bots.
// TODOS los bots quedan DISABLED para que no disparen al crear leads.
//
// Uso (en el droplet):
//   node /root/wapi101/scripts/seed-demo-tenant.js
//
// Si el slug ya existe, falla — borra antes manualmente si quieres re-correr.

const path     = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.WAPI101_DB_PATH || '/root/.wapi101/data/wapi101.sqlite';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Reutilizamos las funciones de servicio del proyecto (mismo hashing, mismas validaciones).
const superSvc   = require('../app/src/modules/super/service');
const advisorSvc = require('../app/src/modules/advisors/service');

/* ──────────────── Config ──────────────── */
const SLUG          = process.env.DEMO_SLUG || 'practica';
const DISPLAY_NAME  = 'Demo Práctica · Tutoriales';
const ADMIN_PWD     = 'Demo1234!';   // ojo: pwd >=8 para pasar validación
const ASESOR_PWD    = 'Demo1234!';
const TOTAL_CONTACTS  = 1000;
const TOTAL_EXPEDIENT = 1000;
const TOTAL_BOTS      = 120;

/* ──────────────── Datos para nombres random ──────────────── */
const FIRST_NAMES = [
  'María','José','Juan','Luis','Ana','Carlos','Sofía','Diego','Lucía','Miguel',
  'Andrea','Pablo','Daniela','Jorge','Camila','Fernando','Valeria','Roberto','Paola','Héctor',
  'Adriana','Ricardo','Beatriz','Eduardo','Patricia','Javier','Mónica','Raúl','Gabriela','Sergio',
  'Isabel','Mario','Karla','Antonio','Verónica','Alberto','Liliana','Manuel','Brenda','Arturo',
  'Renata','Óscar','Ximena','Iván','Mariana','Alejandro','Regina','Hugo','Itzel','Emilio',
  'Wendy','Rodrigo','Estefanía','Felipe','Yareli','Bruno','Cinthya','Octavio','Karina','Marco',
  'Génesis','Aarón','Tania','Cristian','Frida','Edgar','Jimena','Israel','Aranza','Saúl',
  'Vianey','Néstor','Nayeli','Damián','Susana','Jonathan','Ileana','Mauricio','Citlali','Gerardo',
];
const LAST_NAMES = [
  'García','Martínez','López','Hernández','González','Pérez','Rodríguez','Sánchez','Ramírez','Cruz',
  'Flores','Gómez','Morales','Reyes','Jiménez','Ortiz','Gutiérrez','Mendoza','Aguilar','Castillo',
  'Vargas','Romero','Soto','Vázquez','Núñez','Domínguez','Salazar','Guerrero','Méndez','Castro',
  'Rivera','Torres','Ramos','Ruiz','Chávez','Delgado','Cortés','Estrada','Maldonado','Acosta',
  'Cabrera','Fuentes','Lara','Camacho','Espinoza','Velázquez','Carrillo','Pacheco','Solís','Rosales',
];
const TAG_NAMES = [
  '🔥 Caliente','🥶 Frío','💸 VIP','🌽 Elote','🍕 Pizzero','🏖️ Vacacionista','👻 Fantasma','🦄 Unicornio',
  '🐌 Lento','🚀 Rápido','💩 Spam','🎯 Apunta','📞 Sin contestar','📅 Repaso','🛒 Compra','💳 Pagó',
  '🤝 Recomendado','⏰ Pendiente','🌮 Taquero','💰 Money','🎁 Promoción','🚨 Urgente','🪙 Curioso',
];

const PHONE_PREFIX = '521'; // MX
const EMAIL_DOMAINS = ['gmail.com','hotmail.com','yahoo.com','outlook.com','protonmail.com'];

function rand(n)        { return Math.floor(Math.random() * n); }
function randItem(arr)  { return arr[rand(arr.length)]; }
function randPhone()    { return PHONE_PREFIX + (5500000000 + rand(99999999)); }
function randEmail(fn,ln) { return (fn + ln + rand(999)).toLowerCase().replace(/[^a-z0-9]/g,'') + '@' + randItem(EMAIL_DOMAINS); }

function randColor() {
  const palette = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981',
                   '#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7',
                   '#d946ef','#ec4899','#f43f5e','#64748b','#475569'];
  return randItem(palette);
}

/* ──────────────── Pipelines de demo ──────────────── */
const PIPELINES = [
  {
    name: '📅 Por Mes',
    color: '#3b82f6',
    icon: '📅',
    stages: ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
             'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
              .map((n,i) => ({ name:n, kind:'in_progress', color: randColor() })),
  },
  {
    name: '📆 Días de Febrero',
    color: '#8b5cf6',
    icon: '📆',
    stages: Array.from({length: 28}, (_,i) => ({
      name: `${i+1} de Febrero`, kind: 'in_progress', color: randColor(),
    })),
  },
  {
    name: '🎯 Funnel Ventas',
    color: '#10b981',
    icon: '🎯',
    stages: [
      { name:'Primer Contacto',  kind:'in_progress', color:'#94a3b8' },
      { name:'Calificado',       kind:'in_progress', color:'#0ea5e9' },
      { name:'Propuesta',        kind:'in_progress', color:'#f59e0b' },
      { name:'Cerrando Venta',   kind:'in_progress', color:'#f97316' },
      { name:'Ganado',           kind:'won',         color:'#10b981' },
      { name:'Perdido',          kind:'lost',        color:'#ef4444' },
    ],
  },
  {
    name: '🌗 Clientes por Horario',
    color: '#f59e0b',
    icon: '🌗',
    stages: [
      { name:'☀️ Clientes Tarde',  kind:'in_progress', color:'#f59e0b' },
      { name:'🌙 Clientes Noche',  kind:'in_progress', color:'#6366f1' },
    ],
  },
];

/* ──────────────── Bots de demo (todos disabled) ──────────────── */
const BOT_TEMPLATES = [
  // ⚠️ TODOS los bots se crean con enabled=0. Algunos van asignados a stages
  // como pipeline_stage triggers; otros son keyword o new_contact.
  // El step "send_message" es lo más simple: un texto. NO se ejecutan así
  // que da igual el contenido — es solo para tutoriales / visual.
];

const KEYWORDS = ['hola','precio','info','compro','quiero','urgente','envío','ayuda','catálogo','promo','pago','factura','duda','horario','demo','prueba','sí','no','tal vez','cuánto cuesta'];
const BOT_NAME_TEMPLATES = [
  '🤖 Bot Bienvenida','💬 Auto-respuesta','📦 Aviso de Envío','💸 Recordatorio Pago',
  '🎁 Promoción','📅 Agendar cita','🔔 Recordatorio','🚨 Urgente','🛒 Carrito',
  '👋 Saludo','🙋 FAQ','📲 Confirmación','✨ Cierre','🪄 Magia','📣 Anuncio',
  '🎯 Calificar Lead','🔁 Seguimiento','⏰ Despertador','💌 Mensaje VIP','💼 Cotización',
];

function buildBots(stagesAllPipelineStage) {
  const bots = [];
  for (let i = 0; i < TOTAL_BOTS; i++) {
    const base = randItem(BOT_NAME_TEMPLATES);
    const t = i < 60 ? 'keyword'
            : i < 100 ? 'pipeline_stage'
            : 'new_contact';
    let triggerValue = null;
    if (t === 'keyword') triggerValue = randItem(KEYWORDS);
    // Steps mínimos: un branch con un mensaje. El motor NO lo va a ejecutar
    // porque enabled=0 — esto es solo para que se vea bonito en el builder.
    const steps = [
      {
        type: 'branch',
        branches: [
          {
            name: '(default)',
            steps: [
              { type: 'send_message', message: `Mensaje ${i+1}: este bot es solo demo. Edítame para tu tutorial.` },
            ],
          },
        ],
      },
    ];
    bots.push({
      name: `${base} #${i+1}`,
      enabled: 0,                  // <-- clave: no se dispara
      trigger_type: t,
      trigger_value: triggerValue,
      steps: JSON.stringify(steps),
      sort_order: i,
    });
  }
  return bots;
}

/* ──────────────── Main ──────────────── */
console.log('▶︎ Iniciando seed de tenant demo...');

// 0. Pre-check: slug no debe existir.
if (db.prepare('SELECT id FROM tenants WHERE slug = ?').get(SLUG)) {
  console.error(`❌ Ya existe tenant con slug "${SLUG}". Bórralo antes de re-correr.`);
  console.error(`   Para borrar: sqlite3 ${DB_PATH} "DELETE FROM tenants WHERE slug='${SLUG}';"`);
  console.error(`   (los datos relacionados quedarán huérfanos — mejor usa el panel super-admin)`);
  process.exit(1);
}

// 1. Tenant + admin advisor
console.log('  • Creando tenant + admin...');
const { tenant, adminCredentials } = superSvc.createTenant(db, {
  slug: SLUG,
  displayName: DISPLAY_NAME,
  plan: 'pro',
  adminName: 'Admin Demo',
  adminUsername: 'demoadmin',
  adminEmail: 'admin@demo.local',
  adminPassword: ADMIN_PWD,
});
const TENANT_ID = tenant.id;
console.log(`    tenant_id=${TENANT_ID}  admin=${adminCredentials.username}`);

// 2. 2 asesores extra
console.log('  • Creando 2 asesores...');
const asesor1 = advisorSvc.create(db, TENANT_ID, {
  name: 'Asesor Uno', username: 'asesor1', email: 'asesor1@demo.local',
  password: ASESOR_PWD, role: 'asesor',
  permissions: { write:true, delete:false, manage_advisors:false },
  _skipPlanCheck: true,
});
const asesor2 = advisorSvc.create(db, TENANT_ID, {
  name: 'Asesor Dos', username: 'asesor2', email: 'asesor2@demo.local',
  password: ASESOR_PWD, role: 'asesor',
  permissions: { write:true, delete:false, manage_advisors:false },
  _skipPlanCheck: true,
});
const adminAdvisor = db.prepare('SELECT id FROM advisors WHERE tenant_id=? AND username=?').get(TENANT_ID, adminCredentials.username);
const ADVISORS = [adminAdvisor.id, asesor1.id, asesor2.id];
console.log(`    advisors=${ADVISORS.join(',')}`);

// 3. Pipelines + stages
console.log('  • Creando pipelines...');
const allStages = []; // {pipelineId, stageId, kind}
db.transaction(() => {
  PIPELINES.forEach((p, idx) => {
    const pr = db.prepare(`
      INSERT INTO pipelines (name, color, icon, sort_order, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(p.name, p.color, p.icon, idx, TENANT_ID);
    const pipelineId = pr.lastInsertRowid;
    p.stages.forEach((s, sIdx) => {
      const sr = db.prepare(`
        INSERT INTO stages (pipeline_id, name, color, sort_order, kind, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(pipelineId, s.name, s.color, sIdx, s.kind, TENANT_ID);
      allStages.push({ pipelineId, stageId: sr.lastInsertRowid, kind: s.kind });
    });
    console.log(`    pipeline "${p.name}" (id=${pipelineId}) con ${p.stages.length} stages`);
  });
})();

// 4. Tags de bots chafas
console.log('  • Creando tags de bot...');
const tagIds = [];
db.transaction(() => {
  TAG_NAMES.forEach((tn) => {
    const r = db.prepare(`INSERT INTO bot_tags (name, color, tenant_id) VALUES (?, ?, ?)`)
      .run(tn, randColor(), TENANT_ID);
    tagIds.push(r.lastInsertRowid);
  });
})();
console.log(`    ${tagIds.length} tags creadas`);

// 5. Bots (TODOS disabled)
console.log(`  • Creando ${TOTAL_BOTS} bots (todos disabled)...`);
const stagePool = allStages.filter(s => s.kind === 'in_progress');
const bots = buildBots(stagePool);
const botIds = [];
db.transaction(() => {
  const insBot = db.prepare(`
    INSERT INTO salsbots (name, enabled, trigger_type, trigger_value, steps, sort_order, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insTag = db.prepare(`INSERT INTO salsbot_tag_assignments (bot_id, tag_id, tenant_id) VALUES (?, ?, ?)`);
  for (const b of bots) {
    const r = insBot.run(b.name, b.enabled, b.trigger_type, b.trigger_value, b.steps, b.sort_order, TENANT_ID);
    const botId = r.lastInsertRowid;
    botIds.push(botId);
    // Asignar 1-3 tags chafas random
    const nTags = 1 + rand(3);
    const used = new Set();
    for (let k = 0; k < nTags; k++) {
      const t = randItem(tagIds);
      if (used.has(t)) continue;
      used.add(t);
      insTag.run(botId, t, TENANT_ID);
    }
  }
})();
console.log(`    ${botIds.length} bots creados, sort_order asignado`);

// 6. Asignar ~30 bots a stages (stage.bot_id)
console.log('  • Asignando algunos bots a stages para tutorial...');
const stageBotPairs = [];
const stageBotsToAssign = Math.min(30, stagePool.length, botIds.length);
const stagesShuffled = [...stagePool].sort(() => Math.random() - 0.5).slice(0, stageBotsToAssign);
db.transaction(() => {
  stagesShuffled.forEach((st, i) => {
    const botId = botIds[i];
    db.prepare(`UPDATE stages SET bot_id=? WHERE id=? AND tenant_id=?`).run(botId, st.stageId, TENANT_ID);
    stageBotPairs.push({ stageId: st.stageId, botId });
  });
})();
console.log(`    ${stageBotPairs.length} stage→bot asignaciones`);

// 7. 1000 contactos
console.log(`  • Creando ${TOTAL_CONTACTS} contactos...`);
const contactIds = [];
db.transaction(() => {
  const ins = db.prepare(`
    INSERT INTO contacts (first_name, last_name, phone, email, tenant_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < TOTAL_CONTACTS; i++) {
    const fn = randItem(FIRST_NAMES);
    const ln = randItem(LAST_NAMES);
    const r = ins.run(fn, ln, randPhone(), randEmail(fn, ln), TENANT_ID);
    contactIds.push(r.lastInsertRowid);
  }
})();
console.log(`    ${contactIds.length} contactos OK`);

// 8. 1000 expedients distribuidos entre todos los stages
console.log(`  • Creando ${TOTAL_EXPEDIENT} expedients (leads)...`);
let createdExp = 0;
db.transaction(() => {
  const ins = db.prepare(`
    INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, value, tenant_id, assigned_advisor_id, name_is_auto, stage_entered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
  `);
  for (let i = 0; i < TOTAL_EXPEDIENT; i++) {
    const c   = db.prepare('SELECT first_name, last_name FROM contacts WHERE id=?').get(contactIds[i % contactIds.length]);
    const st  = randItem(allStages);
    const adv = randItem(ADVISORS);
    const val = 1000 + rand(50000);
    ins.run(contactIds[i % contactIds.length], st.pipelineId, st.stageId, `${c.first_name} ${c.last_name}`, val, TENANT_ID, adv);
    createdExp++;
  }
})();
console.log(`    ${createdExp} expedients OK`);

/* ──────────────── Resumen ──────────────── */
console.log('\n✅ Seed completo.\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Tenant:           ${tenant.displayName} (id=${tenant.id}, slug="${tenant.slug}")`);
console.log('Credenciales:');
console.log(`  Admin:          ${adminCredentials.username}  /  ${ADMIN_PWD}`);
console.log(`  Asesor 1:       asesor1   /  ${ASESOR_PWD}`);
console.log(`  Asesor 2:       asesor2   /  ${ASESOR_PWD}`);
console.log('Pipelines creados:');
PIPELINES.forEach(p => console.log(`  • ${p.name}  (${p.stages.length} stages)`));
console.log(`Contactos:         ${TOTAL_CONTACTS}`);
console.log(`Expedients/Leads:  ${TOTAL_EXPEDIENT}`);
console.log(`Bots:              ${TOTAL_BOTS}  (TODOS disabled — no disparan)`);
console.log(`Tags:              ${tagIds.length}`);
console.log(`Stage→Bot:         ${stageBotPairs.length} asignaciones para mostrar en tutoriales`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\nLogin en producción:  https://wapi101.com/login');
console.log('(Asegúrate de seleccionar/escribir el username del tenant correcto si la app lo pide.)\n');

db.close();
