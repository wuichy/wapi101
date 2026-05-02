# Manual Maestro — Reelance CRM

> **Documento de handoff para humanos y para IAs.** Lee esto antes de tocar el proyecto. Última actualización: 2026-05-01.

Este manual consolida **todo el conocimiento operativo** del Reelance CRM (la app nueva en `app/`, NO el Reelance Hub viejo del directorio raíz).

Lecturas complementarias:
- [README.md](../README.md) — visión general y estado del proyecto
- [LECCIONES_APRENDIDAS.md](LECCIONES_APRENDIDAS.md) — anti-patterns del proyecto padre que evitamos
- [DEPLOYMENT.md](DEPLOYMENT.md) — local Mac vs VPS

---

## 1. Qué es Reelance CRM y dónde vive

**Reelance CRM** es un CRM multi-canal (WhatsApp / Messenger / Instagram / Telegram) construido en Node.js + SQLite. Vive en `/Users/luismelchor/Desktop/ReelanceHub/app/` y se sirve públicamente en **https://lucho101.com**.

Reemplazó al **Reelance Hub** (proyecto padre en el directorio raíz que dependía de Kommo). Reelance Hub sigue presente en disco pero **apagado** — su LaunchAgent está descargado.

### Stack
- **Backend**: Node 20 (x86_64), Express 5, better-sqlite3 (rebuild requerido para x86_64 en Apple Silicon — ver §11)
- **Frontend**: vanilla JS, sin framework, ~6k líneas en [public/app.js](../public/app.js)
- **DB**: SQLite (`app/data/reelance.sqlite`) en modo WAL
- **Webhooks**: cloudflared expone `127.0.0.1:3001` → `lucho101.com`
- **Autoarranque**: LaunchAgents `~/Library/LaunchAgents/com.reelance.app.plist` y `com.reelance.tunnel.plist`

### Acceso
- URL pública: **https://lucho101.com**
- URL local: http://127.0.0.1:3001
- Admin del CRM: usuario `wuichy`, password en posesión del usuario (Luis Melchor)
- **DB path**: `/Users/luismelchor/.reelance/data/reelance.sqlite` ⚠️ NO en `app/data/` (ver §11.0)
- Logs: `/Users/luismelchor/Desktop/ReelanceHub/app/logs/server.log` y `server-error.log`
- Backups automáticos horarios: `/Users/luismelchor/Desktop/ReelanceHub-Backups/`

---

## 2. Estructura del proyecto

```
app/
├── server.js                      Express + bootstrap. Punto de entrada.
├── .env                           Secrets (NO commit). Ver §10
├── data/
│   ├── reelance.sqlite            DB principal (WAL mode)
│   ├── uploads/                   Adjuntos de mensajes (media)
│   └── wa-sessions/<id>/          Auth state de Baileys (whatsapp-lite QR)
├── docs/                          ← Este manual + lecciones + deployment
├── logs/                          server.log, server-error.log, cloudflared.log
├── public/
│   ├── index.html                 SPA principal. Meta tags PWA, manifest.
│   ├── login.html                 Pantalla de login
│   ├── app.js                     Lógica frontend (~6k líneas)
│   ├── styles.css                 Tailwind-inspired vanilla CSS
│   ├── sw.js                      Service Worker (push notifications)
│   ├── manifest.json              PWA manifest
│   └── icons/                     icon-180/192/512.png
├── scripts/
│   ├── seed-fake-customers.js     Genera clientes demo
│   └── migrate-kommo-pipelines.js Migración one-shot de pipelines de Kommo
└── src/
    ├── db/
    │   ├── index.js               Singleton SQLite + runner de migraciones
    │   └── migrations/            001_init.sql … 023_notifications.sql
    ├── middleware/auth.js         Bearer token middleware
    ├── security/crypto.js         AES-256-GCM para credenciales
    └── modules/
        ├── advisors/              Usuarios + sesiones (admin/asesor)
        ├── auth/                  OAuth callbacks (Meta, TikTok)
        ├── bot/                   Salesbots: engine + runs
        ├── conversations/         Conversaciones unificadas + sender por canal
        ├── customers/             Contactos
        ├── expedients/            Casos/leads en pipelines
        ├── integrations/          Connectores
        │   ├── providers/         whatsapp.js, whatsapp-lite.js, telegram, etc.
        │   ├── routes.js
        │   ├── service.js         hydrate(), connect(), connectQr(), qrStatus()
        │   ├── webhooks.js        Receptor multi-provider con HMAC
        │   └── whatsapp-web/      Baileys (QR scan) — manager + bootstrap
        ├── notifications/         Web Push (VAPID)
        ├── outgoing-webhooks/     Para suscriptores externos
        ├── pipelines/             CRUD pipelines + stages
        ├── stats/                 Métricas dashboard
        ├── templates/             Plantillas WhatsApp (sync con Meta)
        └── trash/                 Papelera 30 días con restore
```

