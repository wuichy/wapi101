# 🎛️ Control de Reelance Hub

Carpeta con scripts de **uso manual** para administrar el servidor Reelance Hub
desde la Mac. Todos son archivos `.command` — los puedes ejecutar con **doble
clic** desde Finder.

> **Si todo está bien configurado, NO necesitas tocar nada de aquí.**
> El sistema arranca solo al iniciar la Mac y se reinicia solo si crashea.
> Estos scripts son para **emergencias** o **diagnóstico**.

---

## 📋 Los 4 scripts

### `0-Configurar-Mac-Servidor.command`
**Cuándo usarlo:** UNA sola vez en la vida, cuando montas todo en una Mac nueva.

**Qué hace:**
- Activa `autorestart` → la Mac se prende sola si se va la luz
- Pone `sleep = 0` → la Mac no se duerme cuando está enchufada
- Pone `disksleep = 0` → el disco no se duerme nunca

**Pide:** tu contraseña de Mac (la del login).

**Después de correrlo:** ya no lo vuelves a tocar.

---

### `1-Prender.command`
**Cuándo usarlo:** Si por algún motivo Reelance Hub no está corriendo y quieres
arrancarlo a mano (ejemplo: lo apagaste a propósito y quieres volver a prender).

**Qué hace:**
1. Verifica si ya hay procesos corriendo (no duplica)
2. Si está corriendo, te pregunta si quieres reiniciar todo
3. Arranca el túnel de Cloudflare (`lucho101.com`)
4. Arranca el servidor Node.js
5. Verifica que `https://lucho101.com/healthz` responda
6. Te dice **"✅ TODO LISTO"** o el error específico

**⚠️ Importante:** Con los LaunchAgents activos (que es lo normal), **no
necesitas correr esto** — la Mac arranca todo solo. Este script existe por si
algún día algo se atora.

---

### `2-Revisar.command`
**Cuándo usarlo:** Cuando quieras saber si Reelance Hub está vivo o tienes dudas.

**Qué hace:** SOLO INFORMA, no toca nada.
- ¿Está corriendo el servidor Node? (con su PID)
- ¿Está corriendo el túnel de Cloudflare?
- ¿Responde el server localmente?
- ¿Responde la URL pública `lucho101.com`?
- Diagnóstico final con qué hacer si algo falla

**Es seguro correrlo cuando quieras** — no apaga, no prende, no rompe nada.

---

### `3-Apagar.command`
**Cuándo usarlo:** Casi nunca. Solo si necesitas apagar Reelance Hub a propósito
(ejemplo: para mantenimiento o reiniciar la Mac).

**Qué hace:**
1. Te pide confirmación (`s/n`)
2. Apaga el servidor Node
3. Apaga el túnel de Cloudflare
4. Si no se rinden, los fuerza con `kill -9`

**⚠️ Importante:** Si los LaunchAgents están activos, este script apaga los
procesos pero macOS los va a relanzar automáticamente en ~30 segundos. Para
apagar **definitivamente** hay que descargar los LaunchAgents:

```bash
launchctl unload ~/Library/LaunchAgents/com.reelance.server.plist
launchctl unload ~/Library/LaunchAgents/com.reelance.tunnel.plist
```

Y para volver a activarlos:

```bash
launchctl load -w ~/Library/LaunchAgents/com.reelance.server.plist
launchctl load -w ~/Library/LaunchAgents/com.reelance.tunnel.plist
```

---

## 🆘 Si algo no funciona

1. **Primero corre `2-Revisar.command`** — te dice qué está roto
2. Si dice que falta arrancar algo, corre `1-Prender.command`
3. Si después de correr `1-Prender` sigue fallando, revisa los logs:
   - `~/Desktop/ReelanceHub/logs/server-error.log`
   - `~/Desktop/ReelanceHub/logs/cloudflared-error.log`
4. Si está todo "abajo" pero el endpoint público no responde:
   - Es problema de internet o Cloudflare (rara vez)
   - Revisa tu conexión y espera 1-2 minutos

---

## 📞 Contacto rápido para diagnóstico

Si nada funciona y necesitas ayuda urgente, los datos clave:

```
URL pública:        https://lucho101.com
Endpoint health:    https://lucho101.com/healthz
Subdominio Kommo:   ventasreelancemx
Salesbot principal: 48782
Salesbot Camino B:  48800
amojo_id:           edb9a8e1-51f3-414a-b8f0-c74c6c9b87e6
```

Ver `MANUAL_MAESTRO.md` (carpeta padre) para todos los detalles técnicos.
