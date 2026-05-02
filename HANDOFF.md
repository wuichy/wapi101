# Reelance Hub — Documento de Contexto / Handoff

> Documento generado para que otro Claude (u otro asistente/desarrollador) tome contexto del proyecto sin haber visto la conversación previa.

**Última actualización:** 2026-04-29
**Usuario:** Luis Melchor (no programador, perfil de negocio)
**Plataforma:** macOS, ruta del proyecto `/Users/luismelchor/Desktop/ReelanceHub`

---

## 1. ¿Qué es Reelance Hub?

Una **app web tipo inbox** (estilo iMessage / WhatsApp Web) que se conecta a **Kommo CRM** para que un equipo de ventas pueda **leer y responder mensajes de WhatsApp** desde una interfaz dedicada, sin entrar a la UI de Kommo.

- **Frontend:** HTML/CSS/JS vanilla (sin framework). Diseño minimal estilo macOS/iOS.
- **Backend:** Node.js + Express. Almacenamiento en JSON local (`data/app-state.json`).
- **Integración:** Kommo OAuth 2.0 + webhooks + Salesbot/Marketingbot + widget personalizado instalado en Kommo.
- **Canal:** WhatsApp Business (WABA) integración OFICIAL de Kommo (no third-party).

---

## 2. Arquitectura — Cómo fluyen los mensajes

### Flujo entrante (cliente → app)
```
Cliente escribe en WhatsApp
   ↓
Kommo recibe (canal WABA, source_id 23041515)
   ↓
Kommo dispara webhook → POST /webhooks/kommo
   ↓
Server normaliza y guarda en data/app-state.json
   ↓
UI hace polling cada 4s a /api/chats y muestra el mensaje
```

### Flujo saliente desde la app (agente → cliente)
```
Agente escribe en la app y presiona Enviar
   ↓
POST /api/chats/:chatId/messages
   ↓
Server guarda mensaje "local" + queuea pending reply + dispara salesbot
   ↓
Salesbot ejecuta widget block → POST /api/kommo/salesbot/handoff
   ↓
Server consume pendingReply, responde 200 { ok: true }, llama callReturnUrl con { reply_text, has_reply, reply_channel_id }
   ↓
Salesbot continúa con {{json.*}} → handler "show" envía al cliente vía el mismo canal WABA del trigger
   ↓
Mensaje llega a WhatsApp del cliente (UNA sola vez ✅)
```

### ⚠️ Limitación documentada por soporte oficial de Kommo
Los **mensajes salientes** que un agente envía **directamente desde la UI de Kommo** (no desde la app) **NO se pueden capturar** ni vía webhook ni vía API REST cuando el canal es WABA oficial. Esto fue confirmado por Artyom Sinitsyn (soporte Kommo): *"Los métodos de ChatsAPI están diseñados únicamente para integraciones únicas con el servicio de chat... no están disponibles para los canales existentes... no contamos con un método público para webhooks salientes."*

**Implicación práctica:** la política operativa es que **TODOS los agentes responden ÚNICAMENTE desde la app Reelance Hub**, no desde Kommo. De lo contrario, el historial en la app queda incompleto.

---

## 3. Stack y archivos clave

```
ReelanceHub/
├── server.js              (1136 líneas — Express, rutas API/webhooks/handoff)
├── package.json           (express ^5, axios ^1)
├── lib/
│   ├── config.js          (carga .env, exporta config)
│   ├── store.js           (CRUD del estado JSON; tiene dedupe de mensajes locales vs webhook)
│   ├── kommo.js           (OAuth, refresh tokens, apiRequest, launchSalesbot)
│   ├── auth.js            (manejo de sesiones)
│   └── push.js            (web push notifications)
├── public/
│   ├── index.html         (197 líneas — shell de la UI)
│   ├── app.js             (1621 líneas — lógica del frontend)
│   ├── styles.css         (estilo Mac/iOS, ~800+ líneas)
│   └── manifest.json + service-worker.js (PWA — instalable en celular)
├── kommo-widget/          (widget para subir a Kommo como ZIP)
│   ├── manifest.json      (versión actual: 1.0.13)
│   ├── script.js          (define handlers reelance_reply_bridge y reelance_log_outgoing)
│   └── i18n/, images/
├── data/
│   └── app-state.json     (estado persistente — chats, tokens, pendingReplies)
├── render.yaml            (configuración para deploy en Render con disk persistente)
├── .env                   (NO commiteado — credenciales Kommo)
├── .env.example
├── .gitignore
└── SETUP.md               (manual de instalación original)
```

---

## 4. Configuración Kommo actual