---

## 3. Decisiones arquitectónicas importantes

### 3.1 Dos providers de "WhatsApp", NO los confundas

| Provider | Archivo | Cómo conecta | Sender | Webhooks |
|---|---|---|---|---|
| **`whatsapp`** ("WhatsApp Business API") | [providers/whatsapp.js](../src/modules/integrations/providers/whatsapp.js) | Cloud API oficial — el usuario llena 4 campos: `phoneNumberId`, `wabaId`, `accessToken`, `webhookVerifyToken` | `sendWhatsApp()` en [conversations/sender.js](../src/modules/conversations/sender.js) — POST a `graph.facebook.com/v22.0/{id}/messages` con Bearer token | Llegan a `/webhooks/whatsapp` (HTTP) |
| **`whatsapp-lite`** ("WhatsApp Lite QR") | [providers/whatsapp-lite.js](../src/modules/integrations/providers/whatsapp-lite.js) | QR scan estilo WhatsApp Web — `authType: 'qr'`, NO tiene fields | `sendWhatsAppLite()` — usa Baileys socket vía manager | Eventos `messages.upsert` de Baileys (NO HTTP webhooks) |

### 3.2 ¿Por qué dos providers?

El usuario quería ambos:
- **Business API**: oficial, estable, plantillas aprobadas, ventana 24h, costo por conversación
- **Lite QR**: gratis, sin plantillas, sin ventana 24h, **alto riesgo de ban**, sin soporte oficial — pero replica el "Lite" de Kommo

`whatsapp-lite` está implementado con **Baileys 7.0.0-rc.9**:
- Cada integración tiene una sesión persistente en memoria (Map en [whatsapp-web/manager.js](../src/modules/integrations/whatsapp-web/manager.js))
- Auth state se guarda en `data/wa-sessions/<integration_id>/`
- Reconexión exponencial (cap 60s)
- Si el usuario hace logout en el dispositivo → status='disconnected' + auth files borrados

### 3.3 Flujo "QR" en frontend (whatsapp-lite)

1. Usuario click "Conectar" → `POST /api/integrations/whatsapp-lite/connect` con body vacío
2. Backend crea integración con `status='connecting'` + arranca sesión Baileys (no espera el QR)
3. Frontend polea `GET /api/integrations/:id/qr-status` cada 1.5s
4. Cuando Baileys emite `connection.update` con `qr` → `qrStatus()` lo expone como data URL PNG
5. Usuario escanea desde el celular → Baileys emite `connection: 'open'` → `bootstrap.onConnected` actualiza `status='connected'` + número
6. Frontend detecta `liveStatus === 'connected'` → cierra modal + abre routing

### 3.4 Si el usuario cierra el modal SIN escanear

`closeIntegrationModal` llama `abortPendingQrIfNeeded` → `DELETE /api/integrations/:id` → cleanup completo (mata socket Baileys, borra auth files, elimina row). **NO dejar rows huérfanos en `connecting`** — Baileys reintentará para siempre y los logs se inundan.

### 3.5 `connectQr()` solo reusa rows en `connecting`/`pending`

NO reusar rows en `disconnected` o `error` — esos son terminales, fresh start cada vez.

### 3.6 Cleanup al boot

`bootstrap.init(db)` al inicio del server:
1. Borra rows huérfanos `connecting`/`pending` de whatsapp-lite + sus auth files
2. Restaura sesiones Baileys de rows `connected` con auth state existente

---

## 4. Lecciones aprendidas en esta sesión (DO / DON'T)

### ✅ DO

1. **Usa el provider correcto al conectar WhatsApp** — la card "WhatsApp Business API" pide 4 campos, la card "WhatsApp Lite (QR)" no pide ningún campo y abre flujo de QR. Si el usuario clickea la card equivocada, las credenciales se guardan en el provider incorrecto y el sender falla con "Authentication Error".

