# Lecciones aprendidas de Reelance Hub (Kommo)

> Problemas reales que sufrimos en `Reelance Hub + Kommo` (proyecto padre arriba en este repo) y que **no debemos repetir** en esta nueva app.
> Cada uno con la causa y la regla preventiva.

Última actualización: 2026-04-30 — basado en `MANUAL_MAESTRO.md` y `HANDOFF.md` del proyecto padre.

---

## 1. Storage en JSON local

**Problema (Reelance Hub)**: todo el estado vivía en `data/app-state.json`. Concurrencia mala (write races), queries lentas (`Object.values().filter()` en cada request), backups manuales, sin transacciones.

**Regla**: SQLite desde el día 1. Una sola dependencia (`better-sqlite3`), sincrónico, transaccional, sin servidor. Migraciones versionadas en `src/db/migrations/`.

---

## 2. Polling cada 4 segundos

**Problema**: el frontend hacía `GET /api/chats` cada 4s. Con 50 chats abiertos y varios agentes → varias req/s constantes solo para "ver si hay nuevo mensaje". UX laggy (4s de delay para ver mensaje nuevo).

**Regla**: Server-Sent Events (SSE) o WebSocket para empuje de eventos. SSE es más simple para empezar (HTTP estándar, reconexión automática, sin librerías cliente). Push real cuando llegue webhook, no polling.

---

## 3. Doble envío de mensajes (bug del salesbot)

**Problema**: cliente recibía cada mensaje del agente **dos veces** en WhatsApp. Causa: el `widget_request` interno generaba un `send_external_message` Y había un bloque `send_message` adicional en el bot. Tomó horas diagnosticar.

**Regla**:
- **Un único punto de salida por mensaje**. Que un solo módulo `messages/dispatcher.js` sea responsable de la entrega final.
- **Idempotencia por `external_id`** del proveedor. Si llega el webhook de confirmación con un ID que ya guardamos como local → reemplazar, no duplicar.
- **Logging del flujo end-to-end** desde request hasta delivery confirmation, para debuggear sin hipótesis.

---

## 4. Mensajes salientes desde UI externa no capturables

**Problema**: cuando un agente respondía desde la UI de Kommo (no desde Reelance Hub), Kommo no exponía hook ni API para registrar ese mensaje. Resultado: historial incompleto en la app. Política operativa: "todos responden solo desde Reelance Hub".

**Regla**: en esta app **somos los dueños del canal**. Conectamos directo a WhatsApp Cloud / Messenger / IG / TikTok, no pasamos por un CRM intermedio. No habrá UI alterna donde se pueda enviar sin que nos enteremos.

---

## 5. Refresh token race conditions

**Problema (referencia Kommo)**: el refresh_token se invalida al usarlo. Si dos workers refrescan a la vez, uno gana y el otro queda con `400 invalid_grant` → integración KO.

**Regla**:
- Lock distribuido (en mismo proceso: mutex en memoria; multi-proceso: tabla `locks` en SQLite con `INSERT OR FAIL`).
- Persistir el nuevo refresh **antes** de devolverlo a quien lo pidió, en transacción.
- Refresh proactivo (job cada N tiempo, no on-demand cuando ya expiró).

---

## 6. Adjuntos: workaround feo con OG tags

**Problema**: Kommo no expone Drive API a OAuth → no podemos subir media. Workaround: rutas `/preview/<file>` con meta tags `og:image` para que WhatsApp fetchee y muestre miniatura. Caption + URL en mensaje.

**Regla**: en esta app, los adjuntos son **first-class** desde día 1.
- WhatsApp Cloud: `POST /{phone}/media` → `media_id` → enviar como `image`/`document`/`video`.
- Messenger / IG / TikTok: equivalentes con sus endpoints.
- Almacenamiento local (`data/uploads/`) y referencia por `external_media_id` del proveedor.
- Modelo en DB: `messages.media_url`, `messages.media_external_id`, `messages.media_mime`.

---

## 7. Tokens en plain text

**Problema**: tokens de Kommo en `data/app-state.json` sin cifrar. Si alguien lee el archivo (o se respalda inadvertidamente), expone credenciales.

