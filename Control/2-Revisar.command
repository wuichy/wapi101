#!/bin/bash
# ════════════════════════════════════════════════════════════════
# 🔵 REVISAR REELANCE CRM
# Te dice si está vivo, qué está corriendo y qué falta.
# Doble clic para ejecutar. NO arranca ni apaga nada.
# ════════════════════════════════════════════════════════════════

PUBLIC_URL="https://lucho101.com/healthz"
LOCAL_URL="http://127.0.0.1:3001/healthz"
LOG_DIR="/Users/luismelchor/dev/ReelanceHub/app/logs"

clear
echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   🔵  REVISIÓN DE REELANCE CRM                 ║"
echo "  ╚════════════════════════════════════════════════╝"
echo ""

# ── LaunchAgents ─────────────────────────────────────────────────
APP_PID=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.app$" | awk '{print $1}')
TUNNEL_PID=$(launchctl list | grep -E "^[0-9]+\s+[0-9]+\s+com\.reelance\.tunnel$" | awk '{print $1}')

echo "  📊 LAUNCHAGENTS:"
if [ -n "$APP_PID" ]; then
  echo "     ✅  Reelance CRM corriendo (PID $APP_PID)"
else
  echo "     ❌  Reelance CRM APAGADO"
fi

if [ -n "$TUNNEL_PID" ]; then
  echo "     ✅  Túnel de Cloudflare corriendo (PID $TUNNEL_PID)"
else
  echo "     ❌  Túnel de Cloudflare APAGADO"
fi
echo ""

# ── Endpoint local ───────────────────────────────────────────────
echo "  🏠 SERVIDOR LOCAL (127.0.0.1:3001):"
LOCAL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_URL" --max-time 5)
if [ "$LOCAL_CODE" = "200" ]; then
  echo "     ✅  Responde 200 OK"
else
  echo "     ❌  No responde (HTTP: $LOCAL_CODE)"
fi
echo ""

# ── URL pública (a través del túnel) ─────────────────────────────
echo "  🌍 URL PÚBLICA (https://lucho101.com):"
PUB_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL" --max-time 10)
if [ "$PUB_CODE" = "200" ]; then
  echo "     ✅  Responde 200 OK (visible desde internet)"
else
  echo "     ❌  No responde (HTTP: $PUB_CODE)"
fi
echo ""

# ── Diagnóstico final ────────────────────────────────────────────
echo "  ─────────────────────────────────────────────────"
if [ -n "$APP_PID" ] && [ -n "$TUNNEL_PID" ] && [ "$PUB_CODE" = "200" ]; then
  echo "  ✅  TODO BIEN — Reelance CRM funciona normalmente."
  echo ""
  echo "      Webhooks de WhatsApp Cloud / Meta / TikTok"
  echo "      deberían estar llegando sin problema."
elif [ -z "$APP_PID" ] || [ -z "$TUNNEL_PID" ]; then
  echo "  ⚠️   FALTA ARRANCAR ALGO."
  echo ""
  echo "      → Doble clic en '1-Prender.command' para encenderlo."
elif [ "$PUB_CODE" != "200" ]; then
  echo "  ⚠️   El servidor local funciona pero la URL pública NO."
  echo ""
  echo "      Posibles causas:"
  echo "      • Cloudflare tiene problemas (raro)"
  echo "      • Tu internet está caído"
  echo "      • Túnel reconectándose (espera 30-60s)"
fi
echo ""
echo "  📝 LOGS recientes en: $LOG_DIR/"
echo ""
read -p "  Presiona Enter para cerrar..."
