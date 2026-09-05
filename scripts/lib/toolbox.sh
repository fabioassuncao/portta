#!/usr/bin/env bash
# Portta: containerised tooling.
#
# The gateway promises a host needs only Docker, Git and a shell. Anything else
# it needs (curl, jq, dig, openssl, socat, psql, redis-cli, ssh) lives in one
# small image built from docker/images/toolbox/Dockerfile.

PORTTA_TOOLBOX_IMAGE="fabioassuncao/portta-toolbox:$(portta_version)"
PORTTA_TOOLBOX_CONTEXT="$PORTTA_ROOT/docker/images/toolbox"

portta_toolbox_exists() {
  docker image inspect "$PORTTA_TOOLBOX_IMAGE" >/dev/null 2>&1
}

# portta_toolbox_ensure [--quiet]: build the image if it is not present.
portta_toolbox_ensure() {
  portta_toolbox_exists && return 0
  [ "${1:-}" = "--quiet" ] || info "building the toolbox image (first use only)"
  docker build -q --build-arg "PORTTA_VERSION=$(portta_version)" -t "$PORTTA_TOOLBOX_IMAGE" "$PORTTA_TOOLBOX_CONTEXT" >/dev/null || {
    err "could not build the toolbox image"
    hint "docker build -t $PORTTA_TOOLBOX_IMAGE docker/images/toolbox/"
    return 1
  }
  return 0
}

# portta_toolbox <command...>: run a command in the toolbox, no network attached.
# Ephemeral by construction: --rm, no volumes, no privileges.
portta_toolbox() {
  portta_toolbox_ensure --quiet || return 1
  docker run --rm --network none "$PORTTA_TOOLBOX_IMAGE" "$@"
}

# portta_toolbox_net <network> <command...>: same, joined to one Docker network.
# Used to reach a project's private services without publishing a port.
portta_toolbox_net() {
  local net="$1"; shift
  portta_toolbox_ensure --quiet || return 1
  docker run --rm --network "$net" "$PORTTA_TOOLBOX_IMAGE" "$@"
}

# portta_toolbox_online <command...>: with outbound network access, for DNS
# lookups and API calls.
portta_toolbox_online() {
  portta_toolbox_ensure --quiet || return 1
  docker run --rm "$PORTTA_TOOLBOX_IMAGE" "$@"
}

# portta_curl / portta_jq / portta_dig: prefer the host binary when it exists (faster and
# avoids a container per call), otherwise fall back to the toolbox.
portta_curl() {
  if portta_have curl; then curl "$@"; else portta_toolbox_online curl "$@"; fi
}

portta_jq() {
  if portta_have jq; then jq "$@"; else
    # stdin has to reach the container, so this variant keeps it open.
    portta_toolbox_ensure --quiet || return 1
    docker run --rm -i --network none "$PORTTA_TOOLBOX_IMAGE" jq "$@"
  fi
}

portta_dig() {
  if portta_have dig; then dig "$@"; else portta_toolbox_online dig "$@"; fi
}

# portta_toolbox_stdin <command...>: same as portta_toolbox, with stdin kept open.
# Used to hash a password without ever putting it on a command line, where
# `ps` would show it to every user on the host.
portta_toolbox_stdin() {
  portta_toolbox_ensure --quiet || return 1
  docker run --rm -i --network none "$PORTTA_TOOLBOX_IMAGE" "$@"
}
