#!/usr/bin/env bash
#
# Full-stack restore for NBCG.
#
#   ENV=<dev|prod> RESTIC_REPO=<...> ./infrastructure/scripts/restore.sh [SNAPSHOT_ID|timestamp]
#   ENV=prod RESTIC_REPO=... ./infrastructure/scripts/restore.sh --yes
#
# What it does:
#   1. Locates a snapshot (by timestamp YYYYMMDD-HHMMSS, by restic snapshot ID,
#      or the latest `env:<env>` snapshot).
#   2. Stops the compose stack and wipes each runtime volume.
#   3. Restores the exact filesystem state of every volume from the snapshot.
#   4. Restores runtime configuration and secrets (.env, .secrets.prod.json,
#      .cli-state.json, master.config.json, certificates, rendered configs).
#   5. Brings the stack back up and waits for all services to become healthy.
#      After this, the stack is running exactly as it was at backup time.
#
# Environment variables:
#   ENV             dev|prod (default: from root .env, else dev)
#   RESTIC_REPO     the restic repo used by backup.sh (default $BACKUP_DIR/.repo
#                   where BACKUP_DIR=$ROOT/backups/$ENV)
#   SNAPSHOT        timestamp or restic snapshot ID; omit for latest
#   --yes           skip the interactive confirmation (for cron use)
#
# After a restore, `make list` / `make health` reflect the state at backup
# time. If the CLI implementation has changed since the backup, some steps may
# read "stale" — `make clear T=state --yes` + a fresh run will fix that.
#
# The Makefile target `make cron-restore` calls this script as-is.

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
RESTIC_REPO="${RESTIC_REPO:-$BACKUP_DIR/.repo}"
SNAPSHOT="${1:---latest}"
CONFIRM=false
for a in "$@"; do
  [ "$a" = "--yes" ] && CONFIRM=true
done

# Resolve compose flags (-f before each file), exactly like the CLI.
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

if command -v restic >/dev/null 2>&1; then
  :
elif [ -x "$HOME/bin/restic" ] || [ -x "$HOME/.local/bin/restic" ]; then
  export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
else
  echo "[ERROR] restic not found. Install it (apt-get install -y restic, or copy restic to $HOME/bin/restic) or point RESTIC_REPO at an existing repo." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 || {
    echo "[ERROR] 'docker compose' is not available. Is the compose plugin installed?" >&2
    exit 1
  }
else
  echo "[ERROR] docker is not available." >&2
  exit 1
fi

log() {
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*"
}

export RESTIC_PASSWORD
resolve_restic_password() {
  if [ -n "${RESTIC_PASSWORD:-}" ]; then
    export RESTIC_PASSWORD
    return
  fi
  local env_file
  if [ "$ENV" = "prod" ]; then env_file="$INFRA/env/.env.prod"; else env_file="$ROOT/.env"; fi
  if [ -f "$env_file" ]; then
    RESTIC_PASSWORD=$(sed -n 's/^RESTIC_PASSWORD=\(.*\)$/\1/p' "$env_file" | head -1)
    export RESTIC_PASSWORD
  fi
}
resolve_restic_password

# ---------------------------------------------------------------------------
# Locate the snapshot
# ---------------------------------------------------------------------------
find_snapshot() {
  if [ "$SNAPSHOT" = "--latest" ] || [ -z "$SNAPSHOT" ]; then
    local snap_json
    snap_json=$(restic snapshots --repo "$RESTIC_REPO" --tag "env:$ENV" --tag "backup:stack" --json 2>/dev/null | head -c 4096)
    if ! echo "$snap_json" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d else 1)" 2>/dev/null; then
      echo "[ERROR] No RESTIC snapshots found for env '$ENV' in repo '$RESTIC_REPO'." >&2
      echo "  Try: restic snapshots --repo '$RESTIC_REPO' --tag 'env:$ENV'" >&2
      exit 1
    fi
    echo "$snap_json" | python3 -c '
