#!/usr/bin/env node
// Cron mensual: el día 1 de cada mes, crea un backup tipo 'monthly' para cada
// tenant activo. Lo ejecuta /etc/cron.d/wapi101-backup-monthly
//
// Resolución de módulos:
//   El script vive en /root/wapi101/scripts/ pero better-sqlite3 está en
//   /root/wapi101/app/node_modules. Agregamos esa ruta al resolver para que
//   `require('better-sqlite3')` funcione sin un npm install propio.

const path = require('path');
const Module = require('module');

const APP_DIR = path.resolve(__dirname, '..', 'app');
const APP_MODULES = path.join(APP_DIR, 'node_modules');

// Agrega node_modules de la app al path de resolución
process.env.NODE_PATH = APP_MODULES + (process.env.NODE_PATH ? ':' + process.env.NODE_PATH : '');
Module._initPaths();

(async () => {
  const startedAt = new Date().toISOString();
  try {
    const Database = require('better-sqlite3');
    const service = require(path.join(APP_DIR, 'src/modules/backups/service'));
    const db = new Database(process.env.WAPI101_DB_PATH || '/root/.wapi101/data/wapi101.sqlite');
    console.log(`[monthly-backup] iniciando — ${startedAt}`);
    const results = await service.runMonthlyBackupsForAllTenants(db);
    let okCount = 0, errCount = 0;
    for (const r of results) {
      if (r.ok) {
        okCount++;
        console.log(`[monthly-backup] tenant ${r.tenantId} OK (backup ${r.backupId}, ${(r.size/1024/1024).toFixed(1)} MB)`);
      } else {
        errCount++;
        console.error(`[monthly-backup] tenant ${r.tenantId} ERROR: ${r.error}`);
      }
    }
    console.log(`[monthly-backup] terminado — ${okCount} OK, ${errCount} errores, total ${results.length} tenants`);
    db.close();
    // Salir con código 1 si TODOS fallaron (alerta para el operador), pero
    // 0 si al menos uno tuvo éxito — el cron debe seguir corriendo.
    if (results.length > 0 && okCount === 0) process.exit(2);
  } catch (e) {
    console.error('[monthly-backup] fatal:', e.message, e.stack);
    process.exit(1);
  }
})();
