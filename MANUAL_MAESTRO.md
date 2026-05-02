# Manual Maestro — Reelance Hub
> Documento técnico completo para IA y desarrolladores. Contiene todo lo necesario para entender, configurar, mantener y extender el proyecto sin haber visto conversaciones previas.

**Última actualización:** 2026-04-30 (sesión late)
**Versión del widget principal:** 1.0.24 (`kommo-widget/`)
**Versión del widget logger:** 1.0.3 (`kommo-widget-logger/` — widget SEPARADO para Camino B)
**Salesbot activo:** 48782 (principal) · 48800 (Camino B / templates)
**Usuario:** Luis Melchor (negocio, no programador)
**Ruta del proyecto:** `/Users/luismelchor/Desktop/ReelanceHub`

---

## 1. ¿Qué es Reelance Hub?

Una **app web tipo inbox** (estilo iMessage / WhatsApp Web) que conecta a **Kommo CRM** para que un equipo de ventas pueda **leer y responder mensajes de WhatsApp** desde una interfaz propia, sin entrar a la UI de Kommo.

- **Frontend:** HTML/CSS/JS vanilla. Diseño macOS/iOS.
- **Backend:** Node.js + Express. Estado persistente en JSON local (`data/app-state.json`).
- **Canal:** WhatsApp Business API (WABA) — integración **nativa** de Kommo (no third-party).
- **Acceso:** Login por contraseña simple (`APP_PASSWORD`). Una sesión activa a la vez.

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTE (WhatsApp)                                                 │
│       ↑  ↓ mensajes                                                 │
├───────┼──┼──────────────────────────────────────────────────────────┤
│  KOMMO CRM (ventasreelancemx.kommo.com)                             │
│    ↓ webhook entrante     ↑ salesbot lanzado por API                │
├───────────────────────────┼──────────────────────────────────────────┤
│  REELANCE HUB SERVER (Node.js / lucho101.com)                       │
│    ├── POST /webhooks/kommo     ← mensajes entrantes de Kommo       │
│    ├── POST /api/chats/:id/messages  ← agente envía desde la app   │
│    └── POST /api/kommo/salesbot/handoff  ← el bot pide el texto    │
├─────────────────────────────────────────────────────────────────────┤
│  AGENTE (Reelance Hub UI en el navegador)                           │
│    → lee chats, escribe respuestas, ve historial                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Flujos de mensajes

### 3.1 Mensaje entrante (cliente → agente)

```
Cliente escribe en WhatsApp
  ↓
Kommo recibe por canal WABA (source_id: 23041515)
  ↓
Kommo dispara webhook → POST https://lucho101.com/webhooks/kommo
  ↓
server.js → registerWebhookMessage() normaliza y guarda en app-state.json
  ↓
Frontend hace polling cada 4s a GET /api/chats → muestra el mensaje
  ↓
Push notification al celular del agente (si tiene PWA instalada)
```

### 3.2 Mensaje saliente (agente → cliente)

```
Agente escribe en la app y presiona Enviar
  ↓
POST /api/chats/:chatId/messages
  ↓
Server guarda mensaje local (status: pending, deliveryStatus: "en cola")
  ↓
Server llama POST /api/v2/salesbot/run con { bot_id: 48782, entity_id, entity_type }
  ↓
Kommo ejecuta el Salesbot 48782
  ↓
Salesbot ejecuta el bloque del widget → POST /api/kommo/salesbot/handoff
  (el bot se pausa esperando respuesta de nuestro server)
  ↓
Server responde 200 { ok: true } inmediatamente
Server llama callReturnUrl con { data: { reply_text, has_reply } }
  ↓
Bot recibe los datos → evalúa condición: has_reply == "1"
  ↓
Bot ejecuta handler "show" con el reply_text
  ↓
Kommo entrega el mensaje por el canal WhatsApp activo del lead
  ↓
Cliente recibe el mensaje en WhatsApp ✅
```

---

## 4. Estructura de archivos

```
ReelanceHub/
├── server.js                  (Express — rutas API, webhooks, handoff, auth)
├── package.json               (express ^5, axios ^1, web-push, cookie-session)
├── .env                       (credenciales — NO commiteado)
├── .env.example               (plantilla vacía)
├── render.yaml                (config deploy Render con disk persistente)
├── HANDOFF.md                 (contexto rápido para cambio de sesión)
├── MANUAL_MAESTRO.md          (este archivo)
│
├── lib/
│   ├── config.js              (carga .env, exporta config estructurado)
│   ├── store.js               (CRUD del estado JSON, dedupe de mensajes)
│   ├── kommo.js               (OAuth, refresh token, apiRequest, launchSalesbot)
│   │                          (HTTPS agent propio con keep-alive controlado)
│   │                          (retry automático en errores de red ECONNRESET)
│   ├── auth.js                (sesiones con cookie-session)
│   └── push.js                (web push VAPID, suscripciones por dispositivo)
│
├── public/
│   ├── index.html             (shell de la UI — 197 líneas)
│   ├── app.js                 (lógica frontend — ~1621 líneas)
│   ├── styles.css             (estilo Mac/iOS — ~800 líneas)
│   ├── sw.js                  (service worker PWA)
│   └── manifest.json          (PWA installable)
│
├── kommo-widget/              (widget PRINCIPAL — handoff + log-outgoing)
│   ├── manifest.json          (v1.0.24, define handlers del salesbot)
│   ├── script.js              (lógica del widget — genera JSON para el salesbot)
│   ├── style.css
│   └── i18n/
│       ├── es.json
│       └── en.json
│
├── kommo-widget-logger/       (widget SEPARADO — solo Camino B / templates)
│   ├── manifest.json          (v1.0.3 — handler único `log_template_sent`)
│   ├── script.js              (lee value_manual con prioridad sobre placeholder)
│   ├── style.css
│   ├── widget.zip             (zip listo para subir a Kommo)
│   └── i18n/
│       ├── es.json
│       └── en.json
│
├── Control/                   (scripts .command para administrar la Mac)
│   ├── README.md              (qué hace cada script y cuándo usarlo)
│   ├── 0-Configurar-Mac-Servidor.command  (UNA vez: autorestart + nunca dormir)
│   ├── 1-Prender.command                  (arranca tunnel+server manual)
│   ├── 2-Revisar.command                  (diagnóstico, no toca nada)
│   └── 3-Apagar.command                   (shutdown limpio con confirmación)
│
├── data/
│   └── app-state.json         (estado persistente — NO commiteado)
│
└── logs/
    ├── server.log
    ├── server-error.log
    ├── cloudflared.log
    └── ngrok.log
```

---

## 5. Variables de entorno (.env)

```env
PORT=3000
APP_BASE_URL=https://lucho101.com          # URL pública del servidor

# Auth
APP_PASSWORD=***                           # Contraseña de acceso a la app
APP_SESSION_SECRET=***                     # Secret para cookies de sesión

# Kommo OAuth
KOMMO_SUBDOMAIN=ventasreelancemx
KOMMO_CLIENT_ID=***
KOMMO_CLIENT_SECRET=***
KOMMO_REDIRECT_URI=https://lucho101.com/auth/kommo/callback

# IDs de Kommo
KOMMO_SALESBOT_ID=48800                   # ID del salesbot activo
KOMMO_SOURCE_ID=23041515                  # Source ID del canal WABA
# amojo_id descubierto: edb9a8e1-51f3-414a-b8f0-c74c6c9b87e6 (vía /api/debug/probe-final)

# Web Push (VAPID)
VAPID_PUBLIC_KEY=***
VAPID_PRIVATE_KEY=***
VAPID_SUBJECT=mailto:soporte@lucho101.com
```

> **Importante:** Si se crea un nuevo salesbot, actualizar `KOMMO_SALESBOT_ID` y reiniciar el server.

---

## 6. Configuración de Kommo (paso a paso desde cero)

### 6.1 OAuth — Conectar la cuenta

