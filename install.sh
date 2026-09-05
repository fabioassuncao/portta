#!/usr/bin/env bash
# ============================================================================
# Portta installer
# ============================================================================
#   curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
#
# The same command installs, updates, and reconciles a broken configuration.
# It is idempotent: running it twice changes nothing the second time except
# the image tags it pulls.
#
# What it does NOT do, on purpose:
#
#   * clone the repository. A normal installation runs published images and a
#     handful of configuration files; the source tree is for developing Portta,
#     not for running it. See docs/adr/0020-installer-and-portta-home.md.
#   * build anything. Builds belong in CI.
#   * expose applications. It configures how you reach the PANEL and nothing
#     else. Each project decides its own exposure later, from the panel or the
#     CLI. See docs/adr/0021-panel-access-modes.md.
#   * touch Tailscale, Git, GitHub or an AI agent CLI. It reports on them and
#     stops there.
#
# Everything it writes lives under one directory (PORTTA_HOME), plus one
# optional symlink in a bin directory on PATH.
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Where the artefacts come from
# ---------------------------------------------------------------------------

PORTTA_REPO="${PORTTA_REPO:-fabioassuncao/portta}"
# Branch, tag or commit to install the runtime files from. `main` is the
# released line; CI and the test hosts override it.
PORTTA_REF="${PORTTA_REF:-main}"
# Namespace holding the published component images.
PORTTA_REGISTRY="${PORTTA_REGISTRY:-ghcr.io/fabioassuncao}"

PORTTA_INSTALLER_VERSION="1"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""
fi

step() { printf '\n%s%s%s\n\n' "$C_BOLD" "$*" "$C_RESET" >&2; }
say()  { printf '  %s\n' "$*" >&2; }
good() { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }
warn() { printf '  %s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
bad()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
note() { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RESET" >&2; }
die()  { printf '\n%serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Interaction
# ---------------------------------------------------------------------------
# The script is normally piped into bash, so stdin is the script itself.
# Prompts therefore read from the controlling terminal, never from stdin.

PORTTA_TTY=""
if [ -r /dev/tty ] && [ -w /dev/tty ] && { : >/dev/tty; } 2>/dev/null; then
  PORTTA_TTY=/dev/tty
fi

ASSUME_YES=false
NON_INTERACTIVE=false

interactive() {
  [ -n "$PORTTA_TTY" ] && [ "$NON_INTERACTIVE" != "true" ]
}

# ask <prompt> <default>: echoes the answer on stdout. Falls back to the
# default without blocking when there is no terminal.
ask() {
  local prompt="$1" default="${2:-}" reply=""
  if ! interactive; then printf '%s' "$default"; return 0; fi
  if [ -n "$default" ]; then
    printf '  %s [%s]: ' "$prompt" "$default" >/dev/tty
  else
    printf '  %s: ' "$prompt" >/dev/tty
  fi
  IFS= read -r reply </dev/tty || reply=""
  printf '%s' "${reply:-$default}"
}

# ask_secret <prompt>: reads without echoing. Empty means "generate one".
ask_secret() {
  local prompt="$1" reply=""
  if ! interactive; then printf ''; return 0; fi
  printf '  %s: ' "$prompt" >/dev/tty
  stty -echo </dev/tty 2>/dev/null || true
  IFS= read -r reply </dev/tty || reply=""
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  printf '%s' "$reply"
}

confirm() {
  local prompt="$1" reply
  [ "$ASSUME_YES" = "true" ] && return 0
  if ! interactive; then return 1; fi
  printf '  %s [y/N] ' "$prompt" >/dev/tty
  IFS= read -r reply </dev/tty || reply=""
  case "$reply" in y|Y|yes|YES|s|S|sim|SIM) return 0 ;; *) return 1 ;; esac
}

# For the one question whose only other answer is "then I cannot continue".
# Still asked, because installing Docker Engine changes the machine; defaulted
# to yes, because refusing it ends the run with an error either way.
confirm_default_yes() {
  local prompt="$1" reply
  [ "$ASSUME_YES" = "true" ] && return 0
  if ! interactive; then return 1; fi
  printf '  %s [Y/n] ' "$prompt" >/dev/tty
  IFS= read -r reply </dev/tty || reply=""
  case "$reply" in n|N|no|NO|nao|NAO|"não") return 1 ;; *) return 0 ;; esac
}

# ---------------------------------------------------------------------------
# Environment access
# ---------------------------------------------------------------------------
# Existing installs ship their reader. A fresh install has no file to read;
# all writes happen after the current runtime adapter has been downloaded.
env_get() {
  [ -f "$1" ] || return 0
  [ -f "$PORTTA_HOME/scripts/lib/env.sh" ] || die "the installation environment adapter is missing"
  ( . "$PORTTA_HOME/scripts/lib/env.sh"; portta_env_get "$1" "$2" )
}
env_set() { portta_env_set "$2" "$3" "$1"; }

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

INSTALL_DIR=""
PROJECTS_HOME=""
PANEL_ACCESS=""
PANEL_PORT=""
PANEL_AUTH=""
DOMAIN=""
DOMAIN_MODE=""
TLS_EMAIL=""
ACTION="install"
SKIP_DEPS=false
PULL_ONLY=false

usage() {
  cat >&2 <<'USAGE'
Portta installer

  curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash

The same command installs and updates. Flags are passed after `-s --`:

  curl -fsSL .../install.sh | bash -s -- --yes --panel-access public

OPTIONS
  --install-dir <path>    Where Portta keeps its data and configuration
                          (default: /opt/portta as root, ~/.portta otherwise)
  --projects-home <path>  Where this Node manages Projects
                          (default: ~/projects, or /srv/projects as root)
  --panel-access <mode>   public | tailscale | local | domain
                          (default: public). `domain` routes the panel at one
                          hostname of --domain over HTTPS, behind the same
                          login page a protected project gets; it needs --tls
  --panel-port <port>     Host port for the panel            (default: 8081)
  --panel-auth <mode>     required | disabled. `required` makes the panel sign
                          people in; `disabled` makes every request the local
                          operator and is only allowed on loopback
                          (default: required, except --panel-access local)
  --domain <domain>       Base domain for routed services    (optional)
  --domain-mode <mode>    Project hostnames: local | auto | custom
                          (default: auto on a server, local otherwise)
  --tls <email>           Serve HTTPS. Needs --domain and a wildcard record
                          pointing here; certificates come from Let's Encrypt
                          over HTTP-01, one per hostname, and :80 must be
                          reachable from the internet. The address is the ACME
                          account contact. For one wildcard instead, configure
                          DNS-01 afterwards: see docs/dns-and-tls.md
  --version <ref>         Tag, branch or commit to install   (default: main)
  --registry <namespace>  Image namespace  (default: ghcr.io/fabioassuncao)
  --skip-deps             Never offer to install Docker
  --pull-only             Pull images and exit; change nothing else
  --uninstall             Stop Portta and remove PORTTA_HOME, keeping volumes
  -y, --yes               Assume yes; still prompts for values it cannot detect
  --non-interactive       Never prompt; every unset value takes its default
  -h, --help              This text

There is no panel password here any more. The panel signs people in itself, and
the first account is created once, in a browser at /setup or from this host with
`portta auth bootstrap`. The installer prints the address at the end.

ENVIRONMENT
  PORTTA_HOME              same as --install-dir
  PORTTA_PROJECTS_HOME     same as --projects-home
  PORTTA_REF               same as --version
  PORTTA_REGISTRY          same as --registry
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir) shift; INSTALL_DIR="${1:-}" ;;
    --install-dir=*) INSTALL_DIR="${1#*=}" ;;
    --projects-home) shift; PROJECTS_HOME="${1:-}" ;;
    --projects-home=*) PROJECTS_HOME="${1#*=}" ;;
    --panel-access) shift; PANEL_ACCESS="${1:-}" ;;
    --panel-access=*) PANEL_ACCESS="${1#*=}" ;;
    --panel-port) shift; PANEL_PORT="${1:-}" ;;
    --panel-port=*) PANEL_PORT="${1#*=}" ;;
    --panel-auth) shift; PANEL_AUTH="${1:-}" ;;
    --panel-auth=*) PANEL_AUTH="${1#*=}" ;;
    # Gone with the Traefik credential: the panel's first account is created at
    # /setup. Refused rather than ignored, so a script that still passes one is
    # told instead of quietly installing something else.
    --panel-user|--panel-user=*)
      die "--panel-user is gone: the panel signs people in itself, and the first account is created at /setup (or with 'portta auth bootstrap')" ;;
    --domain) shift; DOMAIN="${1:-}" ;;
    --domain=*) DOMAIN="${1#*=}" ;;
    --domain-mode) shift; DOMAIN_MODE="${1:-}" ;;
    --domain-mode=*) DOMAIN_MODE="${1#*=}" ;;
    --tls) shift; TLS_EMAIL="${1:-}" ;;
    --tls=*) TLS_EMAIL="${1#*=}" ;;
    --version) shift; PORTTA_REF="${1:-}" ;;
    --version=*) PORTTA_REF="${1#*=}" ;;
    --registry) shift; PORTTA_REGISTRY="${1:-}" ;;
    --registry=*) PORTTA_REGISTRY="${1#*=}" ;;
    --skip-deps) SKIP_DEPS=true ;;
    --pull-only) PULL_ONLY=true ;;
    --uninstall) ACTION="uninstall" ;;
    -y|--yes) ASSUME_YES=true ;;
    --non-interactive) NON_INTERACTIVE=true; ASSUME_YES=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

