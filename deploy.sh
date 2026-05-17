#!/usr/bin/env bash
# deploy.sh — Deploys this repo to a remote Docker host over SSH.
#
# Reads HOST and SUDO_PASS from .env.deploy (gitignored). Example .env.deploy:
#   HOST=user@1.2.3.4
#   REMOTE_DIR=/home/user/patzer
#   SUDO_PASS=...
#   HOST_PORT=8800
#
# Usage:
#   ./deploy.sh              # tar source → ssh, build & start
#   ./deploy.sh --no-build   # restart without rebuilding the image
#   ./deploy.sh --logs       # tail logs after deploy

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$script_dir/.env.deploy"

if [[ ! -f "$env_file" ]]; then
  echo ".env.deploy not found. Create it with HOST=user@host, REMOTE_DIR=/path, SUDO_PASS=... (optional)" >&2
  exit 1
fi

# Parse .env.deploy without source'ing it (values may contain shell metacharacters)
HOST_TARGET=""
REMOTE_DIR=""
SUDO_PASS=""
HOST_PORT="8800"
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  if [[ "$line" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    # Strip surrounding quotes if present and trailing whitespace
    value="${value%$'\r'}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    case "$key" in
      HOST) HOST_TARGET="$value" ;;
      REMOTE_DIR) REMOTE_DIR="$value" ;;
      SUDO_PASS) SUDO_PASS="$value" ;;
      HOST_PORT) HOST_PORT="$value" ;;
    esac
  fi
done < "$env_file"

if [[ -z "$HOST_TARGET" || -z "$REMOTE_DIR" ]]; then
  echo "HOST and REMOTE_DIR must be set in .env.deploy" >&2
  exit 1
fi

no_build=0
tail_logs=0
for arg in "$@"; do
  case "$arg" in
    --no-build|-NoBuild) no_build=1 ;;
    --logs|-Logs)        tail_logs=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

cyan='\033[0;36m'; green='\033[0;32m'; reset='\033[0m'
log()   { printf "${cyan}→ %s${reset}\n" "$*"; }
done_() { printf "${green}%s${reset}\n" "$*"; }

remote_exec() {
  # shellcheck disable=SC2029
  ssh "$HOST_TARGET" "$1"
}

remote_sudo_script() {
  local script="$1"
  local local_script remote_script rc
  local_script="$(mktemp -t patzer-remote-XXXXXX.sh)"
  remote_script="/tmp/patzer-remote-$RANDOM-$$.sh"
  {
    printf '#!/usr/bin/env bash\nset -e\n'
    printf '%s\n' "$script"
  } > "$local_script"
  scp -q "$local_script" "${HOST_TARGET}:${remote_script}"
  if [[ -n "$SUDO_PASS" ]]; then
    # shellcheck disable=SC2029
    ssh "$HOST_TARGET" "chmod +x '$remote_script' && echo '$SUDO_PASS' | sudo -S -p '' bash '$remote_script'; rc=\$?; rm -f '$remote_script'; exit \$rc"
  else
    # shellcheck disable=SC2029
    ssh "$HOST_TARGET" "chmod +x '$remote_script' && sudo bash '$remote_script'; rc=\$?; rm -f '$remote_script'; exit \$rc"
  fi
  rc=$?
  rm -f "$local_script"
  return $rc
}

log "Ensuring remote dir $REMOTE_DIR exists"
remote_exec "mkdir -p '$REMOTE_DIR'"

log "Syncing source to ${HOST_TARGET}:${REMOTE_DIR}"
local_tar="$(mktemp -t patzer-deploy-XXXXXX.tar.gz)"
remote_tar="/tmp/patzer-deploy-$RANDOM-$$.tar.gz"
trap 'rm -f "$local_tar"' EXIT

tar \
  --exclude='node_modules' --exclude='.git' --exclude='dist' \
  --exclude='build'        --exclude='data' --exclude='bin' \
  --exclude='.env'         --exclude='.env.deploy' \
  -czf "$local_tar" -C "$script_dir" .

scp -q "$local_tar" "${HOST_TARGET}:${remote_tar}"
remote_exec "tar -xzf '$remote_tar' -C '$REMOTE_DIR' && rm -f '$remote_tar'"

if [[ $no_build -eq 0 ]]; then
  log "Building image on remote (this can take a few minutes)"
  remote_sudo_script "cd '$REMOTE_DIR'
HOST_PORT=$HOST_PORT docker compose build"
fi

log "Starting container"
remote_sudo_script "cd '$REMOTE_DIR'
HOST_PORT=$HOST_PORT docker compose up -d
sleep 2
docker compose ps"

if [[ $tail_logs -eq 1 ]]; then
  remote_sudo_script "cd '$REMOTE_DIR'
docker compose logs --tail=50"
fi

server_ip="${HOST_TARGET##*@}"
echo
done_ "Deployed. Open http://${server_ip}:${HOST_PORT}"