1. Ir a `https://ventasreelancemx.kommo.com/settings/profile/apps/`
2. Crear integración privada con permisos: `crm`, `leads`, `contacts`, `chats`
3. Redirect URI: `https://lucho101.com/auth/kommo/callback`
4. Guardar `client_id` y `client_secret` en `.env`
5. En la app: ir a `/auth/kommo/url` → autorizar

**Docs:** https://developers.kommo.com/docs/oauth-20

### 6.2 Webhook entrante

1. Kommo → Configuración → Integraciones → Webhooks
2. URL: `https://lucho101.com/webhooks/kommo`
3. Marcar eventos: `Mensajes: Agregar` (y opcionalmente `Leads: Editar`)
4. Guardar

> Esta URL recibe mensajes entrantes de WhatsApp. **No cambiarla.**

### 6.3 Widget Reelance Hub

1. Kommo → Configuración → Integraciones → subir ZIP
2. Archivo: `widget_v1.0.24.zip` (versión actual)
3. Activar el widget
4. En los ajustes del widget, el campo `webhook_url` debe quedar vacío (lo llena el salesbot)

> El widget define los bloques visuales que aparecen en el diseñador de Salesbots.
> Para actualizar: mismos pasos, en el paso 2 subir el zip de la nueva versión (Kommo lo sobreescribe).
>
> **Desde v1.0.24:** las URLs de los webhooks están **hardcodeadas en `script.js`**, ya no
> se exponen como settings del bloque. Esto evita que Kommo bloquee el botón Guardar
> por validación de campos vacíos.

### 6.4 Salesbot — Crear desde cero

**Bot activo actual:** `48800` (creado abril 2026, widget v1.0.24)
**Nombre sugerido:** "Reelance Hub Send"

1. Kommo → Configuración → Salesbots → Crear nuevo
2. Agregar trigger: **"Cualquier conversación nueva"**
3. Click **"Agrega el siguiente paso"**
4. En el panel de bloques, sección **Reelance Hub** → seleccionar **"Enviar desde Reelance Hub"**
5. (Desde v1.0.24 ya no hay campos editables en el bloque — la URL está hardcodeada)
6. **Guardar** (el botón debe estar activo de inmediato)
7. Anotar el ID del bot (sale en la URL: `.../bot/NÚMERO/edit`)
8. Actualizar `.env` → `KOMMO_SALESBOT_ID=<nuevo_id>`
9. Reiniciar el server

> **Si el botón Guardar sale gris** y el bot ya tiene ejecuciones activas (de pruebas previas),
> Kommo lo bloquea. Solución: crear un bot nuevo (no se puede destrabar el viejo).

#### JSON interno que Kommo almacena (referencia)

```json
{
  "0": {
    "question": [{
      "handler": "widget",
      "params": {
        "widget_id": "1232019",
        "widget_instance_id": "<UUID generado por Kommo>",
        "widget_source_code": "reelance_reply_bridge",
        "params": {
          "webhook_url": "https://lucho101.com/api/kommo/salesbot/handoff"
        }
      }
    }],
    "block_uuid": "<UUID generado por Kommo>"
  },
  "conversation": false
}
```

> ⚠️ Este es el formato `handler: "widget"` (externo). Si se necesita pegar en el editor `</>` de Kommo, usar ESTE formato. NO pegar el formato interno compilado (arrays con `widget_request`, `condition`, `show`) porque Kommo no lo persiste correctamente.

#### JSON compilado que genera el widget (referencia interna — v1.0.24)

Cuando Kommo ejecuta el salesbot, el widget `onSalesbotDesignerSave` devuelve **dos pasos**:
el primero llama al servidor, el segundo entrega según `reply_type` (texto / imagen / archivo):

```json
[
  {
    "question": [
      { "handler": "widget_request", "params": { "url": "https://lucho101.com/api/kommo/salesbot/handoff", "data": { "source": "reelance_hub", "lead_id": "{{lead.id}}", "contact_id": "{{contact.id}}", "source_id": "{{lead.source_id}}" } } },
      { "handler": "goto", "params": { "type": "question", "step": 1 } }
    ],
    "require": []
  },
  {
    "question": [
      { "handler": "condition", "params": { "term1": "{{json.reply_type}}", "term2": "text",  "operation": "=", "result": [ { "handler": "show", "params": { "type": "text",  "value": "{{json.reply_text}}" } } ] } },
      { "handler": "condition", "params": { "term1": "{{json.reply_type}}", "term2": "image", "operation": "=", "result": [ { "handler": "show", "params": { "type": "image", "value": "{{json.reply_url}}" } } ] } },
      { "handler": "condition", "params": { "term1": "{{json.reply_type}}", "term2": "file",  "operation": "=", "result": [ { "handler": "show", "params": { "type": "file",  "value": "{{json.reply_url}}" } } ] } },
      { "handler": "stop", "params": {} }
    ],
    "require": []
  }
]
```

> **Nota importante:** Las ramas `image` y `file` están en el JSON pero **el servidor actualmente
> siempre responde con `reply_type: "text"`** porque Kommo no envía media real con `show type:"image"`
> (re-hostea el archivo en `kommo.cc` y manda la URL como texto). Para imágenes/archivos,
> el servidor pone una **URL de preview HTML** (ver Sección 12, "Workaround envío de archivos").

---

## 7. Endpoint /api/kommo/salesbot/handoff — Detalle

Este es el endpoint más crítico. El salesbot lo llama cuando el agente envía un mensaje.

**Request que recibe (de Kommo):**
```json
{
  "token": "<JWT firmado con KOMMO_CLIENT_SECRET>",
  "return_url": "https://ventasreelancemx.kommo.com/api/v4/salesbot/<id>/continue/<run_id>",
  "data": {
    "source": "reelance_hub",
    "lead_id": "23335864",
    "contact_id": "25707122",
    "source_id": "23041515",
    "message_text": ""
  }
}
```

**Lo que hace el server:**
1. Valida el JWT (usa `KOMMO_CLIENT_SECRET` como clave HMAC-SHA512)
2. Extrae `entity_id` y `entity_type` del payload del JWT
3. Consume el `pendingReply` del store (el texto que el agente escribió)
4. Responde `200 { ok: true }` inmediatamente (Kommo requiere respuesta en <2s)
5. Llama `callReturnUrl` con `{ data: { reply_text, has_reply } }`
6. El bot recibe esos datos como `{{json.reply_text}}` y `{{json.has_reply}}`

**Response que envía a callReturnUrl (v1.0.24):**
```json
{
  "data": {
    "reply_text": "Hola, ¿en qué te puedo ayudar?",
    "reply_url":  "",
    "reply_type": "text",
    "has_reply":  "1"
  }
}
```

Para mensajes con archivo, `reply_text` lleva el caption (si lo hay) seguido de la URL de
preview HTML — ej: `"Mira la foto\nhttps://lucho101.com/preview/abc-foto.jpg"`. El bot la
manda como texto y WhatsApp descubre los OG tags de esa URL para mostrar miniatura inline.

> **`reply_text` nunca debe ser cadena vacía cuando `has_reply: "1"`** — Kommo manda el
> literal `{{json.reply_text}}` al cliente cuando el valor es empty-string. Por eso el server
> tiene fallback: si no hay texto ni archivo, manda `"—"`.

---

## 8. Endpoints del servidor

