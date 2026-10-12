#!/usr/bin/env bash
#
# Full-stack backup for NBCG.
#
#   ENV=<dev|prod> BACKUP_DIR=<...> make cron-backup
#   ENV=prod ./infrastructure/scripts/backup.sh
#
# What it does:
#   1. Gracefully stops the compose stack for the given environment
#      (full-stack stop, ~30 s downtime, gives a fully consistent snapshot of
#      every volume at one point in time).
#   2. Tarballs every runtime volume into a timestamped snapshot directory.
#   3. Copies runtime-generated configuration and secrets into the snapshot.
#   4. Initializes (if needed) and writes a RESTIC backup of the snapshot,
#      applies retention (default: 7 daily / 4 weekly / 6 monthly), verifies.
#   5. Brings the stack back up and waits for all services to become healthy.
#
# Data backed up (everything that cannot be pulled/cloned from the repo):
#   - postgres-data (app DB), keycloak-data (Keycloak DB), pgadmin-data
#   - opensearch-data, redis-data, seaweedfs-data
# Runtime config backed up:
#   - root .env, infrastructure/.secrets.prod.json (prod only)
#   - infrastructure/.cli-state.json (state machine, so restore = exact old state)
#   - infrastructure/master.config.json, docker/certs/*, docker/nginx/*,
#     docker/opensearch/*, docker/keycloak/nbcg-realm.json, docker/pgadmin/servers.json
# NOT backed up:
#   - nginx-logs (log data, not required for a restore)
#   - application container images (rebuilt automatically by `docker compose up`)
#
# Environment variables:
#   ENV             dev|prod (default: from root .env, else dev)
#   BACKUP_DIR      snapshot destination, default $ROOT/backups/$ENV
#   RESTIC_REPO     restic repo location; default $BACKUP_DIR/.repo (local,
#                   inside the repo) or any restic target (s3://, ssh://...).
#   RESTIC_PASSWORD REQUIRED if RESTIC_REPO is unset, or read from
#                   $BACKUP_DIR/.repo/.restic (default). Must be set in .env.<env>
#                   or passed in the environment for cron use.
#   RETENTION_KEEP_DAILY/KEEP_WEEKLY/KEEP_MONTHLY  defaults 7/4/6
#
# The Makefile targets `make cron-backup` / `make cron-restore` already call
# this script (and restore.sh) as-is; pass ENV=prod for a production backup.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults and resolution
# ---------------------------------------------------------------------------
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
INFRA="$ROOT/infrastructure"

ENV="${ENV:-}"
if [ -z "$ENV" ] && [ -f "$ROOT/.env" ]; then
  ENV=$(sed -n 's/^ENV=//p' "$ROOT/.env" | head -1)
fi
ENV="${ENV:-dev}"
if [ "$ENV" != "dev" ] && [ "$ENV" != "prod" ]; then
  echo "[ERROR] ENV must be 'dev' or 'prod', got '$ENV'" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups/$ENV}"
RETENTION_KEEP_DAILY="${RETENTION_KEEP_DAILY:-7}"
RETENTION_KEEP_WEEKLY="${RETENTION_KEEP_WEEKLY:-4}"
RETENTION_KEEP_MONTHLY="${RETENTION_KEEP_MONTHLY:-6}"

# ---------------------------------------------------------------------------
# Log file
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
LOG="$BACKUP_DIR/backup.log"

# ---------------------------------------------------------------------------
# Resolve compose flags (-f before each file), exactly like the CLI: root
# level preferred, otherwise the infrastructure/docker tree.
# ---------------------------------------------------------------------------
COMPOSE_FLAGS=()
resolve_compose_files() {
  local ext="ext"
  [ "$ENV" = "prod" ] && ext="prod"

  local root_ext="$ROOT/docker-compose.$ext.yml"
  local infra_ext="$INFRA/docker/docker-compose.$ext.yml"

  COMPOSE_FLAGS=(-f "$ROOT/docker-compose.yml")

  if [ -f "$root_ext" ]; then
    COMPOSE_FLAGS+=(-f "$root_ext")
  elif [ -f "$infra_ext" ]; then
    COMPOSE_FLAGS+=(-f "$infra_ext")
  else
    echo "[ERROR] No compose file found for $ENV at $root_ext or $infra_ext" >&2
    exit 1
  fi
}
resolve_compose_files

