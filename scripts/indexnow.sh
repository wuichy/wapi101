#!/bin/bash
# Avisa a IndexNow (lo usan Bing, Yandex, Seznam, Naver; Google NO) qué URLs
# cambiaron, para que las rastreen en minutos en vez de semanas.
# Uso: ./scripts/indexnow.sh                      → todas las URLs del sitemap en vivo
#      ./scripts/indexnow.sh https://wapi101.com/blog/x  → solo esas
# La llave vive en app/public/<32hex>.txt (es pública por diseño, no es un secreto).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE=$(ls "$DIR"/app/public/*.txt | grep -E '/[0-9a-f]{32}\.txt$' | head -1)
[ -n "$KEY_FILE" ] || { echo "no hay archivo de llave IndexNow en app/public/"; exit 1; }
KEY=$(basename "$KEY_FILE" .txt)
URLS=()
if [ $# -gt 0 ]; then URLS=("$@"); else
  while IFS= read -r u; do URLS+=("$u"); done < <(curl -s -A "Mozilla/5.0" https://wapi101.com/sitemap.xml | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g')
fi
python3 - "$KEY" "${URLS[@]}" << 'PY'
import json, sys, urllib.request, urllib.error
key, urls = sys.argv[1], sys.argv[2:]
body = json.dumps({"host": "wapi101.com", "key": key, "keyLocation": f"https://wapi101.com/{key}.txt", "urlList": urls}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
try:
    r = urllib.request.urlopen(req, timeout=20); print(f"IndexNow → HTTP {r.status} · {len(urls)} URLs enviadas")
except urllib.error.HTTPError as e:
    print(f"IndexNow → HTTP {e.code} · {e.read().decode()[:200]}"); sys.exit(1)
PY