| Método | Ruta | Auth | Función |
|--------|------|------|---------|
| GET | `/login` | No | Página de login |
| POST | `/login` | No | Autenticar con contraseña |
| POST | `/logout` | Sí | Cerrar sesión |
| GET | `/api/status` | Sí | Estado conexión Kommo, salesbot ID, versión |
| GET | `/api/chats` | Sí | Lista chats con mensajes |
| POST | `/api/chats/:id/messages` | Sí | Enviar mensaje (lanza salesbot) |
| POST | `/api/chats/:id/read` | Sí | Marcar como leído |
| POST | `/api/chats/:id/unread` | Sí | Marcar como no leído |
| POST | `/api/chats/:id/pin` | Sí | Fijar chat |
| DELETE | `/api/chats/:id/pin` | Sí | Desfijar chat |
| DELETE | `/api/chats/:id` | Sí | Borrar chat local |
| GET | `/api/quick-replies` | Sí | Lista de respuestas rápidas |
| POST | `/api/quick-replies` | Sí | Crear respuesta rápida |
| DELETE | `/api/quick-replies/:id` | Sí | Borrar respuesta rápida |
| GET | `/auth/kommo/url` | Sí | URL OAuth de Kommo |
| GET | `/auth/kommo/callback` | No | Callback OAuth |
| GET | `/api/push/vapid-public-key` | No | Clave pública VAPID |
| POST | `/api/push/subscribe` | Sí | Registrar suscripción push |
| POST | `/api/push/unsubscribe` | Sí | Cancelar suscripción push |
| POST | `/api/push/test` | Sí | Enviar push de prueba |
| POST | `/webhooks/kommo` | No | Webhook mensajes entrantes de Kommo |
| POST | `/webhooks/kommo/log-outgoing` | No | Bot registra mensaje saliente |
| POST | `/api/kommo/salesbot/handoff` | No (JWT) | Bot pide texto a enviar |
| GET | `/api/kommo/salesbot-id` | Sí | ID del salesbot configurado |
| GET | `/api/kommo/sources` | Sí | Canales conectados en Kommo |
| GET | `/uploads/:filename` | No | Sirve archivos crudos (binarios) |
| GET | `/preview/:filename` | No | HTML con OG tags → preview en WhatsApp |
| GET | `/api/debug/webhooks` | Sí | Últimos 100 webhooks recibidos |
| GET | `/api/debug/salesbot` | Sí | Últimos 20 eventos del salesbot |
| GET | `/api/debug/chat-messages/:chatId` | Sí | Prueba endpoints de chat de Kommo |
| GET | `/api/debug/probe-uploads` | Sí | Diagnóstico: prueba 8 endpoints de upload de Kommo |
| GET | `/api/debug/probe-drive` | Sí | Diagnóstico: drive shards 01-10 + chat message endpoints |
| GET | `/api/debug/probe-final` | Sí | Diagnóstico: amojo_id, drive auth methods, sources |

---

## 9. lib/kommo.js — Decisiones técnicas

### HTTPS Agent propio
```js
const kommoHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 20,
  timeout: 20_000
});
```
**Por qué:** Sin un agente propio, axios reutiliza conexiones keep-alive del pool global. Cuando Kommo cierra su lado de la conexión, el siguiente request falla con `Error: socket hang up` (ECONNRESET). El agente propio controla el ciclo de vida de las conexiones.

### Retry automático en errores de red
```js
if (isTransientNetworkError(error)) {
  await sleep(300);
  response = await doKommoCall(...); // segundo intento
}
```
**Por qué:** ECONNRESET, ETIMEDOUT y socket hang up son errores transitorios de red — un reintento de 300ms los resuelve en el 95% de los casos. Los errores `4xx`/`5xx` con respuesta HTTP NO se reintentan (son errores de lógica).

### Refresh automático de token (401)
Si Kommo devuelve 401, el server refresca el access token con el refresh token y reintenta la llamada automáticamente, sin interrumpir al usuario.

---

## 10. lib/store.js — Estado persistente

El estado completo de la app vive en `data/app-state.json`. Estructura:

```js
{
  kommo: {
    subdomain, tokens, account,
    detectedSalesbotId, lastError
  },
  chats: {
    "<chatId>": {
      chatId, chatIds, talkId, talkIds,
      entityId, entityIds, entityType,
      contactId, contactIds,
      title, subtitle, origin,
      messages: [{ id, text, timestamp, direction, deliveryStatus, status }],
      unread, pinned, pinnedAt
    }
  },
  pendingReplies: {},   // texto que el agente envió, esperando que el bot lo consuma
  webhookDebug: [],     // últimos 100 webhooks recibidos
  salesbotDebug: [],    // últimos 20 eventos del salesbot
  quickReplies: [],     // respuestas rápidas del agente
  pushSubscriptions: [] // suscripciones Web Push por dispositivo
}
```

### Dedupe de mensajes
Cuando el agente envía, se crea un mensaje local con `id: "local-{timestamp}"`. Cuando llega el webhook de confirmación de Kommo con el ID real, `addMessageToChat()` detecta que ya existe un mensaje local con el mismo texto y lo reemplaza (no duplica).

---

## 11. Widget Kommo — Estructura y versiones

### Archivo: kommo-widget/manifest.json
Define los handlers disponibles en el diseñador de Salesbots:

- **`reelance_reply_bridge`** → El bloque principal. Genera el flujo `widget_request → condition → show` para enviar la respuesta del agente por WhatsApp.
- **`reelance_log_outgoing`** → Solo registra en Reelance Hub mensajes que el bot envió por otro medio (ej: plantillas HSM). No entrega nada al cliente.

### Cómo configurar el bloque `reelance_log_outgoing` en un bot

Este bloque debe colocarse **inmediatamente después del paso que envía el mensaje** (antes de cualquier pausa o cambio de etapa):

```
┌──────────────────────────────┐
│  📤 Enviar mensaje WhatsApp  │  ← Step que envía la plantilla
└─────────────┬────────────────┘
              │
┌─────────────▼────────────────┐
│  📋 Registrar en Reelance Hub│  ← AQUÍ va el bloque log-outgoing
│  • webhook_url: (auto)       │     justo después del envío
│  • message_text: [el texto]  │
└─────────────┬────────────────┘
              │
┌─────────────▼────────────────┐
│  ⏸️  Pausa / Cambio de etapa │
└──────────────────────────────┘
```

Al abrir el bloque aparecen **dos campos**:
1. **"URL para registrar (no editar)"** → contiene `https://lucho101.com/webhooks/kommo/log-outgoing` — **NO tocar, nunca cambiar esta URL**
2. **"Texto del mensaje a registrar"** → aquí se escribe el mismo texto que envía el bot en ese step

> ⚠️ Si se coloca el bloque DESPUÉS de una pausa de 24h, el registro llega con el delay de la pausa. Colocarlo siempre antes de la pausa.

### Versiones y su zip
| Versión | Zip | Cambio principal |
|---------|-----|-----------------|
| 1.0.4 | (archivado) | Primera versión con `show` como handler de entrega |
| 1.0.14 | `reelance-widget-v1.0.14.zip` | Limpieza de comentarios, i18n mejorado |
| 1.0.18 | `reelance-widget-v1.0.18.zip` | `required: false` + `default_value` — editable Y Guardar funciona |
| 1.0.21 | `widget_v1.0.21.zip` | Logos con dimensiones oficiales de Kommo (130×100, 84×84, etc.) |
| 1.0.22 | `widget_v1.0.22.zip` | `message_text` de vuelta en `reelance_reply_bridge` — fix Save gris al editar |
| 1.0.23 | `widget_v1.0.23.zip` | 3 ramas en delivery: text/image/file + soporta `reply_url`, `reply_type` |
| **1.0.24** | `widget_v1.0.24.zip` | URLs hardcodeadas en script.js — fix Save gris en bot nuevo ✅ **ACTUAL** |

---

## 12. Problemas conocidos y sus soluciones

### "Botón Guardar en gris en el diseñador de Salesbots"

Este problema afecta específicamente al campo `message_text` del bloque `reelance_log_outgoing`. Se probaron múltiples combinaciones hasta encontrar la que funciona:

| Configuración | Editable | Guardar | Estado |
|--------------|----------|---------|--------|
| `manual: false` | ❌ | ✅ | No sirve (no se puede escribir) |
| `manual: true` | ✅ | ❌ | No sirve (bloquea Guardar) |
| `required: false` (sin manual) | ✅ | ❌ | Kommo lo trata como requerido igual |
| `manual: true` + `required: false` | ❌ | ✅ | No sirve (no se puede escribir) |
| **`required: false` + `default_value`** | ✅ | ✅ | **CORRECTO — v1.0.18** |

**Solución actual (v1.0.18):**
```json
"message_text": {
  "name": "Texto del mensaje a registrar",
  "type": "text",
  "required": false,
  "default_value": "Escribe aquí el mensaje del bot"
}
```
El `default_value` pre-llena el campo (pasa la validación de Kommo) y el usuario puede editar el texto. Si el problema reaparece en una versión futura, **la solución es siempre agregar `default_value`**.

