# Manual Técnico Completo — ReelanceHub CRM

> Documento de referencia para inteligencias artificiales, desarrolladores y sistemas de integración.
> Describe con exactitud cómo funciona todo el sistema: arquitectura, base de datos, API, motor de bots, integraciones de canales, frontend y seguridad.

---

## 1. ¿Qué es ReelanceHub CRM?

ReelanceHub CRM es un sistema de gestión de relaciones con clientes (CRM) diseñado para agencias y empresas de servicios. Funciona como una aplicación web de una sola página (SPA) con backend Node.js y base de datos SQLite. Las características principales son:

- **Gestión de contactos** con campos personalizados, etiquetas, importación masiva
- **Pipelines de ventas** tipo Kanban con columnas (etapas) arrastrables
- **Expedientes** (deals/leads) que vinculan contactos con pipelines
- **Conversaciones omnicanal** (WhatsApp, Messenger, Instagram, Telegram, y más)
- **Motor de bots de automatización** con pasos condicionales, temporizadores, envío de mensajes y cambios de etapa
- **Plantillas de mensajes** con soporte para WhatsApp Business API
- **Sistema de asesores** con roles y permisos
- **Webhooks salientes** para notificar sistemas externos
- **Estadísticas** de ventas y actividad

---

## 2. Estructura del Repositorio

```
ReelanceHub/
├── app/                          ← Aplicación principal (backend + frontend)
│   ├── server.js                 ← Punto de entrada Express
│   ├── package.json              ← Dependencias: better-sqlite3, express
│   ├── .env                      ← Variables de entorno (no incluir en git)
│   ├── .env.example              ← Plantilla de variables de entorno
│   ├── public/                   ← Frontend estático servido por Express
│   │   ├── index.html            ← SPA completa (una sola página HTML)
│   │   ├── app.js                ← Lógica frontend (vanilla JS, ~6000 líneas)
│   │   └── styles.css            ← Estilos globales
│   ├── src/
│   │   ├── db/
│   │   │   ├── index.js          ← Inicialización SQLite + corredor de migraciones
│   │   │   └── migrations/       ← Archivos SQL numerados (001 → 021)
│   │   ├── middleware/
│   │   │   └── auth.js           ← Validación JWT de sesiones
│   │   ├── security/
│   │   │   └── crypto.js         ← Cifrado AES-256-GCM para credenciales
│   │   └── modules/              ← Módulos de funcionalidad aislados
│   │       ├── advisors/         ← Usuarios del sistema
│   │       ├── auth/             ← OAuth callbacks
│   │       ├── bot/              ← Motor de automatización
│   │       ├── conversations/    ← Mensajería y hilos
│   │       ├── customers/        ← Gestión de contactos
│   │       ├── expedients/       ← Deals/leads + actividad
│   │       ├── integrations/     ← Conectores de canales externos
│   │       ├── outgoing-webhooks/← Webhooks salientes
│   │       ├── pipelines/        ← Pipelines y etapas Kanban
│   │       ├── stats/            ← Analíticas
│   │       └── templates/        ← Plantillas de mensajes
│   └── data/
│       ├── reelance.sqlite       ← Base de datos SQLite
│       └── uploads/              ← Archivos subidos por usuarios
├── render.yaml                   ← Configuración de deploy en Render.com
├── lib/                          ← Librerías de integración Kommo CRM
├── kommo-widget/                 ← Widget para Kommo
└── claude-pro-reelance/          ← Plugin de WordPress/WooCommerce
```

---

## 3. Tecnología

| Componente | Tecnología |
|-----------|-----------|
| Runtime | Node.js 20+ |
| Framework backend | Express 5 |
| Base de datos | SQLite via `better-sqlite3` (síncrono) |
| Frontend | Vanilla JS + HTML + CSS (sin frameworks) |
| Cifrado | AES-256-GCM (Node.js `crypto`) |
| Contraseñas | scrypt (N=16384, r=8, p=1) |
| Sesiones | Token Bearer de 32 bytes aleatorios |
| Deploy | Render.com (web service + persistent disk 1GB) |

---

## 4. Arranque del Servidor

**Archivo:** `app/server.js`

### Secuencia de inicialización:

1. Carga `.env` con parser mínimo propio (sin dependencias npm)
2. Construye objeto `config` con todos los parámetros
3. Llama `getDb(config.dbPath)` → abre SQLite y corre migraciones pendientes
4. Llama `advisorSvc.ensureFirstAdmin(db, {...})` → crea admin si no existe ninguno
5. Crea app Express
6. Monta `/webhooks` primero (requieren `express.raw()` para verificación HMAC)
7. Instala `express.json({ limit: '5mb' })` global
8. Instala `authMiddleware(db)` en `/api/*`
9. Monta todos los módulos con `mountSafe()` (fallo de un módulo no tumba el servidor)
10. Sirve archivos estáticos de `public/`
11. Escucha en `config.host:config.port`

### Variables de entorno requeridas:

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
APP_BASE_URL=https://tu-dominio.com

# Seguridad
ADMIN_PASSWORD=contraseña-segura
ENCRYPTION_KEY=                    # openssl rand -hex 32 (64 caracteres hex)

# Base de datos
DB_PATH=./data/reelance.sqlite
UPLOADS_DIR=./data/uploads

# Meta / WhatsApp (si se usa)
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=

# IA (proveedor pluggable)
AI_PROVIDER=anthropic              # anthropic | openai | google | ollama | custom
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-7
```

---

## 5. Base de Datos SQLite

### Cómo funcionan las migraciones

**Archivo:** `app/src/db/index.js`

- Al arrancar, ejecuta todos los archivos `.sql` de `migrations/` ordenados numéricamente
- Usa una tabla interna para recordar cuáles ya se aplicaron
- Las migraciones son idempotentes: se pueden correr múltiples veces sin daño
- `better-sqlite3` es completamente síncrono: no hay Promises ni callbacks

### Esquema completo de tablas

#### PIPELINES — Embudos de venta

```sql
CREATE TABLE pipelines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#2563eb',   -- Color hex para UI
  icon        TEXT,                      -- Emoji o nombre de icono
  sort_order  INTEGER DEFAULT 0,         -- Orden de visualización en tabs
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#94a3b8',
  sort_order  INTEGER DEFAULT 0,
  kind        TEXT DEFAULT 'in_progress'
              CHECK (kind IN ('in_progress','won','lost')),
  bot_id      INTEGER REFERENCES salsbots(id) ON DELETE SET NULL  -- Bot que se dispara al entrar
);
```

#### CONTACTS — Clientes

```sql
CREATE TABLE contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT,
  phone       TEXT,            -- Normalizado a +52XXXXXXXXXX (o +CCNUMERO)
  email       TEXT,
  bot_paused  INTEGER DEFAULT 0,  -- 1 = todos los bots pausados para este contacto
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_email ON contacts(email);

