# Setup Reelance CRM en MacBook Pro (segunda máquina, dev)

> **Quién**: Luis Melchor para uso desde su MacBook Pro, mientras el iMac sigue siendo el server (lucho101.com).
>
> **Para qué**: poder editar el código, probar cambios localmente, conectar con Kommo y Meta para desarrollo, sin afectar el server. Los cambios validados se pushean → el server los pulea → reinicia.

Este documento asume que tu MacBook Pro tiene:
- macOS reciente
- Acceso al GitHub `wuichy/reelance-woocommerre-github`
- Claude Code (o similar) instalado

---

## 1. Pre-requisitos

### Node.js
```bash
# Si no tienes Node, instala Node 20 LTS via nvm o Homebrew:
brew install node@20
# Verifica:
node -v   # debe decir v20.x
npm -v    # debe decir 10.x
```

### Git + SSH key
1. Genera SSH key (si no tienes):
   ```bash
   ssh-keygen -t ed25519 -C "luis@reelance-macbook-pro" -f ~/.ssh/id_ed25519 -N ""
   cat ~/.ssh/id_ed25519.pub
   ```
2. Copia la output y agrégala en https://github.com/settings/ssh/new (con title "MacBook Pro")
3. Configura git user:
   ```bash
   git config --global user.name "Luis Melchor"
   git config --global user.email "luis@lucho101.com"
   ```

### sqlite3 CLI
```bash
brew install sqlite3
```

---

## 2. Clonar el repo

```bash
mkdir -p ~/dev
cd ~/dev
git clone git@github.com:wuichy/reelance-woocommerre-github.git
cd reelance-woocommerre-github
```

> **Importante**: NO clones a `~/Desktop/` — iCloud Drive sincronizaría todo el repo y puede causar conflictos. Usa `~/dev/` o `~/Code/` o cualquier dir fuera del Desktop/Documents.

---

## 3. Setup del CRM (carpeta `app/`)

```bash
cd app
cp .env.example .env
npm install
```

### Edita `.env` con secrets

Algunos secrets los puedes generar/copiar de la siguiente forma:

```env
# Server (puede ser distinto al server: usa otro puerto pa' no chocar)
NODE_ENV=development
PORT=3002                              # ← distinto de 3001 del server
HOST=127.0.0.1
APP_BASE_URL=http://localhost:3002    # ← solo local

# Auth
ADMIN_PASSWORD=loquesea
SESSION_SECRET=lo-que-quieras-32-chars

# DB local (separada del server)
DB_PATH=./data/reelance.sqlite
UPLOADS_DIR=./data/uploads

# Cifrado de credenciales (CRÍTICO: igual al del server si quieres usar la misma DB)
ENCRYPTION_KEY=                        # genera con: openssl rand -hex 32
                                       # OR: pega el del server (ver §4 abajo)
```

Para los secrets de Meta/Kommo:
- Mira §4 abajo para opciones de cómo conseguirlos.

### Arrancar
```bash
npm start
# Abre http://localhost:3002 — debe verse el login
```

> Si no quieres recibir webhooks reales en local (lo cual lo común), no expongas con cloudflared. Solo testea cambios al código + UI.

---

## 4. Compartir secrets entre Mac server y MacBook Pro

Tienes 3 estrategias. Elige la que te quede más cómoda:

### Estrategia A — AirDrop manual (simple, secure)
1. En el iMac (server): abre Finder → ve a `~/Desktop/ReelanceHub/app/`
2. Selecciona `.env` → AirDrop → MacBook Pro
3. En el MacBook Pro: lo recibes en Downloads → muévelo a `~/dev/reelance-woocommerre-github/app/.env`
4. Si quieres también Kommo: AirDrop también `/Users/luismelchor/Desktop/ReelanceHub/data/app-state.json` (es donde están los OAuth tokens del Hub viejo) → guárdalo en el mismo path en MacBook Pro.

**Cuándo**: cuando regeneres tokens / cambies secrets, repites el AirDrop.