### "Palomita en Kommo pero mensaje no llega al teléfono"
**Causa A:** Se usaba `send_external_message` como handler de entrega. Ese handler requiere un canal custom registrado en `amojo.kommo.com`. Sin ese canal, Kommo acepta el JSON (muestra palomita) pero no tiene a dónde entregar.  
**Solución:** Usar `handler: "show"` con `type: "text"` — es el handler nativo que entrega por el canal WhatsApp activo del lead.

**Causa B:** Se pasaba `source_id` (23041515) como `reply_channel_id`. El source_id no es un channel_id — Kommo los trata como conceptos distintos.  
**Solución:** El handler `show` no necesita ningún channel_id. Eliminado del payload.

### "Error: socket hang up / ECONNRESET"
**Causa:** Axios reutilizaba conexiones keep-alive del pool global que Kommo ya había cerrado.  
**Solución:** HTTPS agent propio + retry automático (implementado en `lib/kommo.js`).

### "Reloj en el mensaje / bot lanza pero nunca llama al webhook"
**Causa:** El JSON pegado en el editor `</>` de Kommo estaba en formato array `[...]`. Kommo espera formato objeto `{"0": {...}, "conversation": false}`. También: los placeholders `{{lead.id}}` se convirtieron en links de Markdown al copiar del chat.  
**Solución:** Siempre crear el bot desde el **editor visual** (arrastrando el bloque). Solo usar `</>` para verificar, no para editar.

### "Bloque log-outgoing sin campo de texto editable"
**Causa:** El campo `message_text` en el manifest usa `manual: true` sin `default_value`, o usa alguna combinación que Kommo no renderiza correctamente como editable.  
**Solución:** Usar `required: false` + `default_value: "Escribe aquí el mensaje del bot"` sin flag `manual`. Ver tabla de combinaciones en la sección anterior.

### "Mensaje duplicado al cliente"
**Causa:** Había dos steps de entrega activos al mismo tiempo — el `send_external_message` del widget Y un bloque `send_message` externo en el bot.  
**Solución:** El bot debe tener ÚNICAMENTE el bloque del widget. No agregar steps adicionales de "Enviar mensaje".

### "Imágenes/archivos llegan como URL en lugar de inline" — Workaround envío de archivos

**Hallazgo definitivo (abril 2026):** Kommo NO permite a integraciones OAuth server-side
enviar media real (binarios) a chats de WhatsApp existentes. Los partners oficiales
(Twilio/360dialog) tienen acceso especial. Probamos exhaustivamente:

| Endpoint probado | Resultado |
|---|---|
| `POST /api/v4/chat/uploads` | 404 — no existe |
| `POST /api/v4/chats/uploads` | 404 |
| `POST /api/v4/uploads`, `/files`, `/upload` | 404 |
| `POST /api/v4/account/_DRIVE_/uploads` | 404 |
| `https://drive-XX.kommo.com/api/v4/uploads` | **401** — existe pero rechaza OAuth Bearer (requiere session cookies del navegador) |
| `POST /api/v4/chats/{id}/messages` | 404 |
| `show type:"image" value:"<URL>"` | Re-hostea en `kommo.cc` y manda como **texto** |

**Workaround actual (v1.0.24 + ruta `/preview/`):**

Cuando el agente manda un archivo, el server hace:
1. Guarda archivo en `data/uploads/<id>-<nombre>` (URL `/uploads/...` cruda — sigue accesible)
2. Construye URL de preview: `https://lucho101.com/preview/<id>-<nombre>`
3. Manda al bot `reply_text = caption + "\n" + preview_url` y `reply_type = "text"`
4. Bot ejecuta `show type:"text"` con esa URL
5. WhatsApp recibe el mensaje, **fetchea la URL del preview**, lee los meta `og:image` del HTML
6. Cliente ve **miniatura inline de la imagen** + el caption arriba ✅

La ruta `/preview/:filename` (en `server.js`, pública vía `/lib/auth.js`) genera HTML
con OG tags apuntando al archivo real:
```html
<meta property="og:image" content="https://lucho101.com/uploads/<id>-<file>" />
<meta property="og:image:secure_url" content="..." />
<meta property="og:image:width" content="1200" />
<meta name="twitter:card" content="summary_large_image" />
```

Para PDFs / archivos no-imagen, el preview es una página con título + botón Descargar.

**Cuando Kommo soporte responda** con el endpoint correcto, descomentar el bloque
`kommo.uploadChatFile(...)` en `server.js` (busca `/* try {` en la sección de envío
de mensajes) y revertir `replyType = 'text'` a la lógica original (`image`/`file`/`text`).

### "Save button gris al crear bot nuevo" (v1.0.22 y anteriores)
**Causa:** El bloque `reelance_reply_bridge` exponía `webhook_url` como setting con
`manual: false` pero sin `required: false` → Kommo lo trataba como requerido y la
validación frontend bloqueaba el botón.  
**Solución (v1.0.24):** URLs hardcodeadas en `script.js` (`HANDOFF_URL`, `LOG_URL`).
Los bloques ya no exponen settings de URL al usuario — solo `message_text` opcional.

---

## 13. Comandos útiles

```bash
# Iniciar el server
cd /Users/luismelchor/Desktop/ReelanceHub
/Users/luismelchor/.local/node/bin/node server.js

# Iniciar en background (como lo hace el sistema)
nohup /Users/luismelchor/.local/node/bin/node server.js >> logs/server.log 2>> logs/server-error.log &

# Ver PID del server corriendo
pgrep -lf "server.js"

# Matar y reiniciar
pkill -f "node.*server.js" && sleep 1 && nohup /Users/luismelchor/.local/node/bin/node server.js >> logs/server.log 2>> logs/server-error.log &

# Ver últimos eventos del salesbot
curl -s http://localhost:3000/api/debug/salesbot | python3 -m json.tool | tail -60

# Ver últimos webhooks recibidos
curl -s http://localhost:3000/api/debug/webhooks | python3 -m json.tool | tail -60

# Estado de la conexión Kommo
curl -s http://localhost:3000/api/status

# Ver logs en tiempo real
tail -f /Users/luismelchor/Desktop/ReelanceHub/logs/server.log

# Construir nuevo zip del widget (siempre hacer los 3 pasos juntos):
# 1. Bump versión en manifest.json (editar a mano)
# 2. Generar imagen con nueva versión (cambiar "v1.XX" por la versión real):
python3 - << 'EOF'
import struct, zlib

CHARS = {
    'v':[[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0],[0]*5,[0]*5],
    '1':[[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0],[0]*5,[0]*5],
    '.':[[0]*5,[0]*5,[0]*5,[0]*5,[0,0,1,0,0],[0]*5,[0]*5],
    '0':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    '2':[[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,1,1,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
    '3':[[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
    '4':[[1,0,0,1,0],[1,0,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0],[0,0,0,1,0]],
    '5':[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
    '6':[[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    '7':[[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[0,1,0,0,0],[0,1,0,0,0]],
    '8':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    '9':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0]],
}
def make_png(width, height, version_text, bg=(41,128,185), fg=(255,255,255)):
    avail_h = int(height * 0.55); avail_w = int(width * 0.85)
    sc_h = max(1, avail_h // 7)
    char_w_units = 5 * len(version_text) + 2 * (len(version_text) - 1)
    sc_w = max(1, avail_w // char_w_units)
    sc = min(sc_h, sc_w)
    char_w = 5 * sc; gap = 2 * sc
    total_w = len(version_text) * char_w + (len(version_text) - 1) * gap
    rows = [bytearray(bg * width) for _ in range(height)]
    sx = (width - total_w) // 2; sy = (height - 7 * sc) // 2
    for ci, ch in enumerate(version_text):
        bm = CHARS.get(ch, [[0]*5]*7); cx = sx + ci * (char_w + gap)
        for ri, rb in enumerate(bm):
            for bi, bit in enumerate(rb):
                if bit:
                    for dy in range(sc):
                        for dx in range(sc):
                            px = cx + bi * sc + dx; py = sy + ri * sc + dy
                            if 0 <= px < width and 0 <= py < height:
                                rows[py][px*3:px*3+3] = bytearray(fg)
    def chunk(t,d): c=t+d; return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
    sig=b'\x89PNG\r\n\x1a\n'
    ihdr=chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))
    raw=b''.join(b'\x00'+bytes(r) for r in rows)
    return sig+ihdr+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')

# ⚠️ DIMENSIONES OFICIALES Kommo — NO CAMBIAR
SPECS = [
    ('logo_min.png',     84,  84),
    ('logo_small.png',   108, 108),
    ('logo.png',         130, 100),
    ('logo_medium.png',  240,  84),
    ('logo_main.png',    400, 272),
]
ver = "v1.XX"  # <-- CAMBIAR AQUÍ a la versión actual
base = "/Users/luismelchor/Desktop/ReelanceHub/kommo-widget/images"
for fname, w, h in SPECS:
    open(f"{base}/{fname}",'wb').write(make_png(w,h,ver))
print(f"Imágenes {ver} generadas con dimensiones oficiales")
EOF
# 3. Construir el zip:
cd /Users/luismelchor/Desktop/ReelanceHub/kommo-widget && zip -r ../reelance-widget-v1.0.XX.zip . -x "*.DS_Store" "*.zip"
```

