# Manual: Conectar una IA a Reelance CRM

> Este archivo es el **starter kit** para que cualquier IA (Claude, ChatGPT, Gemini, etc.) pueda leer y operar tu CRM de Reelance desde una sesión nueva, sin pasar por la web. Tarda 60 segundos en setup.

---

## ¿Qué quieres hacer? Dos caminos

Hay **dos cosas distintas** que puedes hacer, y necesitan setup distinto. Identifica la tuya antes de seguir:

### Camino A — Operar datos del CRM (lo más común)
"Buscame contactos", "manda este mensaje", "muéveme expedientes", "dame stats".
- **Setup:** solo necesitas un token de máquina. **60 segundos.**
- **Sigue:** secciones 1–4 ("Setup en 4 pasos") + "El prompt".
- **Cambios son INSTANTÁNEOS** en `lucho101.com`. No requiere deploy.

### Camino B — Cambiar código del CRM (UI, features, bugs)
"Agrega un botón X", "cambia el color de Y", "arregla el bug Z".
- **Setup:** token + acceso a GitHub + login admin en navegador. **15-20 minutos la primera vez** en una compu nueva.
- **Sigue:** primero Camino A, después salta a "Lo que el token NO te da: cambios de código" abajo.
- **Cambios requieren `git push` + click manual al botón Deploy** en `lucho101.com`.

---

## CAMINO A — Setup en 4 pasos (lo que TÚ haces)

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

## CAMINO B — Cambios de código (lo que el token NO te da)

El token de máquina sirve para mover **datos** (contactos, mensajes, expedientes). **No** sirve para cambiar el código del CRM (UI, features, bugs). Son tres capas distintas:

| Capa | Qué hace | Qué necesitas |
|---|---|---|
| **Token de máquina** (`mt_…`) | La IA lee/escribe datos del CRM por API | Generarlo en Ajustes → Tokens de máquina |
| **GitHub access** | La IA edita código y hace `git push` | SSH key tuya autorizada en GitHub |
| **Login admin en navegador** | Tú aprietas el botón Deploy | Tu password de admin |

### Flujo "compu nueva, quiero cambios de código"

**Paso 1 — Token (cambios de datos)**
Generas token en Ajustes → la IA puede leer/escribir datos del CRM. Si solo vas a pedirle cosas como "manda este mensaje" o "buscame contactos", aquí terminas.

**Paso 2 — Setup de GitHub (solo si vas a editar código)**

Pídele esto a la IA en la compu nueva (Claude Code es lo más fácil):

```
Necesito setup de git para clonar el repo wuichy/reelance-woocommerre-github
de GitHub. Hazlo así:

1. Genera una llave SSH ed25519 nueva con email luis@reelance.mx (o el que use Luis):
     ssh-keygen -t ed25519 -C "luis@reelance.mx" -f ~/.ssh/id_ed25519 -N ""
   Si ya existe ~/.ssh/id_ed25519, NO la sobrescribas — úsala.

2. Muéstrame la llave pública para que la copie:
     cat ~/.ssh/id_ed25519.pub

3. Espera a que Luis la autorice en https://github.com/settings/keys
   (él hace click en "New SSH key", pega la llave, le pone nombre tipo
   "MacBook nueva 2026" y guarda).

4. Cuando me confirme, prueba la conexión:
     ssh -T git@github.com
   Debe responder "Hi wuichy! You've successfully authenticated…"

5. Clona el repo en /Users/<usuario>/dev/:
     mkdir -p ~/dev && cd ~/dev
     git clone git@github.com:wuichy/reelance-woocommerre-github.git
     cd reelance-woocommerre-github
     git remote -v   # confirma que apunta a GitHub
```

**Paso 3 — La IA edita código y hace push**
Una vez clonado, le pides cambios normalmente ("agrega un botón X", "arregla el bug Y") y la IA hace `git add`, `git commit`, `git push origin main`.