import json,sys
snaps = json.load(sys.stdin)
snaps.sort(key=lambda s: s["time"], reverse=True)
s = snaps[0]
print(s["id"])
print(s["path"])
print(s["time"])
'
    return
  fi
  # Timestamp form: YYYYMMDD-HHMMSS
  if echo "$SNAPSHOT" | grep -qE '^[0-9]{8}-[0-9]{6}$'; then
    local m
    m="$BACKUP_DIR/$SNAPSHOT/snapshot-info.json"
    if [ ! -f "$m" ]; then
      echo "[ERROR] Snapshot '$SNAPSHOT' not found (expected $m)." >&2
      exit 1
    fi
    echo "$SNAPSHOT"
    echo "$BACKUP_DIR/$SNAPSHOT"
    echo "manual"
    return
  fi
  # RESTIC snapshot ID form: fall back to restic by ID
  local snap_json
  snap_json=$(restic snapshots --repo "$RESTIC_REPO" --json 2>/dev/null | head -c 4096)
  if ! echo "$snap_json" | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin) else 1)" 2>/dev/null; then
    echo "[ERROR] Snapshot '$SNAPSHOT' not found in RESTIC repo '$RESTIC_REPO'." >&2
    exit 1
  fi
  local id path time
  id=$(echo "$snap_json" | python3 -c "
import json,sys
snaps = json.load(sys.stdin)
for s in snaps:
    if s['id'].startswith('$SNAPSHOT'):
        print(s['id']); print(s['path']); print(s['time']); sys.exit(0)
sys.exit(1)") || { echo "[ERROR] Snapshot '$SNAPSHOT' not found." >&2; exit 1; }
  echo "$id"
  echo "$path"
  echo "manual"
}

SNAP_RESULT=$(find_snapshot)
SNAP_ID=$(echo "$SNAP_RESULT" | sed -n '1p')
SNAPDIR=$(echo "$SNAP_RESULT" | sed -n '2p')
SNAP_TIME=$(echo "$SNAP_RESULT" | sed -n '3p')

SNAPDIR=$(python3 -c "import os,sys; print(os.path.abspath(sys.argv[1]))" "$SNAPDIR")

if [ ! -f "$SNAPDIR/snapshot-info.json" ]; then
  echo "[ERROR] snapshot-info.json not found at $SNAPDIR" >&2
  exit 1
fi

log "[INFO] Restoring snapshot ID '$SNAP_ID' from '$SNAPDIR' ($SNAP_TIME)"

# Read the manifest.
MANIFEST="$SNAPDIR/snapshot-info.json"
RESTORE_ENV=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['env'])" "$MANIFEST")
RESTORE_PROJECT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['project'])" "$MANIFEST")
log "[INFO] Restoring to environment '$RESTORE_ENV' (project: $RESTORE_PROJECT)"

log "[INFO] Volumes in snapshot:"
VOLUME_NAMES=()
python3 -c "
import json,sys
m = json.load(open(sys.argv[1]))
for f in m['files']:
    if f['name'].endswith('.tar.gz') and not f['name'].endswith('nginx-logs.tar.gz'):
        print(f['name'])
" "$MANIFEST" | while IFS= read -r n; do echo "  - $n"; done

# ---------------------------------------------------------------------------
# Confirm (non-destructive)
# ---------------------------------------------------------------------------
if [ "$CONFIRM" = false ]; then
  echo ""
  echo "This will stop the '$RESTORE_ENV' stack, remove ALL runtime volumes and"
  echo "replace them with the data from snapshot '$SNAP_ID' ($SNAP_TIME)."
  printf "Continue? [y/N] "
  read -r ans
  case "$ans" in
    [Yy]*) CONFIRM=true ;;
    *) echo "[INFO] Aborted."; exit 0 ;;
  esac
fi

# ---------------------------------------------------------------------------
# Stop the stack and wipe volumes
# ---------------------------------------------------------------------------
log "[INFO] Stopping stack ..."
docker compose "${COMPOSE_FLAGS[@]}" stop -t 60 >/dev/null || true
docker compose "${COMPOSE_FLAGS[@]}" down >/dev/null 2>&1 || true

log "[INFO] Recreating fresh volumes ..."
VOLUME_NAMES=()
while IFS= read -r name; do
  [ -n "$name" ] && VOLUME_NAMES+=("$name")
done < <(docker compose "${COMPOSE_FLAGS[@]}" config --format json \
  | python3 -c 'import json,sys; [print(v["name"]) for v in json.load(sys.stdin).get("volumes", {}).values()]')

for vol in "${VOLUME_NAMES[@]}"; do
  log "[INFO] Removing old volume: $vol"
  docker volume rm "$vol" >/dev/null 2>&1 || true
done

# Fresh volumes are created by compose when containers are created.
docker compose "${COMPOSE_FLAGS[@]}" up -d --no-start >/dev/null 2>&1 || true

# Verify each volume now exists; create any missing ones explicitly.
for vol in "${VOLUME_NAMES[@]}"; do
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    log "[INFO] Volume $vol not created by compose; creating explicitly ..."
    docker volume create "$vol" >/dev/null 2>&1
  fi
done

