#!/usr/bin/env bash
# Backup diario de wapi101 con encryption + opcional upload offsite.
#
# Pipeline:
#   1. Hot backup de DB (sqlite3 .backup atómico)
#   2. tar.gz de DB + uploads
#   3. Encryption con GPG (AES-256, passphrase de /root/.wapi101/backup-passphrase)
#   4. Si está configurado R2 (CF_R2_*), upload del .gpg al bucket
#   5. Rotación local: 30 días
#   6. Rotación remota: 90 días (cleanup en R2)
#
# Restore:
#   gpg --decrypt -o backup.tar.gz wapi101-backup-YYYYMMDD-HHMMSS.tar.gz.gpg
#   tar -xzf backup.tar.gz
#
# Setup R2 (offsite, opcional):
#   1. Crear bucket en Cloudflare Dashboard > R2 > Create bucket "wapi101-backups"
#   2. R2 > Manage API Tokens > Create Token (R2 Edit perms)
#   3. Guardar en /root/.wapi101/r2.env:
#        CF_R2_ACCOUNT_ID=xxxxx
#        CF_R2_ACCESS_KEY=xxxxx
#        CF_R2_SECRET_KEY=xxxxx
#        CF_R2_BUCKET=wapi101-backups
#   4. chmod 600 /root/.wapi101/r2.env

set -euo pipefail

BACKUP_DIR="/root/.wapi101/backups"
DATA_DIR="/root/.wapi101/data"
DB_FILE="$DATA_DIR/wapi101.sqlite"
UPLOADS_DIR="$DATA_DIR/uploads"
PASSPHRASE_FILE="/root/.wapi101/backup-passphrase"
R2_ENV_FILE="/root/.wapi101/r2.env"
TS=$(date +"%Y%m%d-%H%M%S")
RETENTION_LOCAL=30
RETENTION_R2=90

log() {
  if command -v systemd-cat >/dev/null 2>&1; then
    echo "$@" | systemd-cat -t wapi101-backup -p info
  else
    echo "[backup] $@" >&2
  fi
}
err() {
  if command -v systemd-cat >/dev/null 2>&1; then
    echo "$@" | systemd-cat -t wapi101-backup -p err
  else
    echo "[backup] ERROR: $@" >&2
  fi
}

[ -f "$DB_FILE" ] || { err "DB no existe: $DB_FILE"; exit 1; }
mkdir -p "$BACKUP_DIR"

# Asegurar passphrase de encryption — si no existe, generar una random de 64 chars
if [ ! -f "$PASSPHRASE_FILE" ]; then
  log "Generando passphrase nuevo (primera vez)"
  head -c 64 /dev/urandom | base64 | tr -d '/+=' | head -c 64 > "$PASSPHRASE_FILE"
  chmod 600 "$PASSPHRASE_FILE"
  log "⚠ IMPORTANTE: guarda una copia de $PASSPHRASE_FILE en 1Password. Si se pierde, los backups encriptados NO se pueden recuperar."
fi