**Regla**:
- Cifrar tokens at-rest con AES-256-GCM (clave en `ENCRYPTION_KEY`, 32 bytes hex).
- Funciones helper `encrypt(plaintext)` / `decrypt(ciphertext)` en `src/security/crypto.js`.
- Nunca loggear tokens en `console.log` ni en debug endpoints (mostrar solo prefijo o hash).

---

## 8. `field_id` no portable entre cuentas

**Problema**: Kommo asigna IDs numéricos diferentes a custom fields por cuenta. Mapear "Order ID" → `field_id: 12345` solo funciona en una cuenta.

**Regla**: identificadores semánticos. Custom fields propios tienen `code` (string slug). Si vamos a pasar a multi-tenant, mapping por código, no por id numérico.

---

## 9. Versioning de API de proveedores

**Problema (referencia Meta)**: Graph API libera nueva versión cada 3 meses (v22, v23, v24...). Cada versión tiene 2 años de soporte. Usar "latest" implícito → te rompen sin avisar.

**Regla**:
- Pinear versión en `META_GRAPH_VERSION=v22.0` (env var).
- Upgrade trimestral con smoke tests.
- Suscribirse al [Graph API Changelog](https://developers.facebook.com/docs/graph-api/changelog).

---

## 10. Idempotencia de webhooks

**Problema**: Meta retiene reintentos hasta 7 días. Sin dedup, el mismo evento se procesa varias veces (mensaje duplicado en DB, doble notificación, etc).

**Regla**: tabla `webhook_events(provider, external_id, signature_hash UNIQUE)`. Antes de procesar, `INSERT OR IGNORE`. Si ya existe → 200 sin hacer nada.

---

## 11. Bucle infinito (PATCH → webhook → PATCH)

**Problema**: cuando actualizamos un lead en Kommo via API, Kommo dispara `update_lead` webhook hacia nosotros. Si lo procesamos y volvemos a actualizar → loop.

**Regla**: cada acción que originamos lleva un flag `origin: 'self'`. Webhooks que llegan con ese marcador (vía custom field temporal o cache de IDs salientes recientes) → ignorar.

---

## 12. Verificación de webhook signature sobre raw body

**Problema (referencia Meta)**: la firma `X-Hub-Signature-256` se valida sobre el body **crudo**. Si Express ya parseó JSON, la firma falla.

**Regla**: en rutas de webhook, `express.raw({ type: 'application/json' })` **antes** de `bodyParser.json()`. Verificar HMAC, luego parsear.

---

## 13. SLA de 2 segundos en respuesta de webhook

**Problema (referencia Kommo y Meta)**: si tardas más de 2s en responder 200, tras N fallos te deshabilitan el webhook.

**Regla**: webhook handler responde 200 inmediato → encola tarea (cola in-process por ahora; Redis/BullMQ cuando crezca) → worker procesa async.

---

## 14. Stages reservados / IDs hardcodeados

**Problema (referencia Kommo)**: stages 142 (Won) y 143 (Lost) son reservados por Kommo, existen en TODO pipeline, no se pueden borrar.

**Regla**: en esta app diseñamos pipelines flexibles. Cada pipeline define sus etapas sin reservados. Las etapas tipo "won/lost" son una bandera (`is_terminal`, `kind: 'won'|'lost'|'in_progress'`), no IDs hardcodeados.

---

## 15. Plantillas de WhatsApp con variables mal formateadas

**Problema (común en la comunidad)**: `{1}` en lugar de `{{1}}`, variables no secuenciales (`{{1}}, {{2}}, {{4}}`), categoría mal elegida → rechazo + alza de costos.

**Regla**:
- Validador local de plantillas antes de mandar a aprobación: parser que verifique formato, secuencia, longitud (body < 1024, header < 60).
- UI clara: marketing vs utility vs authentication, con explicación de costo.
- Bloquear URL shorteners (`bit.ly`, `wa.me/...`) en templates.

---

## 16. Customer Service Window de 24h

**Problema/regla**: WhatsApp solo permite mensajes free-form dentro de 24h tras el último mensaje del cliente. Fuera, solo plantillas aprobadas.

**Regla**:
- Cada conversación lleva `window_expires_at`.
- UI: si la ventana expiró, deshabilitar input de texto libre y forzar selección de plantilla aprobada.
- Cron job que actualice `window_expires_at` al recibir mensaje entrante.

---

## 17. UX: scroll del chat estilo WhatsApp

**Problema (Reelance Hub late-abril 2026)**: inicialmente los mensajes se mostraban con el más reciente arriba (estilo feed). Hubo que rediseñar a viejo→arriba, nuevo→abajo (estilo WhatsApp/iMessage).

**Regla**: chat siempre con scroll a abajo, autoscroll en mensaje nuevo solo si el usuario ya estaba en el bottom. Si el usuario hizo scroll arriba para leer histórico, no romper su posición.

---

## 18. Dependencia de un solo proveedor (Kommo) sin fallback

**Problema**: si Kommo se cae o cambia API, Reelance Hub queda inservible. Estamos atados a sus tiempos de soporte (Drive API issue lleva semanas pendiente).

**Regla**: cada canal es un módulo independiente. Si WhatsApp Cloud cambia algo, no afecta Messenger ni IG. Cada uno con su `provider.js` que abstrae la API.

---

## 19. No automatizar backups

**Problema**: el JSON state vivía sin backup. Un `rm` accidental → fin.

**Regla**:
- SQLite `.backup` automático cada hora a `data/backups/YYYYMMDD-HH.sqlite`.
- Retención: 24 horarios + 30 diarios.
- Fácil restore: copiar archivo y reiniciar.

---

## 20. Tunnel local (cloudflared) con un solo dominio

**Problema**: si cloudflared se cae, todo offline. La app vive en una Mac de escritorio + cloudflared expone via dominio `lucho101.com`.

**Regla**:
- Mantener cloudflared como hoy en local.
- En VPS no se necesita tunnel (tiene IP pública).
- Configuración (`APP_BASE_URL`, etc.) por env var → mismo código sirve en ambos.
- Watchdog (UptimeRobot externo) ya implementado en proyecto padre — replicarlo aquí.

---

## 21. IA: nunca acoplar a un solo proveedor

**Problema potencial**: si codeamos directo contra `Anthropic SDK` y mañana queremos:
- Bajar costos pasando a Gemini Flash o GPT-4o-mini
- Privacidad total con Ollama local (Gemma/Llama corriendo en la misma Mac, sin internet)
- Probar Groq/Together por velocidad
- Fallback automático cuando un proveedor cae

…tendríamos que reescribir la integración. Es la versión "IA" del problema 18 (un solo proveedor sin fallback).

**Regla**: módulo `src/ai/` con interfaz unificada `AIProvider`:

```js
// src/ai/types.js
class AIProvider {
  async chat({ system, messages, maxTokens, temperature }) { /* devuelve { text, usage } */ }
  async stream({ system, messages, onToken }) { /* SSE/streaming */ }
}
```

Implementaciones:
- `src/ai/providers/anthropic.js` — Claude
- `src/ai/providers/openai.js` — GPT (también sirve para Groq, Together, vLLM via baseUrl)
- `src/ai/providers/google.js` — Gemini
- `src/ai/providers/ollama.js` — local (Gemma, Llama, Qwen)
- `src/ai/index.js` — factory que lee `AI_PROVIDER` y devuelve la implementación correcta

**La app habla solo con `src/ai/index.js`**. Cambiar de Claude → Ollama es:
1. `ollama pull gemma2:9b`
2. `AI_PROVIDER=ollama` en `.env`
3. Reiniciar

Cero cambios en el código que usa la IA. La UI de Ajustes → IA expone esto al usuario sin tocar `.env`.

**Bonus**: información de la empresa (system prompt) vive en DB, no en código. Tabla `ai_settings(provider, model, system_prompt, mode, temperature, max_tokens, updated_at)`. La pantalla Ajustes → IA es el editor.

---

# Lecciones de la migración a Cloud API + Lite QR (mayo 2026)

> Sprint donde migramos lucho101.com del Reelance Hub viejo al CRM nuevo, conectamos WhatsApp Business API (Cloud API) directo, e implementamos WhatsApp Lite (QR scan vía Baileys). Estas lecciones surgieron en una sola sesión de trabajo.

---

## 22. Confundir providers `whatsapp` vs `whatsapp-lite`

**Problema**: el CRM tiene 2 cards de WhatsApp en la pantalla de Integraciones — "WhatsApp Business API" (provider `whatsapp`, Cloud API oficial) y "WhatsApp Lite (QR)" (provider `whatsapp-lite`, Baileys/QR scan). El usuario clickeó la card equivocada y conectó las credenciales en el provider incorrecto. Cuando los webhooks entrantes llegaban, las conversaciones se creaban con `provider='whatsapp'` (porque vienen del endpoint `/webhooks/whatsapp`), pero el `sender.js` no encontraba `phoneNumberId` ni `accessToken` en la integración whatsapp-lite (sus credenciales son `appId`/`appSecret`/`systemUserToken`) — caía al fallback de env vars vacías y Meta respondía "Authentication Error". Tomó tiempo diagnosticar.

**Regla**:
- Antes de debuggear "Authentication Error" en envío de WhatsApp, **verifica con `SELECT * FROM integrations WHERE provider = 'whatsapp'`** que haya una integración del provider correcto.
- Si solo encuentras `whatsapp-lite` cuando esperas `whatsapp` → el usuario clickeó la card equivocada; bórralo y reconecta en la card correcta.
- En la UI del CRM, las cards deben **diferenciarse claramente** (icono, color, descripción): la de Cloud API tiene 4 fields, la de Lite QR tiene 0 (es flujo de QR).

---

## 23. `event.stopPropagation()` inline rompe handlers delegados

**Problema**: el botón de eliminar bot tenía `onclick="event.stopPropagation()"` inline para evitar que el click abriera el bot builder. Pero el handler de delete estaba **delegado** en `#botList` (event bubbling). El `stopPropagation` impedía que el click llegara a `#botList`, así que el delete handler nunca corría. El usuario clickeaba "borrar" y nada pasaba.

**Regla**:
- **NO uses `event.stopPropagation()` en hijos cuando tienes listeners delegados en el padre.**
- En el row click handler, usa `if (e.target.closest('.action-btn')) return;` antes de abrir el detalle. Así el click sobre el botón sigue burbujeando hasta el handler delegado del botón, pero el row no se abre.

---

## 24. Compartir Access Tokens por chat es mala práctica

**Problema**: durante setup el usuario pegó el system user access token completo en el chat con la IA. Aunque el chat es privado, queda en historial; cualquier persona con acceso al historial (otro dispositivo, leak, futuro acceso) puede usarlo. El token tiene scope `whatsapp_business_messaging` y `whatsapp_business_management` — alguien con eso puede mandar mensajes haciéndose pasar por el negocio.

**Regla**:
- Tokens (Access Token, App Secret, encryption keys) **se pegan SOLO en el form de la app que los va a usar**, nunca en chat.
- Si por accidente uno se filtra → revoca y regenera inmediatamente desde `business.facebook.com/settings/system-users → revocar tokens`.
- En diagnóstico, si la IA necesita validar un token, que el usuario corra el `curl` desde su Terminal y pegue solo el resultado JSON.

---

## 25. Meta limita 1 admin del sistema en negocios sin verificar

**Problema**: el usuario quiso crear un nuevo system user "Reelance API" — Meta respondió "Esta empresa alcanzó el número máximo del límite de usuarios administradores del sistema. El número máximo de usuarios administradores del sistema que puedes tener es 1."

**Regla**:
- Para Business Manager **sin verificar**, máximo 1 system user admin.
- En vez de crear nuevo, **reusa el existente** y asígnale los assets que necesita (Apps + WABAs).
- Si necesitas más system users, completa Business Verification (`business.facebook.com/settings/security` → Verificación del negocio) — eso sube el límite.

---

## 26. Asignar system user a las apps/WABAs es paso aparte (Meta no lo hace solo)

**Problema**: tener un system user con rol Admin **no le da acceso a las apps ni WABAs** automáticamente. Hay que asignarlos uno por uno desde el panel de cada asset (no desde el panel del usuario, en el nuevo Business Manager).

**Regla**: cuando reuses un system user existente, **verifica su pestaña "Activos asignados"**. Si no aparece tu app o tu WABA:
- Apps: ve a `Business Settings → Cuentas → Apps → tu app → Asignar personas → Usuarios del sistema → marcar Wuichy → toggle "Administrar app"`.
- WABA: igual pero en `Cuentas de WhatsApp → tu WABA → Asignar personas`.

Sin esto, generar token resulta en token con scope vacío — al usar truena en cualquier llamada con error de permisos.

---

## 27. Suscribir una app al WABA requiere POST a la API (no UI)

**Problema**: incluso con webhook URL configurado en la app y fields suscritos (`messages`, etc.), si la app **no está registrada en `subscribed_apps` del WABA**, Meta no le dispara webhooks. Esta acción no tiene UI en Meta Developer ni en Business Manager.

**Regla**: después de configurar la app, llama:
```bash
curl -X POST "https://graph.facebook.com/v22.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer {SYSTEM_USER_TOKEN}"
```
Espera `{"success": true}`. Verifica con:
```bash
curl "https://graph.facebook.com/v22.0/{WABA_ID}/subscribed_apps" -H "Authorization: Bearer {TOKEN}"
```
Debe listar tu app en `data[]`.

Si el flujo de Embedded Signup se usó antes para conectar la misma app, la suscripción al WABA ya existe — pero si la app se creó manualmente, falta este paso.

---

## 28. Parallel mode con otro CRM = Meta apps distintas, no URLs distintas en la misma app

**Problema potencial**: usuario quiere que Reelance CRM y Kommo reciban mensajes simultáneamente (parallel mode durante migración). Su instinto fue "cambio el webhook URL de la app de Reelance" — pero esa app ya tenía a Kommo enchufado. Cambiar URL rompería Kommo.

**Regla**:
- Cada CRM tiene su **propia Meta App** (con su propio App ID, secret, webhook URL).
- Múltiples apps pueden estar suscritas al mismo WABA → Meta dispara webhooks a TODAS al mismo tiempo.
- Verifica con `GET /v{ver}/{waba_id}/subscribed_apps` quiénes son los consumidores actuales antes de hacer cambios.
- En este proyecto tenemos: `Reelance WA api` (1699229564757836) + `Kommo` (1022173854571346) — ambos suscritos al WABA `829166119736948`. Coexisten sin tocarse.

---

## 29. Better-sqlite3 binary mismatch en Apple Silicon con Node x86_64

**Problema**: la Mac es Apple Silicon pero el Node binary del usuario es **x86_64** (instalado en `~/.local/node`). `npm install` baja el prebuilt **arm64** de `better-sqlite3` y al cargar truena con:
```
incompatible architecture (have 'arm64', need 'x86_64h' or 'x86_64')
```

**Regla**: después de cualquier `npm install` que toque `better-sqlite3` (o cualquier dep nativa), **rebuild from source**:
```bash
cd app && PATH=/Users/luismelchor/.local/node/bin:$PATH npm rebuild better-sqlite3 --build-from-source
```

Verifica con:
```bash
file node_modules/better-sqlite3/build/Release/better_sqlite3.node
# debe decir: Mach-O 64-bit bundle x86_64
```

---

## 30. Conexiones externas a SQLite con WAL activo dan `SQLITE_NOTADB`

**Problema**: si el server está corriendo (con WAL activo) y abrimos una conexión externa a `data/reelance.sqlite`, a veces revienta con `SqliteError: file is not a database` aunque el archivo es válido. Es un conflicto de checkpoint del WAL — el lector externo intenta leer el header durante un commit del server.

**Regla**: para queries externas (debugging, scripts ad-hoc):
1. **Detén el server primero**: `launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist`
2. Espera 2 segundos para que checkpoint el WAL
3. Corre tu query
4. Reinicia: `launchctl load ~/Library/LaunchAgents/com.reelance.app.plist`

`{ readonly: true }` reduce conflictos pero no los elimina. El método seguro es apagar el server.

---

## 31. Borrar integración deja conversaciones en limbo (FK SET NULL)

**Problema**: `conversations.integration_id` tiene `ON DELETE SET NULL`. Cuando borras la integración (DELETE FROM integrations), todas las conversaciones existentes con `integration_id` apuntando a ella quedan con `NULL`. El `sender.js` busca credenciales por `integration_id` → no encuentra → cae al fallback de env vars → falla.

**Regla**: cuando reemplazas una integración por otra (ej: borraste whatsapp-lite e hiciste connect a whatsapp con id nuevo), actualiza las convos existentes:
```sql
UPDATE conversations SET integration_id = <NUEVO_ID>
WHERE provider = '<PROVIDER>' AND integration_id IS NULL;
```

Idealmente, el código debería detectar `integration_id IS NULL` y buscar la integración activa por provider antes de fallar — TODO mejora.

---

## 32. Sesiones zombie de Baileys generan logs infinitos

**Problema**: si el flujo de QR de WhatsApp Lite se queda a medias (usuario cerró modal sin escanear, server crasheó durante QR, etc.), el row queda en `connecting` y al boot `bootstrap.init` reanima la sesión Baileys. Si nadie escanea, Baileys sigue rotando QRs cada 30s indefinidamente y los logs se inundan: `[wa-web N] QR disponible` cada 30s.

**Regla**:
- En `closeIntegrationModal` del frontend, si el usuario cierra sin completar el scan → `DELETE /api/integrations/:id` (cleanup completo: row + auth files + sesión).
- En `bootstrap.init` al boot, **borra rows huérfanos en estado `connecting`/`pending`** ANTES de restaurar las conectadas.
- `connectQr()` solo reusa rows en estado `connecting`/`pending` — NO en `disconnected`/`error` (esos son terminales, fresh start).

---

## 33. Webhooks en development mode solo llegan de admins/devs/testers

**Problema**: la Meta App está en **Development mode** (`App Mode: Development`). Meta muestra warning naranja: *"Apps will only be able to receive test webhooks while the app is unpublished. No production data, including from app admins, developers or testers, will be delivered unless the app has been published."*

En dev mode los webhooks de mensajes **solo llegan si el remitente está registrado como admin/developer/tester de la app**. Mensajes de clientes random (no testers) son filtrados silenciosamente — sin error, sin webhook. Para testing inicial funciona porque mandas desde tu propio número (que es admin de la app), pero en producción real **muchos mensajes nunca llegan**.

**Regla**: para producción real:
1. Pasa la app a **Live Mode** (`App Settings → Toggle App Mode`)
2. Requiere: Privacy Policy URL + App Icon + Business Verification + posibles App Reviews
3. Antes de declarar "funciona en producción", **pide a alguien externo (no admin/dev/tester) que te mande un mensaje** y verifica que llegó. Si no llega → falta publicar.

---

## 34. Cambiar webhook URL puede fallar silenciosamente con redirect

**Problema**: al hacer "Verificar y guardar" del webhook URL en Meta Developer, si la URL no responde correctamente (ngrok caído, server down), Meta puede redirigirte al "Inicio rápido" sin mostrar error claro. La URL queda con el valor viejo, no se guardó nada — pero el usuario cree que sí.

**Regla**: después de hacer "Verificar y guardar", **vuelve a la pestaña Configuración** y verifica que el campo URL muestre el nuevo valor. Si volvió al viejo → la verificación falló (probablemente la URL no respondió el `hub.challenge` correcto al GET de Meta).

---

## 35. Push notifications en iOS solo funcionan si la PWA está agregada al home screen

**Problema potencial**: el usuario quería notificaciones push de WhatsApp en su iPhone. iOS 16.4+ soporta Web Push, **pero solo si abres la app desde el ícono del home screen** (no desde Safari directamente). Es restricción de Apple.

**Regla**:
- **iOS**: Safari → Compartir → Agregar a pantalla de inicio → abrir desde el ícono → permitir notificaciones
- **Mac (Safari 16+)**: Archivo → Agregar al Dock → abrir desde Launchpad → permitir notif
- **Chrome/Edge** (cualquier OS): el botón de instalar PWA aparece en la barra de URL

Sin esto, `Notification.requestPermission()` puede dar `granted` pero los pushes nunca llegan.

---

## 36. Base de fallback en VAPID/secrets: tener mismas keys entre Hub viejo y CRM nuevo

**Problema potencial**: si generas VAPID keys nuevas en el CRM, las suscripciones existentes en iPhone/Mac (que tenían las keys del Hub viejo) **se invalidan** — el SW las trataría como inválidas. El usuario tendría que volver a suscribirse en cada dispositivo.

**Regla**: si tienes un CRM viejo siendo reemplazado y los devices están suscritos vía web push, **copia las VAPID keys del viejo al nuevo `.env`** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Las suscripciones se preservan, solo cambia el server que las usa para mandar push.

---

## 37. iCloud Drive corrompe SQLite — DB live debe vivir FUERA de iCloud

**Problema (vivido en producción mayo 2026)**: `~/Desktop/ReelanceHub/app/data/reelance.sqlite` estaba en una carpeta sincronizada por iCloud Drive (Desktop sync activado en macOS). SQLite escribe constantemente al WAL y a la DB principal. iCloud detectó conflictos entre el archivo local y la nube, creó archivos duplicados (`reelance 2.sqlite-wal` con 74KB de cambios huérfanos), y en algún momento **revirtió la DB principal** a un estado anterior. Resultado: los 13 pipelines + 130 etapas migrados desde Kommo desaparecieron sin pasar por la papelera. La trash table estaba vacía. Recuperación: re-correr el script de migración (Kommo seguía intacto).

Esto puede pasar a cualquier archivo escrito frecuentemente que viva en Desktop/Documents con iCloud sync. Síntomas:
- Archivos `nombre 2.ext` apareciendo (con espacio antes del 2)
- Cambios recientes "se pierden" sin explicación
- Logs sin error obvio

**Regla**:
- **DB SQLite live NUNCA en `~/Desktop/`, `~/Documents/`, ni cualquier dir que iCloud sincronice.**
- Ubicaciones seguras: `~/.miapp/` (oculto), `/usr/local/var/miapp/`, `~/Library/Application Support/miapp/`.
- En Reelance: DB vive en `~/.reelance/data/reelance.sqlite`. `wa-sessions/` y `uploads/` también ahí.
- **Backups automáticos horarios** sí pueden vivir en iCloud — un snapshot consistente (`sqlite3 .backup`) es un archivo único sin WAL, iCloud lo sincroniza limpio. Esto da protección en la nube sin riesgo.
- LaunchAgent `com.reelance.backup` corre `~/.reelance/backup.sh` cada hora. Retención: 24 horarios + 30 diarios.
- Path config en `app/.env`: `DB_PATH=/Users/luismelchor/.reelance/data/reelance.sqlite`.

**Cómo detectar si tu app está en riesgo**:
```bash
ls -la ~/Desktop/<tuapp>/ 2>/dev/null | grep " 2\." # archivos con "2" sufijo = iCloud conflictos
```

---

## Resumen ejecutivo

| Tema | Reelance Hub | Esta app |
|---|---|---|
| Storage | JSON file | SQLite |
| Real-time | Polling 4s | SSE / polling conservador |
| Mensajes salientes | Vía salesbot Kommo | Directo al provider |
| Adjuntos | OG tags hack | Media API nativa |
| Tokens | Plain text | Cifrados (AES-256-GCM) |
| API versioning | Implícito | Pinneado en env |
| Webhooks | Sin dedup | Idempotencia por `external_id` |
| Auth | 1 password | Users + roles (admin/asesor) |
| Backup | Manual | Auto cada hora (TODO) |
| Multi-canal | Solo WA via Kommo | WA Cloud API + WA Lite QR + Messenger + IG + Telegram + TikTok |
| IA | No tenía | Multi-provider abstraído (Claude / GPT / Gemini / Ollama local) |
| WhatsApp QR (lite) | No tenía | Baileys con session manager + auth persistido |
| Push notifications | Sí | Sí (mismas VAPID keys del Hub viejo, suscripciones preservadas) |
| Smart healthz | 503 si Kommo desconectado | 503 si integración whatsapp-lite reportada como disconnected/error |
| Pipelines | Kommo (13 pipelines) | Kommo migrado + Reelance (15 totales) |
