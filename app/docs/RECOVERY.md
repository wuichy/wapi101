# Recovery — acceso al CRM en 5 minutos desde una máquina nueva

> Cheat sheet: 1 página. Si pierdes / te roban un dispositivo, lo primero es entrar a [lucho101.com](https://lucho101.com) → Ajustes → Tokens de máquina → **🔴 Revocar todos**. Después regenera para tu equipo nuevo según el caso que aplique.

## Caso A — Solo navegador (sin Claude)

1. Abre `https://lucho101.com`
2. Login con `username + password` (los que tú sabes — no están en código).
3. Listo: tienes UI completa (chats, contactos, expedientes, integraciones, ajustes).
4. Si estás revocando dispositivos: Ajustes → **Tokens de máquina** → "🔴 Revocar todos los tokens" → confirma.

**No requiere terminal, ni token, ni nada técnico.** Es lo más rápido.

---

## Caso B — Con Claude pero sin MCP (estado actual hoy)

1. Login en `https://lucho101.com` desde el navegador (paso 1-2 del caso A).
2. Ajustes → Tokens de máquina → **+ Generar token** → nombre `mac-nueva-YYYY-MM-DD` → **copia el plaintext** (solo se muestra una vez).
3. Pégalo en una variable de entorno o archivo en la máquina nueva (NO en el chat con Claude):
   ```bash
   echo 'export REELANCE_TOKEN="mt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"' >> ~/.zshrc
   source ~/.zshrc
   ```
4. Comparte solo el nombre de la variable con Claude (`$REELANCE_TOKEN`), no el valor.

### Comandos útiles que Claude puede correr con el token

```bash
# Health check
curl https://lucho101.com/healthz

# Tu propio perfil
curl -H "Authorization: Bearer $REELANCE_TOKEN" https://lucho101.com/api/me

# Listar contactos
curl -H "Authorization: Bearer $REELANCE_TOKEN" "https://lucho101.com/api/contacts?limit=20"

# Buscar contactos por texto
curl -H "Authorization: Bearer $REELANCE_TOKEN" "https://lucho101.com/api/contacts?q=garcia"

# Listar expedientes activos
curl -H "Authorization: Bearer $REELANCE_TOKEN" "https://lucho101.com/api/expedients?status=open"

# Detalle de un expediente
curl -H "Authorization: Bearer $REELANCE_TOKEN" https://lucho101.com/api/expedients/123

# Listar pipelines
curl -H "Authorization: Bearer $REELANCE_TOKEN" https://lucho101.com/api/pipelines

# Stats del dashboard
curl -H "Authorization: Bearer $REELANCE_TOKEN" https://lucho101.com/api/stats

# Conversaciones recientes
curl -H "Authorization: Bearer $REELANCE_TOKEN" "https://lucho101.com/api/conversations?limit=10"

# Mensajes de una conversación
curl -H "Authorization: Bearer $REELANCE_TOKEN" https://lucho101.com/api/conversations/45/messages

# Listar tokens (solo admins via cookie de sesión, no machine tokens)
curl -H "Authorization: Bearer $REELANCE_TOKEN" https://lucho101.com/api/machine-tokens
# ↑ devolverá 403: los machine tokens NO pueden gestionar tokens. Es by design.
# Para gestionar tokens entra al navegador (caso A).
```

### Si una llamada devuelve 401
Tu token fue revocado o nunca fue válido. Vuelve al paso 2 del caso A para generar uno nuevo desde el navegador.

---

## Caso C — Con Claude + MCP (cuando exista en fase 2)

> Pendiente de implementar. Cuando esté listo:

1. Login en `https://lucho101.com` → Ajustes → Tokens de máquina → genera token.
2. En la Mac nueva, edita `~/.config/claude-code/mcp.json` (o el archivo de configuración MCP de Claude Code):
   ```json
   {
     "mcpServers": {
       "reelance": {
         "command": "npx",
         "args": ["-y", "@reelance/mcp-server"],
         "env": {
           "REELANCE_TOKEN": "mt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
           "REELANCE_BASE_URL": "https://lucho101.com"
         }
       }
     }
   }
   ```
3. Reinicia Claude Code. Verifica con `/mcp` o equivalente que `reelance` aparece como conectado.
4. Claude ya tiene tools nativas: `reelance__list_contacts`, `reelance__get_expedient`, `reelance__send_message`, etc.

---

## Si te roban un dispositivo (orden de operaciones)

1. **Browser → Ajustes → Tokens de máquina → 🔴 Revocar todos.** (5 segundos)
2. Cambia tu password de admin (Ajustes → Asesores → tu usuario → editar).
3. Genera un token nuevo SOLO para tu máquina nueva (caso B paso 2).
4. Verifica el log de últimos usos en la tabla de tokens — si ves IPs raras, ya están bloqueadas porque revocaste todo.

## Notas

- El plaintext del token se muestra **una sola vez** al crearlo. Si lo pierdes, revócalo y crea otro.
- Los tokens empiezan con `mt_` y miden 35 caracteres.
- En la tabla solo verás el **prefijo** (`mt_xxxxx…`) — suficiente para identificarlo, no para suplantarlo.
- Cualquier 401 indica token revocado o inválido — no es un bug, es la kill switch funcionando.
- Los machine tokens **no** pueden gestionar otros machine tokens (anti-escalada). Para revocar/crear, usa el navegador con tu password.
