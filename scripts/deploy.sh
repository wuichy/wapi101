#!/usr/bin/env bash
#
# Deploy de wapi101 al VPS, con candado anti-pisadas.
#
# El 12-ago-2026 un `git pull` en el servidor abortó porque había 3 archivos
# editados a mano en producción que nunca se subieron a git — entre ellos el
# fix del (ref:XXXX) para clientes recurrentes. Git nos salvó por casualidad:
# si los archivos no hubieran chocado, el pull los borra en silencio y nadie
# se entera hasta que algo deja de funcionar semanas después.
#
# Este script convierte esa casualidad en una regla:
#   1. Si el servidor tiene cambios sin subir → GUARDA un parche y ABORTA.
#   2. Revisa la sintaxis de lo que va a entrar ANTES de reiniciar.
#   3. Reinicia y verifica que quedó vivo y sirviendo la versión nueva.
#
# Uso:  ./scripts/deploy.sh
#
set -euo pipefail

HOST="wapi-new"
REMOTE="/root/wapi101"
RESCUES="/root/wapi101-rescates"
SERVICE="wapi101"
URL="https://wapi101.com"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }
step() { printf '\n%s── %s%s\n' "$BOLD" "$*" "$OFF"; }

cd "$(dirname "$0")/.."

# ── 1. El repo local debe estar limpio y subido ───────────────────────────
step "Revisando el repo local"

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  die "Tienes cambios sin commitear. Haz commit (o stash) antes de desplegar."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch --quiet origin main 2>/dev/null || true
if [[ -n "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]]; then
  git log origin/main..HEAD --oneline
  die "Tienes commits sin pushear. Súbelos primero: git push git@github.com:wuichy/wapi101.git HEAD:main"
fi
ok "Local limpio y sincronizado (rama: $BRANCH)"

# ── 2. CANDADO: ¿el servidor tiene cambios sin subir? ─────────────────────
# Solo importan los archivos TRACKEADOS modificados. Los untracked (los .bak
# que se van acumulando ahí) no estorban al pull, así que no bloquean.
step "Revisando si el servidor tiene cambios sin subir"

DIRTY="$(ssh "$HOST" "cd $REMOTE && git status --porcelain | grep -v '^??' || true")"

if [[ -n "$DIRTY" ]]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  PATCH="$RESCUES/$STAMP.patch"

  ssh "$HOST" "mkdir -p $RESCUES && cd $REMOTE && git diff > $PATCH && git diff --stat"

  printf '\n%s%s╔════════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RED" "$OFF"
  printf '%s%s║  EL SERVIDOR TIENE CAMBIOS QUE NO ESTÁN EN GIT             ║%s\n' "$BOLD" "$RED" "$OFF"
  printf '%s%s╚════════════════════════════════════════════════════════════╝%s\n\n' "$BOLD" "$RED" "$OFF"
  say "Archivos editados a mano en producción:"
  say "$DIRTY"
  say ""
  say "NO desplegué nada. El pull los habría borrado."
  say ""
  ok "Parche de rescate guardado en el servidor:"
  say "    $PATCH"
  say ""
  say "${BOLD}Para rescatarlos${OFF} (desde tu Mac, en el repo):"
  say "    ssh $HOST 'cat $PATCH' > /tmp/rescate.patch"
  say "    git apply -3 /tmp/rescate.patch"
  say "    # revisa, resuelve conflictos si hay, y commitea"
  say ""
  say "${BOLD}Si de plano son basura${OFF} y quieres tirarlos:"
  say "    ssh $HOST 'cd $REMOTE && git checkout -- .'"
  say ""
  exit 1
fi
ok "Servidor limpio — no hay nada que rescatar"

# ── 3. Traer el código ────────────────────────────────────────────────────
step "Bajando el código nuevo"
CHANGED="$(ssh "$HOST" "cd $REMOTE && git fetch --quiet origin main && git diff --name-only HEAD origin/main")"

if [[ -z "$CHANGED" ]]; then
  warn "El servidor ya está en la misma versión — nada que desplegar."
  exit 0
fi
say "Archivos que cambian:"
say "$CHANGED" | sed 's/^/    /'

ssh "$HOST" "cd $REMOTE && git pull --ff-only -q"
ok "Código actualizado"

# ── 4. Sintaxis ANTES de reiniciar ────────────────────────────────────────
# El servicio sigue corriendo el código viejo en memoria: si algo no compila,
# abortamos aquí y el sitio nunca se cae.
step "Revisando sintaxis de lo que entró"
JS="$(printf '%s\n' "$CHANGED" | grep '\.js$' || true)"

if [[ -n "$JS" ]]; then
  BAD="$(ssh "$HOST" "cd $REMOTE && for f in $(printf '%s ' $JS); do [ -f \"\$f\" ] && node --check \"\$f\" 2>&1 | head -3 && echo \"FALLA: \$f\"; done" || true)"
  if printf '%s' "$BAD" | grep -q 'FALLA:'; then
    say "$BAD"
    die "Hay un error de sintaxis. NO reinicié — el sitio sigue vivo con la versión anterior."
  fi
  ok "Sintaxis OK ($(printf '%s\n' "$JS" | wc -l | tr -d ' ') archivos .js)"
else
  ok "No cambió ningún .js"
fi

# ── 5. Reiniciar y comprobar que quedó vivo ───────────────────────────────
step "Reiniciando el servicio"
ssh "$HOST" "systemctl restart $SERVICE && sleep 3 && systemctl is-active $SERVICE" >/dev/null \
  || {
       say ""
       ssh "$HOST" "journalctl -u $SERVICE -n 30 --no-pager" || true
       die "El servicio NO arrancó. Arriba están los últimos logs."
     }
ok "Servicio activo"

# ── 6. ¿De verdad está sirviendo la versión nueva? ────────────────────────
step "Verificando lo que sirve el sitio"
VER="$(ssh "$HOST" "grep -o 'app\.js?v=[a-zA-Z0-9]*' $REMOTE/app/public/index.html | head -1 | cut -d= -f2")"

for asset in "app.js?v=$VER" "styles.css"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/$asset")"
  [[ "$CODE" == "200" ]] && ok "$asset → 200" || die "$asset → $CODE (esperaba 200)"
done

ERRORS="$(ssh "$HOST" "journalctl -u $SERVICE --since '60 sec ago' --no-pager | grep -iE 'uncaught|cannot find module|TypeError' | head -5" || true)"
if [[ -n "$ERRORS" ]]; then
  warn "Aparecieron errores en el arranque:"
  say "$ERRORS"
else
  ok "Sin errores en el arranque"
fi

printf '\n%s%s✓ Desplegado — cache buster: %s%s\n\n' "$BOLD" "$GREEN" "$VER" "$OFF"
