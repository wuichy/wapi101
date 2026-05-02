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

# ─── Backup forzado a iCloud ANTES de apagar ───
# Asegura que todo lo del día quede respaldado, no solo lo de la última hora :05
echo ""
echo "  💾 Respaldando a iCloud antes de apagar..."
if [ -x "$HOME/.reelance/backup.sh" ]; then
  bash "$HOME/.reelance/backup.sh" 2>/dev/null && echo "     ✓ DB SQLite respaldada" || echo "     ⚠️  Backup de DB falló (no es bloqueante)"
fi
if [ -x "$HOME/.reelance/backup-project.sh" ]; then
  bash "$HOME/.reelance/backup-project.sh" 2>/dev/null && echo "     ✓ Proyecto respaldado (código + .env + system-files)" || echo "     ⚠️  Backup de proyecto falló (no es bloqueante)"
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