case "$PANEL_ACCESS" in
  ''|public|tailscale|local|domain) ;;
  *) die "--panel-access must be public, tailscale, local or domain (got: $PANEL_ACCESS)" ;;
esac
case "$DOMAIN_MODE" in
  ''|local|auto|custom) ;;
  *) die "--domain-mode must be local, auto or custom (got: $DOMAIN_MODE)" ;;
esac
case "$PANEL_PORT" in
  ''|*[!0-9]*) [ -z "$PANEL_PORT" ] || die "--panel-port must be a number" ;;
esac
case "$PANEL_AUTH" in
  ''|required|disabled) ;;
  *) die "--panel-auth must be required or disabled (got: $PANEL_AUTH)" ;;
esac

# ---------------------------------------------------------------------------
# 1. Environment detection
# ---------------------------------------------------------------------------
# Nothing here is asked of the user: a machine can describe itself.

OS_KERNEL=$(uname -s)
ARCH_RAW=$(uname -m)
case "$ARCH_RAW" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) ARCH="$ARCH_RAW" ;;
esac

OS_NAME="$OS_KERNEL"
OS_ID=""
case "$OS_KERNEL" in
  Linux)
    if [ -r /etc/os-release ]; then
      # Parsed, never sourced: this file comes from the distribution but the
      # habit of sourcing whatever is on disk is the one worth not having.
      OS_NAME=$(sed -n 's/^PRETTY_NAME="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' /etc/os-release | head -n1)
      OS_ID=$(sed -n 's/^ID="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' /etc/os-release | head -n1)
    fi
    ;;
  Darwin)
    OS_NAME="macOS $(sw_vers -productVersion 2>/dev/null || printf 'unknown')"
    OS_ID="darwin"
    ;;
esac
[ -n "$OS_NAME" ] || OS_NAME="$OS_KERNEL"

CURRENT_USER=$(id -un)
CURRENT_UID=$(id -u)
CURRENT_GID=$(id -g)
IS_ROOT=false
[ "$CURRENT_UID" = "0" ] && IS_ROOT=true
HOST_NAME=$(hostname 2>/dev/null || printf 'unknown')

local_ip() {
  local ip=""
  if have ip; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1)
  fi
  if [ -z "$ip" ] && have ipconfig; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  fi
  if [ -z "$ip" ] && have hostname; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  printf '%s' "$ip"
}

public_ip() {
  local url ip=""
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)
    case "$ip" in
      *[!0-9.]*|'') ip="" ;;
      *) break ;;
    esac
  done
  printf '%s' "$ip"
}

# port_free <port>: best effort. An unknown answer is treated as free, because
# refusing to install over an inconclusive check helps nobody.
port_free() {
  local port="$1"
  if have ss; then
    ss -ltnH "sport = :$port" 2>/dev/null | grep -q . && return 1 || return 0
  fi
  if have lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 1 || return 0
  fi
  if have netstat; then
    netstat -an 2>/dev/null | grep -q "[.:]$port .*LISTEN" && return 1 || return 0
  fi
  return 0
}

