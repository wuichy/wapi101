# Despliegue

Esta app está diseñada para correr en dos entornos sin cambiar código, solo `.env`:

1. **Tu Mac (local)** — desarrollo y producción del día a día (igual que Reelance Hub actual)
2. **VPS** — cuando crezca el equipo o quieras 24/7 sin depender de tu Mac

---

## 1. Local (tu Mac)

### Setup inicial

```bash
cd app
cp .env.example .env
# editar .env con tu password, secrets, etc.
npm install
npm start
```

App corriendo en `http://localhost:3001`.

### Exponer al exterior (para webhooks de WhatsApp/Meta/TikTok)

Igual que Reelance Hub usa **cloudflared** con un dominio (`lucho101.com`).
Reusamos la misma infraestructura — solo cambia el puerto/path:

- Reelance Hub actual → puerto 3000 → `lucho101.com/`
- Esta app nueva → puerto 3001 → `lucho101.com/app/` (subpath) o subdominio nuevo `app.lucho101.com`

(Decidimos cuando llegue el momento — por ahora local sin tunnel está bien para construir UI y módulos.)

### Auto-arranque al encender la Mac

El proyecto padre ya tiene `LaunchAgents` (`com.reelance.server.plist`, `com.reelance.tunnel.plist`) en `~/Library/LaunchAgents/`. Cuando llegue el momento, agregamos `com.reelance.app.plist` apuntando a esta app, mismo patrón:

- `RunAtLoad: true`
- `KeepAlive: { SuccessfulExit: false }`
- `ThrottleInterval: 30`
- Logs a `/Users/luismelchor/Desktop/ReelanceHub/app/logs/`

### Variables de entorno típicas (local)

```env
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
APP_BASE_URL=https://lucho101.com   # o el dominio que uses
DB_PATH=./data/reelance.sqlite
```

`HOST=127.0.0.1` evita exponer la app a la red local de la casa/oficina; cloudflared sí puede llegar porque corre en la misma Mac.

---

## 2. VPS (cuando lo necesites)

Pasar a VPS es **cambio de configuración, no de código**. Pasos:

### A. Provisionar servidor

Cualquier VPS Linux (DigitalOcean, Hetzner, Linode, AWS Lightsail). Mínimo: 1 vCPU, 1 GB RAM, 25 GB disco. Ubuntu 24.04 LTS recomendado.

### B. Instalar dependencias

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build tools (better-sqlite3 los necesita la primera vez)
sudo apt-get install -y build-essential python3

# Nginx (reverse proxy + SSL)
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### C. Clonar y configurar

```bash
cd /var/www
sudo git clone <repo> reelance
cd reelance/app
cp .env.example .env
# editar .env
sudo npm install --omit=dev
```

`.env` para VPS:
```env
NODE_ENV=production
PORT=3001
HOST=127.0.0.1                      # nginx hace reverse proxy → no exponer al exterior
APP_BASE_URL=https://app.tudominio.com
DB_PATH=/var/www/reelance/app/data/reelance.sqlite
```

### D. systemd (auto-arranque + restart en crash)

Equivalente a los LaunchAgents de la Mac.

`/etc/systemd/system/reelance-app.service`:
```ini
[Unit]
Description=Reelance App
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/reelance/app
EnvironmentFile=/var/www/reelance/app/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable reelance-app
sudo systemctl start reelance-app
sudo systemctl status reelance-app
```

### E. Nginx + SSL

`/etc/nginx/sites-available/reelance-app`:
```nginx
server {
    listen 80;
    server_name app.tudominio.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.tudominio.com;

    # SSL gestionado por certbot

    client_max_body_size 25M;       # uploads de media

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;

        # SSE necesita esto:
        proxy_buffering off;
        proxy_cache off;
    }

    # Webhooks pueden necesitar el body crudo — el handler lo maneja en Node
    location /webhooks/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_buffering off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/reelance-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d app.tudominio.com
```

### F. Backups automáticos

Cron job en `/etc/cron.hourly/reelance-backup`:
```bash
#!/bin/bash
DST=/var/backups/reelance
mkdir -p "$DST"
sqlite3 /var/www/reelance/app/data/reelance.sqlite ".backup $DST/$(date +%Y%m%d-%H).sqlite"
# Retención: 24 horarios + 30 diarios — `find` borra los viejos
find "$DST" -name "*.sqlite" -mtime +30 -delete
```

### G. Monitoreo

UptimeRobot apuntando a `https://app.tudominio.com/healthz` cada 5 min — igual que el proyecto padre.

---

## 3. Diferencias localhost ↔ VPS resumidas

| | Local (Mac) | VPS |
|---|---|---|
| Auto-arranque | LaunchAgents | systemd |
| TLS | cloudflared | nginx + certbot |
| Bind | `127.0.0.1` | `127.0.0.1` (detrás de nginx) |
| `APP_BASE_URL` | `https://lucho101.com` | `https://app.tudominio.com` |
| `DB_PATH` | relativo (`./data/...`) | absoluto (`/var/www/...`) |
| Backups | manual / próximo cron | `/etc/cron.hourly/` |
| Logs | `app/logs/` | `journalctl -u reelance-app -f` |

**El código no cambia** — solo `.env` y los wrappers del sistema (LaunchAgent vs systemd).

---

## 4. Migración local → VPS

Cuando llegue el día:

1. Crear VPS y desplegarlo siguiendo sección 2.
2. Detener app local: `launchctl unload ~/Library/LaunchAgents/com.reelance.app.plist`
3. Copiar SQLite + uploads:
   ```bash
   rsync -avz app/data/ user@vps:/var/www/reelance/app/data/
   ```
4. Apuntar DNS de `app.tudominio.com` a IP del VPS.
5. Actualizar URLs en Meta Developer Console (callback OAuth, webhook URL).
6. Verificar healthz: `curl https://app.tudominio.com/healthz`.
7. Apagar definitivamente app en Mac.

Tiempo estimado: 1-2 horas si todo va bien.
