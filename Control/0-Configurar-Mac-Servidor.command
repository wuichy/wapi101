#!/bin/bash
# ════════════════════════════════════════════════════════════════
# ⚡ CONFIGURAR LA MAC COMO SERVIDOR 24/7
# Aplica los ajustes de energía necesarios para que la Mac:
#  • Se prenda sola tras un corte de luz
#  • Nunca duerma cuando está enchufada
#  • Despierte ante tráfico de red
#
# Solo necesitas correr esto UNA VEZ. Te pedirá tu contraseña.
# ════════════════════════════════════════════════════════════════

clear
echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   ⚡  CONFIGURAR MAC COMO SERVIDOR 24/7        ║"
echo "  ╚════════════════════════════════════════════════╝"
echo ""
echo "  Esto va a:"
echo "    1. Activar auto-arranque tras corte de luz"
echo "    2. Evitar que la Mac duerma cuando está enchufada"
echo "    3. Mantener el disco siempre activo"
echo "    4. Mantener wake on network (ya está activo)"
echo ""
echo "  ⚠️  Te va a pedir tu contraseña de Mac (la del login)."
echo "      Cuando la escribas NO se ven los caracteres — es normal."
echo ""
read -p "  ¿Listo? Presiona Enter para continuar (o Ctrl+C para cancelar)..."

echo ""
echo "  [1/3] Auto-prender después de corte de luz..."
sudo pmset -a autorestart 1 && echo "        ✓ OK"

echo "  [2/3] Nunca dormir cuando está enchufada..."
sudo pmset -c sleep 0 && echo "        ✓ OK"

echo "  [3/3] Disco siempre despierto cuando enchufada..."
sudo pmset -c disksleep 0 && echo "        ✓ OK"

echo ""
echo "  ─────────────────────────────────────────────────"
echo "  📊 Configuración FINAL de tu Mac:"
echo "  ─────────────────────────────────────────────────"
pmset -g | grep -E "autorestart|^ sleep|^ disksleep|womp" | sed 's/^/  /'
echo ""

# Verificar
AUTORESTART=$(pmset -g | grep "autorestart" | awk '{print $2}')
SLEEP_VAL=$(pmset -g | grep "^ sleep" | awk '{print $2}')

if [ "$AUTORESTART" = "1" ] && [ "$SLEEP_VAL" = "0" ]; then
  echo "  ╔════════════════════════════════════════════════╗"
  echo "  ║   ✅  TU MAC YA ES UN SERVIDOR 24/7            ║"
  echo "  ╚════════════════════════════════════════════════╝"
  echo ""
  echo "  Ahora:"
  echo "  • Si se va la luz → al volver, la Mac se prende sola"
  echo "  • Combinado con LaunchAgents → Reelance Hub revive solo"
  echo "  • La Mac NO se duerme mientras esté enchufada"
  echo ""
  echo "  ⚠️  IMPORTANTE: Si es MacBook, deja la TAPA ABIERTA"
  echo "      o conecta un monitor/teclado externo. Cerrar la tapa"
  echo "      duerme la Mac aunque tenga estos ajustes."
  echo ""
else
  echo "  ⚠️  Algo no se aplicó correctamente. Revisa arriba."
  echo ""
fi

read -p "  Presiona Enter para cerrar..."
