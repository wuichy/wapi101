#!/bin/bash
# ════════════════════════════════════════════════════════════════
# 🟢 PRENDER REELANCE CRM
# Carga los LaunchAgents del app nuevo + túnel de Cloudflare.
# Doble clic para ejecutar. No te preocupes, no rompe nada.
# ════════════════════════════════════════════════════════════════

APP_PLIST="$HOME/Library/LaunchAgents/com.reelance.app.plist"
TUNNEL_PLIST="$HOME/Library/LaunchAgents/com.reelance.tunnel.plist"
PUBLIC_URL="https://lucho101.com/healthz"
LOG_DIR="/Users/luismelchor/Desktop/ReelanceHub/app/logs"

clear
echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   🟢  PRENDIENDO REELANCE CRM                  ║"
echo "  ╚════════════════════════════════════════════════╝"
echo ""

# ── Paso 1: ¿Ya está corriendo? ──────────────────────────────────
APP_RUNNING=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.app$" | awk '{print $1}')
TUNNEL_RUNNING=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.tunnel$" | awk '{print $1}')

if [ -n "$APP_RUNNING" ] && [ -n "$TUNNEL_RUNNING" ]; then
  echo "  ⚠️  Reelance CRM YA está corriendo."
  echo "     App PID: $APP_RUNNING  ·  Túnel PID: $TUNNEL_RUNNING"
  echo ""
  read -p "  ¿Reiniciar todo? (s/n): " RESTART
  if [[ "$RESTART" != "s" && "$RESTART" != "S" ]]; then
    echo ""
    echo "  Sin cambios. Cierra esta ventana."
    read -p "  Presiona Enter..."
    exit 0
  fi
  echo "  → Apagando lo que está corriendo..."
  launchctl unload "$APP_PLIST" 2>/dev/null
  launchctl unload "$TUNNEL_PLIST" 2>/dev/null
  sleep 2
fi

# ── Paso 2: Cargar túnel ─────────────────────────────────────────
echo "  [1/3] Cargando túnel de Cloudflare (lucho101.com)..."
launchctl load "$TUNNEL_PLIST" 2>/dev/null
sleep 3
TUNNEL_PID=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.tunnel$" | awk '{print $1}')
if [ -z "$TUNNEL_PID" ]; then
  echo ""
  echo "  ❌  ERROR: El túnel no arrancó."
  echo "     Revisa: $LOG_DIR/cloudflared-error.log"
  echo ""
  read -p "  Presiona Enter para cerrar..."
  exit 1
fi
echo "       ✓ Túnel corriendo (PID $TUNNEL_PID)"

# ── Paso 3: Cargar app nuevo ─────────────────────────────────────
echo "  [2/3] Cargando Reelance CRM (Node, puerto 3001)..."
launchctl load "$APP_PLIST" 2>/dev/null
sleep 4
APP_PID=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.app$" | awk '{print $1}')
if [ -z "$APP_PID" ]; then
  echo ""
  echo "  ❌  ERROR: El app no arrancó."
  echo "     Revisa: $LOG_DIR/server-error.log"
  launchctl unload "$TUNNEL_PLIST" 2>/dev/null
  echo ""
  read -p "  Presiona Enter para cerrar..."
  exit 1
fi
echo "       ✓ App corriendo (PID $APP_PID)"

# ── Paso 4: Verificar que la URL pública responde ───────────────
echo "  [3/3] Verificando que https://lucho101.com responde..."
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL" --max-time 10)

echo ""
if [ "$HTTP_CODE" = "200" ]; then
  echo "  ╔════════════════════════════════════════════════╗"
  echo "  ║   ✅  TODO LISTO — Reelance CRM está VIVO      ║"
  echo "  ╚════════════════════════════════════════════════╝"
  echo ""
  echo "  📱 Ya puedes:"
  echo "     • Abrir https://lucho101.com en tu iPhone/Mac"
  echo "     • Recibir webhooks de WhatsApp Cloud / Meta / TikTok"
  echo ""
else
  echo "  ❌  El túnel respondió código HTTP: $HTTP_CODE"
  echo "     Espera 30 segundos y prueba de nuevo en el navegador."
  echo "     Si sigue, ejecuta '2-Revisar.command' para diagnosticar."
  echo ""
fi

read -p "  Puedes cerrar esta ventana (Enter o ⌘+W)..."
