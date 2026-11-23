#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -lt 4 || $# -gt 5 || ${1:-} != --project || ${3:-} != --bundle || ( $# -eq 5 && ${5:-} != --verify-only ) ]]; then
  printf 'Usage: restore.sh --project ISOLATED-restore --bundle FILE.gpg [--verify-only]\n' >&2
  exit 2
fi
project=$2
bundle=$4
verify_only=${5:-}
python_bin=${SHOWCASE_PYTHON_BIN:-python3}
: "${SHOWCASE_APPROVED_RESTORE_PROJECT:?Confirm the exact isolated project}"
: "${SHOWCASE_EXPECT_SCHEMA:?Declare the compatible Alembic revision}"
: "${SHOWCASE_EXPECT_API_IMAGE_ID:?Declare the compatible image ID}"
: "${SHOWCASE_BACKUP_SIGNER:?Set the approved signing-key fingerprint}"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*-restore$ && "$project" == "$SHOWCASE_APPROVED_RESTORE_PROJECT" && -f "$bundle" && ! -L "$bundle" ]] || exit 2
for bin in gpg "$python_bin"; do command -v "$bin" >/dev/null || exit 69; done
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT

gpg --batch --status-fd 3 --output "$stage/payload.tar" --decrypt -- "$bundle" 3>"$stage/signatures"
"$python_bin" -I - "$stage" "$project" "$SHOWCASE_BACKUP_SIGNER" "$SHOWCASE_EXPECT_SCHEMA" "$SHOWCASE_EXPECT_API_IMAGE_ID" <<'PY'
from hashlib import file_digest
from pathlib import Path, PurePosixPath
import json
import re
import shutil
import sys
import tarfile

stage = Path(sys.argv[1])
project, signer, schema, image = sys.argv[2:]
status = [row.split() for row in (stage / 'signatures').read_text().splitlines()]
if not any(len(row) > 2 and row[:2] == ['[GNUPG:]', 'VALIDSIG'] and (row[2] == signer or row[-1] == signer) for row in status):
    raise SystemExit('Backup has no signature from the approved signer')
expected = {'db.sql', 'schema', 'image', 'source_project', 'captured_at', 'manifest.json'}
target = stage / 'verified'
target.mkdir()
(target / 'assets').mkdir()
files = set()
with tarfile.open(stage / 'payload.tar') as archive:
    for member in archive:
        name = member.name.removeprefix('./')
        if member.isdir() and name in {'.', '', 'assets'}:
            continue
        if (not member.isfile() or (name not in expected and not re.fullmatch(r'assets/[0-9a-f]{32}', name))
            or name in files or not PurePosixPath(name).parts):
            raise SystemExit('Backup contains an unexpected or duplicate entry')
        files.add(name)
        with archive.extractfile(member) as source, (target / name).open('xb') as destination:
            shutil.copyfileobj(source, destination)
if not expected <= files:
    raise SystemExit('Backup metadata is incomplete')
manifest = json.loads((target / 'manifest.json').read_text(encoding='utf-8'))
if not isinstance(manifest, dict) or set(manifest) != files - {'manifest.json'}:
    raise SystemExit('Backup manifest does not list exactly the imported files')
for name, digest in manifest.items():
    with (target / name).open('rb') as source:
        if file_digest(source, 'sha256').hexdigest() != digest:
            raise SystemExit('Backup checksum mismatch')
if (target / 'source_project').read_text().strip() == project:
    raise SystemExit('Restore cannot target its source project')
if (target / 'schema').read_text().strip() != schema or (target / 'image').read_text().strip() != image:
    raise SystemExit('Backup does not match the approved compatible application and schema')
PY

# Verification-only is for an operator inspecting a bundle before choosing a destination.
if [[ -n "$verify_only" ]]; then
  printf 'Verified signed bundle; no Docker or database operations were run.\n'
  exit 0
fi

# A verified backup is still not authorization to overwrite a populated destination.
: "${SHOWCASE_ASSET_DIR:?Set the isolated destination asset path}"
[[ -d "$SHOWCASE_ASSET_DIR" && ! -L "$SHOWCASE_ASSET_DIR" ]] || exit 2
shopt -s nullglob dotglob
present=("$SHOWCASE_ASSET_DIR"/*)
((${#present[@]} == 0)) || { printf 'Restore always requires an empty isolated asset directory\n' >&2; exit 1; }
command -v docker >/dev/null || exit 69
compose=(docker compose --project-name "$project" -f "$(dirname "$0")/compose.yaml")
target_image=$(docker image inspect --format '{{.Id}}' "${SHOWCASE_API_IMAGE:-showcase-api:local}")
[[ "$target_image" == "$SHOWCASE_EXPECT_API_IMAGE_ID" ]] || { printf 'Target API image does not match the approved restore image\n' >&2; exit 1; }
if ! running=$( "${compose[@]}" ps --status running --services api proxy ); then
  printf 'Could not verify isolated API and proxy state; restore was not attempted\n' >&2
  exit 1
fi
[[ -z "$running" ]] || { printf 'Stop the isolated API and proxy before restoring\n' >&2; exit 1; }
existing=$(sudo mysql -uroot -N -B cosmetics-product-platform -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()")
[[ "$existing" == 0 ]] || { printf 'The isolated target database is not empty\n' >&2; exit 1; }
sudo mysql -uroot <"$stage/verified/db.sql"
for entry in "$stage/verified/assets"/*; do
  destination="$SHOWCASE_ASSET_DIR/${entry##*/}"
  [[ ! -e "$destination" && ! -L "$destination" ]] || exit 1
  install -m 0640 -o 10001 -g 10001 -- "$entry" "$destination"
done
printf 'Verified files restored into the isolated target. API and proxy remain stopped pending acceptance.\n'
