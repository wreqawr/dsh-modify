#!/usr/bin/env bash
# =============================================================================
# DeepSeek Harness Service Manager
# =============================================================================
# One-click management script for the DeepSeek Harness Web UI.
#
# Usage:
#   ./service.sh [command] [port]    (no command defaults to restart)
#
# Commands:
#   start     Build (if needed) and start the web UI server in the background
#   stop      Stop the running web UI server and all its children
#   restart   Restart the web UI server (default when no command given)
#   status    Check whether the service is running
#   build     Run a full project build (host + client + web)
#   logs      Tail the service log file (Ctrl-C to exit)
#   dev       Full dev loop: build + web server + client plugin watcher
#   help      Show this help message
#
# Port (optional): positional argument after start/restart/dev, the DSH_PORT
# environment variable, or the DEFAULT_PORT constant (3080). A bare number is
# treated as restart on that port.
#
# Runtime files (gitignored):
#   .dsh-service.pid   — PID of the background web server process
#   .dsh-service.log   — Combined stdout/stderr log of the web server
#   .dsh-service.port  — The port the running server listens on
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$PROJECT_DIR/.dsh-service.pid"
LOG_FILE="$PROJECT_DIR/.dsh-service.log"
PORT_FILE="$PROJECT_DIR/.dsh-service.port"
HOST="127.0.0.1"
DEFAULT_PORT=3080
PORT="$DEFAULT_PORT"                         # effective port (see resolve_port)
BUILD_SENTINEL="$PROJECT_DIR/apps/cli/lib"   # exists after a successful build

# ---------------------------------------------------------------------------
# Colors (disabled when stdout is not a terminal)
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; NC=''
fi

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }

# Resolve the effective listen port: positional argument > DSH_PORT env > default.
# Sets the global PORT variable and validates it is a non-negative integer.
resolve_port() {
  local arg="${1:-}"
  local candidate="${arg:-${DSH_PORT:-$DEFAULT_PORT}}"
  if [[ ! "$candidate" =~ ^[0-9]+$ ]]; then
    log_error "Invalid port: $candidate (must be a non-negative integer)"
    exit 1
  fi
  PORT="$candidate"
}

# The Web UI URL for the given port (defaults to the global PORT).
web_url() {
  echo "http://$HOST:${1:-$PORT}"
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
check_prerequisites() {
  local missing=()
  command -v node   >/dev/null 2>&1 || missing+=(node)
  command -v pnpm   >/dev/null 2>&1 || missing+=(pnpm)
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required tools: ${missing[*]}"
    echo "  Install Node.js (>=22.19 or >=24) and enable pnpm via Corepack:"
    echo "    corepack enable"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# PID helpers
# ---------------------------------------------------------------------------

# Read the PID file and verify the process is still alive.
# Prints the PID and returns 0 on success, returns 1 otherwise.
read_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)" || return 1
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    return 1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
    return 0
  fi
  # Stale PID file — clean it up
  rm -f "$PID_FILE"
  return 1
}