---

## 14. Links de documentación oficial

| Recurso | URL |
|---------|-----|
| Kommo Developers (ES) | https://es-developers.kommo.com/docs/kommo-desarrolladores |
| OAuth 2.0 Kommo | https://developers.kommo.com/docs/oauth-20 |
| Salesbot SDK | https://developers.kommo.com/docs/salesbot-sdk |
| Salesbot Digital Pipeline | https://developers.kommo.com/docs/salesbot-dp |
| Private Chatbot Integration | https://es-developers.kommo.com/docs/integraci%C3%B3n-de-chatbot-privado |
| Chats API — Connect channel | https://developers.kommo.com/reference/connect-channel |
| Chats API — Send messages | https://developers.kommo.com/reference/send-import-messages |
| Five steps to send a message | https://developers.kommo.com/reference/send-message-guide |
| Salesbot step types (soporte) | https://www.kommo.com/support/crm/salesbot-step-and-action-types/ |
| Web Push (web-push npm) | https://www.npmjs.com/package/web-push |
| VAPID Keys guide | https://vapidkeys.com/ |

---

## 15. Notas para la IA que retome este proyecto

1. **El usuario NO programa.** Dar instrucciones visuales paso a paso. Usar diagramas ASCII cuando sea necesario.
2. **Idioma:** español de México, informal.
3. **Antes de cambiar código**, siempre leer los logs de debug: `GET /api/debug/salesbot` y `GET /api/debug/webhooks`.
4. **El salesbot debug** tiene entries tipo `launch_attempt`, `launch_success`, `handoff_request`, `handoff_complete`. Si hay `launch_success` pero NO `handoff_request`, el bot está vacío o mal configurado (no el código).
5. **No pegar JSON compilado en el editor `</>` de Kommo.** Usar siempre el editor visual.
6. **Si se crea un nuevo salesbot**, actualizar `KOMMO_SALESBOT_ID` en `.env` y reiniciar el server.
7. **El widget tiene `widget_id: "1232019"`** — ese es el ID de instalación en la cuenta de Kommo. No cambia salvo que se desinstale y reinstale el widget.
8. **En cada rebuild del widget SIEMPRE hacer estas 3 cosas juntas, sin excepción:**
   1. Bump de versión en `manifest.json` (1.0.X → 1.0.X+1)
   2. Regenerar las imágenes del logo con el número de versión visible (ej: "v1.20") usando el script Python en la sección 13
   3. Reconstruir el zip: `cd kommo-widget && zip -r ../reelance-widget-v1.0.XX.zip . -x "*.DS_Store" "*.zip"`
   Esto permite identificar visualmente qué versión está instalada en Kommo sin tener que abrir el manifest.

   **⚠️ DIMENSIONES OFICIALES de los logos (Kommo rechaza el zip si están mal):**
   | Archivo | Dimensiones (px) |
   |---------|------------------|
   | `logo_min.png` | 84 × 84 |
   | `logo_small.png` | 108 × 108 |
   | `logo.png` | 130 × 100 |
   | `logo_medium.png` | 240 × 84 |
   | `logo_main.png` | 400 × 272 |
   | `logo_dp.png` (opcional) | 174 × 109 |
   
   Cada archivo no debe exceder 300 KB. Fuente oficial: https://es-developers.kommo.com/docs/images
9. **La URL pública del server** está en `APP_BASE_URL`. Actualmente es `https://lucho101.com` (via cloudflared). En dev se usa ngrok.
10. **Timestamps de mensajes:** La función `formatTime()` en `public/app.js` muestra solo la hora (`HH:MM`) para mensajes de hoy, y `DD/MM/AA HH:MM` para mensajes de días anteriores. El locale es `es-MX` con formato de 24h.
11. **Limitación de Kommo:** los mensajes salientes enviados directamente desde la UI de Kommo (no desde Reelance Hub) NO se pueden capturar vía webhook ni API. Esto es una restricción oficial confirmada por soporte de Kommo. **Workaround operativo:** todos los agentes responden EXCLUSIVAMENTE desde Reelance Hub.

---

## 16. Historial de versiones del widget

| Versión | Cambio |
|---------|--------|
| 1.0.1 – 1.0.3 | Versiones iniciales — arquitectura básica |
| 1.0.4 | Primer fix del bug de doble mensaje — cambio a handler `show` |
| 1.0.5 – 1.0.9 | Mejoras incrementales (archivadas en `dist/`) |
| 1.0.10 | Intento de cambiar a `send_message` (descartado) |
| 1.0.11 | Revert a `send_external_message` sin `channels[]` (insuficiente) |
| 1.0.12 | Handler `show` — correcto, pero `manual: true` impedía guardar |
| 1.0.13 | `manual: false` — fix del botón Guardar gris |
| 1.0.14 | Limpieza de comentarios, i18n actualizado, código limpio |
| 1.0.15 | Agregado bloque `reelance_log_outgoing` para registrar mensajes de bots; `manual: true` en message_text — editable pero bloqueaba Guardar |
| 1.0.16 | `required: false` sin manual — Kommo igual bloqueaba Guardar |
| 1.0.17 | `manual: true` + `required: false` — Guardar OK pero campo no editable |
| 1.0.18 | `required: false` + `default_value` — editable Y Guardar funciona ✅; timestamp DD/MM/AA |
| 1.0.19 – 1.0.20 | (intermedios — bumps + logos) |
| 1.0.21 | Logos con dimensiones oficiales de Kommo (130×100, 84×84, 108×108, 240×84, 400×272) |
| 1.0.22 | `message_text` re-agregado en `reelance_reply_bridge` (se había quitado por error al añadir Camino B) |
| 1.0.23 | Delivery con 3 ramas: text/image/file (`{{json.reply_type}}`); soporta `reply_url` y `reply_type` |
| **1.0.24** | URLs hardcodeadas en script (`HANDOFF_URL`, `LOG_URL`) — bloque sin settings visibles → fix Save gris ✅ |

---

## 17. Hallazgos clave de abril 2026 (sesión de debugging extendida)

### Sobre envío de archivos a WhatsApp

Después de probar exhaustivamente todos los endpoints públicos de Kommo (ver
Sección 12 → "Imágenes/archivos llegan como URL"), se confirmó que **no hay forma
documentada de mandar media binario a chats de WhatsApp existentes desde una
integración OAuth server-side**. El Drive API rechaza Bearer tokens (solo cookies),
y `show type:"image"` en el salesbot re-hostea y manda como texto.

**Solución implementada:** ruta `/preview/:filename` con OG tags. WhatsApp fetchea
el HTML y muestra miniatura inline automáticamente.