2. **Verifica que la integración guardada tenga el provider correcto antes de debuggear** — un usuario "conectó WhatsApp" pero en realidad la integración guardada era `whatsapp-lite` con credenciales del Embedded Signup viejo. El sender de `whatsapp` (Cloud API) caía al fallback de env vars vacías.

3. **Cuando borres una integración, actualiza `conversations.integration_id` de las conversaciones existentes** — el FK tiene `ON DELETE SET NULL`, así que las convos quedan con `integration_id=NULL` y futuro envío falla. Si reconectaste con un id nuevo, hay que `UPDATE conversations SET integration_id=<nuevo> WHERE provider=<provider>`.

4. **Test el access token directamente con curl antes de asumir que el problema es el token** — usa `GET /debug_token` y `POST /{phone_id}/messages`. Si funciona via curl pero falla via CRM, el problema es lo guardado en DB, no Meta.

5. **Para parallel mode con Kommo (Meta Cloud API)**: cada Meta App tiene su propio webhook URL. Suscribir 2+ apps al mismo WABA hace que Meta dispare webhooks a TODAS. Reelance + Kommo coexisten sin tocarse mutuamente.

6. **Suscribir una app al WABA requiere POST a la API** — la UI de Meta no expone esto. Llamada: `POST /v{ver}/{waba_id}/subscribed_apps` con Bearer token del system user. Verificar con `GET /subscribed_apps` (lista las apps registradas).

### ❌ DON'T

1. **NO uses `event.stopPropagation()` inline en botones dentro de listeners delegados** — rompe los handlers. En el bot list había `<button onclick="event.stopPropagation()">` que mataba el click delegado del delete handler. La solución correcta es chequear `e.target.closest('.delete-btn')` en el row click handler.

2. **NO compartas tokens de acceso (Access Tokens) en plain text por chat** — quedan en historial. Si pasó, **revoca y regenera** en `business.facebook.com/settings/system-users → Wuichy → Revocar tokens`.

3. **NO uses tokens de "60 días"** del sistema user — caducan. Siempre **"Nunca"**.

4. **NO confundas `App Secret` con `Access Token`**:
   - App Secret: 32 chars, empieza con `dd2299...` en este proyecto. Para verificar firmas HMAC de webhooks. Vive en `.env` o como field cifrado.
   - Access Token: 200+ chars, empieza con `EAA...`. Para llamadas a la API. Vive cifrado en `integrations.credentials_enc`.

5. **NO uses números de prueba de Meta** (los que provee gratis 90 días, ej: `+1 555 636 1659`) para testing real — los mensajes solo llegan a 5 numbers verificados. Usa el número real ya registrado al WABA.

6. **NO crees un nuevo system user si ya tienes uno** — Meta limita a 1 admin del sistema en negocios sin verificar. Reusa el existente y asígnale los assets necesarios (Apps + WABAs).

7. **NO asignes el system user al WABA equivocado** — Meta Business Manager puede tener múltiples WABAs con nombres similares. Verifica con el WABA ID que devuelve Meta API Setup.

8. **NO cambies el webhook URL de la app que Kommo usa** — eso rompe Kommo. Cada CRM debe usar su propia Meta App con su propia URL. Parallel mode = apps distintas, no URL distinta en la misma app.

9. **NO permitas múltiples conexiones de WhatsApp Lite (QR) al mismo número simultáneamente** — WhatsApp limita a 4 dispositivos vinculados. Adicionar uno expulsa al más viejo (cliente Kommo, iPad, etc.).

10. **NO ignores el warning de "app unpublished"** — webhooks de mensajes de **gente NO admin/dev/tester** no llegan en development mode. Para producción real, publica la app (App Mode → Live).

11. **NO escribas DB queries externos cuando el server está corriendo** — better-sqlite3 puede dar `SQLITE_NOTADB` por conflicto de WAL/locking. Apaga el LaunchAgent, query, prende.

---

## 5. IDs y URLs importantes (no son secretos, los enseña Meta libremente)

### Meta / WhatsApp
- **App ID**: `1699229564757836` (app: "Reelance WA api")
- **App Secret**: empieza con `dd2299` (vive en `.env` y/o `integrations.credentials_enc`)
- **WABA ID**: `829166119736948` (cuenta "Reelance" en Meta Business)
- **Phone Number ID**: `912165015315274`
- **Display number**: `+52 1 33 1476 7374` (verified_name: "Reelance", quality: GREEN, code_verification: EXPIRED — no bloquea)
- **System User**: `Wuichy` (ID `100070642266039`, rol Admin)
- **Webhook URL**: `https://lucho101.com/webhooks/whatsapp`
- **Webhook Verify Token**: `reelance-wh-verify-2025` (también está en `META_WEBHOOK_VERIFY_TOKEN` del .env como fallback global)
- **Apps suscritas al WABA**: `Reelance WA api` (1699229564757836) + `Kommo` (1022173854571346) — parallel mode confirmado
- **Webhook fields suscritos**: `messages`, `message_template_status_update`, `account_alerts`

