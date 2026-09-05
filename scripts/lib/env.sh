#!/usr/bin/env bash
# Shared zero-Node adapter. No dotenv content is ever sourced or evaluated.
portta_env_engine() {
  local file="$1" operation="$2" key="${3:-}" value="${4:-}" last="" crlf=false
  if [ -s "$file" ]; then
    last=$(tail -c 1 "$file" | od -An -tu1 | tr -d ' ')
    if LC_ALL=C head -n 1 "$file" | LC_ALL=C grep -q $'\r$'; then crlf=true; fi
  fi
  PORTTA_ENV_PATH="$file" PORTTA_ENV_OPERATION="$operation" \
    PORTTA_ENV_KEY="$key" PORTTA_ENV_VALUE="$value" \
    PORTTA_ENV_TEMPLATE="$(dirname "$file")/.env.example" \
    PORTTA_ENV_FINAL_NL="$([ -z "$last" ] || [ "$last" = 10 ] && printf true || printf false)" \
    PORTTA_ENV_CRLF="$crlf" \
    awk -f "${PORTTA_ENV_LIBRARY}/env.awk"
}
PORTTA_ENV_LIBRARY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

portta_env_get() { portta_env_engine "$1" get "$2"; }

portta_env_edit() {
  local file="$1" operation="$2" key="${3:-}" value="${4:-}" lock tmp backup attempt=0
  mkdir -p "$(dirname "$file")/.env-lock" || return 1
  chmod 700 "$(dirname "$file")/.env-lock"
  lock="$(dirname "$file")/.env-lock/writer"
  until mkdir "$lock" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 50 ]; then printf 'configuration is locked: %s; check active writers before removing it\n' "$lock" >&2; return 1; fi
    sleep 0.1
  done
  tmp="$lock/new"; backup="$lock/previous"
  if ! (umask 077; portta_env_engine "$file" "$operation" "$key" "$value" > "$tmp"); then
    rm -f "$tmp"; rmdir "$lock"; return 1
  fi
  if [ -f "$file" ] && cmp -s "$file" "$tmp"; then
    chmod 600 "$file"; rm -f "$tmp"; rmdir "$lock"; return 0
  fi
  if [ -f "$file" ]; then
    if ! cp "$file" "$backup" || ! chmod 600 "$backup"; then
      rm -f "$tmp" "$backup"; rmdir "$lock"; return 1
    fi
    if [ "$operation" = prepare ] && ! grep -qx '# Portta environment structure: 1' "$file" && [ ! -e "$file.before-structure" ]; then
      cp "$backup" "$file.before-structure" && chmod 600 "$file.before-structure" || return 1
    fi
  fi
  if ! (umask 077; cat "$tmp" > "$file"); then
    if [ -f "$backup" ]; then cat "$backup" > "$file" || return 1; fi
    rm -f "$tmp" "$backup"; rmdir "$lock"; return 1
  fi
  chmod 600 "$file"
  rm -f "$tmp" "$backup"; rmdir "$lock"
}

portta_env_set() {
  local file="${3:-$PORTTA_ROOT/.env}"
  portta_env_edit "$file" set "$1" "$2" || return 1
  export "$1=$2"
}

portta_prepare_env() {
  local file="${1:-$PORTTA_ROOT/.env}" key value
  portta_env_edit "$file" prepare || return 1
  for key in PORTTA_AUTH_SECRET PORTTA_RUNTIME_DB_PASSWORD PORTTA_WEB_USER PORTTA_AUTH_USER; do
    if [ "$key" = PORTTA_RUNTIME_DB_PASSWORD ] && [ "$(portta_env_get "$file" PORTTA_RUNTIME_DB_MODE)" = external ]; then continue; fi
    value=$(portta_env_get "$file" "$key") || return 1
    [ -z "$value" ] || continue
    case "$key" in
      *_USER) value="$(id -u):$(id -g)" ;;
      *) value=$(LC_ALL=C od -An -N 32 -tx1 /dev/urandom | tr -d ' \n') ;;
    esac
    # ensure is checked again under the same writer lock by the engine.
    portta_env_edit "$file" ensure "$key" "$value" || return 1
  done
}

portta_load_env() {
  local file="${1:-$PORTTA_ROOT/.env}" parsed line key value
  [ -f "$file" ] || return 0
  parsed=$(portta_env_engine "$file" read) || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key=${line%%$'\t'*}; value=${line#*$'\t'}
    export "$key=$value"
  done <<< "$parsed"
}