CREATE TABLE contact_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  UNIQUE(contact_id, tag)
);
```

#### EXPEDIENTS — Leads/Deals

```sql
CREATE TABLE expedients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  pipeline_id  INTEGER NOT NULL REFERENCES pipelines(id),
  stage_id     INTEGER NOT NULL REFERENCES stages(id),
  name         TEXT,            -- Auto-generado como "LEAD-001" si no se especifica
  value        REAL DEFAULT 0,  -- Valor monetario del deal
  name_is_auto INTEGER DEFAULT 0,  -- 1 si el nombre fue auto-generado
  created_at   INTEGER DEFAULT (unixepoch()),
  updated_at   INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_expedients_contact    ON expedients(contact_id);
CREATE INDEX idx_expedients_pipeline   ON expedients(pipeline_id);
CREATE INDEX idx_expedients_stage      ON expedients(stage_id);

CREATE TABLE expedient_tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expedient_id INTEGER NOT NULL REFERENCES expedients(id) ON DELETE CASCADE,
  tag          TEXT NOT NULL,
  UNIQUE(expedient_id, tag)
);

CREATE TABLE expedient_activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expedient_id INTEGER NOT NULL REFERENCES expedients(id) ON DELETE CASCADE,
  contact_id   INTEGER,
  advisor_id   INTEGER,
  advisor_name TEXT,
  type         TEXT NOT NULL,
  description  TEXT,
  metadata     TEXT,   -- JSON arbitrario
  created_at   INTEGER DEFAULT (unixepoch())
);
```

**Tipos de actividad registrados:**
| Tipo | Descripción |
|------|-------------|
| `created` | Expediente creado |
| `stage_change` | Cambio de etapa |
| `pipeline_change` | Cambio de pipeline |
| `name_change` | Nombre del expediente modificado |
| `contact_name_change` | Nombre del contacto modificado |
| `phone_change` | Teléfono modificado |
| `tag_add` / `tag_remove` | Etiqueta añadida/eliminada |
| `bot_start` | Bot inició ejecución |
| `bot_done` | Bot completó exitosamente |
| `bot_error` | Bot terminó con error |
| `bot_killed` | Bot terminado manualmente por asesor |
| `bot_paused_manual` | Bot pausado manualmente por asesor |
| `bot_resumed` | Bot reanudado por asesor |

#### CUSTOM FIELDS — Campos personalizados

```sql
CREATE TABLE custom_field_defs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,      -- 'expedient' | 'contact'
  label      TEXT NOT NULL,
  field_type TEXT NOT NULL,      -- Ver tipos abajo
  options    TEXT,               -- JSON: ["opción1","opción2"] para select/multi_select
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE custom_field_values (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,
  record_id INTEGER NOT NULL,    -- ID del expediente o contacto
  field_id  INTEGER NOT NULL REFERENCES custom_field_defs(id) ON DELETE CASCADE,
  value     TEXT,                -- Siempre texto; la UI convierte según field_type
  UNIQUE(entity, record_id, field_id)
);
```

**Tipos de campo:**
`text` | `number` | `toggle` | `select` | `multi_select` | `date` | `url` | `long_text` | `birthday` | `datetime`

#### INTEGRATIONS — Conectores de canales

```sql
CREATE TABLE integrations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider        TEXT NOT NULL,           -- 'whatsapp' | 'messenger' | 'instagram' | 'telegram' | etc.
  status          TEXT DEFAULT 'disconnected'
                  CHECK (status IN ('connected','disconnected','error')),
  display_name    TEXT,                    -- Nombre legible (e.g. número de teléfono)
  external_id     TEXT,                    -- ID externo del canal (phone_number_id, page_id, etc.)
  credentials_enc TEXT,                    -- JSON cifrado AES-256-GCM con tokens/secrets
  config          TEXT,                    -- JSON con routing: { pipelineId, stageId }
  last_error      TEXT,
  connected_at    INTEGER,
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch())
);

CREATE TABLE webhook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  signature_hash TEXT,
  payload      TEXT,             -- JSON del evento (truncado a 10000 chars)
  received_at  INTEGER DEFAULT (unixepoch()),
  processed_at INTEGER,
  UNIQUE(provider, external_id)  -- Previene procesamiento duplicado
);

CREATE TABLE outgoing_webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  events     TEXT DEFAULT '[]',   -- JSON array de tipos de evento a notificar
  active     INTEGER DEFAULT 1,
  secret_enc TEXT,                -- Secreto para firmar payloads (cifrado)
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
```

#### CONVERSATIONS & MESSAGES — Mensajería

```sql
CREATE TABLE conversations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  integration_id   INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  provider         TEXT NOT NULL,           -- 'whatsapp' | 'messenger' | 'instagram' | 'telegram'
  external_id      TEXT NOT NULL,           -- ID del chat externo (número WA, page_scoped_id, etc.)
  last_message_at  INTEGER,
  last_message     TEXT,                    -- Preview del último mensaje
  unread_count     INTEGER DEFAULT 0,
  bot_paused       INTEGER DEFAULT 0,       -- 1 = bot pausado en esta conversación
  last_incoming_at INTEGER,                 -- Última vez que llegó mensaje (para ventana 24h WA)
  created_at       INTEGER DEFAULT (unixepoch()),
  UNIQUE(provider, external_id)             -- Una conversación por canal/chat
);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_id     TEXT,                     -- ID del mensaje en el canal externo
  direction       TEXT NOT NULL
                  CHECK (direction IN ('incoming','outgoing')),
  provider        TEXT NOT NULL,
  body            TEXT,
  media_url       TEXT,
  status          TEXT,                     -- 'sent' | 'delivered' | 'read' | 'failed'
  created_at      INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
