#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ $# -eq 4 && "$1" == --project && "$3" == --destination ]] || { printf 'Usage: backup.sh --project NAME --destination FILE.gpg\n' >&2; exit 2; }
project=$2
output=$4
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ && "$output" == *.gpg && ! -e "$output" ]] || exit 2
: "${SHOWCASE_ASSET_DIR:?Set the configured asset path}"
: "${SHOWCASE_BACKUP_SIGNER:?Set the approved signing-key fingerprint}"
: "${SHOWCASE_BACKUP_RECIPIENT:?Set the approved recovery-key fingerprint}"
for bin in docker gpg python3 tar; do command -v "$bin" >/dev/null || { printf '%s is required\n' "$bin" >&2; exit 69; }; done
[[ -d "$SHOWCASE_ASSET_DIR" && ! -L "$SHOWCASE_ASSET_DIR" ]] || exit 2
stage=$(mktemp -d)
partial="${output}.partial.$$"
compose=(docker compose --project-name "$project" -f "$(dirname "$0")/compose.yaml")
running=$( "${compose[@]}" ps --status running --services )

cleanup() {
  status=$?
  trap - EXIT
  for service in api proxy; do
    if [[ $'\n'"$running"$'\n' == *$'\n'"$service"$'\n'* ]]; then
      "${compose[@]}" start "$service" || status=1
    fi
  done
  rm -rf -- "$stage"
  rm -f -- "$partial"
  exit "$status"
}
trap cleanup EXIT

# Drain proxy first, then stop the only application writer before taking both snapshots.
"${compose[@]}" stop proxy api
sudo mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF --databases cosmetics-product-platform >"$stage/db.sql"
sudo mysql -uroot -N -B cosmetics-product-platform -e "SELECT version_num FROM alembic_version" >"$stage/schema"
[[ -s "$stage/db.sql" && -s "$stage/schema" ]] || exit 1
api_id=$( "${compose[@]}" ps --all --quiet api )
[[ -n "$api_id" ]] || { printf 'No source API container metadata\n' >&2; exit 1; }
docker inspect --format '{{.Image}}' "$api_id" >"$stage/image"
printf '%s\n' "$project" >"$stage/source_project"
date -u +%Y-%m-%dT%H:%M:%SZ >"$stage/captured_at"
python3 -I - "$SHOWCASE_ASSET_DIR" "$stage" <<'PY'
from hashlib import file_digest
from pathlib import Path
import json
import shutil
import sys

source, stage = map(Path, sys.argv[1:])
assets = stage / 'assets'
assets.mkdir()
for p in source.iterdir():
    if p.is_symlink() or not p.is_file() or len(p.name) != 32 or any(c not in '0123456789abcdef' for c in p.name):
        raise SystemExit('Refusing an unexpected asset entry')
    shutil.copyfile(p, assets / p.name)
entries = {}
for p in sorted(stage.rglob('*')):
    if p.is_file():
        with p.open('rb') as stream:
            entries[p.relative_to(stage).as_posix()] = file_digest(stream, 'sha256').hexdigest()
(stage / 'manifest.json').write_text(json.dumps(entries, sort_keys=True), encoding='utf-8')
PY
tar -cf - -C "$stage" . | gpg --batch --output "$partial" --local-user "$SHOWCASE_BACKUP_SIGNER" --recipient "$SHOWCASE_BACKUP_RECIPIENT" --sign --encrypt
mv -- "$partial" "$output"
printf 'Signed encrypted bundle created. Transfer it only to the approved off-host backup destination.\n'