### Reelance Business (Meta)
- **Business Manager**: cuenta `Reelance Portfolio comercial`
- **Verificación de negocio**: ✓ verde (verificado)
- **App Mode**: Development (NO Live aún) — pendiente publicar para mensajes de números no-tester

### Kommo (proyecto viejo, sigue activo en paralelo)
- **Subdomain**: `ventasreelancemx`
- **Account ID**: `30065876`
- **Salesbot principal usado**: ID `48800`
- **OAuth tokens**: en `/Users/luismelchor/Desktop/ReelanceHub/data/app-state.json` — siguen válidos
- **API NO expone definiciones de salesbots** — solo se pueden ejecutar por ID (`POST /salesbots/run`), no leer su lógica

### Cloudflare
- **Tunnel ID**: `0621db0b-b39c-4049-8228-0c231ffacbfe`
- **Config**: `~/.cloudflared/config.yml` (ingress lucho101.com → :3001)
- **Backup config previo**: `~/.cloudflared/config.yml.bak` (ingress :3000 — del Hub viejo)

### LaunchAgents
- `~/Library/LaunchAgents/com.reelance.app.plist` — Node server :3001
- `~/Library/LaunchAgents/com.reelance.tunnel.plist` — cloudflared
- `~/Library/LaunchAgents/com.reelance.backup.plist` — backup horario de la DB
- `~/Library/LaunchAgents/com.reelance.server.plist` — **viejo Hub Kommo, descargado, NO recargar**

### Lanzadores Desktop (alias .command)
- `~/Desktop/🟢 Prender Reelance Hub.command` → `Control/1-Prender.command` → carga LaunchAgents
- `~/Desktop/🔍 Revisar Reelance Hub.command` → `Control/2-Revisar.command` → status check
- `~/Desktop/🔴 Apagar Reelance Hub.command` → `Control/3-Apagar.command` → unload
- Los nombres dicen "Hub" pero apuntan al CRM nuevo. Renombrar es safe.

---

## 6. Pipelines + etapas migrados desde Kommo

13 pipelines + 130 etapas migrados via [scripts/migrate-kommo-pipelines.js](../scripts/migrate-kommo-pipelines.js):

| # | Pipeline | Etapas |
|---|---|---|
| 3 | WHATSAPP | 14 |
| 4 | CLIENTES | 10 |
| 5 | DISTRIBUIDOR | 9 |
| 6-13 | 1 MES, 2 MESES, 3 MESES, ..., 8 MESES | 9-12 cada uno |
| 14 | Instagram, Facebook y Tiktok | 6 |
| 15 | PRUEBA BORRAR | 6 |

Mapeo:
- `kommoStatus.id === 142` → `stages.kind = 'won'`
- `kommoStatus.id === 143` → `stages.kind = 'lost'`
- resto → `kind = 'in_progress'`
- Color hex se preserva del status original

Pipelines pre-migración (no borrar, tienen 13 expedientes asociados):
- `Ventas` (id 1, default seed)
- `Prueba` (id 2, test)

**El script es idempotente NO** — correrlo otra vez DUPLICA pipelines. Si necesitas re-sincronizar, primero borra los nuevos.

---

## 7. Sistema de notificaciones (push)

### Backend
- VAPID keys en `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) — copiadas del Hub viejo, suscripciones existentes en iPhone/Mac siguen válidas
- Tabla `push_subscriptions` (UNIQUE por endpoint, FK a advisors)
- Tabla `alert_log` (bitácora de pushes enviados)
- Endpoints: `GET /api/push/vapid-public-key` (público), `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test`, `GET /api/push/log`
- Cooldown anti-spam por (kind, key) — ej: WhatsApp disconnect tiene cooldown 10 min
- Auto-cleanup: si `webpush.sendNotification` devuelve 410/404, la suscripción se borra

### Eventos que disparan push
1. **Mensaje entrante** (cualquier canal: whatsapp, whatsapp-lite, messenger, instagram, telegram) — tag `chat-${convoId}` (colapsa)
2. **WhatsApp Lite desconectado** (logout o error prolongado) — cooldown 5-10 min
3. **WhatsApp Lite reconectado** desde estado de error — cooldown 60s
4. **Test manual** desde Ajustes → Notificaciones

### Frontend
- Service Worker en `/sw.js` — handle `push` events + `notificationclick`
- Pane "Notificaciones" en Ajustes — botón Activar / Desactivar / Probar / Log
- Banner global de conexión (`#connBanner`) — naranja "inestable" tras 1 fallo, rojo "offline" tras 3 fallos seguidos del wrapper `api()`

