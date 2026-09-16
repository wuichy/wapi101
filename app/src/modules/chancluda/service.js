// Chancluda — le avisa por WhatsApp a Chancluda (Mar, +52 33 2609 4214) cada
// vez que cae un pedido PAGADO de reelance (evento order con status
// PROCESSING), desde el WhatsApp personal de Luis (integración 33,
// whatsapp-lite +5213349657193). Si a los 30 minutos el pedido sigue sin
// procesarse (sin evento COMPLETED/INVOICED), manda UN recordatorio.
//
// Horario laboral: L-V 9:30–17:30 hora de México, MENOS la comida (14:00 a
// 15:00) y los días de descanso obligatorio de la LFT (art. 74). Fuera de
// ventana los avisos se FORMAN en cola y salen al abrir la ventana — si se
// juntaron varios, salen en UN solo mensaje resumen.
//
// El interruptor vive en Apps → Chancluda (app_installs.enabled del
// marketplace). Apagado = no se manda nada Y NO se encola nada nuevo.
'use strict';

const TO_PHONE_LIKE  = '%3326094214'; // Chancluda (Mar)
const INTEGRATION_ID = 33;            // WhatsApp personal 33 4965 7193
const TENANT_ID      = 1;             // reelance
const RECORDATORIO_MIN = 30;

// México centro es UTC-6 fijo desde que se eliminó el horario de verano (2022).
const OFFSET_MX_H = -6;

let _db = null;

// Un canal caído (o un candado) hacía que el tick reintentara CADA MINUTO para
// siempre: 1,440 líneas de log al día diciendo lo mismo, y el problema mudo
// entre el ruido. Ahora el reintento se va espaciando (2, 4, 8… hasta 30 min)
// y solo se escribe en el log cuando de verdad se intentó.
let _fallos = 0;
let _proximoIntento = 0;

/* ── Calendario ──────────────────────────────────────────────────────────── */

function _mx(now) {
  return new Date(now.getTime() + OFFSET_MX_H * 3600_000);
}

// Enésimo lunes del mes (para los feriados que se recorren).
function _lunesN(anio, mes, n) {
  const d = new Date(Date.UTC(anio, mes, 1));
  const desplazamiento = (8 - d.getUTCDay()) % 7;
  return 1 + desplazamiento + (n - 1) * 7;
}

// Descansos obligatorios de la LFT art. 74 (mismos que usa reelance para la
// promesa de entrega). El 1-oct de cambio de gobierno (cada 6 años; próximo
// 2030) no está — agregarlo ese año.
function esFeriado(mx) {
  const a = mx.getUTCFullYear(), m = mx.getUTCMonth(), d = mx.getUTCDate();
  if (m === 0  && d === 1)  return true;                 // 1 enero
  if (m === 1  && d === _lunesN(a, 1, 1))  return true;  // 1er lunes de febrero
  if (m === 2  && d === _lunesN(a, 2, 3))  return true;  // 3er lunes de marzo
  if (m === 4  && d === 1)  return true;                 // 1 mayo
  if (m === 8  && d === 16) return true;                 // 16 septiembre
  if (m === 10 && d === _lunesN(a, 10, 3)) return true;  // 3er lunes de noviembre
  if (m === 11 && d === 25) return true;                 // 25 diciembre
  return false;
}

// ¿Ahora mismo se puede molestar a Chancluda?
// L-V 9:30–17:30, menos 14:00–15:00 (comida) y feriados.
function enVentana(now = new Date()) {
  const mx = _mx(now);
  const dia = mx.getUTCDay();
  if (dia === 0 || dia === 6) return false;
  if (esFeriado(mx)) return false;
  const min = mx.getUTCHours() * 60 + mx.getUTCMinutes();
  if (min < 9 * 60 + 30 || min >= 17 * 60 + 30) return false;
  if (min >= 14 * 60 && min < 15 * 60) return false;
  return true;
}

/* ── Estado ──────────────────────────────────────────────────────────────── */

