// probar-casa-avisos.js — prueba la puerta de los avisos de la casa SIN mandar
// nada de verdad: el envío se inyecta falso. Correr antes de reiniciar wapi101.
//
//   node scripts/probar-casa-avisos.js

const express = require('express');
const mod = require('../src/modules/casa-avisos/routes');

let mandados = [];
let llave = 'llave-de-prueba';
const app = express();
// Las pruebas de la puerta corren con los avisos PRENDIDOS (activo: true);
// el modo apagado (el de producción desde el 30-sep) se prueba al final.
app.use('/api/apps/casa-avisos', mod.router({
  leerLlave: () => llave,
  activo: true,
  enviar: async (t) => { mandados.push(t); return 'msg-' + mandados.length; },
}));
let mandadosApagado = [];
app.use('/apagado', mod.router({
  leerLlave: () => 'llave-de-prueba',
  enviar: async (t) => { mandadosApagado.push(t); return 'x'; },
}));

const fallas = [];
function paso(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? '  · ' + detalle : ''}`);
  if (!ok) fallas.push(nombre);
}

(async () => {
  const srv = app.listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/api/apps/casa-avisos/aviso`;
  const post = (cuerpo, token = llave) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(cuerpo),
  }).then(async r => ({ status: r.status, j: await r.json() }));

  paso('sale por push de wapi (NO por WhatsApp Lite: tumbaba el 9686)', mod.CANAL === 'push');
  paso('va solo al tenant de Luis (1)', mod.TENANT === 1);
  paso('ya no expone línea ni destino de WhatsApp', mod.INTEGRACION === undefined && mod.DESTINO === undefined);

  let r = await post({ text: 'hola' }, null);
  paso('sin llave -> 401', r.status === 401);
  r = await post({ text: 'hola' }, 'otra');
  paso('llave equivocada -> 401', r.status === 401);
  r = await post({ text: '   ' });
  paso('texto vacío -> 400', r.status === 400);
  r = await post({ text: 'x'.repeat(1001) });
  paso('texto de más de 1000 -> 400', r.status === 400);
  r = await post({ text: 'Casa: prueba', to: '5215555555555' });
  paso('manda (y el "to" del request se ignora)', r.status === 200 && r.j.sent === true && mandados.length === 1);
  r = await post({ text: 'Casa: prueba' });
  paso('mismo texto en <2 min -> no se repite', r.status === 200 && r.j.sent === false && mandados.length === 1);

  mod._reset(); mandados = [];
  for (let i = 0; i < 12; i++) await post({ text: 'aviso ' + i });
  r = await post({ text: 'aviso 13' });
  paso('tope de 12 por hora -> el 13 se rechaza (429)', r.status === 429 && mandados.length === 12);

  mod._reset(); llave = null;
  r = await post({ text: 'hola' }, 'lo-que-sea');
  paso('sin archivo de llave -> no manda (403)', r.status === 403);

  paso('en producción los avisos están APAGADOS', mod.ACTIVO === false);
  const rA = await fetch(`http://127.0.0.1:${srv.address().port}/apagado/aviso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer llave-de-prueba' },
    body: JSON.stringify({ text: 'Casa: la casa se cayó' }),
  }).then(async r => ({ status: r.status, j: await r.json() }));
  paso('apagado: responde 200 sin mandar nada', rA.status === 200 && rA.j.sent === false && mandadosApagado.length === 0);
  const rB = await fetch(`http://127.0.0.1:${srv.address().port}/apagado/aviso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer otra' },
    body: JSON.stringify({ text: 'x' }),
  });
  paso('apagado: la llave se sigue exigiendo (401)', rB.status === 401);

  srv.close();
  console.log(fallas.length ? `\nFALLARON ${fallas.length}: ${fallas.join(', ')}` : '\nTODO BIEN — casa-avisos');
  process.exit(fallas.length ? 1 : 0);
})();
