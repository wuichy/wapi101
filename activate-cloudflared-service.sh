#!/bin/bash
# Activa cloudflared como servicio launchd y desactiva ngrok.
# Corre esto SOLO después de que setup-cloudflared.sh haya terminado bien
# y hayas verificado que `./cloudflared tunnel run reelancehub` funciona.

set -e

PLIST_NGROK="$HOME/Library/LaunchAgents/com.reelancehub.ngrok.plist"
PLIST_CF="$HOME/Library/LaunchAgents/com.reelancehub.cloudflared.plist"

cat > "$PLIST_CF" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.reelancehub.cloudflared</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/luismelchor/Desktop/ReelanceHub/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>reelancehub</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/luismelchor/Desktop/ReelanceHub</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/luismelchor</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/luismelchor/Desktop/ReelanceHub/logs/cloudflared.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/luismelchor/Desktop/ReelanceHub/logs/cloudflared-error.log</string>
</dict>
</plist>
EOF

echo "==> Desactivando ngrok"
if [ -f "$PLIST_NGROK" ]; then
  launchctl unload "$PLIST_NGROK" 2>/dev/null || true
  mv "$PLIST_NGROK" "$PLIST_NGROK.disabled"
fi

echo "==> Activando cloudflared service"
launchctl load -w "$PLIST_CF"
sleep 3
launchctl list | grep reelancehub

echo ""
echo "Cloudflared activo. Verifica https://lucho101.com en unos segundos."