**Datos descubiertos durante el probe:**
- `amojo_id` de la cuenta: `edb9a8e1-51f3-414a-b8f0-c74c6c9b87e6`
- `subdomain`: `ventasreelancemx`
- `widget_id`: `1232019`
- Drive API URL pattern: `https://drive-{01-10}.kommo.com/api/v4/uploads` (existe pero 401 con Bearer)

### Sobre el botón Guardar gris en bots

Era causado por `webhook_url` en los settings del bloque sin `required: false`.
**v1.0.24 lo elimina del manifest** (URLs hardcodeadas en `script.js`).

### Sobre el campo `reply_text` vacío

Si el server responde `reply_text: ""` cuando `has_reply: "1"`, Kommo manda el
literal `{{json.reply_text}}` como texto al cliente. **Siempre poner un fallback**
(URL del archivo o `"—"`).

---

## 18. Widget Logger SEPARADO (`kommo-widget-logger/`) — Camino B

Widget aislado del principal para que cualquier cambio en el flujo de plantillas
NO afecte el chat agente↔cliente. Ruta: `/Users/luismelchor/Desktop/ReelanceHub/kommo-widget-logger/`.

### Por qué un widget separado
El widget principal (`kommo-widget/`) maneja el **handoff** (agente envía mensajes
al cliente) y un `log_outgoing` interno. Cuando se necesitó tracking de plantillas
HSM enviadas por bots automáticos (Camino B: 24h+, recordatorios, follow-ups), se
creó este segundo widget para no tocar nada del flujo crítico.

### Manifest v1.0.3

```json
{
  "widget": {
    "name": "Reelance Hub registrar mensaje",
    "version": "1.0.3",
    "interface_version": 2,
    "init_once": true,
    "locale": ["es","en"],
    "installation": true
  },
  "locations": ["settings", "salesbot_designer"],
  "salesbot_designer": {
    "log_template_sent": {
      "name": "Registrar plantilla en Reelance Hub",
      "settings": {
        "message_text": { "type": "text", "default_value": "Pega aquí el texto de la plantilla" },
        "tag":          { "type": "text", "default_value": "Plantilla" }
      }
    }
  }
}
```

### Script — el truco de `value_manual`

Kommo guarda el texto que el usuario tipea en la **caja de "entrada manual" (3 puntos)**
en `params.value_manual`, NO en el campo nombrado (`message_text`). Si solo lees
`message_text` siempre te llega el placeholder `"Pega aquí el texto de la plantilla"`.

La función `pickRealText()` resuelve esto:

```js
const pickRealText = (p, fieldName, placeholder) => {
  const vm = p?.value_manual?.trim?.() || '';
  const fv = p?.[fieldName]?.trim?.() || '';
  if (vm && vm !== placeholder) return vm;   // prioridad: value_manual
  if (fv && fv !== placeholder) return fv;   // fallback: campo nombrado
  return '';
};
```

El widget devuelve un `widget_request` que llama
`https://lucho101.com/webhooks/kommo/log-outgoing` con `text`, `tag`, `lead_id`,
`contact_id`, y un marcador `_widget_version` para debug.

### Endpoint del servidor

`POST /webhooks/kommo/log-outgoing` (en `server.js` línea ~998):
1. Responde 200 inmediato
2. Llama `return_url` para desbloquear el bot (CRÍTICO — sin esto el bot queda atascado)
3. Procesa async: agrega el mensaje al chat correcto con `deliveryStatus: 'enviado por salesbot'`

### Bug encontrado: `change_status` después del timer no funciona

**Síntoma:** el bot termina (`_stop` con `talk-close`) pero el lead NO cambia de etapa.

**Diagnóstico hecho con API directa:**
- Se hizo `PATCH /api/v4/leads/{id}` con los mismos `status_id` + `pipeline_id` → ✅ funcionó
- Por lo tanto los IDs son válidos, el token tiene permisos, no hay validación bloqueando

**Conclusión:** el bloque `action.change_status` del salesbot a veces no aplica el
cambio aunque tenga IDs correctos. Es un bug/limitación de Kommo. **Workaround
sugerido (no implementado):** mover el widget logger DESPUÉS del timer y extender
el endpoint `/log-outgoing` para que acepte `target_status_id` + `target_pipeline_id`
opcionales y haga el cambio vía API directamente.

### Historial del widget logger

| Versión | Cambio |
|---------|--------|
| 1.0.0 | Inicial — falló al instalar (faltaba `installation:true`, `tour`, etc.) |
| 1.0.1 | Estructura corregida copiando del widget principal |
| 1.0.2 | Agregada función `pickRealText()` para resolver el problema de `value_manual` |
| **1.0.3** | Agregado `_widget_version` al payload — debug marker para confirmar versión activa ✅ |

---

## 19. Mejoras UI — scroll del chat (sesión late abril 2026)

### Cambio
Antes los mensajes se mostraban con el más reciente **arriba** (estilo feed). El
usuario pidió cambiarlo a estilo WhatsApp/iMessage: **viejos arriba, nuevos abajo**.

### Implementación en `public/app.js` → `renderMessages()`

**1. Orden de mensajes** (línea ~759):
```js
// Antes:  right.timestamp - left.timestamp  (descendente)
// Ahora:  left.timestamp - right.timestamp  (ascendente — viejos primero)
const orderedMessages = [...currentChat.messages]
  .sort((left, right) => left.timestamp - right.timestamp);
```

**2. Scroll inteligente con fingerprint para evitar flicker**

El polling llama `render()` cada 4 segundos. Sin optimización, cada ciclo hacía
`messages.innerHTML = ''` → reset del scroll → re-render → snap al fondo. Eso
producía un parpadeo molesto (el chat "subía y bajaba" cada 4s aunque no hubiera
mensajes nuevos).

Solución: calcular un **fingerprint** del estado del chat y saltarse el re-render
si nada cambió.

```js
function buildMessagesFingerprint(chat) {
  const last = chat.messages[chat.messages.length - 1];
  return [chat.chatId, chat.messages.length, last.id, last.timestamp,
          last.status, last.deliveryStatus, chat.title,
          chat.statusId, chat.pipelineId].join('|');
}

// Dentro de renderMessages():
if (!isChatSwitch && renderMessages._lastFingerprint === fingerprint) {
  // Solo refresca título/meta, NO toca el DOM de mensajes
  return;
}
```

**3. Comportamiento del scroll** después de un re-render real:

| Situación | Comportamiento |
|-----------|----------------|
| Cambia de chat | Auto-scroll al fondo (último mensaje visible) |
| Estaba <80px del fondo | Sigue al fondo (mensajes nuevos visibles) |
| Estaba leyendo arriba | **Mantiene la distancia exacta desde el fondo** (los msgs nuevos crecen sin moverle el viewport) |

Fórmula clave para el caso 3:
```js
messages.scrollTop = messages.scrollHeight - messages.clientHeight - distanceFromBottom;
```

Funciona idéntico en móvil y escritorio porque comparten el mismo JS.

---

## 20. PENDIENTE: Integración WooCommerce (reelance.mx)

### Objetivo
Cuando un cliente realiza un pedido en `reelance.mx` (WooCommerce), Reelance Hub
debe automatizar la creación/actualización del contacto y lead en Kommo.

### Arquitectura propuesta — módulo aislado
**Archivo nuevo:** `lib/woocommerce.js` — toda la lógica orden → Kommo
**Endpoint nuevo:** `POST /webhooks/woocommerce/order-created` en `server.js`

Cero cambios al chat, salesbot, widgets, o handoff. Si rompe, solo rompe el flujo
WooCommerce.

### Flujo deseado