### Credenciales (.env)
```
APP_BASE_URL=https://unvalued-headband-persuader.ngrok-free.dev   (en dev — cambiar al deployar)
KOMMO_SUBDOMAIN=ventasreelancemx
KOMMO_CLIENT_ID=e2b93c87-8635-4025-ba8d-3054d7a2c38a
KOMMO_CLIENT_SECRET=yLpa8fZvJV12Fk0z3Oqyw8jq486cOH8ijFW0fy5rGSxbvRFRTrCW36yNmy748mWX
KOMMO_REDIRECT_URI=https://unvalued-headband-persuader.ngrok-free.dev/auth/kommo/callback
KOMMO_SALESBOT_ID=48660
KOMMO_SOURCE_ID=23041515
```

### Cuenta Kommo
- Subdominio: `ventasreelancemx.kommo.com`
- Account ID: `30065876`
- Source WABA: `23041515`
- Salesbot ID: `48660` (tipo `marketingbot`, no `salesbot` clásico)
- Widget ID en Kommo: `1232019`

### JSON actual del Salesbot (después de los fixes)
```json
{
  "0": {
    "question": [{
      "params": {
        "params": { "webhook_url": "https://unvalued-headband-persuader.ngrok-free.dev/api/kommo/salesbot/handoff" },
        "widget_id": "1232019",
        "widget_instance_id": "31b13a86-387c-11f1-9422-00163ecc67dc",
        "widget_source_code": "reelance_reply_bridge"
      },
      "handler": "widget"
    }],
    "block_uuid": "57f5cda5-a7a7-4d75-bbe2-84bd727e19c6"
  },
  "conversation": false
}
```

**IMPORTANTE:** este JSON solo tiene 1 bloque (el widget). Antes tenía un segundo bloque `send_message` con `{{json.reply_text}}` que causaba el envío doble — ya fue eliminado.

---

## 5. Historia de decisiones técnicas importantes

### 5.1 El bug del doble mensaje (resuelto)

**Síntoma:** cuando el agente enviaba un mensaje desde la app, el cliente lo recibía **dos veces** en WhatsApp.