```

#### BOTS — Automatización

```sql
CREATE TABLE salsbots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  enabled       INTEGER DEFAULT 1,
  trigger_type  TEXT NOT NULL,    -- 'keyword' | 'new_contact' | 'pipeline_stage' | 'always'
  trigger_value TEXT,             -- Palabra clave, o ID de etapa para pipeline_stage
  steps         TEXT DEFAULT '[]', -- JSON array de pasos
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE TABLE bot_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id       INTEGER REFERENCES salsbots(id) ON DELETE SET NULL,
  bot_name     TEXT,
  contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  expedient_id INTEGER REFERENCES expedients(id) ON DELETE SET NULL,
  trigger_type TEXT,
  status       TEXT DEFAULT 'running'
               CHECK (status IN ('running','done','error','killed','paused')),
  current_step INTEGER DEFAULT 0,
  total_steps  INTEGER DEFAULT 0,
  error_msg    TEXT,
  started_at   INTEGER DEFAULT (unixepoch()),
  finished_at  INTEGER
);

CREATE TABLE contact_bot_pauses (
  contact_id INTEGER NOT NULL,
  bot_id     INTEGER NOT NULL,
  paused     INTEGER DEFAULT 1,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (contact_id, bot_id)
);
```

#### TEMPLATES — Plantillas de mensajes

```sql
CREATE TABLE message_templates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  type                TEXT DEFAULT 'free_form'
                      CHECK (type IN ('free_form','wa_api')),
  name                TEXT NOT NULL,       -- Nombre técnico (snake_case para WA API)
  display_name        TEXT,               -- Nombre legible para UI
  category            TEXT,               -- 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  language            TEXT DEFAULT 'es',
  header              TEXT,               -- Texto de encabezado
  body                TEXT NOT NULL,      -- Cuerpo del mensaje
  footer              TEXT,               -- Pie de página
  wa_status           TEXT DEFAULT 'draft'
                      CHECK (wa_status IN ('draft','pending','approved','rejected')),
  wa_id               TEXT,               -- ID asignado por Meta tras envío
  wa_rejected_reason  TEXT,
  created_at          INTEGER DEFAULT (unixepoch()),
  updated_at          INTEGER DEFAULT (unixepoch())
);
```

**Variables soportadas en plantillas:**
- `{nombre}` → `contact.first_name`
- `{apellido}` → `contact.last_name`
- `{telefono}` → `contact.phone`
- `{email}` → `contact.email`

#### ADVISORS — Usuarios del sistema

```sql
CREATE TABLE advisors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,            -- scrypt: "scrypt:N:r:p:salt_hex:hash_hex"
  role          TEXT DEFAULT 'asesor'
                CHECK (role IN ('admin','asesor')),
  permissions   TEXT DEFAULT '{}',        -- JSON: { write, delete, view_reports, manage_advisors }
  active        INTEGER DEFAULT 1,
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE TABLE advisor_sessions (
  token       TEXT PRIMARY KEY,           -- 32 bytes hex aleatorio
  advisor_id  INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,           -- unixepoch() + 30 días
  created_at  INTEGER DEFAULT (unixepoch())
);
```

#### APP SETTINGS

```sql
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,              -- JSON
  updated_at INTEGER DEFAULT (unixepoch())
);
-- Claves usadas:
-- 'profile'  → { companyName, logoUrl, ... }
-- 'bot'      → { enabled, schedule, globalTriggers, ... }
```

---

## 6. Autenticación y Seguridad

### Flujo de login

```
POST /api/auth/login
Body: { username, password }

→ advisorSvc.login(db, username, password)
  1. Busca advisor por username o email
  2. Verifica password con scrypt (verifyPassword)
  3. Crea sesión: token = crypto.randomBytes(32).toString('hex')
     INSERT INTO advisor_sessions (token, advisor_id, expires_at)
     expires_at = unixepoch() + 2592000  (30 días)
  4. Retorna { token, advisor: { id, name, username, role, permissions } }
