#!/usr/bin/env node
/**
 * probar-window-alert.js — el reloj que la TARJETA le enseña a Luis.
 *
 *   cd /root/wapi101/app && node pruebas/probar-window-alert.js
 *
 * Qué cuida (23-sep-2026): el bot de ventana NO arranca cuando el cliente escribe —
 * espera hasta 10 min antes de que cierre la ventana de 24 h. Pero la alarma de la
 * etapa grita "Estancado" a las 9 h. Resultado: la tarjeta se veía en rojo, sin nada
 * corriendo y sin reloj, ~15 h antes de que el bot despertara. `windowAlertFor` ahora
 * devuelve también la HORA a la que le toca, y la tarjeta deja de mentir.
 *
 * ⚠️ El reloj de aquí tiene que ser EL MISMO de `_handleLead`. Si allá cambian
 * MOVE_AT_SEC o las ranuras y aquí no, esta prueba truena — que es justo el punto.
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const guard = require('../src/modules/bot/window-guard');

const { WINDOW_SEC, MOVE_AT_SEC, SAFE_BEFORE_CLOSE_SEC, WARN_SEC } = guard;
const DAY = 24 * 3600;
const TENANT = 1;
const STAGE = 10;
const BOT = 285;

let pasadas = 0, fallas = 0;
function revisa(que, fn) {
  try { fn(); pasadas++; console.log(`  ✓ ${que}`); }
  catch (e) { fallas++; console.log(`  ✗ ${que}\n      ${e.message}`); }
}

/** Base en memoria con lo mínimo que toca windowAlertFor. */
function nuevaDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE salsbots (id INTEGER PRIMARY KEY, name TEXT, enabled INTEGER,
      trigger_type TEXT, trigger_value TEXT, tenant_id INTEGER);
    CREATE TABLE conversations (id INTEGER PRIMARY KEY, contact_id INTEGER, provider TEXT,
      integration_id INTEGER, bot_paused INTEGER DEFAULT 0, last_message_at INTEGER, tenant_id INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, direction TEXT,
      body TEXT, media_url TEXT, status TEXT, meta_json TEXT, created_at INTEGER, tenant_id INTEGER);
    CREATE TABLE bot_window_guard (tenant_id INTEGER, bot_id INTEGER, expedient_id INTEGER,
      decision TEXT, reason TEXT, last_in_at INTEGER, slot_at INTEGER, detail TEXT, decided_at INTEGER,
      PRIMARY KEY (bot_id, expedient_id));
  `);
  db.prepare('INSERT INTO salsbots VALUES (?,?,?,?,?,?)')
    .run(BOT, 'WA Leads Entrantes (ventana 24 h)', 1, 'window_24h', String(STAGE), TENANT);
  db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?)')
    .run(1, 100, 'whatsapp', 1, 0, 0, TENANT);
  guard.bustCache();
  return db;
}

let _mid = 0;
function msg(db, { dir, body, at, status = 'sent' }) {
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)')
    .run(++_mid, 1, dir, body, null, status, null, at, TENANT);
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = 1').run(at);
}
const LEAD = { id: 9999, contact_id: 100, stage_id: STAGE };
const alerta = (db, now) => guard.windowAlertFor(db, TENANT, LEAD, { nowSec: now });

const AHORA = 1_790_000_000;

console.log('\n── 1. Todo contestado: la tarjeta tiene que dar la HORA del bot');
{
  const db = nuevaDb();
  const escribio = AHORA - 3 * 3600;                 // el cliente escribió hace 3 h
  msg(db, { dir: 'incoming', body: 'quiero mi cupón', at: escribio });
  msg(db, { dir: 'outgoing', body: 'aquí está tu cupón', at: escribio + 4 });
  const r = alerta(db, AHORA);
  revisa('devuelve algo (antes devolvía null y la tarjeta se veía muda)', () => assert.ok(r));
  revisa("es del tipo 'scheduled'", () => assert.strictEqual(r.kind, 'scheduled'));
  revisa('la hora es 23 h 50 min después del mensaje del cliente', () =>
    assert.strictEqual(r.slotAt, escribio + MOVE_AT_SEC));
  revisa('la hora todavía no llega', () => assert.ok(r.slotAt > AHORA));
  revisa('dice qué bot es', () =>
    assert.strictEqual(r.botName, 'WA Leads Entrantes (ventana 24 h)'));
  revisa('el reloj corre desde el cliente, no desde nosotros', () =>
    assert.strictEqual(r.anchorIsOurs, false));
  revisa('la ventana cierra 24 h después del cliente', () =>
    assert.strictEqual(r.closesAt, escribio + WINDOW_SEC));
}

console.log('\n── 2. Algo del cliente SIN contestar: manda la prisa, no el bot');
{
  const db = nuevaDb();
  const escribio = AHORA - (WINDOW_SEC - 2 * 3600);  // le quedan 2 h de ventana
  msg(db, { dir: 'incoming', body: '¿cuánto tarda el envío?', at: escribio });
  const r = alerta(db, AHORA);
  revisa("es del tipo 'pending'", () => assert.strictEqual(r.kind, 'pending'));
  revisa('trae la hora de cierre, no la del bot', () => {
    assert.strictEqual(r.closesAt, escribio + WINDOW_SEC);
    assert.strictEqual(r.slotAt, undefined);
  });
  revisa('sigue mandando pendingSince (compatibilidad)', () =>
    assert.strictEqual(r.pendingSince, escribio));
}

console.log('\n── 3. Pendiente pero con la ventana lejos: ni rojo ni hora');
{
  const db = nuevaDb();
  msg(db, { dir: 'incoming', body: '¿tienen cejas?', at: AHORA - 60 });   // le sobran ~24 h
  revisa('no inventa aviso', () => assert.strictEqual(alerta(db, AHORA), null));
  revisa('WARN_SEC sigue siendo 3 h', () => assert.strictEqual(WARN_SEC, 3 * 3600));
}

console.log('\n── 4. "ok gracias" NO es pendiente: cuenta como cerrado');
{
  const db = nuevaDb();
  const t = AHORA - 5 * 3600;
  msg(db, { dir: 'incoming', body: 'quiero el cupón', at: t });
  msg(db, { dir: 'outgoing', body: 'aquí está', at: t + 10 });
  msg(db, { dir: 'incoming', body: 'okk graciass 🙏', at: t + 60 });      // cierre, aunque venga después
  const r = alerta(db, AHORA);
  revisa('lo trata como agendado, no como pendiente', () =>
    assert.strictEqual(r.kind, 'scheduled'));
  revisa('el reloj se ancla en SU último mensaje', () =>
    assert.strictEqual(r.slotAt, (t + 60) + MOVE_AT_SEC));
}

console.log('\n── 5. Nunca escribió (carrito abandonado): el reloj corre desde NUESTRO mensaje');
{
  const db = nuevaDb();
  const nuestro = AHORA - 3600;
  msg(db, { dir: 'outgoing', body: 'vimos que dejaste algo en el carrito', at: nuestro });
  const r = alerta(db, AHORA);
  revisa('igual da hora', () => assert.strictEqual(r.kind, 'scheduled'));
  revisa('anclado en nuestro mensaje', () => {
    assert.strictEqual(r.slotAt, nuestro + MOVE_AT_SEC);
    assert.strictEqual(r.anchorIsOurs, true);
  });
}

console.log('\n── 6. Chat vacío: no hay silencio que medir');
{
  const db = nuevaDb();
  revisa('no devuelve nada', () => assert.strictEqual(alerta(db, AHORA), null));
}

console.log('\n── 7. Se le pasó el turno: la hora se recorre al día siguiente');
{
  const db = nuevaDb();
  const escribio = AHORA - (DAY + 3600);             // ya pasó su primera ranura
  msg(db, { dir: 'incoming', body: 'hola', at: escribio });
  msg(db, { dir: 'outgoing', body: 'hola!', at: escribio + 5 });
  const r = alerta(db, AHORA);
  revisa('sigue dando una hora futura', () => {
    assert.strictEqual(r.kind, 'scheduled');
    assert.ok(r.slotAt > AHORA, `slotAt ${r.slotAt} debería ser futuro`);
  });
  revisa('cae a la misma hora, otro día', () =>
    assert.strictEqual((r.slotAt - (escribio + MOVE_AT_SEC)) % DAY, 0));
}

console.log('\n── 8. Ya lo movió: la tarjeta se calla (si no, prometería un bot que no va a correr)');
{
  const db = nuevaDb();
  const t = AHORA - 3600;
  msg(db, { dir: 'incoming', body: 'hola', at: t });
  msg(db, { dir: 'outgoing', body: 'hola!', at: t + 5 });
  db.prepare(`INSERT INTO bot_window_guard (tenant_id,bot_id,expedient_id,decision,reason,last_in_at,slot_at,detail,decided_at)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(TENANT, BOT, LEAD.id, 'moved', null, t, t, 'movido', AHORA - 60);
  revisa('no devuelve hora', () => assert.strictEqual(alerta(db, AHORA), null));
}