### `/healthz` smart
Devuelve 503 si:
- DB no responde
- Una integración whatsapp-lite marcada `connected` en DB pero el manager Baileys reporta `disconnected` o `error`

UptimeRobot pingea cada 5 min y alerta si responde 503.

---

## 8. Flujos críticos (runbooks)

### Conectar WhatsApp Business API (Cloud API)
Ver `app/docs/MANUAL_MAESTRO.md` §5 + el chat history del 2026-05-01. Pasos resumidos:
1. Meta Developer → app → System User Wuichy → "Generar token" (caducidad: Nunca, scopes: `whatsapp_business_messaging` + `whatsapp_business_management`)
2. Meta Developer → app → WhatsApp → Configuration → URL: `https://lucho101.com/webhooks/whatsapp`, Verify Token: `reelance-wh-verify-2025`, suscribir `messages` + `message_template_status_update`
3. `POST /v22.0/{waba_id}/subscribed_apps` con el access token → confirma `{"success": true}`
4. En Reelance CRM → Integraciones → "WhatsApp Business API" (NO "Lite QR") → llenar 4 campos → Conectar

### Conectar WhatsApp Lite (QR scan)
1. Reelance CRM → Integraciones → "WhatsApp Lite (QR)" → Conectar
2. Click "Generar QR"
3. En tu celular: WhatsApp → Configuración → Dispositivos vinculados → Vincular un dispositivo → escanea
4. El modal detecta connect → cierra → abre routing modal

### Reiniciar el server (sin tumbar el túnel)
```bash
launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist
sleep 2
launchctl load ~/Library/LaunchAgents/com.reelance.app.plist
sleep 4
curl https://lucho101.com/healthz
```

### Backup de la DB
Ahora mismo manual:
```bash
sqlite3 /Users/luismelchor/Desktop/ReelanceHub/app/data/reelance.sqlite ".backup /Users/luismelchor/Desktop/backups/reelance-$(date +%Y%m%d-%H%M).sqlite"
```
**Pendiente**: cron horario automático con retención (24 horarios + 30 diarios) — ver lección #19 de [LECCIONES_APRENDIDAS.md](LECCIONES_APRENDIDAS.md).

### Ver logs en vivo
```bash
tail -f /Users/luismelchor/Desktop/ReelanceHub/app/logs/server.log
```

### Inspeccionar webhooks recientes
```
https://lucho101.com/webhooks/_debug
```
Devuelve los últimos 50 eventos recibidos con provider + external_id + timestamps.

### Diagnosticar token de Meta
```bash
TOKEN='EAAY...'
curl "https://graph.facebook.com/debug_token?input_token=${TOKEN}&access_token=${TOKEN}"
```

### Migrar nuevos pipelines de Kommo
```bash
cd /Users/luismelchor/Desktop/ReelanceHub/app
node scripts/migrate-kommo-pipelines.js          # dry-run
node scripts/migrate-kommo-pipelines.js --apply  # ejecutar
```
**Cuidado**: NO es idempotente — duplicará pipelines si ya migraste.

---

## 9. Estado de migración Kommo → Reelance CRM

| Componente | Estado |
|---|---|
| **Pipelines + etapas** | ✅ Migrados (13 pipelines, 130 etapas) |
| **Contactos / leads** | ❌ NO migrados (decisión del usuario) |
| **Asesores / usuarios** | ❌ NO migrados |
| **Salesbots** | ❌ NO migrables (Kommo API no expone definiciones) — opciones: reconstruir manualmente, screenshots, o templates |
| **WhatsApp Cloud API** | ✅ Conectado en Reelance + sigue activo en Kommo (parallel mode) |
| **Custom fields** | ❌ NO migrados (pendiente — `custom_field_defs` table existe en Reelance) |
| **Conversaciones históricas** | Parcial — 12 convos de tests + envíos previos. No se importaron desde Kommo (Kommo no expone API de mensajes). |

