# Reelance Hub — Manual de Integración Kommo + WhatsApp

## Cómo funciona el flujo completo

```
Cliente escribe en WhatsApp
        ↓
   Kommo lo recibe
        ↓
   Kommo dispara webhook → /webhooks/kommo (tu app)
        ↓
   App guarda el mensaje y lo muestra en la UI
        ↓
   Tú escribes respuesta en la app y presionas Enviar
        ↓
   App guarda el texto como "pending reply"
   App llama POST /api/v2/salesbot/run en Kommo
        ↓
   Kommo ejecuta el Salesbot
   Salesbot llama tu endpoint → /api/kommo/salesbot/handoff (widget_request)
        ↓
   Tu app responde 200 { ok: true } inmediatamente
   Tu app hace POST al return_url de Kommo con { data: { reply_text, has_reply, reply_channel_id } }
        ↓
   Kommo continúa el Salesbot con {{json.reply_text}}
   Salesbot ejecuta send_external_message → WhatsApp
        ↓
   Mensaje llega al cliente
```

---

## 1. Variables de entorno (.env)

Crea un archivo `.env` en la raíz del proyecto con estas variables:

```env
# URL pública de tu app (ngrok en desarrollo, tu dominio en producción)
APP_BASE_URL=https://TU-NGROK-URL.ngrok-free.app

# Kommo OAuth
KOMMO_SUBDOMAIN=tu-subdominio          # ej: miempresa (de miempresa.kommo.com)
KOMMO_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
KOMMO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
KOMMO_REDIRECT_URI=https://TU-NGROK-URL.ngrok-free.app/auth/kommo/callback

# ID del Salesbot que creaste en Kommo (ver sección 4)
KOMMO_SALESBOT_ID=123456

# ID de la fuente/canal de WhatsApp en Kommo (ver sección 5)
KOMMO_SOURCE_ID=654321
```

> Cada vez que cambies la URL de ngrok debes actualizar APP_BASE_URL, KOMMO_REDIRECT_URI y la URL del webhook en Kommo.

---

## 2. Correr ngrok

### Instalación (una sola vez)
```bash
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken TU_AUTHTOKEN   # obtén el token en dashboard.ngrok.com
```

### Iniciar ngrok (cada vez que desarrolles)
```bash
# En una terminal separada, deja esto corriendo
ngrok http 3000
```

Ngrok te mostrará algo así:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3000
```

Copia esa URL `https://abc123.ngrok-free.app` — la necesitas en todos lados.

### URL estática (opcional pero recomendado)
```bash
# Para no cambiar la URL cada vez, reserva un dominio fijo en ngrok.com → Domains
ngrok http --domain=mi-app-fija.ngrok-free.app 3000
```

---

## 3. Correr la app

```bash
# En otra terminal
npm start
```

Abre en tu navegador: `https://TU-NGROK-URL.ngrok-free.app`

---

## 4. Registrar la integración en Kommo (OAuth)

1. Ve a **Kommo → Configuración → Integraciones → Crear integración**
2. Tipo: **Aplicación privada**
3. Llena:
   - **Redirect URI**: `https://TU-NGROK-URL.ngrok-free.app/auth/kommo/callback`
4. Guarda — Kommo te dará `Client ID` y `Client Secret` → ponlos en `.env`
5. En la UI de tu app, haz clic en **Conectar a Kommo** y autoriza

---

## 5. Encontrar el KOMMO_SOURCE_ID (canal de WhatsApp)

1. Con la app conectada, abre en tu navegador:
   ```
   https://TU-NGROK-URL.ngrok-free.app/api/kommo/sources
   ```
2. Verás un JSON con todas las fuentes. Busca la que tenga `type: "waba"` o `type: "whatsapp"`:
   ```json
   { "id": 654321, "name": "WhatsApp Business", "type": "waba" }
   ```
3. Ese `id` es tu `KOMMO_SOURCE_ID` → ponlo en `.env` y reinicia la app

---

## 6. Instalar el widget en Kommo

El widget es la pieza que conecta el Salesbot con tu app.

1. En Kommo ve a **Configuración → Integraciones → Mi widget (privado)**
2. Si no lo tienes creado, crea uno privado y sube la carpeta `kommo-widget/` como ZIP
3. En la configuración del widget ingresa la **Webhook URL**:
   ```
   https://TU-NGROK-URL.ngrok-free.app/api/kommo/salesbot/handoff
   ```
4. Instala el widget en la cuenta

---

## 7. Crear el Salesbot en Kommo

