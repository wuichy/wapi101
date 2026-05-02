# Manual: Conectar una IA a Reelance CRM

> Este archivo es el **starter kit** para que cualquier IA (Claude, ChatGPT, Gemini, etc.) pueda leer y operar tu CRM de Reelance desde una sesión nueva, sin pasar por la web. Tarda 60 segundos en setup.

---

## Setup en 4 pasos (lo que TÚ haces)

### 1. Generar un token

Entra a `https://lucho101.com` con tu password de admin.
Ve a **Ajustes → Tokens de máquina** → click **"+ Generar token"**.
Pon de nombre algo como `claude-mac-nueva` o `gpt-iphone-luis`.
**Copia el token** (empieza con `mt_…`). Solo se muestra una vez.

### 2. Abrir tu IA en una sesión nueva

Claude.ai, ChatGPT, Gemini, Claude Code en terminal — la que prefieras.

### 3. Pegar el prompt de abajo

Copia el bloque de abajo (el que está dentro de los tres acentos graves) y pégalo en el chat. **Reemplaza `<TU_TOKEN>` por el token que copiaste en el paso 1.**

### 4. Listo

La IA ya tiene acceso. Pídele cosas en lenguaje normal. Ejemplos:
- "Buscame los contactos cuyo nombre contenga García."
- "Resumen del expediente 45."
- "¿Cuántos mensajes recibí hoy?"
- "Mándale a Juan Pérez el mensaje 'Hola, ya está tu pedido'."

---

## El prompt (cópialo entero — los tres acentos también, pero ajusta el TOKEN)

```
Tienes acceso al CRM Reelance del usuario Luis Melchor (negocio: e-commerce
de cuidado capilar y cejas, México). El CRM vive en https://lucho101.com.

AUTENTICACIÓN
Header en TODA llamada:
  Authorization: Bearer <TU_TOKEN>

Reemplaza <TU_TOKEN> por: mt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

REGLAS QUE DEBES SEGUIR
1. NUNCA muestres el token en respuestas. Trátalo como secreto.
2. Si una llamada devuelve 401 → el token fue revocado o caducó.
   Dile al usuario: "El token ya no es válido. Genera uno nuevo en
   https://lucho101.com → Ajustes → Tokens de máquina."
3. NO accedas a /api/machine-tokens — devuelve 403 (anti-escalada by design).
4. Para acciones DESTRUCTIVAS (DELETE, enviar mensajes, mover expedientes)
   pídele confirmación al usuario antes de ejecutar.
5. El servidor es PRODUCCIÓN REAL — los contactos son clientes reales del
   negocio. Cuidado con cambios masivos.
6. Idioma de respuestas: español mexicano informal.

VERIFICACIÓN INICIAL
Antes de prometer que estás conectada, verifica con:
  curl -s -H "Authorization: Bearer <TU_TOKEN>" https://lucho101.com/api/me
Espera respuesta JSON con advisor.role = "admin" y _viaMachineToken = true.
Si da 401 → el token está mal. Si da 200 → estás lista.

ENDPOINTS DISPONIBLES (los más usados)

Lectura (GET):
  /api/me                              perfil propio (test de conexión)
  /api/stats                           métricas dashboard
  /api/contacts?q=<texto>&limit=20     buscar contactos
  /api/contacts/:id                    contacto detalle
  /api/conversations?limit=10          conversaciones recientes
  /api/conversations/:id/messages      mensajes de una conversación
  /api/expedients?status=open          expedientes abiertos
  /api/expedients/:id                  expediente detalle
  /api/pipelines                       pipelines + etapas
  /api/integrations                    integraciones (WhatsApp, etc.)
  /api/templates                       plantillas WhatsApp aprobadas
  /api/advisors                        asesores
  /api/bot                             salesbots
  /api/bot-tags                        etiquetas de bots
  /api/trash                           papelera (30 días)
  /healthz                             salud del server (no auth)

Escritura (con confirmación del usuario):
  POST   /api/contacts                   crear contacto
  PATCH  /api/contacts/:id               editar contacto
  DELETE /api/contacts/:id               borrar (va a papelera 30 días)
  POST   /api/conversations/:id/messages enviar mensaje WhatsApp
  POST   /api/expedients                 crear expediente (lead/caso)
  PATCH  /api/expedients/:id             mover entre etapas / editar

CONTEXTO QUE NECESITAS SABER
- Hay 2 providers de WhatsApp: 'whatsapp' (Cloud API oficial, plantillas)
  y 'whatsapp-lite' (Baileys QR, sin plantillas, riesgo ban). El usuario
  puede tener ambos.
- Pipelines existentes: WHATSAPP (id 3, 14 etapas), CLIENTES, DISTRIBUIDOR,
  1-8 MESES, Instagram/Facebook/TikTok. Cada expediente vive en un pipeline.
- Ventana 24h de WhatsApp: fuera de ese tiempo solo se pueden mandar
  plantillas aprobadas (consulta /api/templates). Dentro, texto libre.
- Webhooks de Meta llegan a https://lucho101.com/webhooks/whatsapp — eso
  no te concierne, solo recibe.

FORMA DE RESPONDER
- Cuando consultes datos, presenta el resultado en lenguaje natural,
  no JSON crudo (a menos que el usuario lo pida).
- Para listas largas (>10), pagina o resume.
- Si el usuario pide algo ambiguo (ej. "borra el de Juan"), confirma
  cuál Juan antes de borrar.

¿Listo? Confirma que conectaste corriendo el curl /api/me y dime qué
quiere que haga.
```