# Recursively kill a process and all its descendants.
# On macOS `pkill -P` lists direct children; we recurse to cover grandchildren.
kill_tree() {
  local pid="$1"
  local sig="${2:-TERM}"
  # Kill children first so they can clean up before the parent exits
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Wait for a process (and its tree) to exit, with a timeout.
# Returns 0 if exited, 1 if still alive after timeout.
wait_for_exit() {
  local pid="$1"
  local timeout="${2:-10}"
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && (( elapsed < timeout )); do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  kill -0 "$pid" 2>/dev/null && return 1
  return 0
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

do_build() {
  log_step "Building project (host + client + web)…"
  cd "$PROJECT_DIR"
  pnpm run build
  log_info "Build complete. ✔"
}

do_start() {
  check_prerequisites

  if pid="$(read_pid 2>/dev/null)"; then
    log_warn "Service is already running (PID: $pid)"
    log_info "Web UI → $(web_url "$(cat "$PORT_FILE" 2>/dev/null || true)")"
    return 0
  fi

  # Build on first run or if the build output is missing
  if [[ ! -d "$BUILD_SENTINEL" ]]; then
    log_info "No build output detected — running a full build first…"
    do_build
  fi

  log_step "Starting DeepSeek Harness Web UI on port ${PORT}…"
  cd "$PROJECT_DIR"

  # Truncate the log file so each start begins with a clean slate
  : > "$LOG_FILE"

  # Launch in a new process group so we can kill the whole tree later
  pnpm dsh web --port "$PORT" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid"  > "$PID_FILE"
  echo "$PORT" > "$PORT_FILE"

  # Give the server a moment to come up, then verify
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    log_info "Service started. ✔  (PID: $pid)"
    echo ""
    echo -e "  ${BOLD}Web UI :${NC}  $(web_url)"
    echo -e "  ${BOLD}Logs   :${NC}  $LOG_FILE"
    echo -e "  ${BOLD}PID    :${NC}  $PID_FILE"
    echo ""
    echo "  Tail logs:  ./service.sh logs"
    echo "  Stop:       ./service.sh stop"
  else
    log_error "Service failed to start. Last 20 lines of log:"
    echo "───────────────────────────────────────"
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    echo "───────────────────────────────────────"
    rm -f "$PID_FILE" "$PORT_FILE"
    return 1
  fi
}

do_stop() {
  local pid
  if ! pid="$(read_pid 2>/dev/null)"; then
    log_warn "Service is not running (no live PID found)."
    return 0
  fi

  log_step "Stopping service (PID: $pid)…"

  # Graceful: SIGTERM the whole tree
  kill_tree "$pid" TERM

  if wait_for_exit "$pid" 10; then
    log_info "Service stopped gracefully. ✔"
  else
    log_warn "Process did not exit within 10 s — sending SIGKILL…"
    kill_tree "$pid" KILL
    sleep 1
    log_info "Service force-stopped. ✔"
  fi

  rm -f "$PID_FILE" "$PORT_FILE"
}

do_restart() {
  do_stop
  sleep 1
  do_start
}

do_status() {
  local pid
  if pid="$(read_pid 2>/dev/null)"; then
    local port
    port="$(cat "$PORT_FILE" 2>/dev/null || echo "$DEFAULT_PORT")"
    log_info "Service is ${GREEN}running${NC} (PID: $pid)"
    echo ""
    echo -e "  ${BOLD}Web UI :${NC}  $(web_url "$port")"
    echo -e "  ${BOLD}Logs   :${NC}  $LOG_FILE"
    echo -e "  ${BOLD}PID    :${NC}  $PID_FILE"

    # Quick liveness probe (optional — don't fail if curl isn't around)
    if command -v curl >/dev/null 2>&1; then
      if curl -sf -o /dev/null --max-time 3 "$(web_url "$port")" 2>/dev/null; then
        echo -e "  ${BOLD}HTTP   :${NC}  ${GREEN}reachable${NC}"
      else
        echo -e "  ${BOLD}HTTP   :${NC}  ${YELLOW}not responding yet${NC} (server may still be starting)"
      fi
    fi
    return 0
  else
    log_warn "Service is ${RED}not running${NC}."
    return 1
  fi
}

do_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    log_warn "No log file found at: $LOG_FILE"
    log_info "Start the service first: ./service.sh start"
    return 1
  fi
  log_info "Tailing $LOG_FILE  (Ctrl-C to exit)"
  echo "───────────────────────────────────────"
  tail -f "$LOG_FILE"
}

do_dev() {
  check_prerequisites

  log_step "Dev mode: full build → web server → client plugin watcher"
  log_info "This command runs in the foreground; Ctrl-C stops everything."
  echo ""

  # 1. Build
  do_build

  # 2. Start web server in the background (so we can also run the watcher)
  cd "$PROJECT_DIR"
  : > "$LOG_FILE"

  pnpm dsh web --port "$PORT" >>"$LOG_FILE" 2>&1 &
  local web_pid=$!
  disown "$web_pid" 2>/dev/null || true
  echo "$web_pid" > "$PID_FILE"
  echo "$PORT"    > "$PORT_FILE"
  log_info "Web server started (PID: $web_pid)"
  log_info "Web UI → $(web_url)"

  # 3. Cleanup handler: when this script exits (Ctrl-C, kill, etc.),
  #    tear down the web server so we don't leak processes.
  cleanup() {
    echo ""
    log_step "Dev mode interrupted — stopping web server (PID: $web_pid)…"
    kill_tree "$web_pid" TERM
    wait_for_exit "$web_pid" 5 || kill_tree "$web_pid" KILL
    rm -f "$PID_FILE" "$PORT_FILE"
    log_info "Dev mode stopped. ✔"
  }
  trap cleanup EXIT INT TERM

  # 4. Run the client plugin watcher in the foreground.
  #    tsdown rewrites lib/client.js on every source change;
  #    the web server polls those bundles and pushes HMR frames.
  log_step "Starting client plugin watcher (pnpm run dev:web --poll)…"
  pnpm run dev:web -- --poll
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  echo ""
  echo -e "${BOLD}DeepSeek Harness — Service Manager${NC}"
  echo ""
  echo "Usage:"
  echo "  ./service.sh [command] [port]"
  echo ""
  echo "Commands:"
  echo "  start     Build (if needed) and start the web UI server"
  echo "  stop      Stop the running web UI server"
  echo "  restart   Restart the web UI server (default when no command given)"
  echo "  status    Check whether the service is running"
  echo "  build     Run a full project build"
  echo "  logs      Tail the service log file (Ctrl-C to exit)"
  echo "  dev       Full dev loop: build + server + client watcher"
  echo "  help      Show this help message"
  echo ""
  echo "Port (optional, default $DEFAULT_PORT):"
  echo "  Passed as a positional argument after start/restart/dev, or via the"
  echo "  DSH_PORT environment variable. A bare number is treated as restart."
  echo ""
  echo "Runtime files:"
  echo "  $PID_FILE"
  echo "  $LOG_FILE"
  echo "  $PORT_FILE"
  echo ""
  echo "Examples:"
  echo "  ./service.sh               # restart on default port"
  echo "  ./service.sh 8888          # restart on port 8888"
  echo "  ./service.sh start 8888    # build + launch on port 8888"
  echo "  ./service.sh restart 8888  # restart on port 8888"
  echo "  ./service.sh dev 8888      # dev loop on port 8888"
  echo "  DSH_PORT=8888 ./service.sh # restart on port 8888"
  echo "  ./service.sh logs          # follow the log"
  echo ""
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
case "${1:-}" in
  start)           resolve_port "${2:-}"; do_start   ;;
  stop)            do_stop    ;;
  restart)         resolve_port "${2:-}"; do_restart ;;
  status)          do_status  ;;
  build)           do_build   ;;
  logs)            do_logs    ;;
  dev)             resolve_port "${2:-}"; do_dev     ;;
  help|--help|-h)  usage      ;;
  "")
    # No command: restart on the default/env port.
    resolve_port ""
    do_restart
    ;;
  *)
    # A bare numeric argument means "restart on that port".
    if [[ "$1" =~ ^[0-9]+$ ]]; then
      resolve_port "$1"
      do_restart
    else
      log_error "Unknown command: $1"
      usage
      exit 1
    fi
    ;;
esac