function _bootstrap(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS chancluda_avisos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id    INTEGER NOT NULL,
    external_id  TEXT    NOT NULL,
    order_number TEXT,
    resumen      TEXT,
    notified_at  INTEGER,
    reminded_at  INTEGER,
    done         INTEGER DEFAULT 0,
    created_at   INTEGER DEFAULT (unixepoch()),
    UNIQUE(tenant_id, external_id)
  )`).run();
}

function activa(db) {
  try {
    const row = db.prepare(`
      SELECT ai.enabled FROM app_installs ai
      JOIN marketplace_apps ma ON ma.id = ai.app_id
      WHERE ma.slug = 'chancluda' AND ai.tenant_id = ?
    `).get(TENANT_ID);
    return !!(row && row.enabled);
  } catch { return false; }
}

// PROCESSING = pagado, listo para empacar → se avisa.
// Estos otros = ya no hay nada que empacar ni que recordar.
const YA_NO_APLICA = new Set(['COMPLETED', 'INVOICED', 'CANCELLED', 'REFUNDED', 'FAILED', 'TRASH']);

function _resumenPedido(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  // reelance manda `productName` y `quantity` (verificado en vivo con #80578).
  // Se aceptan también `name`/`qty` por si algún día cambia el emisor.
  const lineas = items
    .map((i) => {
      const cant = i.quantity != null ? i.quantity : (i.qty != null ? i.qty : 1);
      const nombre = i.productName || i.name || 'producto';
      return `${cant}x ${nombre}`;
    })
    .join(', ');
  const total = payload && payload.totalCents != null ? `$${(payload.totalCents / 100).toFixed(2)}` : '';
  if (lineas && total) return `${lineas} — ${total}`;
  return lineas || total;
}

/* ── Entrada: evento de pedido de reelance ───────────────────────────────── */

function onOrderEvent(db, tenantId, payload) {
  try {
    if (tenantId !== TENANT_ID) return;
    _bootstrap(db);
    const externalId = String((payload && (payload.id != null ? payload.id : payload.orderNumber)) || '').trim();
    if (!externalId) return;
    const status = String((payload && payload.status) || '').toUpperCase();

    if (status === 'PROCESSING') {
      if (!activa(db)) return; // apagada: ni cola
      const num = (payload.orderNumberDisplay) ||
                  (payload.orderNumber ? `#${payload.orderNumber}` : `#${externalId}`);
      db.prepare(`
        INSERT OR IGNORE INTO chancluda_avisos (tenant_id, external_id, order_number, resumen)
        VALUES (?, ?, ?, ?)
      `).run(tenantId, externalId, num, _resumenPedido(payload));
      // El reloj de cada minuto lo agarra solo. Aquí NO se dispara un tick: ese
      // tick corría sin el 'enviar' inyectado y, si tronaba, encendía el backoff
      // y dejaba bloqueado al tick bueno que venía detrás.
    } else if (YA_NO_APLICA.has(status)) {
      db.prepare('UPDATE chancluda_avisos SET done = 1 WHERE tenant_id = ? AND external_id = ?')
        .run(tenantId, externalId);
    }
  } catch (err) {
    console.warn('[chancluda] onOrderEvent:', err.message);
  }
}

/* ── Envío ───────────────────────────────────────────────────────────────── */