**Causa raíz (que tomó horas diagnosticar):**
1. El `widget_request` del widget personalizado generaba internamente un step `send_external_message` (mensaje #1).
2. El salesbot tenía además un bloque externo `send_message` con `{{json.reply_text}}` (mensaje #2).
3. Ambos fireaban en cadena → 2 mensajes idénticos al cliente.

**Otras hipótesis exploradas (descartadas):**
- ❌ El doble call a `callReturnUrl` desde el handoff (no era — el `{ ok: true }` no dispara continuación)
- ❌ Multi-launch del salesbot (los logs mostraban un solo launch)
- ❌ `way_of_communication: any_first` + `chat_sources` mandando a 2 canales
- ❌ Bot type mismatch (marketingbot vs salesbot endpoint)

**Solución implementada:**
1. Widget v1.0.4: el `onSalesbotDesignerSave` solo genera el `widget_request` + `goto` + condition con `show` (handler nativo Kommo que envía por el mismo canal del trigger). NO usa `send_external_message` (que requiere canal amojo propio).
2. Salesbot: se eliminó el bloque externo `send_message`, dejando solo el bloque del widget.
3. Resultado: UN solo mensaje al cliente.

**Posteriormente** (versión 1.0.13 actual del widget) se agregó un segundo handler `reelance_log_outgoing` que solo registra mensajes en la app sin enviar — para soportar plantillas WhatsApp enviadas desde Kommo.

### 5.2 Dedupe de mensajes locales (en `lib/store.js`)

Cuando el server agrega un mensaje "local" (`id: local-{timestamp}`) al enviar, y luego llega el webhook de confirmación con el ID real de Kommo, se reemplaza el local por el real (no se duplica). Lógica en `addMessageToChat()`:
- Si webhook trae mensaje outgoing con ID que NO empieza con `local-`
- Y existe en el chat un mensaje con `id` que empieza `local-` y mismo `text`
- → reemplaza el local por el del webhook (manteniendo el ID real, marcando `deliveryStatus: 'enviado'`)

### 5.3 Rediseño UI estilo Mac/iOS

Anteriormente el UI tenía colores café/verde con gradientes pesados. Se rediseñó por completo a:
- Background `#f2f2f7` (iOS gris)
- Burbujas estilo iMessage (gris para entrante, azul para saliente)
- Fuentes del sistema (`-apple-system, BlinkMacSystemFont, SF Pro Text`)
- Sin gradientes, sombras sutiles
- Botones redondos con íconos

### 5.4 PWA installable

El frontend ya tiene `manifest.json`, `service-worker.js` y meta tags `apple-mobile-web-app-*` para instalarse desde Safari/Chrome a la pantalla de inicio del celular como una app nativa.

---

## 6. Estado actual del git

- Repo inicializado en `/Users/luismelchor/Desktop/ReelanceHub/.git`
- Branch principal: `main`
- Primer (y único) commit: `Preparar proyecto para deploy en Render`
- `.gitignore` excluye: `.env`, `data/`, `node_modules/`, `*.zip`, `ngrok`, `.DS_Store`, `dist/`
- Tamaño del repo: ~172 KB
- **NO hay remote configurado todavía** — el siguiente paso es push a GitHub

---

## 7. Tareas pendientes / próximos pasos

### Inmediato (en progreso)
1. ⏳ Crear repo en GitHub y hacer push del código
2. ⏳ Crear cuenta en Render
3. ⏳ Deployar en Render plan Starter ($7/mes) con disk persistente para `data/`
4. ⏳ Configurar variables de entorno en Render (las del `.env` actual)
5. ⏳ Actualizar URLs en Kommo: redirect_uri OAuth + webhook URL + webhook URL del salesbot block

### Mediano plazo
- Auto-responder con Claude API (idea explorada pero no implementada): Claude lee mensajes entrantes, propone borrador, agente aprueba o auto-envía.
- Mejorar manejo de adjuntos (actualmente el envío de archivos NO está conectado al salesbot — solo se aceptan en el composer pero no se envían).

### Bugs/limitaciones conocidos
- No se reciben mensajes salientes enviados desde la UI de Kommo (limitación de Kommo, no del código). **Workaround:** política operativa "responder solo desde Reelance Hub".
- El widget v1.0.13 tiene un nuevo handler `reelance_log_outgoing` para soportar registro de plantillas WhatsApp — verificar que su flujo end-to-end esté funcionando.

---

## 8. Comandos útiles para retomar trabajo

```bash
# Iniciar app localmente
cd /Users/luismelchor/Desktop/ReelanceHub
npm start                    # corre en puerto 3000

# Iniciar ngrok (en otra terminal) para que Kommo pueda alcanzar la app
ngrok http --domain=unvalued-headband-persuader.ngrok-free.dev 3000

# Ver el estado de Kommo
curl http://localhost:3000/api/status

# Ver últimos webhooks recibidos
curl http://localhost:3000/api/debug/webhooks | python3 -m json.tool | head -50

# Ver eventos del salesbot
curl http://localhost:3000/api/debug/salesbot | python3 -m json.tool | head -80

# Reiniciar server
lsof -ti:3000 | xargs kill 2>/dev/null; node server.js &
```

---

## 9. Endpoints clave del backend (server.js)

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/status` | estado de conexión Kommo |
| GET | `/api/chats` | lista de chats con sus mensajes |
| POST | `/api/chats/:chatId/messages` | enviar mensaje (lanza salesbot) |
| POST | `/api/chats/:chatId/read` | marcar chat como leído |
| DELETE | `/api/chats/:chatId` | borrar chat local |
| POST | `/webhooks/kommo` | webhook de mensajes entrantes de Kommo |
| POST | `/api/kommo/salesbot/handoff` | endpoint que el widget llama desde el salesbot |
| GET | `/auth/kommo/url` | genera URL OAuth |
| GET | `/auth/kommo/callback` | callback OAuth |
| GET | `/api/debug/webhooks` | últimos 100 webhooks (debug) |
| GET | `/api/debug/salesbot` | últimos 20 eventos del salesbot (debug) |
| GET | `/api/kommo/sources` | lista de canales conectados |

---

## 10. Notas para el próximo asistente

- **El usuario NO programa.** Hay que dar instrucciones paso a paso, sin asumir conocimiento técnico. Mejor "abre Finder y ve a..." que "ejecuta `cd ...`".
- El usuario es paciente pero quiere soluciones simples y prácticas.
- Las decisiones técnicas hay que **explicarlas en lenguaje natural** ("Kommo manda doble porque..."), no en jerga.
- **Idioma del usuario:** español de México (informal, "qué onda", "ándale").
- Las instrucciones de Kommo a veces requieren screenshots porque la UI cambia entre versiones — pedirle screenshots cuando algo no esté claro.
- Hay un patrón: el usuario va a probar algo y reportar "sigue sin funcionar X" — es bueno pedir logs (`/api/debug/*`) ANTES de proponer cambios al código.

---

**FIN DEL DOCUMENTO DE HANDOFF**