# ---------------------------------------------------------------------------
# Extract each volume's tarball into its fresh volume
# ---------------------------------------------------------------------------
log "[INFO] Extracting volumes from snapshot ..."
for vol in "${VOLUME_NAMES[@]}"; do
  tar="$SNAPDIR/$(basename "$vol").tar.gz"
  if [ ! -f "$tar" ]; then
    echo "[ERROR] Volume archive not found: $tar" >&2
    exit 1
  fi
  log "[INFO] Restoring volume: $vol"
  docker run --rm \
    -v "$vol:/dst" \
    -v "$tar:/src:ro" \
    busybox:1.36 \
    sh -c "rm -rf /dst/* && tar xzf /src -C /dst" \
    || { log "[ERROR] Failed to restore volume '$vol'"; exit 1; }
  log "[INFO] Volume restored: $vol"
done

# ---------------------------------------------------------------------------
# Restore runtime configuration and secrets
# ---------------------------------------------------------------------------
log "[INFO] Restoring runtime configuration and secrets ..."
python3 - "$SNAPDIR" "$ROOT" "$INFRA" <<'PY'
import json, os, shutil, sys
snapdir, root, infra = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(os.path.join(snapdir, "snapshot-info.json")))
targets = {
    "env.root": os.path.join(root, ".env"),
    "secrets.prod.json": os.path.join(infra, ".secrets.prod.json"),
    "cli-state.json": os.path.join(infra, ".cli-state.json"),
    "master.config.json": os.path.join(infra, "master.config.json"),
    "nginx.conf": os.path.join(infra, "docker", "nginx", "nginx.conf"),
    "htpasswd": os.path.join(infra, "docker", "nginx", "htpasswd"),
    "opensearch.yml": os.path.join(infra, "docker", "opensearch", "opensearch.yml"),
    "nbcg-realm.json": os.path.join(infra, "docker", "keycloak", "nbcg-realm.json"),
    "servers.json": os.path.join(infra, "docker", "pgadmin", "servers.json"),
}
for entry in m["files"]:
    name = entry["name"]
    if name in targets:
        d = os.path.dirname(targets[name])
        if not os.path.exists(d):
            os.makedirs(d)
        shutil.copy2(os.path.join(snapdir, name), targets[name])
        print(f"  restored {targets[name]}")
    elif name == "certs":
        dest = os.path.join(infra, "docker", "certs")
        if os.path.exists(dest):
            shutil.rmtree(dest)
        shutil.copytree(os.path.join(snapdir, name), dest)
        print(f"  restored {dest}")
PY

log "[INFO] Runtime configuration restored."

# ---------------------------------------------------------------------------
# Bring the stack back up
# ---------------------------------------------------------------------------
log "[INFO] Starting stack ..."
docker compose "${COMPOSE_FLAGS[@]}" up -d >/dev/null 2>&1 || {
  log "[WARN] 'docker compose up' reported non-zero; checking service status anyway."
}

log "[INFO] Waiting for all services to become healthy (timeout 600s) ..."
WAITED=0
while [ $WAITED -lt 600 ]; do
  down=0
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
  log "[WARN] Start services manually and re-check: make docker A=up && make docker A=health"
else
  log "[INFO] Stack is up and healthy."
fi

# ---------------------------------------------------------------------------
# Production note
# ---------------------------------------------------------------------------
if [ "$ENV" = "prod" ]; then
  log "[INFO] Production restore note:"
  log "[INFO]   - The stack on 'up' automatically reconciles credentials and applies"
  log "[INFO]     OpenSearch security, so no manual steps are required."
  log "[INFO]   - Application images (frontend/backend) are rebuilt by compose up if"
  log "[INFO]     needed; run 'make docker A=build' if you want a controlled rebuild."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
log "[INFO] ================= RESTORE SUMMARY ================="
log "[INFO] Snapshot restored: $SNAP_ID ($SNAP_TIME)"
log "[INFO] Repo:              $RESTIC_REPO"
echo "  Snapshot:           $SNAP_ID"
echo "  Data restored to:   $RESTORE_ENV stack ($RESTORE_PROJECT)"
echo "  Restic repo:        $RESTIC_REPO"
echo "  New latest snapshot for $RESTORE_ENV:"
restic snapshots --repo "$RESTIC_REPO" --tag "env:$RESTORE_ENV" --latest 1 --json \
  | python3 -c '
import json,sys
s = json.load(sys.stdin)[0]
print("   ID:", s["id"], "| time:", s["time"])' 2>/dev/null || true
echo ""
echo "Next steps:"
echo "  make docker A=health          # per-service health status"
echo "  make docker A=ps              # running containers"
if [ "$ENV" = "prod" ]; then
  echo "  make docker A=os-secure       # (usually auto-run on 'up') configure OpenSearch security"
fi
echo "  ./infrastructure/scripts/backup.sh   # take a new backup after verifying"