### Para terminar la migración (cuando quieras)
1. **Salesbots**: pedirle al usuario screenshots del editor visual de Kommo y reconstruir cada bot manualmente en Reelance (tabla `salsbots`).
2. **Custom fields**: leer `/api/v4/leads/custom_fields` de Kommo y poblar `custom_field_defs` en Reelance.
3. **Apagar Kommo**: solo cuando confirmes 1-2 semanas de operación estable. Pasos:
   - Desactivar webhooks de Kommo en Meta (App Dashboard de la app de Kommo, NO de Reelance)
   - Desconectar WhatsApp en Kommo
   - Cancelar plan de Kommo (si aplica)

---

## 10. Variables de entorno importantes (en `app/.env`)

NO escribas valores aquí. Solo referencia.

```env
# Server
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
APP_BASE_URL=https://lucho101.com

# Auth
ADMIN_PASSWORD=...
SESSION_SECRET=...

# DB
DB_PATH=./data/reelance.sqlite
UPLOADS_DIR=./data/uploads

# Cifrado de credenciales en DB (32 bytes hex)
ENCRYPTION_KEY=...                    # CRÍTICO: si se pierde, todas las creds cifradas se vuelven inservibles

# Meta (WhatsApp / Messenger / Instagram)
META_APP_ID=1699229564757836
META_APP_SECRET=dd2299...             # 32 chars, empieza con dd2299
META_GRAPH_VERSION=v22.0
META_WEBHOOK_VERIFY_TOKEN=reelance-wh-verify-2025

# WhatsApp Cloud — fallback global (las integraciones tienen su propia)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=

# IA (multi-provider — abstraído)
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-7

# Web Push (VAPID)
VAPID_PUBLIC_KEY=BIx0x2FwYoxQk07grjg...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:soporte@lucho101.com
```

`.env` está en `.gitignore`. NO commitear.

Si pierdes `ENCRYPTION_KEY`, todas las `integrations.credentials_enc` quedan inservibles → el usuario tendría que reconectar todas las integraciones. Backup de `.env` por separado es CRÍTICO.

---

## 11. Gotchas operativos

### 11.0 ⚠️ CRÍTICO: la DB live VIVE FUERA de iCloud

```
DB live:    /Users/luismelchor/.reelance/data/reelance.sqlite
            └── wa-sessions/                    (auth state Baileys)
            └── uploads/                        (adjuntos)

Backups:    /Users/luismelchor/Desktop/ReelanceHub-Backups/
            ├── hourly/  (24 últimos backups, retenidos 24h)
            └── daily/   (30 últimos, retenidos 30 días)
```

**Por qué**: el directorio `~/Desktop/ReelanceHub/` está sincronizado con iCloud Drive. iCloud Drive sincroniza CADA archivo del Desktop por defecto en macOS. SQLite escribe constantemente a la DB principal y al WAL — iCloud detecta esos cambios como conflictos cuando dos versiones coexisten (local vs nube), crea archivos `nombre 2.sqlite-wal`, y a veces **revierte** la DB principal a un estado anterior. Esto pasó una vez y se perdieron los 13 pipelines migrados de Kommo (recuperados con re-migración).

**La solución implementada (mayo 2026)**:
1. **DB live** vive en `~/.reelance/data/` — fuera del Desktop, **iCloud no la sincroniza**.
2. **Backups automáticos** vía LaunchAgent `com.reelance.backup` cada hora — guarda snapshot consistente (`sqlite3 .backup`, no copia raw) en `~/Desktop/ReelanceHub-Backups/`.
3. Los backups SÍ se sincronizan a iCloud (es archivo único, sin WAL → sync limpio). Si la Mac muere, los snapshots están en la nube y restoreables.
4. **Retención**: 24 horarios + 30 diarios = ~54 archivos máximo.

### Variables relevantes
```env
DB_PATH=/Users/luismelchor/.reelance/data/reelance.sqlite
UPLOADS_DIR=/Users/luismelchor/.reelance/data/uploads
# WA_SESSIONS_DIR opcional — por default es <dirname DB_PATH>/wa-sessions
```