PROJECT_NAME=$(docker compose "${COMPOSE_FLAGS[@]}" config --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')

RESTIC_REPO="${RESTIC_REPO:-$BACKUP_DIR/.repo}"

# Find the restic binary: PATH, then the user's local bin, then install via apt
# (root only). A network install from GitHub is left out on purpose — the script
# stays simple and reliable and never guesses wrong about versions/platforms.
if command -v restic >/dev/null 2>&1; then
  :
elif [ -x "$HOME/bin/restic" ] || [ -x "$HOME/.local/bin/restic" ]; then
  export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
elif id -u >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  echo "[INFO] restic not found; attempting apt-get install ..."
  apt-get install -y -q restic >/dev/null 2>&1 || {
    echo "[ERROR] restic not available (apt-get failed; run as root first)." >&2
    echo "Install it manually: apt-get install -y restic" >&2
    exit 1
  }
  echo "[INFO] restic installed."
else
  echo "[ERROR] restic not found, not running as root, and no local bin available." >&2
  echo "Install it manually: curl -L -o restic \"https://github.com/restic/restic/releases/download/0.18.0/restic_0.18.0_linux_amd64.bz2\"" >&2
  exit 1
fi

restic version >/dev/null 2>&1 || {
  echo "[ERROR] restic became unavailable after install attempt." >&2
  exit 1
}

# Resolve RESTIC_PASSWORD: env var wins, then the per-env .env file.
resolve_restic_password() {
  if [ -n "${RESTIC_PASSWORD:-}" ]; then
    RESTIC_PASSWORD="$RESTIC_PASSWORD"
    return
  fi
  local env_file
  if [ "$ENV" = "prod" ]; then env_file="$INFRA/env/.env.prod"; else env_file="$ROOT/.env"; fi
  if [ -f "$env_file" ]; then
    RESTIC_PASSWORD=$(sed -n 's/^RESTIC_PASSWORD=\(.*\)$/\1/p' "$env_file" | head -1)
  fi
}
resolve_restic_password
if [ -z "${RESTIC_PASSWORD:-}" ]; then
  echo "[ERROR] RESTIC_PASSWORD is not set. Set it in the environment or in .env.${ENV}." >&2
  exit 1
fi
export RESTIC_PASSWORD

log() {
  local ts
  ts=$(date '+%Y-%m-%dT%H:%M:%S%z')
  echo "[$ts] $*" | tee -a "$LOG"
}

# ---------------------------------------------------------------------------
# Stop the stack (graceful stop gives a consistent snapshot on disk)
# ---------------------------------------------------------------------------
log "[INFO] Stopping stack for environment '$ENV' (project: $PROJECT_NAME)..."
docker compose "${COMPOSE_FLAGS[@]}" stop -t 60 >/dev/null || true

WAITED=0
while [ $WAITED -lt 300 ]; do
  running=$(docker compose "${COMPOSE_FLAGS[@]}" ps -q 2>/dev/null | wc -l)
  if [ "$running" -eq 0 ]; then
    log "[INFO] Stack fully stopped."
    break
  fi
  log "[INFO] Waiting for remaining containers to stop ($running still running)..."
  sleep 2
  WAITED=$((WAITED + 2))
done
if [ "$running" -ne 0 ]; then
  log "[WARN] Some containers did not stop cleanly; continuing anyway."
fi

# ---------------------------------------------------------------------------
# List volumes from the resolved compose configuration (resolved names)
# ---------------------------------------------------------------------------
log "[INFO] Resolving runtime volumes from compose config ..."
VOLUME_NAMES=()
while IFS= read -r name; do
  [ -n "$name" ] && VOLUME_NAMES+=("$name")
done < <(docker compose "${COMPOSE_FLAGS[@]}" config --format json \
  | python3 -c 'import json,sys; [print(v["name"]) for v in json.load(sys.stdin).get("volumes", {}).values()]')

VOLUME_LIST="${VOLUME_NAMES[*]:-<none>}"
log "[INFO] Volumes: $VOLUME_LIST"

# ---------------------------------------------------------------------------
# Create a timestamped snapshot directory
# ---------------------------------------------------------------------------
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
SNAPDIR="$BACKUP_DIR/$TIMESTAMP"
mkdir -p "$SNAPDIR"

log "[INFO] Snapshot directory: $SNAPDIR"

# ---------------------------------------------------------------------------
# Tarball each volume (a scratch container mounts the volume read-only and
# writes the archive into the snapshot directory)
# ---------------------------------------------------------------------------
for vol in "${VOLUME_NAMES[@]}"; do
  log "[INFO] Backing up volume: $vol"
  docker run --rm \
    -v "$vol:/src:ro" \
    -v "$SNAPDIR:/dst" \
    busybox:1.36 \
    sh -c "tar czf /dst/$(basename "$vol").tar.gz -C /src ." \
    || { log "[ERROR] Failed to back up volume '$vol'"; exit 1; }
  log "[INFO] Volume backup complete: $SNAPDIR/$(basename "$vol").tar.gz"
done

# ---------------------------------------------------------------------------
# Copy runtime-generated configuration and secrets into the snapshot
# ---------------------------------------------------------------------------
copy_if_present() {
  local src="$1" dst="$2"
  if [ -e "$src" ]; then
    local d
    d=$(dirname "$dst")
    mkdir -p "$d"
    cp -a "$src" "$dst"
    log "[INFO] Copied runtime config: $src -> $dst"
  fi
}

copy_if_present "$ROOT/.env" "$SNAPDIR/env.root"
if [ "$ENV" = "prod" ] && [ -f "$INFRA/.secrets.prod.json" ]; then
  cp -a "$INFRA/.secrets.prod.json" "$SNAPDIR/secrets.prod.json"
  log "[INFO] Copied runtime secrets: $INFRA/.secrets.prod.json -> $SNAPDIR/secrets.prod.json"
fi
copy_if_present "$INFRA/.cli-state.json" "$SNAPDIR/cli-state.json"
copy_if_present "$INFRA/master.config.json" "$SNAPDIR/master.config.json"
copy_if_present "$INFRA/docker/nginx/nginx.conf" "$SNAPDIR/nginx.conf"
copy_if_present "$INFRA/docker/nginx/htpasswd" "$SNAPDIR/htpasswd"
copy_if_present "$INFRA/docker/opensearch/opensearch.yml" "$SNAPDIR/opensearch.yml"
copy_if_present "$INFRA/docker/keycloak/nbcg-realm.json" "$SNAPDIR/nbcg-realm.json"
copy_if_present "$INFRA/docker/pgadmin/servers.json" "$SNAPDIR/servers.json"
# The certificate tree is gitignored and only ever written by the setup steps;
# keep a snapshot of the whole tree (CA + leaves + issued metadata).
if [ -d "$INFRA/docker/certs" ]; then
  cp -a "$INFRA/docker/certs" "$SNAPDIR/certs"
  log "[INFO] Copied certificate tree: $INFRA/docker/certs -> $SNAPDIR/certs"
fi

# ---------------------------------------------------------------------------
# Write the snapshot manifest (so restore knows exactly what went where)
# ---------------------------------------------------------------------------
python3 - "$SNAPDIR" <<'PY'
import json, os, sys
snapdir = sys.argv[1]
entries = []
for f in sorted(os.listdir(snapdir)):
    p = os.path.join(snapdir, f)
    size = os.path.getsize(p) if os.path.isfile(p) else 0
    entries.append({"name": f, "path": f, "size": size})
manifest = {"env": os.environ.get("ENV", "dev"),
            "timestamp": os.environ.get("TIMESTAMP"),
            "project": os.environ.get("PROJECT_NAME"),
            "restic_repo": os.environ.get("RESTIC_REPO"),
            "files": entries}
with open(os.path.join(snapdir, "snapshot-info.json"), "w") as fh:
    json.dump(manifest, fh, indent=2)
print("manifest written")
PY

log "[INFO] Snapshot manifest written: $SNAPDIR/snapshot-info.json"

# ---------------------------------------------------------------------------
# RESTIC: init repo (if missing), backup, forget (retention), verify
# ---------------------------------------------------------------------------
if [ ! -f "$RESTIC_REPO/config" ]; then
  log "[INFO] Initializing RESTIC repository at $RESTIC_REPO ..."
  restic init --repo "$RESTIC_REPO" --verbose >/dev/null || {
    log "[ERROR] RESTIC init failed."
    exit 1
  }
fi

DESC="NBCG stack backup — env=$ENV, project=$PROJECT_NAME"
log "[INFO] Writing RESTIC backup ..."
export RESTIC_DESCRIPTION="$DESC"
restic backup "$SNAPDIR" --repo "$RESTIC_REPO" --tag "env:$ENV" --tag "backup:stack" --verbose

log "[INFO] Applying retention (daily $RETENTION_KEEP_DAILY / weekly $RETENTION_KEEP_WEEKLY / monthly $RETENTION_KEEP_MONTHLY) ..."
restic forget --repo "$RESTIC_REPO" --keep-daily "$RETENTION_KEEP_DAILY" \
  --keep-weekly "$RETENTION_KEEP_WEEKLY" --keep-monthly "$RETENTION_KEEP_MONTHLY" --prune --verbose

log "[INFO] Verifying RESTIC repository ..."
restic check --repo "$RESTIC_REPO" --verbose

# ---------------------------------------------------------------------------
# Bring the stack back up and wait for healthy
# ---------------------------------------------------------------------------
log "[INFO] Starting stack back up ..."
docker compose "${COMPOSE_FLAGS[@]}" up -d >/dev/null 2>&1 || {
  log "[WARN] 'docker compose up' reported non-zero; checking service status anyway."
}

log "[INFO] Waiting for all services to become healthy (timeout 600s) ..."
WAITED=0
while [ $WAITED -lt 600 ]; do
  down=0
  unhealthy=0
  down=$(docker compose "${COMPOSE_FLAGS[@]}" ps --format json 2>/dev/null \
    | python3 -c '
import json,sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        s = json.loads(line)
    except json.JSONDecodeError:
        continue
    state = (s.get("State") or "").lower()
    health = (s.get("Health") or "").lower()
    if state == "unhealthy" or health == "unhealthy":
        print("unhealthy", s.get("Name"))
        sys.exit(0)
print("ok")
')
  if [ "$down" = "ok" ]; then
    log "[INFO] All services are running."
    break
  fi
  if [ "$down" != "ok" ]; then
    echo "$down" | sed 's/^unhealthy /\n  unhealthy: /' | sed 's/ unhealthy: /,/g' | tr ',' '\n' | sed 's/^/  - /'
    log "[INFO] Waiting for services to become healthy ..."
  fi
  sleep 5
  WAITED=$((WAITED + 5))
done

if [ "$down" != "ok" ]; then
  log "[WARN] Stack did not reach a fully healthy state within 600s."
  log "[WARN] If any services are down, start them manually: make docker A=up"
  log "[WARN] Then re-run: make docker A=health"
else
  log "[INFO] Stack is up and healthy."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
log "[INFO] ================= BACKUP SUMMARY ================="
log "[INFO] Snapshot:  $SNAPDIR"
log "[INFO] Repo:      $RESTIC_REPO"
echo "  Snapshot directory: $SNAPDIR"
for vol in "${VOLUME_NAMES[@]}"; do
  echo "    - $SNAPDIR/$(basename "$vol").tar.gz"
done
echo "    - $SNAPDIR/snapshot-info.json"
echo "  Restic repo:      $RESTIC_REPO"
echo ""
echo "To restore this snapshot:"
echo "  ENV=$ENV RESTIC_REPO=$RESTIC_REPO ./infrastructure/scripts/restore.sh $TIMESTAMP"
echo "  (or just './infrastructure/scripts/restore.sh' for the latest snapshot)"