**Paso 4 — Tú aprietas Deploy**
- Abres `lucho101.com` en navegador, login con password admin
- Ajustes → Tokens de máquina → arriba aparece la card **"Despliegue de versión"**
- Click en **🚀 Desplegar última versión** → el server hace `git pull` + reinicio solo (~3s)

**El botón Deploy bloquea explícitamente machine tokens** (anti-escalada). Solo funciona con sesión de navegador autenticada con password — para que ninguna IA pueda autodeployarse cambios sin que tú apruebes.

### Cambios de DATOS vs cambios de CÓDIGO

| Lo que pides | Tipo | Necesita deploy |
|---|---|---|
| "Cambia el nombre del contacto X a Y" | datos | ❌ No, instantáneo |
| "Mándale a todos los de la etapa 3 el mensaje X" | datos | ❌ No, instantáneo |
| "Agrega una columna nueva en la tabla de bots" | código | ✅ Sí, push + Deploy |
| "Cambia el color del botón X a azul" | código | ✅ Sí, push + Deploy |
| "Borra al contacto Juan Pérez" | datos | ❌ No, instantáneo |
| "Crea un endpoint nuevo /api/X" | código | ✅ Sí, push + Deploy |

### Resumen visual del flujo end-to-end

```
┌─────────────────────────────────────────────────────────────┐
│  UNA VEZ POR COMPU NUEVA                                    │
├─────────────────────────────────────────────────────────────┤
│  1. Generas token en lucho101.com → Ajustes → Tokens        │
│  2. Pegas el "El prompt" en tu IA con el token              │
│  3. (Solo si vas a editar código) Setup git+SSH:            │
│     - ssh-keygen → autorizas en github.com/settings/keys    │
│     - git clone del repo                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  CADA VEZ QUE QUIERES UN CAMBIO DE DATOS                    │
├─────────────────────────────────────────────────────────────┤
│  1. Le dices a la IA en lenguaje natural lo que quieres     │
│  2. La IA llama el API y listo — instantáneo                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  CADA VEZ QUE QUIERES UN CAMBIO DE CÓDIGO                   │
├─────────────────────────────────────────────────────────────┤
│  1. Le dices a la IA: "haz X cambio"                        │
│  2. IA edita archivos + git commit + git push origin main   │
│  3. Tú abres lucho101.com → Ajustes → Tokens de máquina     │
│  4. Click en 🚀 Desplegar última versión                    │
│  5. Esperas ~5 segundos, la página se recarga sola          │
└─────────────────────────────────────────────────────────────┘
```

---

## Diferencia con Caso C de RECOVERY.md (MCP)

Este manual usa **autenticación Bearer + curl** — funciona con CUALQUIER IA hoy mismo, sin instalar nada.

El "Caso C" del archivo `RECOVERY.md` describe una integración futura vía **MCP** (Model Context Protocol) donde la IA tendría tools nativas como `reelance__list_contacts`. Cuando esté listo, será aún más simple. Por ahora: este manual.

---

## Troubleshooting

**"401 Unauthorized"** → token revocado o mal pegado. Revísalo en la UI; si está revocado, genera otro.

**"403 Los tokens de máquina no pueden gestionar tokens"** → la IA está intentando llegar a `/api/machine-tokens`. Eso es por diseño: solo el navegador con tu password puede gestionar tokens. Dile a la IA que no use ese endpoint.

**"403 Los tokens de máquina no pueden ejecutar deploys"** → la IA está intentando llegar a `/api/admin/deploy`. Eso también es por diseño: el botón de deploy solo funciona desde el navegador con tu password admin. Dile a la IA que no use ese endpoint y que tú das el click cuando estés listo.

**"500 Server error"** → algo falló del lado del CRM. Revisa `app/logs/server-error.log` o avísame.

**La IA "alucina" datos** → asegúrate de que verificó la conexión con `/api/me` antes. Pídele "muéstrame la respuesta cruda del último curl que hiciste" para auditar.

---

Última actualización: 2026-05-02 — manual reorganizado en Camino A (datos) y Camino B (código), con resumen visual end-to-end y pasos concretos para setup de GitHub en compu nueva.