```
1. WooCommerce → POST /webhooks/woocommerce/order-created
2. Validar firma HMAC (WC permite secret)
3. Buscar contacto en Kommo por teléfono | email
   ├── ENCONTRADO  → PATCH para añadir tags + actualizar datos faltantes
   └── NO ENCONTRADO → POST nuevo contacto con:
        - Nombre completo separado en first_name + last_name
        - Tag "Cliente"
        - Tag con número de orden
        - Phone: "+521" + teléfono
        - Email del cliente
4. Buscar lead activo del contacto
   ├── EXISTE → actualizar (custom field "Ultima Compra" + mover de pipeline)
   └── NO EXISTE → POST nuevo lead con:
        - Name: "{nombre} {dd/mm/aa}" (fecha del pedido)
        - Custom field "Ultima Compra" = timestamp de la orden
5. Detener cualquier salesbot corriendo en ese lead
   → DELETE /api/v4/salesbot/{bot_id}/terminate (verificar endpoint exacto)
6. Mover lead a CLIENTES → etapa X (PENDIENTE confirmar cuál)
```

### IDs ya confirmados (vía API directa — abril 2026)

```
Pipeline CLIENTES = 6128851
  Etapas disponibles:
    53000815: Leads Entrantes
    53000819: Jump Cliente
    98297015: Borrar
    98180480: Clientes FINAL
    53000887: MENSAJE A
    99104471: MENSAJE B
    99611283: ERROR

Custom field "Ultima Compra" = 784794 (visto en webhook payloads previos)
```

### Decisiones pendientes (del usuario antes de implementar)

1. **¿Qué etapa exacta en CLIENTES?** No existe "Recientes" — ¿usar `Leads Entrantes` o crear una nueva?
2. **Formato del teléfono que llega de WC** — ¿siempre 10 dígitos o a veces con código?
3. **Prioridad en búsqueda** — teléfono o email primero
4. **Tags** — "Cliente" en contacto (permanente) y orden# en lead (por compra). Confirmar
5. **Si el contacto YA tiene lead abierto en otro pipeline** (ej. "2 MESES"):
   - A) mover ese mismo lead → CLIENTES (pierde historial)
   - B) crear lead nuevo en CLIENTES, dejar viejo donde está
   - C) cerrar viejo como "Logrado con éxito" + crear nuevo en CLIENTES
6. **¿WC ya tiene webhooks configurados?** Si no, activarlos en `WooCommerce → Ajustes → Avanzado → Webhooks` con:
   - Topic: `Order created` (o `Order updated`)
   - URL: `https://lucho101.com/webhooks/woocommerce/order-created`
   - Secret: generar uno y agregarlo al `.env` como `WOOCOMMERCE_WEBHOOK_SECRET`

### Plan de implementación (cuando el usuario confirme las 6 decisiones)

```
lib/woocommerce.js
  ├── verifySignature(req)           — HMAC-SHA256 con secret
  ├── normalizePhone(raw)            — siempre devuelve "+521..."
  ├── findContact({phone, email})    — GET /api/v4/contacts?query=...
  ├── createContact(orderData)       — POST con tags + custom fields
  ├── updateContact(id, orderData)   — PATCH
  ├── findActiveLead(contactId)      — GET /api/v4/leads?filter[contacts]=...
  ├── createLead(contactId, order)   — POST con pipeline_id, status_id, custom fields
  ├── updateLead(id, order)          — PATCH
  ├── stopActiveSalesbots(leadId)    — verificar API: terminate vs unlink
  └── processOrder(orderPayload)     — orquesta todo el flujo

server.js (5 líneas nuevas):
  app.post('/webhooks/woocommerce/order-created', wc.handleOrderWebhook);

.env (añadir):
  WOOCOMMERCE_WEBHOOK_SECRET=xxx
  KOMMO_CLIENTES_PIPELINE_ID=6128851
  KOMMO_CLIENTES_TARGET_STATUS_ID=53000815  (o el que confirme el usuario)
  KOMMO_CUSTOM_FIELD_ULTIMA_COMPRA=784794
```

### Tests sugeridos antes de producción
1. Webhook de prueba con orden falsa (curl con payload simulado)
2. Verificar contacto creado en Kommo con todos los campos
3. Verificar lead movido al pipeline correcto
4. Probar caso "contacto ya existe" — debe actualizar, no duplicar
5. Probar firma HMAC inválida — debe rechazar 401

---

## 21. Watchdog de conexión (cliente) y monitoreo externo (UptimeRobot)

Sistema de detección de fallas en 3 capas — implementado late-abril 2026.

### Capa 1: detección desde el navegador (cliente)
Implementado en `public/app.js`. Las llamadas de polling (`refreshChats` cada 4s,
`refreshStatus` cada 12s) ahora trackean éxito/fallo:

- `markConnectionSuccess()` — limpia el contador y muestra banner verde si veníamos offline
- `markConnectionFailure(error)` — incrementa contador; al llegar a 3 fallos seguidos marca offline
- Banner persistente en `index.html` (`#connectionBanner`) — naranja (degradado) / rojo (offline) / verde (recuperado)
- Notificación del sistema vía `Notification API` (Mac + iOS PWA 16.4+) con cooldown de 60s para no spammear
- Listeners `window.online`/`window.offline` adelantan el aviso cuando el dispositivo pierde wifi

CSS del banner: `.connection-banner` en `styles.css` con animación `slide` + dot pulse.

**Limitación importante:** este sistema **solo detecta cuando el usuario tiene la app
abierta**. Si la PWA está cerrada o el server cae a las 3am, nadie se entera.

### Capa 2: endpoint público `/healthz`

Nuevo en `server.js` (~línea 695):

```js
app.get('/healthz', (_req, res) => {
  const state = store.readState();
  const kommoOk = Boolean(state.kommo?.tokens?.access_token);
  if (!kommoOk) return res.status(503).json({ ok: false, reason: 'kommo_disconnected' });
  res.status(200).json({ ok: true, version: config.appVersion, ts: Date.now() });
});
```

Marcado como público en `lib/auth.js` (PUBLIC_PATHS). Cualquiera puede pingear
`https://lucho101.com/healthz` sin auth — devuelve `200` si vivo, `503` si Kommo
desconectado, no responde si el server o el túnel están muertos.

### Capa 3: monitoreo externo con UptimeRobot

Servicio gratuito que pinguea `/healthz` cada 5 minutos desde fuera. Cuando falla
2 veces seguidas, manda alertas vía email + Telegram + push.

**Setup del usuario:**
1. Crear cuenta en https://uptimerobot.com
2. Add New Monitor: `HTTPS` · URL `https://lucho101.com/healthz` · cada 5 min
3. Alert contacts: Email (default) + Telegram bot `@uptimerobot_bot`

**Resultado:** Luis se entera por Telegram aunque tenga la app cerrada y esté de viaje.

---

## 22. Auto-arranque al encender la Mac (LaunchAgents)

Implementado late-abril 2026 — sustituye el setup manual viejo (`com.reelancehub.*`,
respaldados como `.OLD-BACKUP`).

### Archivos plist activos en `~/Library/LaunchAgents/`

**`com.reelance.tunnel.plist`** — gestiona el túnel de Cloudflare
**`com.reelance.server.plist`** — gestiona el servidor Node.js

Ambos con:
- `RunAtLoad: true` → arrancan al iniciar sesión en la Mac
- `KeepAlive: { SuccessfulExit: false }` → si crashean inesperadamente, launchd los relanza
- `ThrottleInterval: 30` → no relanza más de una vez cada 30 segundos (evita loops si hay bug)
- Logs van a `/Users/luismelchor/Desktop/ReelanceHub/logs/`

### Comandos para administrarlos

```bash
# Ver el estado actual de los LaunchAgents
launchctl list | grep com.reelance

# Reiniciar manualmente uno
launchctl kickstart -k gui/$(id -u)/com.reelance.server
launchctl kickstart -k gui/$(id -u)/com.reelance.tunnel

# Apagar definitivamente (no auto-restart)
launchctl unload ~/Library/LaunchAgents/com.reelance.server.plist
launchctl unload ~/Library/LaunchAgents/com.reelance.tunnel.plist

# Volver a activar
launchctl load -w ~/Library/LaunchAgents/com.reelance.server.plist
launchctl load -w ~/Library/LaunchAgents/com.reelance.tunnel.plist
```

### Prueba de KeepAlive (verificada el 2026-04-30)

```bash
# Matar el server a propósito
kill <PID>
# Esperar 5 segundos
ps aux | grep node.*server.js
# Resultado: launchd lo había levantado con un PID nuevo ✅
```