### Estrategia B — 1Password / iCloud Keychain
1. En 1Password: crea una entry "Reelance CRM .env" y pega el contenido completo del `.env`
2. Sincroniza en ambas Macs (1Password lo hace solo)
3. Cuando edites en una, actualiza en la otra

**Cuándo**: si ya usas 1Password, esto es lo más cómodo.

### Estrategia C — DB compartida via SSH tunnel (avanzado)
Si quieres usar la MISMA DB que el server (no una copia local):
- Tailscale + SSH tunneling permitiría montar la DB del server en MacBook Pro
- Pero NO recomendable: la DB del server tiene WAL activo, lecturas externas pueden corromper o dar errores
- Para dev, mejor usa una DB local independiente y testea cambios de código contra ella

**Cuándo**: nunca — usa A o B.

---

## 5. Workflow de desarrollo

### Cambio típico

**En MacBook Pro**:
```bash
cd ~/dev/reelance-woocommerre-github
git pull origin main                  # asegúrate de estar al día
# Editas código en VS Code / Cursor / etc.
cd app && npm start                    # pruebas en local
# Cuando esté bien:
git add app/...
git commit -m "fix: lo que cambiaste"
git push origin main
```

**En iMac (server)**:
```bash
cd /Users/luismelchor/Desktop/ReelanceHub
git pull origin main
cd app && npm install                  # solo si cambió package.json
# Reinicia el server:
launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist
launchctl load ~/Library/LaunchAgents/com.reelance.app.plist
# Verifica:
curl https://lucho101.com/healthz
```

### Atajo: deploy automático en el server

Para que el iMac se actualice solo después de un push, podemos crear un **deploy script** que el iMac corra cada minuto:

```bash
# En el iMac:
cat > ~/.reelance/deploy.sh <<'BASH'
#!/bin/bash
cd /Users/luismelchor/Desktop/ReelanceHub
LOCAL=$(git rev-parse @)
REMOTE=$(git ls-remote origin main | cut -f1)
if [ "$LOCAL" != "$REMOTE" ]; then
  git pull origin main >> ~/.reelance/deploy.log 2>&1
  cd app && npm install --prefer-offline --no-audit >> ~/.reelance/deploy.log 2>&1
  launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist
  launchctl load ~/Library/LaunchAgents/com.reelance.app.plist
  echo "[$(date)] deployed $REMOTE" >> ~/.reelance/deploy.log
fi
BASH
chmod +x ~/.reelance/deploy.sh
```

Y un LaunchAgent que lo corra cada 60s. (Opcional — pídeme que lo arme cuando quieras.)

---

## 6. Acceso a Kommo desde MacBook Pro

Si quieres correr scripts que toquen Kommo desde tu MacBook Pro (ej: re-correr la migración, inspeccionar leads, etc.):

1. **Copia el `app-state.json` del Hub viejo** (vía AirDrop):
   - En iMac: `/Users/luismelchor/Desktop/ReelanceHub/data/app-state.json`
   - En MacBook Pro: ponlo en el mismo path relativo (`data/app-state.json` dentro del repo clonado, NO en `app/data/`)

2. Los scripts de Kommo (como `app/scripts/migrate-kommo-pipelines.js`) leen el token de ese archivo.

3. **Importante**: ese archivo NO está en git (gitignored). Cada vez que se refresque el OAuth (Kommo invalida tokens cada 90 días), tienes que sincronizar otra vez.

### Opcional: re-OAuth desde MacBook Pro
Si los tokens caducaron, puedes reauthorizar Kommo desde MacBook Pro:
1. Configura `KOMMO_REDIRECT_URI=http://localhost:3002/auth/kommo/callback` en `.env` local
2. Levanta el Hub viejo en local: `cd ../ && node server.js`
3. Ve a http://localhost:3002 → "Conectar Kommo"
4. El nuevo `app-state.json` queda en el MacBook Pro
5. AirDrop al iMac para que el server también tenga el token fresco

---