### Restaurar desde backup
```bash
# Apagar app
launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist
sleep 2

# Reemplazar la DB con el backup deseado
cp /Users/luismelchor/Desktop/ReelanceHub-Backups/hourly/reelance-20260501-22.sqlite \
   /Users/luismelchor/.reelance/data/reelance.sqlite

# Borrar WAL/SHM stale (opcional, evita conflictos)
rm -f /Users/luismelchor/.reelance/data/reelance.sqlite-wal
rm -f /Users/luismelchor/.reelance/data/reelance.sqlite-shm

# Encender app
launchctl load ~/Library/LaunchAgents/com.reelance.app.plist
```

### Ejecutar backup manual ahora
```bash
bash /Users/luismelchor/.reelance/backup.sh
```

### Ver log de backups
```bash
tail -50 /Users/luismelchor/.reelance/backup.log
```

### El directorio app/data/ viejo
Después de la migración (mayo 2026), el directorio `app/data/` quedó como **respaldo extra** (no se borró). Los archivos ahí ya no se actualizan — la app lee y escribe en `~/.reelance/data/`. Eventualmente puede borrarse, pero por ahora dejarlo no estorba.

**NO restaurar la DB desde `app/data/reelance.sqlite`** — esa es la versión vieja, anterior al fix de iCloud.

### LaunchAgents instalados (3 totales)
- `com.reelance.app` — Node server :3001
- `com.reelance.tunnel` — cloudflared
- **`com.reelance.backup`** — backup horario (NUEVO)

### 11.1 Node binary x86_64 vs better-sqlite3 arm64
La Mac es Apple Silicon pero el Node binary del usuario está en `/Users/luismelchor/.local/node/bin/node` y es **x86_64**. Cuando `npm install` corre, baja el prebuilt arm64 de `better-sqlite3` y revienta al cargar (`incompatible architecture`).

**Fix**:
```bash
cd app && PATH=/Users/luismelchor/.local/node/bin:$PATH npm rebuild better-sqlite3 --build-from-source
```

Después de cada `npm install` que toque `better-sqlite3`, repite el rebuild.

### 11.2 Conexiones externas a la DB durante operación
Si abres una conexión externa a `data/reelance.sqlite` mientras el server está corriendo, puedes recibir `SQLITE_NOTADB` o `database is locked`. Para queries externas:
```bash
launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist
# tu query
launchctl load ~/Library/LaunchAgents/com.reelance.app.plist
```

O usa `Database(path, { readonly: true })` con cuidado (también puede fallar).

### 11.3 Sesiones zombie de WhatsApp Lite
Si un QR se queda sin escanear y el server reinicia, el row queda en `connecting` y al boot la sesión Baileys se reanima. Solo `bootstrap.init` cleanup limpia los huérfanos. Si ves logs `[wa-web N] QR disponible` repetitivos, mata el row:
```bash
sqlite3 data/reelance.sqlite "DELETE FROM integrations WHERE id = N"
rm -rf data/wa-sessions/N
```
Y reinicia el server.

### 11.4 Webhooks de Kommo siguen llegando al server viejo
El Reelance Hub viejo (server.js en root, NO en app/) sigue suscrito a webhooks de Kommo, pero su LaunchAgent está descargado. Los webhooks que Kommo dispare van a 404 — esto es esperado.

### 11.5 Después de borrar una integración, las conversaciones quedan con `integration_id=NULL`
FK `ON DELETE SET NULL`. Si reconectas con un nuevo id, hay que actualizar:
```sql
UPDATE conversations SET integration_id = <nuevo_id> WHERE provider = 'whatsapp' AND integration_id IS NULL;
```
Sin esto, sender.js cae al fallback de env vars y falla.

### 11.6 Si te equivocas y subscribes 2 apps al mismo WABA con la misma URL
Meta dispara el webhook a la URL una sola vez (porque es la misma). Si quieres parallel mode REAL, las dos apps deben tener URLs distintas (Kommo URL distinta de Reelance URL).

### 11.7 `code_verification_status: EXPIRED` en el número
No bloquea mensajería. Solo afecta cambios de `verified_name` o solicitud de badge azul. Ignorable a menos que quieras renovar.

---

## 12. Pendientes conocidos (TODO list)

### Alta prioridad
- [ ] **Publicar Meta App a Live mode** — para recibir mensajes de números no-tester. Requiere Privacy Policy URL + App Icon + posibles App Reviews.
- [ ] **Asignar pipeline default a la integración whatsapp** — actualmente "Sin pipeline asignado". Click en "Pipeline" en la card → elegir.
- [ ] **Agregar campo `appSecret` al provider whatsapp** — actualmente las firmas HMAC de webhooks NO se verifican (`sin appSecret configurado, no se verificó firma` en logs). El secret está en `.env` como `META_APP_SECRET` pero el código de webhooks lee el secret de la integración primero. Solución: agregar field al provider o leer de env como fallback.