### Plists viejos respaldados
- `com.reelancehub.cloudflared.plist.OLD-BACKUP`
- `com.reelancehub.server.plist.OLD-BACKUP`
- `com.reelancehub.ngrok.plist.disabled` (legacy del setup ngrok)

Si algún día hay que rollback, basta con renombrarlos quitando `.OLD-BACKUP` y
hacer `launchctl load` del viejo después de unload del nuevo.

---

## 23. Carpeta `Control/` — scripts `.command` (control manual)

Vive **dentro del proyecto** en `~/Desktop/ReelanceHub/Control/` para mantener
todo unificado. Se accede desde Finder o vía un **alias en el escritorio**
(`Reelance Hub - Control`) creado con `osascript`.

Cada script es un `.command` ejecutable con doble clic desde Finder. Cada uno
tiene un README dentro de la carpeta (`Control/README.md`) explicándolos.

### `0-Configurar-Mac-Servidor.command`
**Uso:** UNA SOLA VEZ por Mac. Configura energía para servidor 24/7.

**Aplica via `sudo pmset`:**
- `autorestart 1` → auto-prende tras corte de luz
- `-c sleep 0` → nunca dormir cuando enchufada
- `-c disksleep 0` → disco siempre activo

Pide la contraseña del usuario. Si ya se corrió, correrlo de nuevo es idempotente.

### `1-Prender.command`
**Uso:** arranque manual cuando no usas LaunchAgents o algo se atoró.

- Verifica si ya está corriendo (no duplica)
- Pregunta si reiniciar todo en caso de duplicado
- Arranca cloudflared + node con `nohup`
- Verifica `/healthz` público y reporta resultado

⚠️ **Con LaunchAgents activos:** este script lanza procesos con `nohup`, no
interactúa con launchd. Si lo corres mientras el LaunchAgent está cargado,
terminas con procesos huérfanos no supervisados. **Con LaunchAgent activo, no
es necesario** salvo emergencias.

### `2-Revisar.command`
**Uso:** diagnóstico — solo informa, no toca nada.

Muestra:
- PIDs de Node + cloudflared (si están corriendo)
- Respuesta de `localhost:3000/healthz`
- Respuesta de `https://lucho101.com/healthz`
- Diagnóstico final con sugerencia de qué hacer

Es seguro correrlo cuantas veces se quiera.

### `3-Apagar.command`
**Uso:** shutdown limpio con confirmación interactiva.

- Pide `s/n` antes de actuar
- Mata Node + cloudflared
- Si no se rinden en 2s, fuerza con `kill -9`

⚠️ **Con LaunchAgents activos:** este script no es suficiente — launchd
relanzará los procesos en ~30 segundos. Para apagar definitivamente:
```bash
launchctl unload ~/Library/LaunchAgents/com.reelance.server.plist
launchctl unload ~/Library/LaunchAgents/com.reelance.tunnel.plist
```

### Permisos y quarantine
Los `.command` requieren permiso de ejecución (`chmod +x`). Si macOS los marca
como "no se puede abrir" tras copiarlos:
```bash
xattr -d com.apple.quarantine ~/Desktop/ReelanceHub/Control/*.command
```

### Acceso rápido desde el escritorio
El alias `~/Desktop/Reelance Hub - Control` apunta a esta carpeta. Si el alias
se borra (iCloud sync, limpieza), recrearlo:
```applescript
osascript <<'EOF'
tell application "Finder"
    set targetFolder to POSIX file "/Users/luismelchor/Desktop/ReelanceHub/Control" as alias
    make new alias to targetFolder at (path to desktop folder)
    set name of result to "Reelance Hub - Control"
end tell
EOF
```

### Historial: la carpeta `scripts/`
Antes de esta reorganización los `.command` vivían en `~/Desktop/ReelanceHub/scripts/`
con nombres en minúsculas. Esa carpeta fue **eliminada** y todos los scripts
quedaron en `Control/` con nombres más legibles (con prefijo numérico de orden de uso).

---

## 24. Procedimiento estándar tras un apagón

Con el setup actual (LaunchAgents + UptimeRobot + scripts manuales) el flujo es:

```
1. Se va la luz → Mac se apaga → todos los procesos mueren
2. UptimeRobot detecta down (en 5-10 min) → 📧 + 📱 Telegram a Luis
3. Vuelve la luz → alguien prende la Mac → login (puede ser auto-login)
4. launchd lee ~/Library/LaunchAgents/ → arranca tunnel + server SOLO
5. UptimeRobot detecta UP → 📧 + 📱 "Reelance Hub is back"
6. iPhone/Mac de Luis: el banner de desconexión que estaba rojo se vuelve verde
   y se quita solo en 4s
```

**Cero intervención manual** — siempre que la Mac llegue a la pantalla de login y
haya internet. Si Luis tiene auto-login de macOS habilitado, ni siquiera necesita
estar físicamente.

### Si algo falla en el paso 4 (LaunchAgent no arranca)

Los logs están en:
- `~/Desktop/ReelanceHub/logs/server.log` y `server-error.log`
- `~/Desktop/ReelanceHub/logs/cloudflared.log` y `cloudflared-error.log`

Diagnóstico paso a paso:
```bash
# ¿Están cargados los plists?
launchctl list | grep com.reelance
# Esperado: dos entradas con PID positivo

# ¿Qué dijo el server al arrancar?
tail -50 ~/Desktop/ReelanceHub/logs/server-error.log

# ¿Qué dijo el tunel?
tail -50 ~/Desktop/ReelanceHub/logs/cloudflared-error.log

# Forzar arranque manual
launchctl kickstart -k gui/$(id -u)/com.reelance.tunnel
launchctl kickstart -k gui/$(id -u)/com.reelance.server
```

---

## 25. Estado actual (snapshot final de la sesión late-abril 2026)

### Lo que está funcionando ✅
- Chat agente↔cliente (handoff widget v1.0.24)
- Logger widget v1.0.3 — captura plantillas HSM enviadas por bots Camino B
- Bot Camino B: envía template → registra → timer → cambia etapa (con workaround manual: mover via API directa cuando el `change_status` falla — ver Sección 18)
- Scroll del chat tipo WhatsApp con fingerprint anti-flicker
- Push notifications PWA
- Preview de imágenes vía `/preview/:filename` con OG tags
- Auth por contraseña, sesiones cookie
- **Watchdog de conexión** del cliente (banner + notif del sistema cuando server no responde)
- **Endpoint `/healthz`** público para monitoreo externo
- **LaunchAgents** que arrancan tunnel+server solos al iniciar la Mac y reinician en crash
- **Scripts `.command`** en escritorio para control manual

### Lo que está pendiente ⏳
1. **Integración WooCommerce** (Sección 20) — esperando 6 decisiones del usuario
2. **Workaround para `change_status` bug** (Sección 18 → opción de mover el widget logger después del timer)
3. **Soporte oficial Kommo** — ticket pendiente sobre Drive API para envío real de media a WhatsApp (amojo_id: `edb9a8e1-51f3-414a-b8f0-c74c6c9b87e6`)
4. **Documentar pipelines de producción** — cuando un bot termina la conversación, qué pipeline/etapa final se usa por canal
5. **UptimeRobot** — el usuario tiene que crear cuenta en https://uptimerobot.com y monitorear `https://lucho101.com/healthz` cada 5 min con email + Telegram (instrucciones en Sección 21)

### Notas operativas para continuar
- **Siempre bumpear versión** del widget al modificar (manual del usuario lo exige)
- **Logger widget = aislado** — cambios ahí no rompen el chat principal
- **Ningún archivo del chat principal cambió en esta sesión** EXCEPTO `public/app.js` (solo `renderMessages` y un helper nuevo `buildMessagesFingerprint`)
- **El bot Camino B** está en pipeline `13641083` ("PRUEBA BORRAR") como pipeline de testing — los bots de producción usan otros pipelines (WHATSAPP, 1-8 MESES, CLIENTES, DISTRIBUIDOR)

---

**FIN DEL MANUAL MAESTRO**