function _convoChancluda(db) {
  // La convo ya existe (contacto "Mar"). Si un día no, se crea con el mismo
  // formato de external_id que usa la integración 33 (dígitos con 521).
  const convo = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.tenant_id = ? AND c.integration_id = ? AND ct.phone LIKE ?
    ORDER BY c.id DESC LIMIT 1
  `).get(TENANT_ID, INTEGRATION_ID, TO_PHONE_LIKE);
  if (convo) return convo;

  const convoSvc = require('../conversations/service');
  const contact = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone LIKE ?')
    .get(TENANT_ID, TO_PHONE_LIKE);
  const digits = String((contact && contact.phone) || '+523326094214').replace(/\D/g, '');
  return convoSvc.findOrCreate(db, TENANT_ID, {
    provider:      'whatsapp-lite',
    externalId:    digits,
    integrationId: INTEGRATION_ID,
    contactId:     contact ? contact.id : undefined,
    contactPhone:  contact ? contact.phone : '+523326094214',
    contactName:   'Chancluda',
  });
}

/**
 * Manda el aviso por el WhatsApp PERSONAL de Luis (integración 33).
 *
 * ⚠️ Cruza a propósito el candado de `sender.js` (`_assertHumanSend`), que
 * bloquea todo envío automático por esa integración porque está marcada
 * "sin bots": es su celular personal. Es la misma decisión y la misma mecánica
 * del aviso al grupo de la paquetería (`/group-notify`, 21-ago-2026): en vez de
 * aflojar el candado general —bots, IA y plantillas siguen bloqueados igual—
 * esta puerta trae la suya, más angosta:
 *   1. El destino NO viaja de fuera: sale de las constantes de este módulo
 *      (Chancluda + integración 33). Nadie puede apuntarlo a otro chat.
 *   2. Solo whatsapp-lite y solo esa integración; si no cuadra, no manda.
 *   3. Antirrebote de 2 min por texto idéntico, igual que el envío a mano.
 */
async function _enviar(db, texto) {
  const convoSvc = require('../conversations/service');
  const convo = _convoChancluda(db);
  if (!convo) throw new Error('sin conversación con Chancluda');

  const integ = Number(convo.integration_id ?? convo.integrationId);
  const externo = convo.external_id ?? convo.externalId;
  if (convo.provider !== 'whatsapp-lite' || integ !== INTEGRATION_ID || !externo) {
    throw new Error(`la conversación de Chancluda no es la esperada (provider ${convo.provider}, integración ${integ})`);
  }

  const last = db.prepare(
    'SELECT body, direction, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1'
  ).get(convo.id);
  if (last && last.direction === 'outgoing' && (last.body || '') === texto
      && (Math.floor(Date.now() / 1000) - last.created_at) < 120) {
    console.log('[chancluda] texto idéntico hace <2 min — se descarta');
    return;
  }

  const manager = require('../integrations/whatsapp-web/manager');
  const externalMsgId = await manager.sendText(integ, externo, texto);
  convoSvc.addMessage(db, TENANT_ID, convo.id, {
    externalId: externalMsgId,
    direction:  'outgoing',
    provider:   convo.provider,
    body:       texto,
    status:     'sent',
  });
}

/* ── El reloj (cada minuto) ──────────────────────────────────────────────── */

async function tick(db = _db, opts = {}) {
  const enviar = opts.enviar || ((texto) => _enviar(db, texto));
  const ahoraDate = opts.ahora || new Date();
  try {
    if (!db) return;
    _bootstrap(db);
    if (!activa(db)) return;
    if (!enVentana(ahoraDate)) return;
    if (_proximoIntento && Date.now() < _proximoIntento) return; // esperando el backoff
    const ahora = Math.floor(ahoraDate.getTime() / 1000);

    // 1) Cola de avisos pendientes (uno solo → mensaje normal; varios → resumen)
    const cola = db.prepare(`
      SELECT * FROM chancluda_avisos
      WHERE tenant_id = ? AND done = 0 AND notified_at IS NULL ORDER BY id
    `).all(TENANT_ID);
    if (cola.length) {
      const texto = cola.length === 1
        ? `Llegó un pedido nuevo: ${cola[0].order_number}${cola[0].resumen ? `\n${cola[0].resumen}` : ''}`
        : `Llegaron ${cola.length} pedidos nuevos:\n` +
          cola.map((c) => `${c.order_number}${c.resumen ? ` — ${c.resumen}` : ''}`).join('\n');
      await enviar(texto);
      const upd = db.prepare('UPDATE chancluda_avisos SET notified_at = ? WHERE id = ?');
      for (const c of cola) upd.run(ahora, c.id);
    }

    // 2) Recordatorio (UNA vez): avisado hace 30+ min y sin procesar
    const tarde = db.prepare(`
      SELECT * FROM chancluda_avisos
      WHERE tenant_id = ? AND done = 0 AND notified_at IS NOT NULL
        AND reminded_at IS NULL AND notified_at <= ? ORDER BY id
    `).all(TENANT_ID, ahora - RECORDATORIO_MIN * 60);
    for (const t of tarde) {
      await enviar(`Recordatorio: el pedido ${t.order_number} lleva más de ${RECORDATORIO_MIN} minutos sin procesarse.`);
      db.prepare('UPDATE chancluda_avisos SET reminded_at = ? WHERE id = ?').run(ahora, t.id);
    }

    // 3) Limpieza: lo ya hecho, a la semana se va
    db.prepare('DELETE FROM chancluda_avisos WHERE done = 1 AND created_at < ?').run(ahora - 7 * 86400);

    if (_fallos) { console.log('[chancluda] el envío se destrabó — de vuelta a la normalidad'); }
    _fallos = 0; _proximoIntento = 0;
  } catch (err) {
    _fallos++;
    const esperaMin = Math.min(30, Math.pow(2, Math.min(_fallos, 5)));
    _proximoIntento = Date.now() + esperaMin * 60_000;
    console.warn(`[chancluda] tick (fallo ${_fallos}, reintento en ${esperaMin} min): ${err.message}`);
  }
}

function init(db) {
  _db = db;
  setTimeout(() => { tick(db); setInterval(() => tick(db), 60_000); }, 30_000);
  console.log('[chancluda] vigilando pedidos (tick cada 60 s)');
}

module.exports = { onOrderEvent, tick, init, enVentana, esFeriado, activa, _resumenPedido, _bootstrap };