## 7. Acceso a Meta WhatsApp desde MacBook Pro

Tu MacBook Pro NO necesita conectarse al webhook de Meta — el server (iMac) es el único que recibe webhooks vía cloudflared en `lucho101.com`.

Pero si quieres mandar mensajes de prueba via API de Meta (sin pasar por el CRM), puedes:
1. Copiar el access token del .env del server
2. Curl desde MacBook Pro:
   ```bash
   curl -X POST "https://graph.facebook.com/v22.0/912165015315274/messages" \
     -H "Authorization: Bearer $ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"messaging_product":"whatsapp","to":"5213349657193","type":"text","text":{"body":"hola desde MacBook Pro"}}'
   ```

---

## 8. Claude en MacBook Pro

Cuando abras este proyecto con Claude Code (o similar) en el MacBook Pro:

1. La carpeta `app/docs/` tiene **todo el contexto** que esta Claude (la del iMac) usó:
   - [MANUAL_MAESTRO.md](MANUAL_MAESTRO.md) — contrato vivo del proyecto
   - [LECCIONES_APRENDIDAS.md](LECCIONES_APRENDIDAS.md) — 37 lecciones DO/DON'T
   - [DEPLOYMENT.md](DEPLOYMENT.md) — local vs VPS
   - [SETUP_MACBOOK_PRO.md](SETUP_MACBOOK_PRO.md) — este archivo

2. Inicia la sesión diciendo: **"lee app/docs/MANUAL_MAESTRO.md antes de tocar nada"**.

3. Reglas que ambas Claudes deben respetar (ya documentadas en MANUAL_MAESTRO §14):
   - NO compartir tokens en plain text por chat
   - Verificar provider correcto antes de debuggear
   - Para producción real, los cambios pasan por git → push → pull en server
   - Antes de borrar algo, confirmar con el usuario

4. Las dos Claudes pueden coexistir si **ambas pasan por git**:
   - MacBook Pro hace cambios → push
   - iMac (server) pulea cuando se le diga (manual o auto-deploy)
   - Si las dos editan al mismo tiempo, git resuelve conflictos como siempre

---

## 9. Troubleshooting

### "Permission denied (publickey)" al hacer git pull/push
Tu SSH key no está agregada a GitHub. Re-haz §1 step "Git + SSH key".

### `npm install` falla con "incompatible architecture"
Si usas Node x86_64 en una Mac arm64 (raro hoy):
```bash
cd app && npm rebuild better-sqlite3 --build-from-source
```

### El servidor local no arranca
- Puerto ocupado: cambia `PORT=3002` (o lo que sea distinto al server)
- DB no existe: la primera ejecución crea `data/reelance.sqlite` con migraciones aplicadas
- VAPID keys vacías: copia las del server (Estrategia A o B)

### Cambios pusheados no aparecen en lucho101.com
- En iMac: `cd /Users/luismelchor/Desktop/ReelanceHub && git status` — confirma branch correcta
- `git pull origin main && cd app && launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist && launchctl load ~/Library/LaunchAgents/com.reelance.app.plist`
- Verifica en logs: `tail -20 /Users/luismelchor/Desktop/ReelanceHub/app/logs/server.log`

---

## 10. Checklist primer uso

- [ ] Node 20 instalado
- [ ] Git + SSH key agregada a GitHub
- [ ] `git config user.name` y `user.email` configurados
- [ ] Repo clonado a `~/dev/` (NO Desktop)
- [ ] `app/.env` copiado del server (Estrategia A o B)
- [ ] `npm install` corrió sin errores
- [ ] `npm start` arranca server local en :3002
- [ ] http://localhost:3002 muestra login
- [ ] Login funciona con `ADMIN_PASSWORD` del `.env`
- [ ] Cambio de prueba: editar un texto en `public/index.html` → guardar → reload navegador → ver el cambio
- [ ] `git push` funciona desde MacBook Pro
- [ ] (Opcional) `app-state.json` del Hub viejo copiado para acceso a Kommo