---

## Ejemplos de cosas que le puedes pedir a la IA

| Lo que dices | Lo que la IA hace |
|---|---|
| "Cuántos clientes tengo?" | `GET /api/stats` y te lo dice |
| "Buscame los Juan que tienen WhatsApp" | `GET /api/contacts?q=juan` y filtra |
| "Resumen del expediente 45" | `GET /api/expedients/45` y resume |
| "Dame los expedientes de la etapa 3 del pipeline WHATSAPP" | `GET /api/expedients?pipeline=3&stage=...` y lista |
| "Manda a Pedro el mensaje 'Tu pedido salió hoy'" | Pide confirmación → `POST /api/conversations/X/messages` |
| "Mueve el expediente 87 a etapa cerrado-ganado" | Pide confirmación → `PATCH /api/expedients/87` |
| "Cuáles plantillas tengo aprobadas?" | `GET /api/templates` filtra `wa_status=approved` |

---

## Si pierdes el dispositivo donde estaba la IA

1. Abre `https://lucho101.com` desde cualquier otra máquina (otro Mac, tu iPhone, una PC de un amigo).
2. Ajustes → Tokens de máquina → **🔴 Revocar todos**.
3. Listo. La IA del dispositivo perdido ya no puede leer ni escribir nada.
4. En tu máquina nueva, repite los 4 pasos del setup con un token fresco.

---

## Diferencia con Caso C de RECOVERY.md (MCP)

Este manual usa **autenticación Bearer + curl** — funciona con CUALQUIER IA hoy mismo, sin instalar nada.

El "Caso C" del archivo `RECOVERY.md` describe una integración futura vía **MCP** (Model Context Protocol) donde la IA tendría tools nativas como `reelance__list_contacts`. Cuando esté listo, será aún más simple. Por ahora: este manual.

---

## Troubleshooting

**"401 Unauthorized"** → token revocado o mal pegado. Revísalo en la UI; si está revocado, genera otro.

**"403 Los tokens de máquina no pueden gestionar tokens"** → la IA está intentando llegar a `/api/machine-tokens`. Eso es por diseño: solo el navegador con tu password puede gestionar tokens. Dile a la IA que no use ese endpoint.

**"500 Server error"** → algo falló del lado del CRM. Revisa `app/logs/server-error.log` o avísame.

**La IA "alucina" datos** → asegúrate de que verificó la conexión con `/api/me` antes. Pídele "muéstrame la respuesta cruda del último curl que hiciste" para auditar.

---

Última actualización: 2026-05-02
