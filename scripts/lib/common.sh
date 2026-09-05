#!/usr/bin/env bash
# Portta: shared shell helpers.
#
# Targets bash 3.2 (the version macOS still ships), so: no associative arrays,
# no ${var,,}, no mapfile. Sourced by bin/portta and scripts/*.sh.

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# PORTTA_ROOT is the repository root, resolved from this file's location so the
# CLI works when called through a symlink or from any working directory.
portta_resolve_root() {
  local src="${BASH_SOURCE[0]}" dir
  while [ -L "$src" ]; do
    dir=$(cd -P "$(dirname "$src")" && pwd)
    src=$(readlink "$src")
    case "$src" in
      /*) ;;
      *) src="$dir/$src" ;;
    esac
  done
  cd -P "$(dirname "$src")/../.." && pwd
}

PORTTA_ROOT="${PORTTA_ROOT:-$(portta_resolve_root)}"
export PORTTA_ROOT

PORTTA_STATE_DIR="$PORTTA_ROOT/state"
export PORTTA_STATE_DIR

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

PORTTA_COLOR_ENABLED=0
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  PORTTA_COLOR_ENABLED=1
fi

portta_c() { # portta_c <ansi-code> <text>
  if [ "$PORTTA_COLOR_ENABLED" = "1" ]; then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
}

portta_bold() { portta_c "1" "$1"; }
portta_dim() { portta_c "2" "$1"; }

# All diagnostics go to stderr so `--json` output on stdout stays parseable.
info() { printf '%s %s\n' "$(portta_c '34' '::')" "$*" >&2; }
ok()   { printf '%s %s\n' "$(portta_c '32' 'ok')" "$*" >&2; }
warn() { printf '%s %s\n' "$(portta_c '33' 'warn')" "$*" >&2; }
err()  { printf '%s %s\n' "$(portta_c '31' 'error')" "$*" >&2; }

die() { err "$*"; exit 1; }

step() { printf '\n%s\n' "$(portta_bold "$*")" >&2; }

# hint <text>: an actionable suggestion printed under an error or warning.
hint() { printf '   %s %s\n' "$(portta_dim '->')" "$*" >&2; }

# A bootstrap secret, written straight to .env and never printed. `od` is in
# POSIX userlands (including macOS) and the finite pipeline cannot SIGPIPE.
portta_random_hex() {
  LC_ALL=C od -An -N "${1:-32}" -tx1 /dev/urandom | tr -d ' \n'
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

# portta_load_env: read .env into the environment without executing it.
#
# Installation values win over inherited shell variables.
# The file is parsed, never sourced: a stray backtick in a value must not run.
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

# ---------------------------------------------------------------------------
# Project domain
# ---------------------------------------------------------------------------
# Mirrors resolveDomain in packages/core/src/domain.ts. The two implementations
# have to agree, because Traefik bakes the resolved base into its default rule
# and the panel derives the same hostnames for display.
# See docs/adr/0022-project-domain-modes.md.

# portta_auto_domain <ipv4> [provider]: the wildcard-DNS name for an address.
#
# The dashed form keeps the address to one DNS label, which leaves
# <project>-<service> as its own label and makes *.1-2-3-4.sslip.io a name a
# certificate can cover.
portta_auto_domain() {
  local ip="$1" provider="${2:-sslip.io}"
  case "$ip" in
    ''|*[!0-9.]*) return 1 ;;
  esac
  # Four octets, each 0-255. Rejecting anything else keeps a stray value out of
  # a hostname that ends up in a Traefik rule.
  #
  # The status is carried in a variable rather than `exit 1` from a rule: an
  # `exit` inside a rule runs END anyway, and an `exit 0` there would overwrite
  # it — which is how 203.0.113.999 became a hostname the first time.
  printf '%s' "$ip" | awk -F. '
    BEGIN { bad = 0 }
    NF != 4 { bad = 1 }
    {
      for (i = 1; i <= 4; i++) {
        if ($i == "" || $i ~ /[^0-9]/ || length($i) > 3 || $i + 0 > 255) bad = 1
      }
    }
    END { exit bad }' || return 1
  printf '%s.%s' "$(printf '%s' "$ip" | tr '.' '-')" "$provider"
}

# portta_detect_public_ip: this host's address as the internet sees it.
#
# One outbound request, to services that answer with nothing but the address.
# Never called to resolve a hostname — that reads the stored PORTTA_PUBLIC_IP —
# only when something deliberately asks to detect or re-check it, because a
# command that pauses on a network call is a command nobody trusts.
portta_detect_public_ip() {
  local url ip=""
  portta_have curl || return 1
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)
    case "$ip" in
      ''|*[!0-9.]*) ip="" ;;
      *) break ;;
    esac
  done
  [ -n "$ip" ] || return 1
  printf '%s' "$ip"
}

# portta_ip_is_private <ipv4>: RFC 1918, plus the CGNAT range Tailscale uses.
#
# The distinction matters for advice, not for policy: a name that resolves to a
# tailnet address is served by binding that address, and telling somebody to
# publish on every interface instead would be a much larger change than the one
# they need.
portta_ip_is_private() {
  case "${1:-}" in
    10.*|192.168.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
    127.*) return 0 ;;
    *) return 1 ;;
  esac
}

# portta_resolve_domain: set PORTTA_DOMAIN from PORTTA_DOMAIN_MODE.
#
# A mode that cannot be honoured falls back to localhost and warns, rather than
# failing: an unreachable hostname is a nuisance, and a gateway that refuses to
# start over one is worse. PORTTA_DOMAIN_PROBLEM carries the reason so `status`
# and `doctor` can report it.
portta_resolve_domain() {
  PORTTA_DOMAIN_PROBLEM=""
  case "${PORTTA_DOMAIN_MODE:-local}" in
    custom)
      if [ -z "${PORTTA_DOMAIN:-}" ]; then
        PORTTA_DOMAIN="localhost"
        PORTTA_DOMAIN_PROBLEM="domain mode is custom and no domain is set"
      fi
      ;;
    auto)
      if [ -z "${PORTTA_PUBLIC_IP:-}" ]; then
        PORTTA_DOMAIN="localhost"
        PORTTA_DOMAIN_PROBLEM="domain mode is auto and no public address has been detected"
      elif ! PORTTA_DOMAIN=$(portta_auto_domain "$PORTTA_PUBLIC_IP" "${PORTTA_AUTO_DOMAIN_PROVIDER:-sslip.io}"); then
        PORTTA_DOMAIN="localhost"
        PORTTA_DOMAIN_PROBLEM="domain mode is auto and $PORTTA_PUBLIC_IP is not an IPv4 address"
      fi
      ;;
    *)
      PORTTA_DOMAIN="localhost"
      ;;
  esac
  export PORTTA_DOMAIN PORTTA_DOMAIN_PROBLEM
}

# portta_defaults: fill in every value the CLI relies on.
# Runs after portta_load_env so an empty (or missing) .env still yields a usable
# local gateway. Keep these in sync with .env.example.
portta_defaults() {
  : "${PORTTA_PROFILE:=local}"
  : "${PORTTA_VERSION:=$(portta_version)}"
  : "${PORTTA_PROJECT_NAME:=portta}"
  : "${PORTTA_NETWORK:=portta}"
  : "${PORTTA_CONTROL_NETWORK:=portta-control}"
  : "${PORTTA_ACCESS_NETWORK:=portta-access}"
  : "${CLOUDFLARE_TUNNEL_ENABLED:=false}"
  : "${CLOUDFLARE_TUNNEL_ZONE:=}"
  : "${CLOUDFLARE_TUNNEL_ID:=}"
  : "${CLOUDFLARE_ACCESS_ENABLED:=false}"
  : "${PORTTA_CLOUDFLARED_IMAGE:=cloudflare/cloudflared:2026.8.3}"
  : "${PORTTA_DOMAIN_MODE:=local}"
  : "${PORTTA_AUTO_DOMAIN_PROVIDER:=sslip.io}"
  : "${PORTTA_PUBLIC_IP:=}"
  : "${PORTTA_DOMAIN:=localhost}"
  : "${PORTTA_BIND_ADDRESS:=127.0.0.1}"
  : "${PORTTA_HTTP_PORT:=80}"
  : "${PORTTA_HTTPS_PORT:=443}"
  : "${PORTTA_LOG_LEVEL:=INFO}"
  : "${PORTTA_ACCESS_LOG:=false}"
  : "${PORTTA_ALIAS_HEADERS_STRATEGY:=keep}"
  : "${PORTTA_DASHBOARD:=false}"
  : "${PORTTA_DASHBOARD_BIND_ADDRESS:=127.0.0.1}"
  : "${PORTTA_DASHBOARD_PORT:=8080}"
  : "${PORTTA_DASHBOARD_EXPOSE:=local}"
  : "${PORTTA_DASHBOARD_ADVERTISED_HOST:=${PORTTA_PROJECT_NAME:-portta}-traefik.${PORTTA_DOMAIN:-localhost}}"
  : "${PORTTA_WEB:=false}"
  : "${PORTTA_WEB_BIND_ADDRESS:=127.0.0.1}"
  : "${PORTTA_WEB_PORT:=8081}"
  : "${PORTTA_WEB_DEV:=false}"
  : "${PORTTA_WEB_EXPOSE:=local}"
  : "${PORTTA_WEB_HOST:=portta-web}"
  : "${PORTTA_WEB_NETWORK:=portta-web}"
  : "${PORTTA_WEB_READ_ONLY:=false}"
  : "${PORTTA_WEB_BUILD:=false}"
  : "${PORTTA_APPLY:=false}"
  : "${PORTTA_RUNNER:=false}"
  : "${PORTTA_WEB_IMAGE:=}"
  : "${PORTTA_AUTH_IMAGE:=}"
  : "${PORTTA_LOCAL_RELEASE:=false}"
  : "${PORTTA_AUTH_SECRET:=}"
  : "${PORTTA_PANEL_ADVERTISED_HOST:=}"
  : "${PORTTA_AUTH_MODE:=disabled}"
  : "${PORTTA_PANEL_URL:=}"
  : "${PORTTA_PANEL_TRUSTED_ORIGINS:=}"
  : "${PORTTA_RUNTIME_DOCS:=true}"
  : "${PORTTA_RUNTIME_API_DOCS:=}"
  : "${PORTTA_DB_NETWORK:=portta-data}"
  : "${PORTTA_DB_VOLUME:=portta-db}"
  : "${PORTTA_RUNTIME_DB_PASSWORD:=}"
  : "${PORTTA_RUNTIME_DATABASE_URL:=}"
  : "${PORTTA_RUNTIME_DB_MODE:=managed}"
  : "${PORTTA_RUNTIME_DB_USER:=portta}"
  : "${PORTTA_RUNTIME_DB_NAME:=portta}"
  case "$PORTTA_RUNTIME_DB_MODE" in
    managed) [ -z "$PORTTA_RUNTIME_DATABASE_URL" ] || { err "PORTTA_RUNTIME_DATABASE_URL requires external database mode"; return 1; } ;;
    external) case "$PORTTA_RUNTIME_DATABASE_URL" in postgres://*|postgresql://*) ;; *) err "external database mode requires a PostgreSQL URL"; return 1 ;; esac ;;
    *) err "PORTTA_RUNTIME_DB_MODE must be managed or external"; return 1 ;;
  esac
  : "${PORTTA_TCP:=false}"
  : "${PORTTA_TCP_POSTGRES_PORT:=5432}"
  : "${PORTTA_TCP_REDIS_PORT:=6379}"
  : "${TLS_ENABLED:=false}"
  : "${TLS_MODE:=local}"
  : "${ACME_CHALLENGE:=dns}"
  : "${ACME_CA_SERVER:=https://acme-v02.api.letsencrypt.org/directory}"
  : "${ACME_DNS_PROVIDER:=cloudflare}"
  : "${ACME_DNS_RESOLVERS:=1.1.1.1:53,8.8.8.8:53}"
  : "${TAILSCALE_ENABLED:=false}"
  : "${TAILSCALE_HOSTNAME:=portta}"
  : "${GITHUB_APP_ENABLED:=false}"
  : "${PUBLIC_ENABLED:=false}"
  : "${CLOUDFLARE_ENABLED:=false}"

  if [ -z "$PORTTA_RUNTIME_API_DOCS" ]; then
    if [ "$PORTTA_WEB_EXPOSE" = "local" ]; then
      PORTTA_RUNTIME_API_DOCS=true
    else
      PORTTA_RUNTIME_API_DOCS=false
    fi
  fi

  export PORTTA_PROFILE PORTTA_VERSION PORTTA_PROJECT_NAME PORTTA_NETWORK \
    PORTTA_CONTROL_NETWORK PORTTA_ACCESS_NETWORK PORTTA_DOMAIN \
    PORTTA_DOMAIN_MODE PORTTA_AUTO_DOMAIN_PROVIDER PORTTA_PUBLIC_IP \
    PORTTA_BIND_ADDRESS PORTTA_HTTP_PORT PORTTA_HTTPS_PORT \
    PORTTA_LOG_LEVEL PORTTA_ACCESS_LOG PORTTA_ALIAS_HEADERS_STRATEGY \
    PORTTA_DASHBOARD \
    PORTTA_DASHBOARD_BIND_ADDRESS PORTTA_DASHBOARD_PORT \
    PORTTA_DASHBOARD_EXPOSE PORTTA_DASHBOARD_ADVERTISED_HOST \
    PORTTA_WEB PORTTA_WEB_BIND_ADDRESS PORTTA_WEB_PORT \
    PORTTA_WEB_DEV PORTTA_WEB_EXPOSE \
    PORTTA_WEB_HOST PORTTA_WEB_NETWORK PORTTA_WEB_READ_ONLY \
    PORTTA_WEB_BUILD PORTTA_WEB_IMAGE PORTTA_AUTH_IMAGE PORTTA_LOCAL_RELEASE PORTTA_AUTH_SECRET PORTTA_PANEL_ADVERTISED_HOST \
    PORTTA_APPLY PORTTA_RUNNER \
    PORTTA_AUTH_MODE PORTTA_PANEL_URL PORTTA_PANEL_TRUSTED_ORIGINS \
    PORTTA_RUNTIME_DOCS PORTTA_RUNTIME_API_DOCS PORTTA_DB_NETWORK PORTTA_DB_VOLUME \
    PORTTA_RUNTIME_DB_MODE PORTTA_RUNTIME_DB_NAME PORTTA_RUNTIME_DB_USER \
    PORTTA_RUNTIME_DB_PASSWORD PORTTA_RUNTIME_DATABASE_URL \
    PORTTA_TCP PORTTA_TCP_POSTGRES_PORT PORTTA_TCP_REDIS_PORT \
    TLS_ENABLED TLS_MODE ACME_CHALLENGE ACME_CA_SERVER ACME_DNS_PROVIDER ACME_DNS_RESOLVERS \
    TAILSCALE_ENABLED TAILSCALE_HOSTNAME PUBLIC_ENABLED CLOUDFLARE_ENABLED GITHUB_APP_ENABLED \
    CLOUDFLARE_TUNNEL_ENABLED CLOUDFLARE_TUNNEL_ZONE CLOUDFLARE_TUNNEL_ID \
    CLOUDFLARE_ACCESS_ENABLED PORTTA_CLOUDFLARED_IMAGE
}

portta_version() {
  if [ -f "$PORTTA_ROOT/VERSION" ]; then
    tr -d '[:space:]' < "$PORTTA_ROOT/VERSION"
  else
    printf 'unknown'
  fi
}

# portta_env_set <key> <value> [file]: set a value in .env in place.
#
# Rewrites the line if the key is present (keeping its position and the
# comments around it) and appends otherwise.
#
# The new contents are built in a temporary file beside the original and then
# copied *over* it. Never `mv`: .env is bind-mounted into the panel container as
# a single file, and a file bind follows the inode, so replacing the file here
# leaves the panel holding an unlinked one and reporting .env as missing until
# it is recreated. The temporary is kept until the copy lands, so an interrupted
# run leaves the new contents recoverable beside the file rather than nothing.

# ---------------------------------------------------------------------------
# Predicates
# ---------------------------------------------------------------------------

# portta_is_true <value>: accepts the spellings people actually write in .env.
portta_is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

portta_have() { command -v "$1" >/dev/null 2>&1; }

# portta_locate <command>: the command's path, looking beyond PATH.
#
# A developer's toolchain is usually wired into an interactive shell — nvm in
# .zshrc, agent CLIs symlinked into ~/.local/bin — and a non-interactive shell
# sees none of it. Reporting "not found" for a tool the machine plainly has is
# worse than saying nothing, so these are the places worth looking before
# giving that answer. Prints nothing when there is genuinely no such command.
portta_locate() {
  local cmd="$1" candidate

  if command -v "$cmd" >/dev/null 2>&1; then
    command -v "$cmd"
    return 0
  fi

  for candidate in \
    "$HOME/.local/bin/$cmd" \
    "$HOME/.bun/bin/$cmd" \
    "$HOME/.cargo/bin/$cmd" \
    "$HOME/.deno/bin/$cmd" \
    /usr/local/bin/"$cmd" \
    /opt/homebrew/bin/"$cmd"; do
    if [ -x "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done

  # nvm, fnm and volta each keep one directory per installed version.
  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin/"$cmd" \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/"$cmd" \
    "$HOME"/.volta/bin/"$cmd"; do
    if [ -x "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done

  return 1
}

# portta_confirm <prompt>: returns 0 on yes. Non-interactive callers must pass
# --yes explicitly; we never assume consent when there is no tty.
portta_confirm() {
  local prompt="$1" reply
  if portta_is_true "${PORTTA_ASSUME_YES:-}"; then
    return 0
  fi
  if [ ! -t 0 ]; then
    err "$prompt"
    hint "no terminal available to confirm; re-run with --yes to proceed"
    return 1
  fi
  printf '%s [y/N] ' "$prompt" >&2
  read -r reply
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

# portta_slug <text>: DNS-safe label: lowercase, [a-z0-9-], no leading/trailing
# dash, collapsed dashes. Mirrors Traefik's `normalize` closely enough that a
# hostname printed by `urls` matches the one Traefik generates.
portta_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//'
}

# portta_json_escape <text>: minimal JSON string escaping for hand-built output.
portta_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g'
}

# Octal permission bits of a file, portable between GNU and BSD stat. Empty
# when the file is gone or neither form works, so callers say "unknown" rather
# than guessing a mode is safe.
portta_file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || printf ''
}