1. Ve a **Kommo → Chats → Salesbot**
2. Crea un nuevo bot
3. Agrega el bloque **Reelance Hub** (tu widget) al flujo
4. Cuando te pida la Webhook URL, ingresa:
   ```
   https://TU-NGROK-URL.ngrok-free.app/api/kommo/salesbot/handoff
   ```
5. Guarda y activa el Salesbot
6. Anota el ID del Salesbot — lo ves en la URL al editarlo:
   ```
   .../salesbot/XXXXXXX/edit   ← ese número es el KOMMO_SALESBOT_ID
   ```
7. Ponlo en `.env` → `KOMMO_SALESBOT_ID=XXXXXXX`

---

## 8. Configurar el webhook de Kommo para mensajes entrantes y salientes

Para que los mensajes lleguen a tu app, Kommo debe avisarte via webhook.

1. Ve a **Kommo → Configuración → Webhooks**
2. Agrega la URL:
   ```
   https://TU-NGROK-URL.ngrok-free.app/webhooks/kommo
   ```
3. Activa estos eventos:
   - ✅ **Nuevo mensaje entrante** (mensaje del cliente)
   - ✅ **Nuevo mensaje saliente** (mensaje enviado desde Kommo — para que también aparezcan en tu app)
   - ✅ **Nuevo chat / conversación**
4. Guarda

---

## 9. Verificar que todo funciona

### Paso 1 — Verifica la conexión OAuth
Abre `https://TU-NGROK-URL.ngrok-free.app/api/status`
Debe mostrar `"connected": true`.

### Paso 2 — Verifica que llegan webhooks
Pide a alguien que te mande un WhatsApp. Luego abre:
```
https://TU-NGROK-URL.ngrok-free.app/api/debug/webhooks
```
Debe aparecer el webhook de Kommo con los datos del mensaje.

### Paso 3 — Verifica que el mensaje aparece en la app
El mensaje debe verse en la UI bajo esa conversación.

### Paso 4 — Envía una respuesta
Escribe algo en la app y presiona Enviar. Luego abre:
```
https://TU-NGROK-URL.ngrok-free.app/api/debug/salesbot
```
Busca en los eventos (de más nuevo a más viejo):
- `launch_attempt` → el bot se intentó lanzar
- `launch_success` → Kommo aceptó la petición
- `handoff_request` → el Salesbot llamó tu endpoint
- `handoff_response_prepared` → tu app preparó la respuesta
- `handoff_complete` → el POST al return_url fue exitoso ✅

Si ves `handoff_return_url_error`, el problema es que el `return_url` no es alcanzable desde Kommo. Verifica que ngrok esté corriendo.

### Paso 5 — Verifica que llegó al cliente
El mensaje debe aparecer en el WhatsApp del cliente y en Kommo como enviado.

---

## 10. Mensajes enviados desde Kommo que no aparecen en la app

Si un agente responde desde la interfaz de Kommo (no desde tu app), el mensaje aparecerá en tu app **solo si**:

1. Tienes activo el evento **Nuevo mensaje saliente** en los webhooks de Kommo (paso 8)
2. El webhook llega a tu app — puedes verificarlo en `/api/debug/webhooks`

La app detecta automáticamente mensajes salientes cuando el `sender.type` es `employee`, `bot`, `operator`, o `amojo`.

---

## 11. Solución de problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| `"connected": false` en `/api/status` | Reconecta OAuth desde la UI, o verifica `KOMMO_CLIENT_ID` y `KOMMO_CLIENT_SECRET` |
| Mensajes entrantes no aparecen | Verifica webhook en Kommo (paso 8) y que ngrok esté corriendo |
| Envías pero no llega al cliente | Revisa `/api/debug/salesbot` — busca `handoff_return_url_error` o `launch_error` |
| `reply_channel_id` vacío en debug | `KOMMO_SOURCE_ID` no está configurado (paso 5) |
| `launch_error` con HTTP 404 | `KOMMO_SALESBOT_ID` incorrecto |
| ngrok dice "session expired" | Reinicia ngrok y actualiza la URL en `.env` y en Kommo webhooks |
| El bot se lanza pero `handoff_request` no aparece | El Salesbot no está configurado con tu widget, o la webhook URL en el bot es incorrecta |

---

## 12. Cambiar la URL de ngrok (cuando reinicia)

Cada vez que reinicies ngrok sin dominio fijo, debes:

1. Copiar la nueva URL de ngrok
2. Actualizar `.env`:
   - `APP_BASE_URL`
   - `KOMMO_REDIRECT_URI`
3. En Kommo → Webhooks: actualizar la URL
4. En Kommo → Salesbot: actualizar la webhook URL del bloque Reelance Hub
5. Reiniciar la app: `npm start`

Por eso se recomienda un dominio fijo de ngrok (paso 2, sección URL estática).