console.log('\n── 9. El movimiento FALLÓ: se calla para que el "Estancado" rojo vuelva solo');
{
  const db = nuevaDb();
  const t = AHORA - 3600;
  msg(db, { dir: 'incoming', body: 'hola', at: t });
  msg(db, { dir: 'outgoing', body: 'hola!', at: t + 5 });
  db.prepare(`INSERT INTO bot_window_guard (tenant_id,bot_id,expedient_id,decision,reason,last_in_at,slot_at,detail,decided_at)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(TENANT, BOT, LEAD.id, 'move_failed', null, t, t, 'no se movió', AHORA - 60);
  revisa('no devuelve hora', () => assert.strictEqual(alerta(db, AHORA), null));
}

console.log('\n── 10. Etapa que nadie vigila: no se mete');
{
  const db = nuevaDb();
  msg(db, { dir: 'incoming', body: 'hola', at: AHORA - 3600 });
  revisa('null en otra etapa', () =>
    assert.strictEqual(guard.windowAlertFor(db, TENANT, { ...LEAD, stage_id: 999 }, { nowSec: AHORA }), null));
}

console.log('\n── 11. Chat que no es de la API oficial: no hay ventana que medir');
{
  const db = nuevaDb();
  db.prepare("UPDATE conversations SET provider = 'web' WHERE id = 1").run();
  msg(db, { dir: 'incoming', body: 'hola', at: AHORA - 3600 });
  revisa('null si no es whatsapp', () => assert.strictEqual(alerta(db, AHORA), null));
}

console.log('\n── 12. Las constantes del reloj no se movieron por accidente');
{
  revisa('MOVE_AT_SEC = 23 h 50 min', () => assert.strictEqual(MOVE_AT_SEC, 23 * 3600 + 50 * 60));
  revisa('WINDOW_SEC = 24 h', () => assert.strictEqual(WINDOW_SEC, DAY));
  revisa('SAFE_BEFORE_CLOSE_SEC = 2 min', () => assert.strictEqual(SAFE_BEFORE_CLOSE_SEC, 120));
}

console.log(`\n${fallas === 0 ? '✅' : '❌'} ${pasadas} comprobaciones pasaron, ${fallas} fallaron\n`);
process.exit(fallas === 0 ? 0 : 1);