### Media prioridad
- [x] ~~**Backup automático de DB** (cron horario, retención 24+30)~~ — **HECHO mayo 2026**, ver §11.0
- [ ] **Migrar custom fields de Kommo** — leer `/api/v4/leads/custom_fields` y poblar `custom_field_defs`
- [ ] **Reconstruir salesbots** desde screenshots de Kommo (manualmente)
- [ ] **SSE en vez de polling** para chats — lección #2 de LECCIONES_APRENDIDAS.md

### Baja prioridad
- [ ] **Renombrar lanzadores Desktop** — dicen "Reelance Hub" pero ahora son del CRM
- [ ] **Borrar código del Hub viejo** (`server.js` en root, lib/, kommo-widget/) cuando se confirme estabilidad
- [ ] **Limpiar warning de `npm audit`** — 2 critical vulnerabilities en deps transitivas de Baileys (no bloqueante)
- [ ] **Renovar `code_verification_status`** del número (cosmético)

---

## 13. Convenciones de código

- **Modular**: cada módulo expone `routes.js` (router Express) + `service.js` (lógica). Si toca DB, también `schema.sql` (en migrations).
- **Aislado**: si un módulo falla al cargar, los demás siguen — patrón `mountSafe()` en server.js.
- **Sin deps pesadas**: Express + better-sqlite3 + web-push + Baileys + qrcode + pino. NO ORM.
- **Vanilla JS frontend**: sin framework. Polling conservador (chats 5s, bots 1.5s).
- **Configuración por `.env`**: mismo código sirve en Mac local y VPS — solo cambia `.env`.
- **Idempotencia por `external_id`**: mensajes y webhook_events deduplican por `(provider, external_id)`.
- **Cifrado at-rest**: todas las credenciales en `integrations.credentials_enc` con AES-256-GCM. Helpers en [security/crypto.js](../src/security/crypto.js).

---

## 14. Convenciones de chat con humanos / IA

Cuando el usuario pide "hacer X":

1. **NO asumas estado** — verifica con queries DB / curl / logs antes de prometer
2. **Usa TodoWrite** para trackear progreso en tareas multi-paso
3. **NO compartas tokens en plain text** — pide al usuario que los pegue en el form de la UI, no en el chat
4. **Verifica la integración correcta** después de cualquier "ya conecté" — los providers se confunden fácil
5. **Para flujos largos** (Meta setup, etc.) divídelo en pasos numerados con stops claros — el usuario manda screenshots entre pasos
6. **Antes de borrar algo en DB**, confirma con el usuario que entiende las consecuencias (FKs, conversaciones huérfanas)
7. **Cuando algo no funciona**, primero diagnostica con curl directo — descarta Meta antes de buscar bugs en el código
8. **Cuidado con paralelismo Kommo + Reelance** — son DOS apps Meta distintas, NO la misma con dos URLs. Si compartieran app, sus webhooks colisionan.

---

## 15. Persona del proyecto (Luis Melchor)

- **Negocio**: Reelance — aparenta ser e-commerce de productos para alopecia / cejas, México
- **Tech**: Mac de escritorio en GDL, Apple Silicon, Node x86_64 instalado en `~/.local/node`
- **Velocidad**: prefiere autonomía — cuando aprueba un plan, ejecuta sin pedir confirmación entre pasos (ver `feedback_autonomous_blocks.md` en memoria persistente)
- **Comunicación**: español mexicano informal, sin acentos a veces, suele preferir respuestas directas
- **Riesgo aceptado**: ya pegó un access token completo en chat consciente del riesgo. La regla "regenera y úsalo solo en form" la conoce — si pasa, recordársela pero respetar su decisión

---

> **Si eres una IA leyendo esto por primera vez**: lee §1 a §5 antes de tocar nada. Si vas a modificar el flujo de WhatsApp, lee también §3 y §11. Si vas a debuggear un problema reportado por el usuario, lee §4 (DO/DON'T). Si vas a borrar datos, lee §11.5.
>
> Si encuentras información desactualizada o conoces algo nuevo, **actualiza este manual** — es el contrato vivo del proyecto.
