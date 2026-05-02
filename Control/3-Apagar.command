#!/bin/bash
# ════════════════════════════════════════════════════════════════
# 🔴 APAGAR REELANCE CRM
# Descarga los LaunchAgents (app + túnel) de forma limpia.
# Solo úsalo si necesitas reiniciar o liberar la Mac.
# ════════════════════════════════════════════════════════════════

APP_PLIST="$HOME/Library/LaunchAgents/com.reelance.app.plist"
TUNNEL_PLIST="$HOME/Library/LaunchAgents/com.reelance.tunnel.plist"

clear
echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   🔴  APAGANDO REELANCE CRM                    ║"
echo "  ╚════════════════════════════════════════════════╝"
echo ""

APP_PID=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.app$" | awk '{print $1}')
TUNNEL_PID=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.tunnel$" | awk '{print $1}')

if [ -z "$APP_PID" ] && [ -z "$TUNNEL_PID" ]; then
  echo "  ℹ️  Reelance CRM ya estaba apagado."
  echo ""
  read -p "  Presiona Enter para cerrar..."
  exit 0
fi

echo "  ⚠️  Esto desconectará la app y los webhooks de WhatsApp/Meta"
echo "     dejarán de llegar hasta que vuelvas a prender."
echo ""
read -p "  ¿Estás seguro? (s/n): " CONFIRM
if [[ "$CONFIRM" != "s" && "$CONFIRM" != "S" ]]; then
  echo ""
  echo "  Cancelado. No se apagó nada."
  read -p "  Presiona Enter para cerrar..."
  exit 0
fi

echo ""
if [ -n "$APP_PID" ]; then
  echo "  → Apagando Reelance CRM (PID $APP_PID)..."
  launchctl unload "$APP_PLIST" 2>/dev/null
fi
if [ -n "$TUNNEL_PID" ]; then
  echo "  → Apagando túnel (PID $TUNNEL_PID)..."
  launchctl unload "$TUNNEL_PLIST" 2>/dev/null
fi
sleep 2

# Verificar que de verdad se apagaron
APP_STILL=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.app$" | awk '{print $1}')
TUNNEL_STILL=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.tunnel$" | awk '{print $1}')

if [ -z "$APP_STILL" ] && [ -z "$TUNNEL_STILL" ]; then
  echo ""
  echo "  ✅  Apagado limpio. Reelance CRM está fuera de línea."
  echo ""
  echo "  Para volver a prender: doble clic en '1-Prender.command'"
else
  echo ""
  echo "  ⚠️  Algunos procesos no se apagaron — forzando..."
  pkill -9 -f "node.*server.js" 2>/dev/null
  pkill -9 -f "cloudflared tunnel" 2>/dev/null
  sleep 1
  echo "  ✅  Forzado completado."
fi

echo ""
read -p "  Presiona Enter para cerrar..."