TMP_DIR=$(mktemp -d -t wapi101-bkp-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

log "Iniciando backup → $TS"

# 1. Hot backup de la DB
DB_BACKUP="$TMP_DIR/wapi101.sqlite"
sqlite3 "$DB_FILE" ".backup '$DB_BACKUP'" || { err "Fallo en sqlite3 .backup"; exit 2; }
DB_SIZE=$(du -h "$DB_BACKUP" | cut -f1)
log "DB snapshot OK ($DB_SIZE)"

# 2. Tar de uploads (si existe)
if [ -d "$UPLOADS_DIR" ]; then
  tar -cf "$TMP_DIR/uploads.tar" -C "$DATA_DIR" uploads
  UPL_SIZE=$(du -h "$TMP_DIR/uploads.tar" | cut -f1)
  log "Uploads snapshot OK ($UPL_SIZE)"
fi

# 3. Combinar en tar.gz
ARCHIVE_PLAIN="/tmp/wapi101-backup-$TS.tar.gz"
tar -czf "$ARCHIVE_PLAIN" -C "$TMP_DIR" . || { err "Fallo creando archive"; exit 3; }

# 4. Encrypt con GPG (AES-256, simétrico con passphrase)
ARCHIVE="$BACKUP_DIR/wapi101-backup-$TS.tar.gz.gpg"
gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --compress-algo none \
    -o "$ARCHIVE" "$ARCHIVE_PLAIN" || { err "Fallo encriptando"; exit 4; }

FINAL_SIZE=$(du -h "$ARCHIVE" | cut -f1)
log "Backup encriptado OK: $ARCHIVE ($FINAL_SIZE)"

# 5. Upload a Cloudflare R2 (opcional) — solo si /root/.wapi101/r2.env existe
if [ -f "$R2_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$R2_ENV_FILE"; set +a
  if [ -n "${CF_R2_ACCOUNT_ID:-}" ] && [ -n "${CF_R2_ACCESS_KEY:-}" ] && [ -n "${CF_R2_SECRET_KEY:-}" ] && [ -n "${CF_R2_BUCKET:-}" ]; then
    OBJECT_KEY="wapi101-backup-$TS.tar.gz.gpg"
    R2_ENDPOINT="https://${CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    # AWS S3 v4 signed PUT request
    DATE=$(date -u +%Y%m%dT%H%M%SZ)
    DATE_STAMP=$(date -u +%Y%m%d)
    SHA_HEX=$(sha256sum "$ARCHIVE" | awk '{print $1}')
    HOST="${CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    CANONICAL_REQUEST=$(printf 'PUT\n/%s/%s\n\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n\nhost;x-amz-content-sha256;x-amz-date\n%s' \
      "$CF_R2_BUCKET" "$OBJECT_KEY" "$HOST" "$SHA_HEX" "$DATE" "$SHA_HEX")
    CR_HASH=$(printf '%s' "$CANONICAL_REQUEST" | sha256sum | awk '{print $1}')
    STRING_TO_SIGN=$(printf 'AWS4-HMAC-SHA256\n%s\n%s/auto/s3/aws4_request\n%s' "$DATE" "$DATE_STAMP" "$CR_HASH")
    SIGNING_KEY=$(printf '%s' "AWS4${CF_R2_SECRET_KEY}" | xxd -p -c 256)
    KDATE=$(printf '%s' "$DATE_STAMP" | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$SIGNING_KEY" -binary | xxd -p -c 256)
    KREGION=$(printf '%s' "auto"      | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$KDATE" -binary | xxd -p -c 256)
    KSERVICE=$(printf '%s' "s3"        | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$KREGION" -binary | xxd -p -c 256)
    KSIGNING=$(printf '%s' "aws4_request" | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$KSERVICE" -binary | xxd -p -c 256)
    SIGNATURE=$(printf '%s' "$STRING_TO_SIGN" | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$KSIGNING" | awk '{print $2}')
    HTTP_CODE=$(curl -sw "%{http_code}" -o /tmp/r2-upload-out.txt -X PUT \
      "$R2_ENDPOINT/$CF_R2_BUCKET/$OBJECT_KEY" \
      -H "Host: $HOST" \
      -H "X-Amz-Date: $DATE" \
      -H "X-Amz-Content-Sha256: $SHA_HEX" \
      -H "Authorization: AWS4-HMAC-SHA256 Credential=${CF_R2_ACCESS_KEY}/${DATE_STAMP}/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${SIGNATURE}" \
      --data-binary "@$ARCHIVE")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
      log "Subido a R2 OK ($OBJECT_KEY)"
    else
      err "R2 upload falló HTTP $HTTP_CODE: $(cat /tmp/r2-upload-out.txt 2>/dev/null | head -c 300)"
    fi
    rm -f /tmp/r2-upload-out.txt
  fi
fi

# 6. Rotación local: borrar backups con más de RETENTION_LOCAL días
DELETED=0
while IFS= read -r OLD; do
  rm -f "$OLD"
  DELETED=$((DELETED + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'wapi101-backup-*.tar.gz*' -type f -mtime +$RETENTION_LOCAL)
[ "$DELETED" -gt 0 ] && log "Borrados $DELETED backup(s) local(es) viejo(s) (>$RETENTION_LOCAL días)"

# Stats finales
TOTAL=$(ls -1 "$BACKUP_DIR"/wapi101-backup-*.tar.gz* 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "Listo. $TOTAL backup(s) en $BACKUP_DIR ($TOTAL_SIZE)"