# locate_tool <command>: the command's path, looking beyond PATH.
#
# A developer's toolchain is usually wired into an interactive shell — nvm in
# .zshrc, agent CLIs symlinked into ~/.local/bin — and the shell running this
# installer sees none of it. Reporting "not found" for a tool the machine
# plainly has is worse than saying nothing. Mirrors portta_locate in
# scripts/lib/common.sh.
locate_tool() {
  local cmd="$1" candidate
  if command -v "$cmd" >/dev/null 2>&1; then command -v "$cmd"; return 0; fi
  for candidate in \
    "$HOME/.local/bin/$cmd" "$HOME/.bun/bin/$cmd" "$HOME/.cargo/bin/$cmd" \
    "$HOME/.deno/bin/$cmd" /usr/local/bin/"$cmd" /opt/homebrew/bin/"$cmd" \
    "$HOME"/.nvm/versions/node/*/bin/"$cmd" \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/"$cmd" \
    "$HOME"/.volta/bin/"$cmd"; do
    if [ -x "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done
  return 1
}

tool_version() { # tool_version <command> [args...]
  local cmd="$1" path; shift
  path=$(locate_tool "$cmd") || return 1
  "$path" "$@" 2>/dev/null | head -n1
}

step "Portta installer"
say "installing from ${C_BOLD}${PORTTA_REPO}@${PORTTA_REF}${C_RESET}"

step "Environment"
good "$OS_NAME"
good "$ARCH"
good "user $CURRENT_USER (uid $CURRENT_UID)"
good "hostname $HOST_NAME"
LOCAL_IP=$(local_ip)
[ -n "$LOCAL_IP" ] && good "local address $LOCAL_IP" || warn "no local IPv4 address detected"

for required in curl tar; do
  have "$required" || die "$required is required and was not found in PATH"
done

# ---------------------------------------------------------------------------
# 2. Container runtime
# ---------------------------------------------------------------------------

install_docker() {
  case "$OS_KERNEL" in
    Linux) ;;
    *) die "Docker is missing. Install Docker Desktop or OrbStack, then run this again" ;;
  esac
  [ "$IS_ROOT" = "true" ] || die "Docker is missing and installing it needs root. Install Docker, or re-run this as root"
  say "installing Docker Engine from get.docker.com"
  curl -fsSL https://get.docker.com | sh || die "the Docker installation script failed"
  if have systemctl; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  have docker || die "Docker still not found after installation"
}

step "Container runtime"
if ! have docker; then
  bad "Docker not found"
  if [ "$SKIP_DEPS" = "true" ]; then
    die "Docker is required. Install it and run this again, or drop --skip-deps"
  elif [ "$ASSUME_YES" = "true" ] || confirm_default_yes "Install Docker Engine now, from get.docker.com?"; then
    install_docker
  else
    die "Docker is required"
  fi
fi

docker info >/dev/null 2>&1 || {
  if have systemctl && [ "$IS_ROOT" = "true" ]; then
    systemctl start docker >/dev/null 2>&1 || true
  fi
  docker info >/dev/null 2>&1 || die "the Docker daemon is unreachable. Start it (or add $CURRENT_USER to the docker group) and run this again"
}

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || printf 'unknown')
good "Docker $DOCKER_VERSION"

docker compose version >/dev/null 2>&1 \
  || die 'the Docker Compose v2 plugin is required; docker-compose v1 is not supported'
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || printf 'unknown')
good "Docker Compose $COMPOSE_VERSION"

# ---------------------------------------------------------------------------
# 3. VPN
# ---------------------------------------------------------------------------
# Read-only throughout. The installer never runs `tailscale up`, never logs in,
# and never edits an existing Tailscale configuration.

TAILSCALE_STATE="absent"
TAILSCALE_IP=""
step "VPN"
if have tailscale; then
  if TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -n1) && [ -n "$TAILSCALE_IP" ]; then
    TAILSCALE_STATE="connected"
    good "Tailscale installed"
    good "connected"
    good "$TAILSCALE_IP"
  else
    TAILSCALE_STATE="disconnected"
    warn "Tailscale is installed but not connected"
    note "run 'tailscale up' yourself if you want the panel on the tailnet; the installer never does it for you"
  fi
else
  warn "Tailscale not found"
  note "optional: the panel can be reached publicly or over an SSH tunnel instead"
fi

# ---------------------------------------------------------------------------
# 4. PORTTA_HOME
# ---------------------------------------------------------------------------

default_home() {
  if [ "$IS_ROOT" = "true" ]; then printf '/opt/portta'; else printf '%s/.portta' "$HOME"; fi
}

default_projects_home() {
  if [ "$IS_ROOT" = "true" ]; then printf '/srv/projects'; else printf '%s/projects' "$HOME"; fi
}

step "Portta home"
# A directory the caller named is honoured exactly. One we defaulted to is a
# guess, and --uninstall is allowed to look elsewhere before giving up.
INSTALL_DIR_EXPLICIT="$INSTALL_DIR"
if [ -z "$INSTALL_DIR" ]; then INSTALL_DIR="${PORTTA_HOME:-}"; INSTALL_DIR_EXPLICIT="$INSTALL_DIR"; fi
if [ -z "$INSTALL_DIR" ]; then
  say "Where should Portta keep its data and configuration?"
  say ""
  INSTALL_DIR=$(ask "directory" "$(default_home)")
fi
# A tilde typed at a prompt arrives literally: the shell that would have
# expanded it never saw it.
# shellcheck disable=SC2088
case "$INSTALL_DIR" in
  "~") INSTALL_DIR="$HOME" ;;
  "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#\~/}" ;;
esac
case "$INSTALL_DIR" in
  /*) ;;
  *) INSTALL_DIR="$(pwd)/$INSTALL_DIR" ;;
esac
PORTTA_HOME="$INSTALL_DIR"

# Projects Home is a second directory: the code the operator is developing,
# not the gateway. Changing it later changes the reference; this installer
# never moves files. See docs/adr/0031-projects-home-and-project.md.
# Uninstall does not ask: it does not touch that directory.
if [ "$ACTION" != "uninstall" ]; then
  if [ -z "$PROJECTS_HOME" ]; then PROJECTS_HOME="${PORTTA_PROJECTS_HOME:-}"; fi
  if [ -z "$PROJECTS_HOME" ]; then
    say "Where should Portta manage your projects?"
    say ""
    note "Recommended: $(default_projects_home)"
    PROJECTS_HOME=$(ask "directory" "$(default_projects_home)")
  fi
  # shellcheck disable=SC2088
  case "$PROJECTS_HOME" in
    "~") PROJECTS_HOME="$HOME" ;;
    "~/"*) PROJECTS_HOME="$HOME/${PROJECTS_HOME#\~/}" ;;
  esac
  case "$PROJECTS_HOME" in
    /*) ;;
    *) PROJECTS_HOME="$(pwd)/$PROJECTS_HOME" ;;
  esac
  case "$PROJECTS_HOME" in
    /) die "Projects Home cannot be the filesystem root" ;;
  esac
fi

# Where an installation could be, in the order the CLI looks. Used by
# --uninstall, and to notice a second installation competing for the port.
portta_home_candidates() {
  printf '%s\n' "/opt/portta" "$HOME/.portta" "/var/lib/portta"
}

# The directory a running Portta was started from, read from the label Compose
# puts on every container it creates. Empty when nothing is running.
running_home() {
  local cid
  cid=$(docker ps -q --filter "label=portta.managed=true" 2>/dev/null | head -n1)
  [ -n "$cid" ] || return 0
  docker inspect "$cid" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null
}

if [ "$ACTION" = "uninstall" ]; then
  step "Uninstall"
  # Only the explicitly given directory is trusted. Without one, look where an
  # installation can be rather than assuming the default and refusing.
  if [ -z "$INSTALL_DIR_EXPLICIT" ] && [ ! -f "$PORTTA_HOME/VERSION" ]; then
    found=$(running_home)
    if [ -z "$found" ] || [ ! -f "$found/VERSION" ]; then
      found=""
      while IFS= read -r candidate; do
        if [ -f "$candidate/VERSION" ]; then found="$candidate"; break; fi
      done <<EOF
$(portta_home_candidates)
EOF
    fi
    [ -n "$found" ] || die "no installation found at $PORTTA_HOME, and none in the usual places. Pass --install-dir"
    PORTTA_HOME="$found"
    good "found an installation at $PORTTA_HOME"
  fi
  [ -f "$PORTTA_HOME/VERSION" ] || die "no installation found at $PORTTA_HOME"
  say "this stops Portta's own containers and removes $PORTTA_HOME"
  say "named volumes (the panel database) are kept, and no project is touched"
  confirm "Continue?" || die "aborted"
  if [ -x "$PORTTA_HOME/bin/portta" ]; then
    PORTTA_ROOT="$PORTTA_HOME" PORTTA_FORCE_BASH=true "$PORTTA_HOME/bin/portta" down >/dev/null 2>&1 || true
  fi
  docker ps -aq --filter "label=portta.managed=true" 2>/dev/null | while read -r cid; do
    [ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1 || true
  done
  rm -rf "$PORTTA_HOME"
  for candidate in /usr/local/bin/portta "$HOME/.local/bin/portta"; do
    [ -L "$candidate" ] && rm -f "$candidate" 2>/dev/null || true
  done
  good "removed $PORTTA_HOME"
  note "the panel database volume was kept: docker volume rm portta-db removes it"
  note "its password lived in the .env just removed; a fresh install resets the role to match"
  note "the shared network was kept: other projects may still be attached"
  exit 0
fi

MODE="install"
if [ -f "$PORTTA_HOME/VERSION" ]; then
  MODE="update"
  PREVIOUS_VERSION=$(tr -d '[:space:]' < "$PORTTA_HOME/VERSION" 2>/dev/null || printf 'unknown')
  good "existing installation found at $PORTTA_HOME (version $PREVIOUS_VERSION)"
  note "data, credentials and configuration are preserved"
elif [ -d "$PORTTA_HOME" ] && [ -n "$(ls -A "$PORTTA_HOME" 2>/dev/null || true)" ]; then
  # A non-empty directory that is not a Portta install is somebody else's.
  die "$PORTTA_HOME exists and is not a Portta installation. Choose another directory with --install-dir"
else
  good "installing into $PORTTA_HOME"
fi

mkdir -p "$PORTTA_HOME" 2>/dev/null \
  || die "cannot create $PORTTA_HOME. Choose a writable directory with --install-dir, or run as root"
[ -w "$PORTTA_HOME" ] || die "$PORTTA_HOME is not writable by $CURRENT_USER"

ENV_FILE="$PORTTA_HOME/.env"

# ---------------------------------------------------------------------------
# 5. Panel access
# ---------------------------------------------------------------------------
# The one decision the installer genuinely cannot make on its own, and the only
# one it asks about. It concerns the PANEL. It does not expose any application.

step "Panel access"

if [ "$MODE" = "update" ] && [ -z "$PANEL_ACCESS" ]; then
  PANEL_ACCESS=$(env_get "$ENV_FILE" PORTTA_WEB_EXPOSE)
  [ -n "$PANEL_ACCESS" ] || PANEL_ACCESS="local"
  good "keeping the configured access mode: $PANEL_ACCESS"
fi

if [ -z "$PANEL_ACCESS" ]; then
  say "How do you want to reach the Portta panel?"
  say ""
  say "  1. Public    — this server's address and a port  ${C_DIM}[default]${C_RESET}"
  if [ "$TAILSCALE_STATE" = "connected" ]; then
    say "  2. Tailscale — only over the VPN ($TAILSCALE_IP)"
  elif [ "$TAILSCALE_STATE" = "disconnected" ]; then
    say "  2. Tailscale — ${C_DIM}unavailable (Tailscale is not connected)${C_RESET}"
  else
    say "  2. Tailscale — ${C_DIM}unavailable (Tailscale not found)${C_RESET}"
  fi
  say "  3. Local     — localhost only, reached over an SSH tunnel"
  say ""
  choice=$(ask "choose" "1")
  case "$choice" in
    1|public|"") PANEL_ACCESS="public" ;;
    2|tailscale) PANEL_ACCESS="tailscale" ;;
    3|local) PANEL_ACCESS="local" ;;
    *) die "invalid choice: $choice" ;;
  esac
fi

if [ "$PANEL_ACCESS" = "tailscale" ] && [ "$TAILSCALE_STATE" != "connected" ]; then
  die "panel access 'tailscale' needs a connected Tailscale node; this host has none. Connect it yourself with 'tailscale up', then run this again"
fi

if [ -z "$PANEL_PORT" ]; then
  PANEL_PORT=$(env_get "$ENV_FILE" PORTTA_WEB_PORT)
  [ -n "$PANEL_PORT" ] || PANEL_PORT="8081"
fi

# One host, one Portta. A second installation would fight this one for the
# panel port, the shared network and the container names, and the failure would
# surface as an unrelated port collision three steps later.
if [ "$MODE" = "install" ]; then
  other=$(running_home)
  if [ -n "$other" ] && [ "$other" != "$PORTTA_HOME" ] && [ -f "$other/VERSION" ]; then
    err_home="$other"
    die "Portta is already installed at $err_home and running. Update it by running this without --install-dir, or remove it first: install.sh --uninstall --install-dir $err_home"
  fi
fi

# A port already held by something else fails late and confusingly inside
# Compose, so say it now. On an update the holder is usually Portta itself.
if [ "$MODE" = "install" ] && ! port_free "$PANEL_PORT"; then
  warn "port $PANEL_PORT is already in use on this host"
  if interactive; then
    PANEL_PORT=$(ask "panel port" "8081")
  else
    die "port $PANEL_PORT is in use; pass --panel-port"
  fi
fi

case "$PANEL_ACCESS" in
  public)
    PANEL_BIND="0.0.0.0"
    good "public — the panel will answer on every interface, behind authentication"
    ;;
  tailscale)
    PANEL_BIND="$TAILSCALE_IP"
    good "tailscale — the panel will answer on $TAILSCALE_IP only"
    ;;
  local)
    PANEL_BIND="127.0.0.1"
    good "local — the panel will answer on 127.0.0.1 only"
    ;;
  domain)
    # The router is the front door; nothing is published on the host, so the
    # bind address is the loopback the container never uses.
    PANEL_BIND="127.0.0.1"
    good "domain — the panel will answer on the gateway's own domain, over HTTPS"
    ;;
  vpn)
    # A mode the installer does not offer, because it needs a domain and the
    # remote-private profile. An update must carry it through untouched rather
    # than quietly rewriting somebody's routed panel into something else.
    PANEL_BIND=$(env_get "$ENV_FILE" PORTTA_WEB_BIND_ADDRESS)
    [ -n "$PANEL_BIND" ] || PANEL_BIND="127.0.0.1"
    good "vpn — routed by Traefik; kept as configured"
    ;;
  *)
    die "unknown panel access mode in $ENV_FILE: $PANEL_ACCESS. Set PORTTA_WEB_EXPOSE to public, tailscale, local or vpn"
    ;;
esac

# ---------------------------------------------------------------------------
# 6. Panel authentication
# ---------------------------------------------------------------------------
# The panel signs people in itself: accounts, roles, sessions and tokens, in its
# own database. There is no credential to invent here and nothing to hand over
# — the first account is created once, at /setup, by whoever opens the panel
# first. See docs/adr/0035-authentication-lives-in-the-panel.md.
#
# What the installer decides is only whether it asks at all. `disabled` makes
# every request the local operator, which is safe on loopback (reaching it
# already means having the machine) and an open control plane anywhere else, so
# the panel's own process refuses that combination at boot.

EXISTING_AUTH_MODE=$(env_get "$ENV_FILE" PORTTA_AUTH_MODE)

# Every mode that puts the panel beyond this host. `domain` was missing from
# the old list when the mode was added, so a fresh install with it created no
# credential at all -- and `domain` was refused without one, leaving a host that
# installed cleanly and could not start its own panel.
needs_auth() {
  case "$PANEL_ACCESS" in
    public|vpn|domain|tailscale) return 0 ;;
    *) return 1 ;;
  esac
}

step "Panel authentication"
if needs_auth; then
  # Not a question on these: the panel refuses to start any other way.
  if [ -n "$PANEL_AUTH" ] && [ "$PANEL_AUTH" != "required" ]; then
    die "--panel-auth disabled cannot be combined with --panel-access $PANEL_ACCESS: the panel would be reachable from another machine with nobody signing in"
  fi
  PANEL_AUTH="required"
  good "the panel will sign people in (access: $PANEL_ACCESS)"
else
  if [ -z "$PANEL_AUTH" ]; then
    if [ -n "$EXISTING_AUTH_MODE" ]; then
      PANEL_AUTH="$EXISTING_AUTH_MODE"
    else
      PANEL_AUTH=$(ask "panel authentication (required/disabled)" "required")
    fi
  fi
  case "$PANEL_AUTH" in
    required|disabled) ;;
    *) die "panel authentication must be required or disabled (got: $PANEL_AUTH)" ;;
  esac
  if [ "$PANEL_AUTH" = "required" ]; then
    good "the panel will sign people in"
  else
    good "the panel will answer as the local operator, on loopback only"
    note "reaching it already means having this machine; run 'portta config set panel.auth required' to change that"
  fi
fi

# ---------------------------------------------------------------------------
# 7. Runtime files
# ---------------------------------------------------------------------------
# Compose files, the Traefik dynamic configuration, and the shell CLI, so a
# host with no Node can still run `portta status`, `portta doctor` and
# `portta up`. No application source, no lockfile, no node_modules: the panel
# and the proxy are published images.

step "Runtime files"

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/portta-install.XXXXXX") || die "cannot create a temporary directory"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

TARBALL_URL="https://codeload.github.com/${PORTTA_REPO}/tar.gz/${PORTTA_REF}"
say "downloading $TARBALL_URL"
curl -fsSL --retry 3 --retry-delay 2 "$TARBALL_URL" > "$WORK_DIR/portta.tar.gz" \
  || die "could not download the runtime files. Check the network, or pass --version with a ref that exists"

# The archive has a single top-level directory whose name embeds the ref, so
# strip it rather than guessing the name.
mkdir -p "$WORK_DIR/src"
tar -xzf "$WORK_DIR/portta.tar.gz" -C "$WORK_DIR/src" --strip-components=1 \
  || die "could not unpack the runtime files"

[ -f "$WORK_DIR/src/VERSION" ] || die "the downloaded archive is not a Portta tree"
NEW_VERSION=$(tr -d '[:space:]' < "$WORK_DIR/src/VERSION")

# Replaced on every run: these are the product, and a stale copy is exactly the
# problem an update is meant to fix.
for path in VERSION .env.example bin scripts docker/compose docker/images; do
  [ -e "$WORK_DIR/src/$path" ] || continue
  target="$PORTTA_HOME/$path"
  mkdir -p "$(dirname "$target")"
  rm -rf "$target"
  cp -R "$WORK_DIR/src/$path" "$target"
done

# Before 0.4 the two image build contexts lived at the runtime root. They are
# product files, replaced wholesale on every update, so remove the obsolete
# copies once docker/images has landed. No compatibility aliases are kept.
for obsolete in apply toolbox; do
  [ -e "$PORTTA_HOME/$obsolete" ] || continue
  rm -rf "${PORTTA_HOME:?}/$obsolete"
done
chmod +x "$PORTTA_HOME/bin/portta" "$PORTTA_HOME"/scripts/*.sh 2>/dev/null || true
good "runtime files for $NEW_VERSION"

# Never replaced: the Traefik dynamic directory holds generated credentials and
# hand-written routing. New files appear on upgrade; existing ones are kept.
mkdir -p "$PORTTA_HOME/config/traefik/dynamic" "$PORTTA_HOME/config/tls"
added=0
for file in "$WORK_DIR/src/config/traefik/dynamic/"*; do
  [ -f "$file" ] || continue
  target="$PORTTA_HOME/config/traefik/dynamic/$(basename "$file")"
  if [ ! -e "$target" ]; then cp "$file" "$target"; added=$((added + 1)); fi
done
good "Traefik dynamic configuration ($added file(s) added, existing ones kept)"

for directory in state/traefik/acme state/tailscale state/access state/auth state/git state/github state/cloudflared state/metrics state/logs state/runner; do
  mkdir -p "$PORTTA_HOME/$directory"
done
# Both hold a credential, and both are bind-mounted. A directory the installer
# does not create is created by Docker instead, owned by root at 0755 — which
# is the wrong mode for a private key and the wrong owner for the panel that
# has to write one.
chmod 700 "$PORTTA_HOME/state/traefik/acme" "$PORTTA_HOME/state/cloudflared" "$PORTTA_HOME/state/runner" 2>/dev/null || true
chmod 700 "$PORTTA_HOME/state/auth" 2>/dev/null || true
[ -f "$PORTTA_HOME/state/traefik/acme/acme.json" ] && chmod 600 "$PORTTA_HOME/state/traefik/acme/acme.json" 2>/dev/null || true
good "state directories"

# ---------------------------------------------------------------------------
# 8. Configuration
# ---------------------------------------------------------------------------

step "Configuration"

# Whether this run created the file matters later: `.env.example` ships values
# for everything, so reading one back cannot tell "the operator chose this"
# from "this is the template's default". Only a file that already existed
# carries a choice.
ENV_WAS_CREATED=false
[ -f "$ENV_FILE" ] || ENV_WAS_CREATED=true
# The downloaded zero-Node adapter is shared with bootstrap and the CLI fallback.
. "$PORTTA_HOME/scripts/lib/env.sh"
env_get() { portta_env_get "$1" "$2"; }
portta_prepare_env "$ENV_FILE" || die "environment preparation failed"
good "prepared .env from the installation template"

PANEL_IMAGE="${PORTTA_REGISTRY}/portta:${NEW_VERSION}"

# A fresh install starts on the local profile, so publishing the panel
# publishes no application. An update must not reimpose that: `portta public
# enable` writes remote-public deliberately, and overwriting it here would
# silently un-expose a host on every routine update.
EXISTING_PROFILE=""
[ "$ENV_WAS_CREATED" = "false" ] && EXISTING_PROFILE=$(env_get "$ENV_FILE" PORTTA_PROFILE)
if [ -z "$EXISTING_PROFILE" ]; then
  env_set "$ENV_FILE" PORTTA_PROFILE "local"
else
  good "keeping the configured profile: $EXISTING_PROFILE"
fi
env_set "$ENV_FILE" PORTTA_WEB "true"
for imagekey in PORTTA_WEB_IMAGE PORTTA_AUTH_IMAGE; do
  configured_image=$(env_get "$ENV_FILE" "$imagekey")
  case "$configured_image" in
    ""|"${PORTTA_REGISTRY}/portta:${PREVIOUS_VERSION:-}") env_set "$ENV_FILE" "$imagekey" "$PANEL_IMAGE" ;;
  esac
done
if [ "$ENV_WAS_CREATED" = true ]; then
  env_set "$ENV_FILE" PORTTA_WEB_BUILD "false"
  env_set "$ENV_FILE" PORTTA_WEB_DEV "false"
fi
if [ -z "$(env_get "$ENV_FILE" PORTTA_PROJECTS_HOME)" ]; then
  env_set "$ENV_FILE" PORTTA_PROJECTS_HOME "$PROJECTS_HOME"
  good "Projects Home: $PROJECTS_HOME"
else
  good "keeping the configured Projects Home: $(env_get "$ENV_FILE" PORTTA_PROJECTS_HOME)"
fi
env_set "$ENV_FILE" PORTTA_WEB_EXPOSE "$PANEL_ACCESS"
env_set "$ENV_FILE" PORTTA_WEB_BIND_ADDRESS "$PANEL_BIND"
env_set "$ENV_FILE" PORTTA_WEB_PORT "$PANEL_PORT"
# The panel writes .env from its Settings page and reads it at startup, so it
# runs as whoever owns PORTTA_HOME rather than as the image's default uid.
[ -n "$(env_get "$ENV_FILE" PORTTA_WEB_USER)" ] || env_set "$ENV_FILE" PORTTA_WEB_USER "${CURRENT_UID}:${CURRENT_GID}"
# The authentication service reads .env once and the protection store on every
# request. Both are owner-only and owned by whoever ran this installer -- root,
# on a VPS -- so the image's default uid could open neither.
[ -n "$(env_get "$ENV_FILE" PORTTA_AUTH_USER)" ] || env_set "$ENV_FILE" PORTTA_AUTH_USER "${CURRENT_UID}:${CURRENT_GID}"

if [ -n "$DOMAIN" ]; then
  env_set "$ENV_FILE" PUBLIC_DOMAIN "$DOMAIN"
  env_set "$ENV_FILE" PORTTA_DOMAIN "$DOMAIN"
  [ -n "$DOMAIN_MODE" ] || DOMAIN_MODE="custom"
  good "base domain recorded: $DOMAIN"
  note "recorded only; applications stay unexposed until you publish them"
fi

# The address this host is reached on, detected once and written to .env so no
# later command has to make a network call to know what a project hostname
# should be. Needed for the panel summary and for the auto domain mode below.
PUBLIC_IP=$(env_get "$ENV_FILE" PORTTA_PUBLIC_IP)
if [ "$PANEL_ACCESS" != "local" ] || [ "$DOMAIN_MODE" = "auto" ]; then
  DETECTED_IP=$(public_ip)
  [ -n "$DETECTED_IP" ] && PUBLIC_IP="$DETECTED_IP"
fi

# On a tailnet host, the address that matters is the tailnet one. sslip.io
# resolves it like any other, so project hostnames end up reachable over the
# VPN and nowhere else — the same boundary the panel already has here, and no
# public exposure at all.
if [ "$PANEL_ACCESS" = "tailscale" ] && [ -n "$TAILSCALE_IP" ]; then
  PUBLIC_IP="$TAILSCALE_IP"
fi

[ -n "$PUBLIC_IP" ] && env_set "$ENV_FILE" PORTTA_PUBLIC_IP "$PUBLIC_IP"

# ---------------------------------------------------------------------------
# Project hostnames
# ---------------------------------------------------------------------------
# Projects get <project>-<service>.<base>. `localhost` is right for a machine
# you are sitting at and useless from anywhere else, so a host whose panel is
# reached from elsewhere gets a base that resolves from elsewhere too.
#
# This is a name and nothing more: it does not publish a single service. See
# docs/adr/0022-project-domain-modes.md.

# On an update the configured mode is a decision and is kept. On a fresh
# install the value in the file is only the template's default, and reading it
# back would pin every new host to `local` — including one whose panel is on a
# tailnet or the public internet, which then advertises *.localhost to somebody
# who cannot open it. That is the failure ADR 0022 exists to prevent.
if [ -z "$DOMAIN_MODE" ] && [ "$ENV_WAS_CREATED" = "false" ]; then
  DOMAIN_MODE=$(env_get "$ENV_FILE" PORTTA_DOMAIN_MODE)
fi
if [ -z "$DOMAIN_MODE" ]; then
  # The panel access mode already asked the question this needs answered:
  # anything but `local` means "I reach this machine from somewhere else".
  if [ "$PANEL_ACCESS" != "local" ] && [ -n "$PUBLIC_IP" ]; then
    DOMAIN_MODE="auto"
  else
    DOMAIN_MODE="local"
  fi
fi

env_set "$ENV_FILE" PORTTA_DOMAIN_MODE "$DOMAIN_MODE"
AUTO_PROVIDER=$(env_get "$ENV_FILE" PORTTA_AUTO_DOMAIN_PROVIDER)
[ -n "$AUTO_PROVIDER" ] || AUTO_PROVIDER="sslip.io"
env_set "$ENV_FILE" PORTTA_AUTO_DOMAIN_PROVIDER "$AUTO_PROVIDER"

PROJECT_DOMAIN="localhost"
case "$DOMAIN_MODE" in
  auto)
    if [ -n "$PUBLIC_IP" ]; then
      PROJECT_DOMAIN="$(printf '%s' "$PUBLIC_IP" | tr '.' '-').${AUTO_PROVIDER}"
      env_set "$ENV_FILE" PORTTA_DOMAIN "$PROJECT_DOMAIN"
      good "projects will answer on *.${PROJECT_DOMAIN}"
      note "${AUTO_PROVIDER} resolves any name embedding this address; no DNS record is needed"
      if [ "$PANEL_ACCESS" = "tailscale" ]; then
        note "built from this node's tailnet address, so those names lead over the VPN only"
      fi
    else
      warn "domain mode auto was asked for and no public address was detected"
      note "falling back to *.localhost; set one later with: portta config set domain.publicIp <address>"
      DOMAIN_MODE="local"
      env_set "$ENV_FILE" PORTTA_DOMAIN_MODE local
      env_set "$ENV_FILE" PORTTA_DOMAIN localhost
    fi
    ;;
  custom)
    PROJECT_DOMAIN=$(env_get "$ENV_FILE" PORTTA_DOMAIN)
    if [ -z "$PROJECT_DOMAIN" ] || [ "$PROJECT_DOMAIN" = "localhost" ]; then
      die "domain mode custom needs a domain: pass --domain dev.example.com"
    fi
    good "projects will answer on *.${PROJECT_DOMAIN}"
    note "*.${PROJECT_DOMAIN} must resolve to this host"
    ;;
  local)
    env_set "$ENV_FILE" PORTTA_DOMAIN localhost
    good "projects will answer on *.localhost"
    note "that only resolves on this machine; --domain-mode auto gives one that resolves anywhere"
    ;;
esac

# TLS, once the domain is settled: it is the domain the certificate is for, and
# there is no certificate a public CA will issue for a bare IP or an auto
# domain. HTTP-01 rather than DNS-01 because it needs no provider credential,
# which is the only reason this can be a single flag at all; a wildcard is a
# deliberate second step. See docs/dns-and-tls.md.
if [ -n "$TLS_EMAIL" ]; then
  case "$PROJECT_DOMAIN" in
    localhost|*.sslip.io|*.nip.io)
      die "--tls needs a real domain: pass --domain dev.example.com --domain-mode custom (no public CA issues a certificate for ${PROJECT_DOMAIN})" ;;
  esac
  env_set "$ENV_FILE" TLS_ENABLED true
  env_set "$ENV_FILE" TLS_MODE acme
  env_set "$ENV_FILE" ACME_CHALLENGE http
  env_set "$ENV_FILE" ACME_EMAIL "$TLS_EMAIL"
  good "HTTPS: Let's Encrypt over HTTP-01, one certificate per hostname"
  note "*.${PROJECT_DOMAIN} must resolve here and :80 must be reachable, or issuance fails"
  note "one wildcard instead needs a DNS credential: docs/dns-and-tls.md"
fi

# The panel's own address, for the summary and for `portta web status`. This
# binds nothing: it is the address a human types.
case "$PANEL_ACCESS" in
  public)
    ADVERTISED="${PUBLIC_IP:-${LOCAL_IP:-$HOST_NAME}}"
    ;;
  tailscale) ADVERTISED="$TAILSCALE_IP" ;;
  local) ADVERTISED="127.0.0.1" ;;
  domain)
    # The Compose router matches this exact value, and so does the panel's own
    # PORTTA_PANEL_URL, so it is the one setting that decides where the panel
    # answers and which origin its session cookie belongs to.
    ADVERTISED=$(env_get "$ENV_FILE" PORTTA_PANEL_ADVERTISED_HOST)
    [ -n "$ADVERTISED" ] || ADVERTISED="$PROJECT_DOMAIN"
    case "$ADVERTISED" in
      localhost|*.sslip.io|*.nip.io|[0-9]*.[0-9]*.[0-9]*.[0-9]*)
        die "--panel-access domain needs a real hostname to route on, and this host would advertise $ADVERTISED. Pass --domain and --domain-mode custom" ;;
    esac
    [ "$(env_get "$ENV_FILE" TLS_ENABLED)" = "true" ] \
      || die "--panel-access domain would carry the panel's session cookie in clear text. Pass --tls <email>"
    ;;
  *)
    ADVERTISED=$(env_get "$ENV_FILE" PORTTA_PANEL_ADVERTISED_HOST)
    [ -n "$ADVERTISED" ] || ADVERTISED="$PANEL_BIND"
    ;;
esac
env_set "$ENV_FILE" PORTTA_PANEL_ADVERTISED_HOST "$ADVERTISED"

env_set "$ENV_FILE" PORTTA_AUTH_MODE "$PANEL_AUTH"

# Where a browser reaches the panel. The panel derives three things from it:
# whether the session cookie may be `Secure`, which origins a sign-in is
# accepted from, and the address it prints.
case "$PANEL_ACCESS" in
  domain) env_set "$ENV_FILE" PORTTA_PANEL_URL "https://${ADVERTISED}" ;;
  vpn)
    # Not an installer mode -- `portta web up --expose vpn` is -- but an update
    # of a host already in it must not rewrite the URL to an address that mode
    # does not answer on.
    VPN_HOST=$(env_get "$ENV_FILE" PORTTA_WEB_HOST); [ -n "$VPN_HOST" ] || VPN_HOST="portta-web"
    VPN_DOMAIN=$(env_get "$ENV_FILE" PRIVATE_DOMAIN)
    [ -n "$VPN_DOMAIN" ] || VPN_DOMAIN="$PROJECT_DOMAIN"
    VPN_SCHEME=http
    [ "$(env_get "$ENV_FILE" TLS_ENABLED)" = "true" ] && VPN_SCHEME=https
    env_set "$ENV_FILE" PORTTA_PANEL_URL "${VPN_SCHEME}://${VPN_HOST}.${VPN_DOMAIN}"
    ;;
  *)      env_set "$ENV_FILE" PORTTA_PANEL_URL "http://${ADVERTISED}:${PANEL_PORT}" ;;
esac

# An upgrade from a Portta whose panel sat behind Traefik: the generated file
# still declares the middleware that guarded it, and the router no longer names
# it. Written empty rather than deleted, because Traefik watches the directory
# and a file that merely stops being updated keeps working.
cat > "$PORTTA_HOME/config/traefik/dynamic/portta-panel.yaml" <<'YAML'
# ============================================================================
# Generated by the Portta installer. Edits are overwritten.
# ============================================================================
# The panel authenticates its own requests: it is a Next application with
# Better Auth behind it, not a router with a credential in front of it.
# Nothing routes through Traefik middleware to reach it any more.
# See docs/adr/0035-authentication-lives-in-the-panel.md.
# ============================================================================
YAML
chmod 600 "$PORTTA_HOME/config/traefik/dynamic/portta-panel.yaml"

cat > "$PORTTA_HOME/install-manifest.json" <<JSON
{
  "installer": "$PORTTA_INSTALLER_VERSION",
  "version": "$NEW_VERSION",
  "ref": "$PORTTA_REF",
  "repository": "$PORTTA_REPO",
  "os": "$OS_NAME",
  "osId": "$OS_ID",
  "arch": "$ARCH",
  "registry": "$PORTTA_REGISTRY",
  "panelImage": "$PANEL_IMAGE",
  "home": "$PORTTA_HOME",
  "panelAccess": "$PANEL_ACCESS",
  "panelPort": "$PANEL_PORT",
  "installedBy": "$CURRENT_USER",
  "updatedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
JSON
good "recorded install-manifest.json"

# ---------------------------------------------------------------------------
# 9. Images
# ---------------------------------------------------------------------------

step "Images"

portta() { # run the installed CLI against this PORTTA_HOME
  PORTTA_ROOT="$PORTTA_HOME" PORTTA_FORCE_BASH=true PORTTA_ASSUME_YES=true \
    "$PORTTA_HOME/bin/portta" "$@"
}

# The shared and control networks must exist before Compose resolves the
# `external: true` references. bootstrap is idempotent and does exactly that.
portta bootstrap --skip-pull || die "bootstrap failed"

# The overlay list and the two values the overlays interpolate that are
# derived rather than stored: the base domain comes from the mode, and the bind
# address comes from the profile. Resolved by the installed gateway's own
# libraries, so the installer cannot disagree with `portta up`.
COMPOSE_RESOLVED=$(PORTTA_ROOT="$PORTTA_HOME" bash -c '
  set -e
  . "$PORTTA_ROOT/scripts/lib/common.sh"
  . "$PORTTA_ROOT/scripts/lib/docker.sh"
  portta_load_env; portta_defaults
  profile="${PORTTA_PROFILE:-local}"
  portta_resolve_profile "$profile" >/dev/null
  printf "%s\n%s\n%s\n" "$PORTTA_DOMAIN" "$PORTTA_BIND_ADDRESS" "$(portta_compose_files "$profile")"
') || die "the compose configuration could not be resolved"

RESOLVED_DOMAIN=$(printf '%s' "$COMPOSE_RESOLVED" | sed -n 1p)
RESOLVED_BIND=$(printf '%s' "$COMPOSE_RESOLVED" | sed -n 2p)
COMPOSE_ARGS=$(printf '%s' "$COMPOSE_RESOLVED" | sed -n 3p)

# `.env` is handed to Compose as a file, never sourced: a value there is data,
# and a generated secret is full of characters a shell would happily act on.
#
# The two derived values are exported, because an environment variable beats
# the env-file. Without that, Compose would interpolate the stored
# PORTTA_BIND_ADDRESS and start the public profile bound to loopback.
run_compose() {
  portta_load_env "$ENV_FILE" || return 1
  # shellcheck disable=SC2086
  ( cd "$PORTTA_HOME" \
    && export PORTTA_DOMAIN="$RESOLVED_DOMAIN" PORTTA_BIND_ADDRESS="$RESOLVED_BIND" \
    && docker compose \
      --project-directory "$PORTTA_HOME" \
      --env-file "$ENV_FILE" \
      $COMPOSE_ARGS "$@" )
}

say "pulling ${PANEL_IMAGE} and the pinned component images"
if ! run_compose pull --quiet; then
  bad "could not pull every image"
  note "if $PANEL_IMAGE is not published yet, build it from a checkout or pass --registry"
  die "image pull failed"
fi
good "images pulled"

if [ "$PULL_ONLY" = "true" ]; then
  step "Done"
  say "--pull-only: images are up to date and nothing else was changed"
  exit 0
fi

# ---------------------------------------------------------------------------
# 10. Start
# ---------------------------------------------------------------------------

step "Starting Portta"

# Render ForwardAuth for project hostnames and shares, and lift any credential
# an older Portta left in a Traefik file into the private store. The panel is
# not part of this any more: it signs its own people in.
#
# Through the `portta-auth-migrate` service rather than by rebuilding its three
# mounts here with -v flags: the service already declares them, and two
# descriptions of one container is how the persistent service's user and the
# migrator's drifted apart.
run_compose run --rm --no-deps portta-auth-migrate >/dev/null \
  || die "existing authentication state could not be migrated"

# Never rotate a persistent cluster's credential during installation.
# Compose health waits for TCP readiness; the panel authenticates and migrates
# before it starts serving. All lookups are scoped to this Compose project.
DB_CONTAINER=""
if [ "$(env_get "$ENV_FILE" PORTTA_RUNTIME_DB_MODE)" != external ]; then
  run_compose up -d --wait --wait-timeout 120 db \
    || die "the panel database did not become healthy; inspect portta logs db"
  DB_CONTAINER=$(run_compose ps -q db)
fi

run_compose up -d --remove-orphans --wait --wait-timeout 240 \
  || die "the stack did not become healthy. Inspect it with: $PORTTA_HOME/bin/portta logs"
good "containers started"

# ---------------------------------------------------------------------------
# 11. Health checks
# ---------------------------------------------------------------------------

step "Health checks"

container_health() { # container_health <component>
  local cid
  cid=$(run_compose ps -q "$1")
  [ -n "$cid" ] || { printf 'absent'; return; }
  docker inspect "$cid" --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}{{ .State.Status }}{{ end }}' 2>/dev/null
}

HEALTH_OK=true

# Prove authentication over TCP, not a trusted local Unix socket.
if [ -n "${DB_CONTAINER:-}" ]; then
  if docker exec "$DB_CONTAINER" sh -c \
       'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select 1"' >/dev/null 2>&1; then
    good "the panel can authenticate to its database"
  else
    bad "the database rejects the configured credential; recover the credential or rotate it explicitly (see docs/persistence.md)"
    HEALTH_OK=false
  fi
fi

for component in traefik socket-proxy web web-socket-proxy db; do
  if [ "$component" = db ] && [ "$(env_get "$ENV_FILE" PORTTA_RUNTIME_DB_MODE)" = external ]; then continue; fi
  state=$(container_health "$component")
  case "$state" in
    healthy|running) good "$component: $state" ;;
    absent) warn "$component: not running"; HEALTH_OK=false ;;
    *) bad "$component: $state"; HEALTH_OK=false ;;
  esac
done

# The panel's front door, checked from the outside rather than from inside the
# container: in `public` mode an unauthenticated request must be refused, and
# proving that is more useful than proving the process is up.
# Traefik learns about a recreated container from the socket proxy, and for a
# second or two after `up` it has the container but not yet the router -- so an
# unmatched request gets 404, which is indistinguishable from a real one in a
# single shot. Waiting for the answer we expect turns a flaky install report
# into an honest one; the loop still gives up, and the last code is what is
# reported. Found updating a working host: the panel returned 401 moments after
# the installer had already called it a failure.
probe_until() { # probe_until <expected> <curl args...>
  _expected="$1"; shift
  _code=""
  _attempt=0
  while [ "$_attempt" -lt 20 ]; do
    _code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || printf '000')
    [ "$_code" = "$_expected" ] && break
    _attempt=$((_attempt + 1))
    sleep 1
  done
  printf '%s' "$_code"
}

# What is checked here is the same in every mode: the panel answers, and it says
# it has nobody yet. `/api/auth/status` is public in both modes for exactly this
# -- a browser has to learn whether to show a sign-in page before it has one --
# and it is the only thing that can say whether an owner exists, because the
# owner lives in the database rather than in .env.
#
# It replaces the old probe for HTTP 401: the panel used to refuse everything
# without a Traefik credential, and it now answers this one endpoint to
# everybody and refuses the rest.
case "$PANEL_ACCESS" in
  domain)
    # No host port in this mode: the router is the only way in, so the probe has
    # to arrive the way a browser does -- by name, on the gateway's entrypoint.
    # --resolve keeps it on this host instead of going out and back through DNS,
    # and -k because the certificate may still be minutes from issuance.
    PANEL_PROBE="--resolve ${ADVERTISED}:443:127.0.0.1 -k https://${ADVERTISED}/api/auth/status"
    PANEL_PROBE_WHERE="https://${ADVERTISED}"
    ;;
  public)
    PANEL_PROBE="http://127.0.0.1:${PANEL_PORT}/api/auth/status"
    PANEL_PROBE_WHERE="port ${PANEL_PORT}"
    ;;
  *)
    PANEL_PROBE="http://${PANEL_BIND}:${PANEL_PORT}/api/auth/status"
    PANEL_PROBE_WHERE="${PANEL_BIND}:${PANEL_PORT}"
    ;;
esac

# The probe is built above from values this script checked; the word splitting
# is what turns it into curl arguments.
# shellcheck disable=SC2086
code=$(probe_until 200 $PANEL_PROBE)
if [ "$code" = "200" ]; then
  good "the panel answers on ${PANEL_PROBE_WHERE}"
  # shellcheck disable=SC2086
  status_body=$(curl -s --max-time 10 $PANEL_PROBE 2>/dev/null || printf '')
  case "$status_body" in
    *'"setupRequired":true'*)
      good "it has no owner yet, and says so: the first account is created at /setup" ;;
    *'"setupRequired":false'*)
      good "it already has an owner; sign in with that account" ;;
    *)
      if [ "$PANEL_AUTH" = "required" ]; then
        bad "the panel did not report whether it needs setting up"
        HEALTH_OK=false
      fi
      ;;
  esac
  case "$PANEL_AUTH:$status_body" in
    required:*'"mode":"open"'*)
      bad "the panel is running in open mode with PORTTA_AUTH_MODE=required in .env"
      HEALTH_OK=false ;;
  esac
else
  bad "the panel did not answer on ${PANEL_PROBE_WHERE} (HTTP $code)"
  HEALTH_OK=false
fi

# ---------------------------------------------------------------------------
# 12. Put the CLI on PATH
# ---------------------------------------------------------------------------

LINK_TARGET=""
for candidate in /usr/local/bin "$HOME/.local/bin"; do
  [ -d "$candidate" ] || continue
  [ -w "$candidate" ] || continue
  LINK_TARGET="$candidate/portta"
  break
done
if [ -n "$LINK_TARGET" ]; then
  ln -sf "$PORTTA_HOME/bin/portta" "$LINK_TARGET"
fi

# The entry point above is the shell one, and it implements the commands
# ADR 0015 names and no others: `portta web`, `portta access`, `portta config`
# and the rest report that they need the full CLI. That report is only useful
# if the CLI can actually be installed, so install it here when the host can.
#
# Deliberately not fatal. Portta's promise is Docker, Git and a shell; the
# gateway that just started works without this, and an npm registry that is
# unreachable, rate-limited or does not yet carry the package must not turn a
# successful install into a failed one. `bin/portta` finds a globally installed
# package next to the node binary, so nothing else has to be wired up.
CLI_STATE="skipped"
if have node && have npm \
   && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' >/dev/null 2>&1; then
  if npm install -g "portta@${NEW_VERSION}" >/dev/null 2>&1 \
     || npm install -g portta >/dev/null 2>&1; then
    CLI_STATE="installed"
  else
    CLI_STATE="unavailable"
  fi
fi

# ---------------------------------------------------------------------------
# 13. Development environment, reported and never changed
# ---------------------------------------------------------------------------

step "Development environment"

report() { # report <label> <command> [args...]
  local label="$1" cmd="$2"; shift 2
  local path value
  if ! path=$(locate_tool "$cmd"); then warn "$label — not found"; return 0; fi
  value=$("$path" "$@" 2>/dev/null | head -n1 || true)
  if have "$cmd"; then
    good "$label — ${value:-installed}"
  elif [ -n "$value" ]; then
    warn "$label — $value, but not on this PATH"
  else
    # Located, and it will not run: npm's shebang is `env node`, so nvm's npm
    # is unusable from a shell that cannot see nvm's node either.
    warn "$label — at $path, but not usable from this shell"
  fi
}

report "Git"            git --version
report "Docker"         docker --version
report "Node.js"        node --version
report "npm"            npm --version
report "GitHub CLI"     gh --version
report "Tailscale"      tailscale version

if have git; then
  git_name=$(git config --global user.name 2>/dev/null || true)
  git_email=$(git config --global user.email 2>/dev/null || true)
  if [ -n "$git_name" ] && [ -n "$git_email" ]; then
    good "Git identity — $git_name <$git_email>"
  else
    warn "Git identity — not configured globally"
  fi
fi
if gh_path=$(locate_tool gh); then
  if "$gh_path" auth status >/dev/null 2>&1; then good "GitHub CLI — authenticated"; else warn "GitHub CLI — not authenticated"; fi
fi
if have npx; then good "npx — available"
elif npx_path=$(locate_tool npx); then warn "npx — at $npx_path, but not on this PATH"
else warn "npx — not found"; fi

step "AI development agents"
agent_report() { # agent_report <label> <command>
  local label="$1" cmd="$2" value path
  if path=$(locate_tool "$cmd"); then
    value=$("$path" --version 2>/dev/null | head -n1 || true)
    if have "$cmd"; then
      good "$label — ${value:-installed}"
    else
      good "$label — ${value:-installed} (at $path, not on this PATH)"
    fi
  else
    warn "$label — not found"
  fi
}
agent_report "Claude Code"  claude
agent_report "Codex CLI"    codex
agent_report "Cursor Agent" cursor-agent
agent_report "Gemini CLI"   gemini
agent_report "Antigravity"  antigravity
note "diagnostic only: the installer never installs, authenticates or reconfigures these"

# ---------------------------------------------------------------------------
# 14. Result
# ---------------------------------------------------------------------------

if [ "$PANEL_ACCESS" = "vpn" ]; then
  # Routed by name, not reached by address: the port is Traefik's, and the
  # hostname is the one the router matches.
  PANEL_HOST=$(env_get "$ENV_FILE" PORTTA_WEB_HOST); [ -n "$PANEL_HOST" ] || PANEL_HOST="portta-web"
  PANEL_SCHEME=http
  [ "$(env_get "$ENV_FILE" TLS_ENABLED)" = "true" ] && PANEL_SCHEME=https
  PANEL_DOMAIN=$(env_get "$ENV_FILE" PRIVATE_DOMAIN)
  [ -n "$PANEL_DOMAIN" ] || PANEL_DOMAIN=$(env_get "$ENV_FILE" PORTTA_DOMAIN)
  PANEL_URL="${PANEL_SCHEME}://${PANEL_HOST}.${PANEL_DOMAIN:-localhost}"
else
  PANEL_URL="http://${ADVERTISED}:${PANEL_PORT}"
fi

step "Portta is ready"

printf '  %-14s %s\n' "version" "$NEW_VERSION" >&2
printf '  %-14s %s\n' "home" "$PORTTA_HOME" >&2
printf '  %-14s %s\n' "panel access" "$PANEL_ACCESS" >&2
printf '  %-14s %s\n' "panel" "$PANEL_URL" >&2
printf '  %-14s %s\n' "projects" "*.${PROJECT_DOMAIN}" >&2

printf '  %-14s %s\n' "authentication" "$PANEL_AUTH" >&2

if [ "$PANEL_AUTH" = "required" ]; then
  printf '\n' >&2
  say "this panel has no accounts yet. Create the first one, which owns it:"
  say ""
  say "    ${PANEL_URL}/setup"
  say ""
  note "or from this host, with no browser: portta auth bootstrap --email you@example.com"
  note "sign-up closes as soon as that account exists; it creates everyone else"
fi

case "$PANEL_ACCESS" in
  public)
    printf '\n' >&2
    warn "the panel is reachable from the internet on port $PANEL_PORT"
    note "authentication is enforced by the proxy, and was verified above"
    note "the connection is plain HTTP: authentication does not encrypt traffic; enable TLS before using it across an untrusted network"
    note "set a domain and TLS_ENABLED=true for a real certificate"
    ;;
  tailscale)
    printf '\n' >&2
    good "the panel is reachable only from your tailnet; nothing is published on the public interface"
    ;;
  vpn)
    printf '\n' >&2
    good "the panel is routed by Traefik on your private domain, as it was before"
    ;;
  local)
    printf '\n' >&2
    good "the panel is reachable only from this machine"
    say "open an SSH tunnel to reach it from your laptop:"
    say ""
    say "    ssh -L ${PANEL_PORT}:127.0.0.1:${PANEL_PORT} ${CURRENT_USER}@${LOCAL_IP:-$HOST_NAME}"
    say ""
    say "then open  http://localhost:${PANEL_PORT}"
    ;;
esac

printf '\n' >&2
# On an update of a host that already ran `portta public enable`, the two lines
# below were both false: Traefik was already answering for opted-in projects.
if [ "$(env_get "$ENV_FILE" PUBLIC_ENABLED)" = "true" ]; then
  say "public access is enabled: Traefik answers for the projects that opted in"
  say "each project still chooses its own exposure from the panel or the CLI"
  [ "$PROJECT_DOMAIN" != "localhost" ] && {
    say ""
    say "a project called web answers on  web.${PROJECT_DOMAIN}"
  }
else
  say "applications stay unexposed: publishing the panel published nothing else"
  say "each project chooses its own exposure from the panel or the CLI"
  if [ "$PROJECT_DOMAIN" != "localhost" ]; then
    say ""
    say "a project called web would answer on  web.${PROJECT_DOMAIN}"
    note "the name resolves already; 'portta public enable' is what makes Traefik answer there"
  fi
fi

printf '\n' >&2
say "CLI:"
if [ -n "$LINK_TARGET" ]; then
  say "    portta status          (linked at $LINK_TARGET)"
else
  say "    $PORTTA_HOME/bin/portta status"
  note "no writable bin directory on PATH; add $PORTTA_HOME/bin to PATH to drop the prefix"
fi
case "$CLI_STATE" in
  installed)
    say "    portta web up          the panel, and every other full-CLI command" ;;
  unavailable)
    note "the full CLI is not installable from this host right now"
    note "  npm install -g portta   gives you web, access, config and the rest" ;;
  *)
    note "Node 22.12+ and npm give you the full command set: npm install -g portta" ;;
esac
case "$PORTTA_HOME" in
  /opt/portta|"$HOME/.portta"|/var/lib/portta) ;;
  *)
    # `npx portta` looks in the conventional locations; this is not one.
    note "this is a custom directory, so export PORTTA_HOME=$PORTTA_HOME for npx portta"
    ;;
esac
say ""
say "re-run this installer at any time to update:"
say "    curl -fsSL https://raw.githubusercontent.com/${PORTTA_REPO}/${PORTTA_REF}/install.sh | bash"

if [ "$HEALTH_OK" != "true" ]; then
  printf '\n' >&2
  bad "some health checks did not pass"
  note "$PORTTA_HOME/bin/portta doctor explains what is wrong"
  exit 1
fi

printf '\n' >&2
exit 0
