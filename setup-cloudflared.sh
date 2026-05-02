#!/bin/bash
# Script interactivo para crear el tunnel y configurar DNS.
# Pre-requisitos:
#   1. Cuenta gratis en cloudflare.com con el dominio lucho101.com agregado
#   2. Nameservers de lucho101.com apuntando a Cloudflare (cambiar en Hostinger)
#   3. DNS propagado (15 min - 24 hrs)
#   4. Haber corrido: ./cloudflared tunnel login
#
# Uso: ./setup-cloudflared.sh

set -e

cd "$(dirname "$0")"

TUNNEL_NAME="reelancehub"
HOSTNAME="lucho101.com"
CONFIG_FILE="$HOME/.cloudflared/config.yml"

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "ERROR: Falta autenticarte. Ejecuta primero: ./cloudflared tunnel login"
  exit 1
fi

echo "==> Creando tunnel '$TUNNEL_NAME' (si ya existe, salta)..."
./cloudflared tunnel create "$TUNNEL_NAME" 2>/dev/null || echo "(tunnel ya existía)"

TUNNEL_UUID=$(./cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" '$2 == name {print $1}')

if [ -z "$TUNNEL_UUID" ]; then
  echo "ERROR: No pude obtener el UUID del tunnel."
  exit 1
fi

echo "==> Tunnel UUID: $TUNNEL_UUID"

echo "==> Generando config.yml en $CONFIG_FILE"
mkdir -p "$HOME/.cloudflared"
cat > "$CONFIG_FILE" <<EOF
tunnel: $TUNNEL_UUID
credentials-file: $HOME/.cloudflared/$TUNNEL_UUID.json

ingress:
  - hostname: $HOSTNAME
    service: http://localhost:3000
  - hostname: www.$HOSTNAME
    service: http://localhost:3000
  - service: http_status:404
EOF

echo "==> Creando rutas DNS"
./cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>/dev/null || echo "(ruta $HOSTNAME ya existía)"
./cloudflared tunnel route dns "$TUNNEL_NAME" "www.$HOSTNAME" 2>/dev/null || echo "(ruta www.$HOSTNAME ya existía)"

echo ""
echo "==============================================="
echo "Listo. Para arrancar el tunnel:"
echo "  ./cloudflared tunnel run $TUNNEL_NAME"
echo ""
echo "Para configurarlo como servicio launchd permanente,"
echo "ejecuta: ./activate-cloudflared-service.sh"
echo "==============================================="
