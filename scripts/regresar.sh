#!/usr/bin/env bash
#
# Vuelve wapi101 a un punto de retorno (tag de git) y lo despliega.
#
# Uso:   ./scripts/regresar.sh                    → lista los puntos disponibles
#        ./scripts/regresar.sh antes-rediseno-bots → vuelve a ese punto
#
# NO borra historia: crea un commit nuevo que deshace los cambios (git revert
# de rango). Así el trabajo descartado sigue existiendo por si lo quieres de
# vuelta, y el servidor puede seguir haciendo `git pull --ff-only` normal.
#
set -euo pipefail
cd "$(dirname "$0")/.."
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

if [[ $# -eq 0 ]]; then
  printf '%sPuntos de retorno disponibles:%s\n\n' "$BOLD" "$OFF"
  git tag -l --sort=-creatordate --format='  %(refname:short)   %(creatordate:short)   %(contents:subject)'
  printf '\nPara volver a uno:\n  ./scripts/regresar.sh <nombre>\n'
  exit 0
fi

TAG="$1"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
  || { printf '%s✗ No existe el punto "%s". Corre el script sin argumentos para ver la lista.%s\n' "$RED" "$TAG" "$OFF"; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  printf '%s✗ Tienes cambios sin commitear. Guárdalos o descártalos primero.%s\n' "$RED" "$OFF"; exit 1
fi

COUNT="$(git rev-list --count "$TAG"..HEAD)"
if [[ "$COUNT" == "0" ]]; then
  printf 'Ya estás en "%s" — no hay nada que deshacer.\n' "$TAG"; exit 0
fi

printf '%sSe van a deshacer estos %s commit(s):%s\n\n' "$BOLD" "$COUNT" "$OFF"
git log --oneline "$TAG"..HEAD | sed 's/^/    /'
printf '\n¿Seguro? Escribe "si" para continuar: '
read -r RESP
[[ "$RESP" == "si" ]] || { echo "Cancelado."; exit 0; }

git revert --no-edit --no-commit "$TAG"..HEAD
git commit -q -m "revert: volver al punto de retorno '$TAG'

Deshace $COUNT commit(s). La historia se conserva: si quieres el trabajo de
vuelta, está en los commits revertidos."
git push -q git@github.com:wuichy/wapi101.git HEAD:main
printf '%s✓ Código de vuelta en "%s". Desplegando…%s\n\n' "$GREEN" "$TAG" "$OFF"
exec ./scripts/deploy.sh