```

### Middleware de autenticación

```
GET /api/* → authMiddleware(db)
  1. Extrae token de header: "Authorization: Bearer <token>"
  2. Busca en advisor_sessions WHERE token=? AND expires_at > unixepoch()
  3. Inyecta req.advisor = { id, name, role, permissions }
  4. Si no hay token o sesión inválida → 401 Unauthorized
```

### Cifrado de credenciales

**Archivo:** `app/src/security/crypto.js`

Todas las credenciales de integraciones (tokens de API, secrets) se almacenan cifradas.

```javascript
// Formato: base64( iv[12] || authTag[16] || ciphertext )
encrypt(plaintext)   // → string cifrado base64
decrypt(ciphertext)  // → plaintext o null si falla

// Uso con JSON:
encryptJson(objeto)  // JSON.stringify + encrypt
decryptJson(cifrado) // decrypt + JSON.parse

// Enmascarar para UI (nunca enviar el valor real al frontend):
mask(valor, visible=4) // "sk_test_abc...2f45"
```

La clave se obtiene de `process.env.ENCRYPTION_KEY` (hex de 32 bytes).  
Si no está configurada, se genera una clave aleatoria efímera (se pierde al reiniciar — no usar en producción sin configurarla).

### Formato de hash de contraseñas

```
"scrypt:16384:8:1:<salt_hex_32_bytes>:<hash_hex_64_bytes>"
```

---

## 7. API REST — Referencia Completa

Todas las rutas bajo `/api/*` requieren `Authorization: Bearer <token>` excepto `/api/auth/login` y `/api/auth/logout`.

### 7.1 Auth

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Login → `{ token, advisor }` |
| `POST` | `/api/auth/logout` | Invalida sesión actual |
| `GET`  | `/api/me` | Datos del asesor autenticado |
| `GET`  | `/healthz` | Health check (sin auth) |
| `GET`  | `/api/ai/info` | Proveedor y modelo de IA configurado |

### 7.2 Contactos (`/api/contacts`)

| Método | Ruta | Body / Query | Descripción |
|--------|------|-------|-------------|
| `GET` | `/api/contacts` | `?q=&page=&per_page=&sort=&dir=` | Listar con paginación y búsqueda |
| `GET` | `/api/contacts/:id` | — | Contacto + expedientes + tags |
| `POST` | `/api/contacts` | `{ first_name, last_name?, phone?, email?, tags? }` | Crear |
| `PATCH` | `/api/contacts/:id` | campos parciales | Actualizar |
| `DELETE` | `/api/contacts/:id` | — | Eliminar (cascada) |
| `PATCH` | `/api/contacts/:id/bot-paused` | `{ paused: true/false }` | Pausar/reanudar bots |
| `POST` | `/api/contacts/check-duplicate` | `{ first_name, phone, email }` | Detectar duplicados |
| `POST` | `/api/contacts/import` | `{ rows: [...], dupePolicy: 'skip'|'update'|'create' }` | Importar masivo |

**Normalización de teléfono:**
- Si empieza con `+` → se usa tal cual
- Si empieza con `52` o `1` → se agrega `+`
- De lo contrario → se agrega `+52`
- Se eliminan espacios, guiones, paréntesis

### 7.3 Pipelines (`/api/pipelines`)

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/pipelines` | — | Lista todos los pipelines con sus etapas |
| `POST` | `/api/pipelines` | `{ name, color?, icon? }` | Crear pipeline |
| `PATCH` | `/api/pipelines/:id` | `{ name?, color?, icon? }` | Actualizar |
| `DELETE` | `/api/pipelines/:id` | — | Eliminar pipeline |
| `POST` | `/api/pipelines/reorder` | `{ order: [id1, id2, ...] }` | Reordenar pipelines |
| `POST` | `/api/pipelines/:id/stages` | `{ name, color?, kind? }` | Crear etapa |
| `POST` | `/api/pipelines/:id/stages/reorder` | `{ order: [stageId1, stageId2, ...] }` | Reordenar etapas |
| `PATCH` | `/api/pipelines/stages/:stageId` | `{ name?, color?, kind?, bot_id? }` | Actualizar etapa |
| `DELETE` | `/api/pipelines/stages/:stageId` | — | Eliminar etapa |

### 7.4 Expedientes (`/api/expedients`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/expedients` | Lista con filtros: `?q=&pipeline_id=&stage_id=&tags=&page=&per_page=` |
| `GET` | `/api/expedients/:id` | Expediente + contacto + campos personalizados |
| `POST` | `/api/expedients` | `{ contactId, pipelineId, stageId, name?, value?, tags?, fieldValues? }` |
| `PATCH` | `/api/expedients/:id` | Actualización parcial — registra actividad automáticamente |
| `DELETE` | `/api/expedients/:id` | Eliminar |
| `GET` | `/api/expedients/contacts-search` | `?q=` Búsqueda rápida de contactos |
| `GET` | `/api/expedients/field-defs` | Definiciones de campos personalizados |
| `POST` | `/api/expedients/field-defs` | Crear definición de campo |
| `PATCH` | `/api/expedients/field-defs/:id` | Actualizar definición |
| `DELETE` | `/api/expedients/field-defs/:id` | Eliminar definición |
| `GET` | `/api/expedients/tags` | Todas las etiquetas únicas |
| `GET` | `/api/expedients/:id/activity` | Historial de actividad del expediente |
| `GET` | `/api/expedients/:id/bots` | Bots disponibles para este expediente |
| `GET` | `/api/expedients/:id/bot-runs` | Ejecuciones de bots |
| `PATCH` | `/api/expedients/:id/bots/:botId` | `{ paused: true/false }` Pausar bot por contacto |

**Cuando se actualiza un expediente via PATCH, el servicio:**
1. Detecta qué campos cambiaron (stage, pipeline, name, etc.)
2. Registra cada cambio en `expedient_activity`
3. Si cambia la etapa → llama `botEngine.triggerPipelineStage()`
4. Si cambia el nombre del contacto/teléfono → registra actividad

### 7.5 Integraciones (`/api/integrations`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/integrations` | Catálogo de proveedores + instancias conectadas |
| `GET` | `/api/integrations/:id` | Detalle de integración (secrets enmascarados) |
| `POST` | `/api/integrations/:provider/connect` | `{ credentials: {...} }` → conectar y verificar |
| `PATCH` | `/api/integrations/:id` | Actualizar credenciales (merge con existentes) |
| `POST` | `/api/integrations/:id/test` | Verificar conexión existente |
| `PATCH` | `/api/integrations/:id/routing` | `{ pipelineId, stageId }` Routing de nuevos contactos |
| `POST` | `/api/integrations/:id/telegram-webhook` | Re-registrar webhook de Telegram |
| `DELETE` | `/api/integrations/:id` | Desconectar |

**Al conectar una integración:**
1. Se llama `provider.test({ credentials })` → verifica que las credenciales funcionen
2. Si OK: se cifran las credenciales con `encryptJson()` y se guardan
3. Para Telegram: se registra el webhook automáticamente con `setWebhook`

### 7.6 Conversaciones (`/api/conversations`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/conversations` | `?q=&provider=&unread=&contact_id=&page=` |
| `GET` | `/api/conversations/:id` | Conversación + contacto + mensajes recientes |
| `GET` | `/api/conversations/:id/messages` | `?page=&per_page=` Mensajes paginados |
| `PATCH` | `/api/conversations/:id/read` | Marcar como leída (unread_count = 0) |
| `PATCH` | `/api/conversations/:id/bot-paused` | `{ paused: true/false }` |
| `POST` | `/api/conversations/:id/messages` | `{ body, media_url? }` Enviar mensaje |

**Al enviar un mensaje (`POST /messages`):**
1. Llama `sendMessage(db, convo, body)` del sender
2. El sender detecta el provider y usa la API correspondiente
3. Guarda el mensaje en `messages` con `direction='outgoing'`
4. Actualiza `conversations.last_message`

### 7.7 Bots (`/api/bot`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/bot` | Lista todos los bots |
| `POST` | `/api/bot` | `{ name, trigger_type, trigger_value, steps, enabled }` |
| `GET` | `/api/bot/:id` | Detalle de bot |
| `PATCH` | `/api/bot/:id` | Actualizar bot |
| `DELETE` | `/api/bot/:id` | Eliminar bot |
| `GET` | `/api/bot/logs` | Últimas 200 entradas del log en memoria |
| `DELETE` | `/api/bot/logs` | Limpiar logs |
| `POST` | `/api/bot/diagnose` | `{ contactId?, phone? }` Diagnóstico de bots disponibles |
| `POST` | `/api/bot/test-trigger` | `{ triggerType, contactId?, phone? }` Disparar bot de prueba |
| `POST` | `/api/bot/runs/:runId/kill` | Terminar ejecución inmediatamente |
| `POST` | `/api/bot/runs/:runId/pause` | Pausar ejecución |
| `POST` | `/api/bot/runs/:runId/resume` | Reanudar ejecución |

### 7.8 Plantillas (`/api/templates`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/templates` | `?type=free_form|wa_api` |
| `GET` | `/api/templates/:id` | Detalle |
| `POST` | `/api/templates` | `{ type, name, display_name, category, language, header?, body, footer? }` |
| `PUT` | `/api/templates/:id` | Actualizar completo |
| `DELETE` | `/api/templates/:id` | Eliminar |
| `POST` | `/api/templates/:id/submit` | Enviar a Meta para aprobación |
| `POST` | `/api/templates/:id/sync` | Sincronizar estado desde Meta |
| `POST` | `/api/templates/sync-all` | Sincronizar todas las pendientes |

### 7.9 Asesores (`/api/advisors`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/advisors` | Lista (requiere admin o `manage_advisors`) |
| `POST` | `/api/advisors` | `{ name, username, email, password, role, permissions }` (admin) |
| `PATCH` | `/api/advisors/:id` | Actualizar (admin o propio perfil) |
| `DELETE` | `/api/advisors/:id` | Eliminar (admin, no puede eliminar el último admin) |

### 7.10 Estadísticas (`/api/stats`)

Endpoints de analíticas de ventas, actividad de bots y conversaciones.

### 7.11 Webhooks salientes (`/api/outgoing-webhooks`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/outgoing-webhooks` | Lista |
| `POST` | `/api/outgoing-webhooks` | `{ name, url, events, secret? }` |
| `PATCH` | `/api/outgoing-webhooks/:id` | Actualizar |
| `DELETE` | `/api/outgoing-webhooks/:id` | Eliminar |

### 7.12 Configuración de perfil

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/settings/profile` | Perfil de empresa |
| `PATCH` | `/api/settings/profile` | `{ companyName, logoUrl, ... }` |

---

## 8. Webhooks Entrantes — Canales de Mensajería

**Archivo:** `app/src/modules/integrations/webhooks.js`

Todos los webhooks se montan en `/webhooks/*` con `express.raw()` para acceder al body crudo (necesario para verificación HMAC).

### Reglas críticas de webhooks:
1. **Responder 200 en menos de 2 segundos** — procesamiento es async
2. **Verificar firma HMAC sobre raw body** (nunca sobre body parseado)
3. **Idempotencia** — tabla `webhook_events` con `UNIQUE(provider, external_id)` previene procesamiento doble
4. **Errores nunca tumban el proceso** — solo se loggean

### Flujo de un mensaje entrante (WhatsApp):

```
POST /webhooks/whatsapp
→ Verificar firma X-Hub-Signature-256 (HMAC-SHA256 con appSecret)
→ Responder 200 inmediatamente
→ Insertar en webhook_events (idempotencia)
→ processWhatsAppMessages(payload, integration)
  → Por cada mensaje en payload.entry[].changes[].value.messages[]:
    1. convoSvc.findOrCreate(db, { provider, externalId: waId, ... })
       → Busca conversación por (provider, external_id)
       → Si no existe: crea contacto (normaliza teléfono) + crea conversación
    2. convoSvc.addMessage(db, convo.id, { direction: 'incoming', body, ... })
    3. ensureExpedient(contactId, routing)
       → Si la integración tiene routing configurado, crea expediente si no existe
    4. botEngine.triggerMessage(db, { convoId, contactId, messageBody, ... })
       → Evalúa todos los bots habilitados con trigger_type='keyword' o 'always'
```

### Verificación de firmas por proveedor:

| Proveedor | Header | Algoritmo | Clave |
|-----------|--------|-----------|-------|
| WhatsApp/Messenger/Instagram | `X-Hub-Signature-256` | `sha256=` + HMAC-SHA256 hex | `appSecret` |
| Shopify | `X-Shopify-Hmac-Sha256` | HMAC-SHA256 base64 | `webhookSecret` |
| WooCommerce | `X-WC-Webhook-Signature` | HMAC-SHA256 base64 | `webhookSecret` |
| Square | `X-Square-Hmacsha256-Signature` | HMAC-SHA256 base64 de `URL+body` | `webhookSignatureKey` |
| Telegram | `X-Telegram-Bot-Api-Secret-Token` | Token directo (no HMAC) | `webhookSecret` |

### Endpoints de webhook:

```
GET  /webhooks/whatsapp      ← Verificación de Meta (hub.challenge)
POST /webhooks/whatsapp      ← Mensajes entrantes
GET  /webhooks/messenger
POST /webhooks/messenger
GET  /webhooks/instagram
POST /webhooks/instagram
POST /webhooks/telegram
POST /webhooks/shopify
POST /webhooks/woocommerce
POST /webhooks/square
POST /webhooks/tiktok
GET  /webhooks/_debug        ← Últimos 50 eventos (solo desarrollo)
```

---

## 9. Motor de Bots

**Archivo:** `app/src/modules/bot/engine.js`

### Estructura de un bot

```javascript
{
  id: 1,
  name: "Bienvenida WA",
  enabled: 1,
  trigger_type: "keyword",          // 'keyword' | 'new_contact' | 'pipeline_stage' | 'always'
  trigger_value: "hola",            // Palabra clave, o ID de etapa
  steps: [                          // Array JSON de pasos
    {
      type: "message",
      config: {
        text: "Hola {nombre}, ¡bienvenido!",
        channelId: "auto"           // 'auto' | ID de integración
      }
    },
    {
      type: "timer",
      config: { minutes: 5 }        // days, hours, minutes, seconds
    },
    {
      type: "stage",
      config: { pipelineId: 1, stageId: 3 }
    },
    {
      type: "tag",
      config: { tag: "interesado" }
    },
    {
      type: "condition",
      config: {
        field: "message",           // 'message' | 'tag' | 'pipeline'
        operator: "contains",
        value: "precio"
      }
    },
    {
      type: "stop_bot",
      config: {}                    // Pausa el bot para esta conversación
    }
  ]
}
```

### Tipos de disparo (triggers)

| `trigger_type` | `trigger_value` | Cuándo se dispara |
|---------------|----------------|------------------|
| `keyword` | `"hola"` | Cuando llega un mensaje que contiene la palabra clave |
| `always` | `""` | En cada mensaje entrante |
| `new_contact` | `""` | Cuando se crea un nuevo contacto |
| `pipeline_stage` | `"3"` (stageId) | Cuando un expediente entra a esa etapa |

### Tipos de pasos (steps)

| `type` | Acción |
|--------|--------|
| `message` | Envía un mensaje de texto al contacto. Soporta variables `{nombre}`, `{apellido}`, `{telefono}`, `{email}` |
| `timer` | Espera un tiempo (días, horas, minutos, segundos). Interruptible por kill/pause |
| `stage` | Mueve/crea el expediente del contacto a una etapa específica |
| `tag` | Añade una etiqueta al contacto |
| `condition` | Evalúa condición. Si falla, detiene el bot |
| `stop_bot` | Marca `bot_paused=1` en la conversación (el bot no responderá más mensajes) |

### Sistema de señales de control (kill/pause/resume)

```javascript
// Registro en memoria de señales activas
const _signals = new Map();
// { runId → { kill: false, pause: false } }

// Al iniciar ejecución:
_signals.set(runId, { kill: false, pause: false });

// killRun(db, runId):
//   sig.kill = true → el loop de pasos detecta y termina con status='killed'
//   También actualiza DB directamente (por si la ejecución está en timer)

// pauseRun(db, runId):
//   sig.pause = true → el timer y el loop esperan en chunks de 500ms

// resumeRun(db, runId):
//   sig.pause = false → el loop continúa
```

### Deduplicación de ejecuciones

Antes de iniciar una nueva ejecución, el motor mata cualquier ejecución activa del mismo bot para el mismo contacto:

```javascript
const active = db.prepare(
  "SELECT id FROM bot_runs WHERE bot_id=? AND contact_id=? AND status IN ('running','paused')"
).all(bot.id, ctx.contactId);
for (const row of active) killRun(db, row.id);
```

### Guardias de pausa en temporizadores

Los timers verifican kill/pause cada segundo sin consumir el tiempo de espera:

```javascript
while (elapsed < ms) {
  if (sig?.kill) return false;           // Detener inmediatamente
  while (sig?.pause && !sig?.kill) {     // Esperar sin consumir timer
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, Math.min(1000, ms - elapsed)));
  elapsed += 1000;
}
```

### Variables en mensajes

```javascript
function replaceVars(text, ctx) {
  const c = ctx.contact || {};
  return text
    .replace(/\{nombre\}/gi,   c.name      || '')
    .replace(/\{apellido\}/gi, c.last_name  || '')
    .replace(/\{telefono\}/gi, c.phone      || '')
    .replace(/\{email\}/gi,    c.email      || '');
}
```

---

## 10. Envío de Mensajes por Canal

**Archivo:** `app/src/modules/conversations/sender.js`

```javascript
sendMessage(db, convo, text)
// Detecta convo.provider y delega:
// → sendWhatsApp   → Graph API /v22.0/{phoneNumberId}/messages
// → sendMessenger  → Graph API /v22.0/me/messages
// → sendInstagram  → Graph API /v22.0/me/messages
// → sendTelegram   → api.telegram.org/bot{token}/sendMessage
```

**WhatsApp payload:**
```json
{
  "messaging_product": "whatsapp",
  "to": "{número_wa_id}",
  "type": "text",
  "text": { "body": "Mensaje aquí" }
}
```

**Telegram payload:**
```json
{
  "chat_id": "{chat_id}",
  "text": "Mensaje aquí"
}
```

Las credenciales se obtienen de la integración vinculada a la conversación (descifradas en el momento de uso, nunca persistidas en memoria).

---

## 11. Integraciones — Proveedores

**Directorio:** `app/src/modules/integrations/providers/`

Cada proveedor exporta un objeto con:

```javascript
{
  meta: { key, name, description, color, initial, docsUrl },
  fields: [{ key, label, type, required, secret, help }],
  test: async ({ credentials }) => { ok, displayName?, externalId?, message? }
}
```

### WhatsApp Cloud API

```javascript
fields: [
  { key: 'phoneNumberId',      required: true  },
  { key: 'wabaId',             required: true  },
  { key: 'accessToken',        required: true, secret: true },
  { key: 'webhookVerifyToken', required: false, secret: true }
]
test: GET https://graph.facebook.com/v22.0/{phoneNumberId}?fields=display_phone_number,verified_name,quality_rating
```

### Messenger

```javascript
fields: [
  { key: 'pageAccessToken', required: true, secret: true },
  { key: 'appSecret',       required: true, secret: true },
  { key: 'webhookVerifyToken' }
]
```

### Instagram

Similar a Messenger (misma Graph API).

### Telegram

```javascript
fields: [
  { key: 'botToken',       required: true, secret: true },
  { key: 'webhookSecret',  required: false, secret: true }
]
// Al conectar: registra webhook automáticamente
// POST https://api.telegram.org/bot{token}/setWebhook
//   { url: APP_BASE_URL + '/webhooks/telegram', secret_token: webhookSecret }
```

### Shopify

```javascript
fields: [
  { key: 'shopDomain',    required: true  },  // tu-tienda.myshopify.com
  { key: 'accessToken',   required: true, secret: true },
  { key: 'webhookSecret', required: false, secret: true }
]
```

### WooCommerce

```javascript
fields: [
  { key: 'siteUrl',       required: true  },
  { key: 'consumerKey',   required: true, secret: true },
  { key: 'consumerSecret',required: true, secret: true },
  { key: 'webhookSecret', required: false, secret: true }
]
```

### Square

```javascript
fields: [
  { key: 'accessToken',          required: true, secret: true },
  { key: 'webhookSignatureKey',  required: false, secret: true }
]
```

### TikTok

```javascript
fields: [
  { key: 'clientKey',    required: true },
  { key: 'clientSecret', required: true, secret: true }
]
```

---

## 12. Registro de Actividad

**Archivo:** `app/src/modules/expedients/activity.js`

```javascript
activity.log(db, {
  expedientId: 42,
  contactId:   7,
  advisorId:   1,          // Opcional: qué asesor lo hizo
  advisorName: "Juan",     // Opcional: nombre del asesor
  type:        'stage_change',
  description: 'Etapa cambiada de "Nuevo" a "Calificado"',
  metadata:    { fromStageId: 1, toStageId: 2 }  // JSON arbitrario
})
```

El registro de actividad se llama automáticamente desde:
- `expedients/service.js` al actualizar cualquier campo del expediente
- `bot/engine.js` al iniciar, terminar o fallar una ejecución de bot
- `bot/routes.js` al matar, pausar o reanudar un bot manualmente

---

## 13. Frontend (SPA)

**Archivos:** `app/public/index.html`, `app/public/app.js`, `app/public/styles.css`

El frontend es una Single Page Application sin framework (vanilla JS). Usa el patrón de "vistas" con un router mínimo.

### Vistas principales

| Vista | `data-view` | Descripción |
|-------|-------------|-------------|
| Dashboard | `home` | Métricas, gráficas, actividad reciente |
| Chats | `chats` | Lista de conversaciones + chat activo |
| Kanban | `pipeline` | Tablero de expedientes por columnas |
| Expediente detalle | `exp-detail` | Vista expandida de un expediente |
| Contactos | `contacts` | CRM de contactos |
| Plantillas | `templates` | Gestión de plantillas de mensajes |
| Bots | `bots` | Creación y gestión de bots |
| Integraciones | `integrations` | Conectar canales externos |
| Asesores | `advisors` | Gestión de usuarios |
| Ajustes | `settings` | Configuración del sistema |

### Patrón de comunicación con API

```javascript
// Función helper central
async function api(method, path, body, opts = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_token}`  // Token almacenado en localStorage
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### Estado de sesión en frontend

```javascript
let _token    = localStorage.getItem('rh_token');
let _advisor  = JSON.parse(localStorage.getItem('rh_advisor') || 'null');
```

Al login exitoso, se guardan en `localStorage`. Al logout, se eliminan.

### Sistema de drag & drop (Kanban)

**Tarjetas de expedientes:**
- Usan HTML5 Drag and Drop API nativa
- El elemento arrastrables es `.pl-card[draggable="true"]`
- Al soltar sobre una columna distinta → `PATCH /api/expedients/:id` con nuevo `stageId`
- Al soltar sobre un tab de pipeline → mueve el expediente a la primera etapa de ese pipeline

**Columnas (etapas):**
- Handle de 6 puntos (`.pl-col-drag-handle`) en el header
- `mousedown` en el handle activa `col.draggable = true`
- `dragend` desactiva `draggable` (evita arrastres accidentales)
- Al soltar → `POST /api/pipelines/:id/stages/reorder` con nuevo orden

**Tabs de pipelines:**
- Handle de 6 puntos en cada tab
- Al soltar → `POST /api/pipelines/reorder` con nuevo orden

### Selector de plantillas (Template Picker)

```javascript
// Lógica de disponibilidad por canal
_wa24Open(convo)  
// → 'open'   si la conversación es WA y last_incoming_at < 24h
// → 'closed' si la conversación es WA y pasaron las 24h
// → 'none'   si no es WhatsApp

_tplAvailability(template, convo)
// → { ok: true }  si se puede enviar
// → { ok: false, reason: "..." } si no se puede
//   - free_form en WA cerrado → bloqueado
//   - wa_api no aprobada → bloqueado
```

Las plantillas de tipo `free_form` solo se pueden enviar en la ventana de 24h de WhatsApp.  
Las de tipo `wa_api` con `wa_status = 'approved'` pueden enviarse en cualquier momento.

### Buscador en chat

El buscador en el detalle de expediente filtra en tiempo real:
- Cuerpo de mensajes
- Descripciones de notificaciones de actividad
- Metadatos de actividad

Los términos encontrados se resaltan con `<mark class="rh-chat-hl">` usando la función `highlightText(rawText, query)` que primero escapa HTML para evitar XSS.

---

## 14. Deployment en Render.com

**Archivo:** `render.yaml`

```yaml
services:
  - type: web
    name: reelance-hub
    env: node
    rootDir: app
    buildCommand: npm install
    startCommand: node server.js
    disk:
      name: reelance-hub-data
      mountPath: /opt/render/project/src/data
      sizeGB: 1
    envVars:
      - key: NODE_VERSION
        value: "20"
      - key: PORT
        value: "10000"
      - key: NODE_ENV
        value: "production"
      - key: APP_BASE_URL
        sync: false          # Configurar manualmente en el dashboard
      - key: ENCRYPTION_KEY
        sync: false          # openssl rand -hex 32
      - key: ADMIN_PASSWORD
        sync: false
```

**Puntos críticos del deploy:**
- El disco persistente monta en `/opt/render/project/src/data` — ahí va el SQLite
- `DB_PATH` debe apuntar al disco persistente: `./data/reelance.sqlite`
- `APP_BASE_URL` debe ser la URL pública asignada por Render para que los webhooks de Meta funcionen
- `ENCRYPTION_KEY` debe ser fija y generada antes del primer deploy

---

## 15. Plugin WordPress/WooCommerce

**Directorio:** `claude-pro-reelance/`

Plugin de WordPress que expone una API REST para que el servidor Node pueda consultar datos de WooCommerce. Permite al MCP (Model Context Protocol) de Claude acceder a:

- `get_orders` / `get_order_detail`
- `get_customers` / `get_customer_detail` / `get_customer_orders`
- `get_products` / `get_product_detail` / `get_low_stock_products`
- `get_coupons`
- `get_sales_report` / `get_top_sellers`
- `get_site_overview` / `get_todays_orders`
- `get_wp_settings` / `update_wp_settings`
- `get_wp_users`
- `list_wp_plugins` / `activate_plugin` / `deactivate_plugin`
- `update_order_status` / `add_order_note`
- `update_product`
- `discover_plugin_apis` / `get_plugin_routes` / `call_plugin_api`

Se activa en WordPress, se configura con una clave API, y el servidor Node usa esa clave para hacer peticiones.

---

## 16. Integración con Kommo CRM

**Directorio:** `lib/` y `kommo-widget/`

Integración bidireccional con Kommo (antes amoCRM):
- `lib/` contiene helpers para el API de Kommo (OAuth2, deals, contacts, leads)
- `kommo-widget/` es un widget instalable en Kommo que permite enviar mensajes desde la UI de Kommo

---

## 17. Convenciones de Código

### Backend

1. **Módulo = factory function**: cada módulo exporta `function(db) { return router; }`
2. **Síncrono**: `better-sqlite3` no usa Promises. No mezclar async/await en queries SQLite
3. **Transacciones**: operaciones multi-tabla usan `db.transaction(() => { ... })()`
4. **Errores**: try/catch en cada route handler, responder 400/404/500 según corresponda
5. **Timestamps**: siempre en Unix epoch segundos (`unixepoch()` en SQLite)
6. **IDs**: siempre Integer, nunca UUID
7. **JSON en SQLite**: columnas como `steps`, `permissions`, `config`, `metadata` almacenan JSON como TEXT

### Frontend

1. **Sin framework**: vanilla JS ES2020+, sin React/Vue/Angular
2. **Una función = una vista**: `renderContacts()`, `renderPipelines()`, etc.
3. **Estado global mínimo**: variables `_` prefijadas para estado de módulo
4. **Fetch centralizado**: toda comunicación API pasa por `api(method, path, body)`
5. **No hay build step**: los archivos se sirven directamente, sin compilación

### Nomenclatura de rutas API

- Recursos en plural inglés: `/api/contacts`, `/api/pipelines`, `/api/conversations`
- Excepciones históricas: `/api/bot` (singular), `/api/expedients` (mezcla español/inglés)
- Acciones como sub-rutas: `/api/bot/runs/:id/kill`, `/api/contacts/import`

---

## 18. Cómo Crear una Nueva Integración

Para agregar un nuevo canal de mensajería (p.ej. WhatsApp Business App, Viber, SMS):

### Paso 1: Crear el archivo de proveedor

`app/src/modules/integrations/providers/nuevo-canal.js`

```javascript
module.exports = {
  meta: {
    key: 'nuevo-canal',
    name: 'Nombre del Canal',
    description: 'Descripción breve',
    color: '#hexcolor',
    initial: 'N',
  },
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true }
  ],
  async test({ credentials }) {
    // Verificar que las credenciales funcionen
    // Retornar { ok: true, displayName, externalId } o { ok: false, message }
  }
};
```

### Paso 2: Registrar en el índice de proveedores

`app/src/modules/integrations/providers/index.js`:

```javascript
const nuevoCanalProvider = require('./nuevo-canal');
// Agregar a la lista de providers
```

### Paso 3: Agregar handler de webhook

En `app/src/modules/integrations/webhooks.js`:

```javascript
function nuevoCanalHandler(req, res) {
  const raw = req.body;
  // 1. Verificar firma
  // 2. Responder 200 inmediatamente
  // 3. Parsear payload
  // 4. Por cada mensaje:
  //    convoSvc.findOrCreate(db, { provider: 'nuevo-canal', externalId, ... })
  //    convoSvc.addMessage(db, convo.id, { direction: 'incoming', body, ... })
  //    botEngine.triggerMessage(db, { convoId, contactId, messageBody, ... })
}

router.post('/nuevo-canal', raw, nuevoCanalHandler);
```

### Paso 4: Implementar envío de mensajes

En `app/src/modules/conversations/sender.js`:

```javascript
async function sendNuevoCanal(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId);
  // Llamar a la API del canal y retornar el ID del mensaje externo
}

// Agregar case en sendMessage():
else if (convo.provider === 'nuevo-canal') {
  return sendNuevoCanal(db, convo, text);
}
```

---

## 19. Cómo Crear un Nuevo Bot

### Via API:

```javascript
POST /api/bot
{
  "name": "Seguimiento ventas",
  "enabled": true,
  "trigger_type": "pipeline_stage",
  "trigger_value": "5",           // ID de la etapa
  "steps": [
    {
      "type": "message",
      "config": {
        "text": "Hola {nombre}, gracias por tu interés. ¿Tienes alguna pregunta?",
        "channelId": "auto"
      }
    },
    {
      "type": "timer",
      "config": { "hours": 24 }
    },
    {
      "type": "condition",
      "config": { "field": "tag", "value": "respondió" }
    },
    {
      "type": "message",
      "config": {
        "text": "Solo quería hacer seguimiento. ¿Necesitas más información?"
      }
    },
    {
      "type": "stage",
      "config": { "pipelineId": 1, "stageId": 6 }
    }
  ]
}
```

### Para dispararlo via pipeline:

1. Crear el bot con `trigger_type: "pipeline_stage"` y `trigger_value: "{stageId}"`
2. Alternativamente: asignar el bot directamente a la etapa via `PATCH /api/pipelines/stages/:stageId` con `{ bot_id: botId }`
3. Cuando un expediente entra a esa etapa (via `PATCH /api/expedients/:id` con nuevo `stageId`), el engine llama `triggerPipelineStage()`

---

## 20. Flujo Completo de un Lead Nuevo desde WhatsApp

```
1. Cliente envía "hola" al número de WhatsApp
↓
2. Meta llama POST /webhooks/whatsapp con el payload
↓
3. Se verifica firma HMAC (si está configurada)
↓
4. Se responde 200 (< 2 segundos)
↓
5. processWhatsAppMessages():
   - convoSvc.findOrCreate() → crea contacto "Nombre Desconocido" con phone +5251234567
   - convoSvc.addMessage()   → guarda mensaje como 'incoming'
   - ensureExpedient()       → si integración tiene routing: crea expediente en pipeline/etapa configurados
   - botEngine.triggerMessage() → evalúa bots con trigger_type='keyword'
↓
6. Bot "Bienvenida" tiene trigger_value="hola":
   - Se inicia ejecución async
   - runAsync() mata ejecuciones duplicadas previas
   - execute() registra run en bot_runs (status='running')
   - Paso 1 message: sendMessage() → Graph API de WhatsApp
   - Paso 2 timer: espera 30 segundos (chunked, interruptible)
   - Paso 3 stage: mueve expediente a etapa "Calificando"
↓
7. Al mover de etapa → triggerPipelineStage() → dispara otro bot si aplica
↓
8. En el frontend, el asesor ve la conversación nueva en "Chats"
9. Puede responder manualmente, pausar/matar el bot, o agregar etiquetas
```

---

## 21. Glosario

| Término | Significado en el sistema |
|---------|--------------------------|
| **Expediente** | Un deal/lead: vincula un contacto con una etapa de un pipeline |
| **Pipeline** | Embudo de ventas: secuencia de etapas tipo Kanban |
| **Etapa** | Columna de un pipeline. `kind` puede ser `in_progress`, `won`, o `lost` |
| **Conversación** | Hilo de mensajes con un contacto en un canal específico |
| **Bot** | Secuencia automatizada de pasos que se ejecuta ante un trigger |
| **Run** | Una ejecución concreta de un bot para un contacto específico |
| **Asesor** | Usuario del CRM (rol `admin` o `asesor`) |
| **Integración** | Conexión con un canal externo (WhatsApp, Telegram, etc.) |
| **Plantilla** | Mensaje predefinido. `free_form` = básico, `wa_api` = aprobado por Meta |
| **Routing** | Configuración de qué pipeline/etapa asignar a nuevos contactos de una integración |
| **wa_id** | ID asignado por Meta a una plantilla aprobada de WhatsApp Business API |
| **Webhook** | Llamada HTTP que hace un servicio externo al CRM cuando ocurre un evento |

---

*Manual generado el 2026-05-01. Versión de la aplicación: 0.0.1*
