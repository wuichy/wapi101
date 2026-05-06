// Capa de DB: singleton de SQLite + runner de migraciones.
// Cada migración SQL en src/db/migrations/ se ejecuta una sola vez (registrada en _migrations).

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let dbInstance = null;

function getDb(dbPath) {
  if (dbInstance) return dbInstance;

  // Asegurar que el directorio existe
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');     // mejor concurrencia lectura/escritura
  db.pragma('foreign_keys = ON');      // respeta REFERENCES

  // Tabla de control de migraciones
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch())
    );
  `);

  // Aplicar migraciones pendientes en orden alfabético
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Patrón oficial SQLite para alteraciones que tocan FKs:
    // foreign_keys=OFF ANTES de la transacción, foreign_key_check al final
    // para garantizar consistencia, foreign_keys=ON después.
    // PRAGMA foreign_keys es ignorado dentro de transacciones, por eso va
    // afuera. Las migrations sin DROP TABLE de tablas referenciadas no
    // afecta — el OFF/ON es transparente.
    db.pragma('foreign_keys = OFF');
    try {
      const trx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      });
      trx();
      // Validar consistencia post-migration. Si hay violaciones, falla
      // explícito (mejor que dejar la DB en estado inconsistente).
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) {
        throw new Error(`Migration ${file} dejó ${violations.length} violaciones de FK: ${JSON.stringify(violations.slice(0, 5))}`);
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
    console.log(`[db] migración aplicada: ${file}`);
  }

  dbInstance = db;
  return db;
}

module.exports = { getDb };
