#!/usr/bin/env bash
# Portta: Docker and Compose helpers.
#
# Everything the gateway creates carries `portta.managed=true`. Nothing in
# here may stop, remove or reconfigure a resource that lacks that label:
# consumer projects own their own containers, networks and volumes.

# ---------------------------------------------------------------------------
# Runtime checks
# ---------------------------------------------------------------------------

# Minimum versions enforced by `doctor`, which sources this file.
# shellcheck disable=SC2034  # consumed by scripts/doctor.sh
PORTTA_MIN_DOCKER_MAJOR=24
# shellcheck disable=SC2034  # consumed by scripts/doctor.sh
PORTTA_MIN_COMPOSE_MAJOR=2

portta_require_docker() {
  portta_have docker || {
    err "docker not found in PATH"
    hint "install OrbStack (recommended on macOS) or Docker Desktop / Docker Engine"
    return 1
  }
  docker info >/dev/null 2>&1 || {
    err "cannot talk to the Docker daemon"
    hint "start OrbStack / Docker Desktop, or check DOCKER_HOST"
    return 1
  }
  return 0
}

portta_docker_server_version() {
  docker version --format '{{.Server.Version}}' 2>/dev/null
}

portta_compose_version() {
  docker compose version --short 2>/dev/null
}

portta_require_compose() {
  docker compose version >/dev/null 2>&1 || {
    err "the Docker Compose plugin is not available"
    hint "Compose v2+ is required; 'docker-compose' (v1) is not supported"
    return 1
  }
  return 0
}

# portta_version_major <version-string>
portta_version_major() {
  printf '%s' "${1:-0}" | sed -e 's/^v//' -e 's/[^0-9.].*$//' | cut -d. -f1
}

# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

PORTTA_PROFILES="local remote-private remote-public"

portta_profile_valid() {
  case " $PORTTA_PROFILES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# portta_resolve_profile <profile>: apply the profile's effective settings.
#
# The domain used for generated hostnames depends on the profile, and Traefik
# bakes it into its default rule at startup, so it has to be settled here,
# before Compose is invoked.
portta_resolve_profile() {
  local profile="$1"
  portta_profile_valid "$profile" || {
    err "unknown profile: $profile"
    hint "valid profiles: $PORTTA_PROFILES"
    return 1
  }

  PORTTA_PROFILE="$profile"

  # The base every project hostname is built on, resolved from the mode before
  # the profile has its say. Mirrors resolveDomain in packages/core/src/domain.ts;
  # see docs/adr/0022-project-domain-modes.md.
  portta_resolve_domain

  case "$profile" in
    local)
      : "${PORTTA_BIND_ADDRESS:=127.0.0.1}"
      ;;

    remote-private)
      if [ -n "${PRIVATE_DOMAIN:-}" ]; then
        PORTTA_DOMAIN="$PRIVATE_DOMAIN"
      fi
      if portta_is_true "${TAILSCALE_ENABLED:-false}"; then
        # Traefik lives inside the Tailscale container's network namespace and
        # is reached over the tailnet. The published ports exist only so the
        # VPS itself can curl the gateway, hence loopback.
        PORTTA_BIND_ADDRESS="127.0.0.1"
      elif [ "${PORTTA_BIND_ADDRESS:-}" = "0.0.0.0" ]; then
        err "profile remote-private must not bind 0.0.0.0"
        hint "either enable TAILSCALE_ENABLED=true, or set PORTTA_BIND_ADDRESS"
        hint "to the address of your VPN interface"
        return 1
      fi
      ;;

    remote-public)
      # An auto or custom base fills in for PUBLIC_DOMAIN where none is set, so
      # going public no longer means buying a domain first. `local` does not:
      # publishing *.localhost to the internet would serve nobody.
      if [ -z "${PUBLIC_DOMAIN:-}" ] \
         && [ "${PORTTA_DOMAIN_MODE:-local}" != "local" ] \
         && [ -n "${PORTTA_DOMAIN:-}" ] && [ "$PORTTA_DOMAIN" != "localhost" ]; then
        PUBLIC_DOMAIN="$PORTTA_DOMAIN"
        export PUBLIC_DOMAIN
      fi
      if [ -z "${PUBLIC_DOMAIN:-}" ]; then
        err "profile remote-public requires PUBLIC_DOMAIN, or a project domain mode that yields one"
        hint "set PUBLIC_DOMAIN in .env, e.g. PUBLIC_DOMAIN=dev.example.com"
        hint "or: portta config set domain.mode auto   (derives one from this host's public address)"
        return 1
      fi
      PORTTA_DOMAIN="$PUBLIC_DOMAIN"
      # Public means public: this is the one profile that binds every interface.
      PORTTA_BIND_ADDRESS="0.0.0.0"
      ;;
  esac

  # The private VPN router must not silently become public just because the
  # selected gateway profile binds Traefik on every interface. Public panel
  # access has its own explicit entrypoint and ForwardAuth overlay.
  if portta_is_true "${PORTTA_WEB:-false}" \
     && [ "${PORTTA_WEB_EXPOSE:-local}" = "vpn" ] \
     && [ "$profile" = "remote-public" ]; then
    err "the panel must not be routed on the remote-public profile"
    hint "Traefik binds every interface there, so a router for the panel would be public"
    hint "set PORTTA_WEB_EXPOSE=local and reach it over SSH or the tailnet"
    return 1
  fi

  # A panel reachable beyond this machine is an open control plane over every
  # container on the host unless it asks who is asking, so this is refused here
  # too: `portta up` must not be a way around `portta web up`. The panel's own
  # process refuses the same combination at boot; this says it first, with the
  # command that fixes it.
  if portta_is_true "${PORTTA_WEB:-false}" \
     && [ "${PORTTA_WEB_EXPOSE:-local}" != "local" ] \
     && [ "${PORTTA_AUTH_MODE:-disabled}" != "required" ]; then
    err "the panel is reachable beyond this host and asks nobody who they are"
    hint "portta config set panel.auth required   then portta web up"
    hint "or set PORTTA_WEB_EXPOSE=local to keep it on loopback"
    return 1
  fi

  # `required` with no secret is a panel that refuses to start, which is worse
  # than one that refuses to come up here: there the failure arrives as a
  # container restarting in a loop.
  if portta_is_true "${PORTTA_WEB:-false}" \
     && [ "${PORTTA_AUTH_MODE:-disabled}" = "required" ] \
     && [ -z "${PORTTA_AUTH_SECRET:-}" ]; then
    err "PORTTA_AUTH_MODE=required with no PORTTA_AUTH_SECRET"
    hint "portta web up   generates one without printing it"
    return 1
  fi

  # The `public` panel entrypoint is a port on the Traefik container. Under the
  # Tailscale attachment Traefik has no network namespace of its own, so there
  # is no port to publish and the mode cannot be honoured.
  if portta_is_true "${PORTTA_WEB:-false}" \
     && [ "${PORTTA_WEB_EXPOSE:-local}" = "public" ] \
     && [ "$(portta_attachment "$profile")" = "tailscale" ]; then
    err "panel access 'public' cannot be combined with the Tailscale attachment"
    hint "Traefik shares the Tailscale namespace there and publishes no port of its own"
    hint "use PORTTA_WEB_EXPOSE=tailscale, or disable TAILSCALE_ENABLED"
    return 1
  fi

  # A database is never reachable from the internet. `public enable` is about
  # HTTP services that opted in; the TCP entrypoints have no such notion, and
  # on this profile Traefik binds every interface.
  if portta_is_true "${PORTTA_TCP:-false}" && [ "$profile" = "remote-public" ]; then
    err "TCP entrypoints must not run on the remote-public profile"
    hint "Traefik binds every interface there, so 5432 and 6379 would face the internet"
    hint "reach databases over the VPN (remote-private) or a loopback bridge instead"
    hint "see docs/tcp-routing.md"
    return 1
  fi

  # ACME cannot issue a certificate without a contact address.
  case "$profile" in
    remote-private|remote-public)
      if portta_is_true "${TLS_ENABLED:-false}" && [ "${TLS_MODE:-}" = "acme" ] \
         && [ -z "${ACME_EMAIL:-}" ]; then
        err "TLS_MODE=acme requires ACME_EMAIL"
        hint "set ACME_EMAIL in .env"
        return 1
      fi
      ;;
  esac

  export PORTTA_PROFILE PORTTA_DOMAIN PORTTA_BIND_ADDRESS
  return 0
}

# portta_attachment <profile>: which overlay decides how Traefik meets the world.
portta_attachment() {
  case "$1" in
    local) printf 'host' ;;
    remote-private|remote-public)
      if portta_is_true "${TAILSCALE_ENABLED:-false}"; then printf 'tailscale'; else printf 'host'; fi
      ;;
  esac
}

# portta_compose_files <profile>: echo the -f arguments for a profile, in order.
#
# The files live under docker/compose/, one directory per axis of the decision:
# docker/compose/attach/ (how Traefik meets the world), docker/compose/profiles/ (which
# entrypoints answer) and docker/compose/features/ (what is opted into). Their relative
# paths still resolve against the repository root, because portta_compose passes
# --project-directory. See docs/adr/0019-compose-files-live-under-docker.md.
portta_compose_files() {
  local profile="$1"
  local files="docker/compose/compose.yaml"
  local attachment
  attachment=$(portta_attachment "$profile")

  # Exactly one attachment overlay, always.
  files="$files docker/compose/attach/$attachment.yaml"

  case "$profile" in
    local)
      files="$files docker/compose/profiles/local.yaml"
      # A locally-issued certificate flips the default entrypoint to :443.
      if portta_is_true "${TLS_ENABLED:-false}" && [ "${TLS_MODE:-local}" = "local" ]; then
        files="$files docker/compose/profiles/local-tls.yaml"
      fi
      ;;
    remote-private|remote-public)
      # Redirecting :80 to :443 without a certificate the browser accepts turns
      # a working URL into a warning page, so the TLS overlay is applied only
      # when there is TLS. See docs/adr/0022-project-domain-modes.md.
      if portta_is_true "${TLS_ENABLED:-false}"; then
        files="$files docker/compose/profiles/remote-tls.yaml"
        # Exactly one challenge overlay rides with it. DNS-01 is the default
        # because it is the only challenge that issues a wildcard, and the only
        # one a private gateway can use; HTTP-01 is the trade for a public host
        # that would rather not hold a DNS credential.
        if [ "${ACME_CHALLENGE:-dns}" = "http" ]; then
          files="$files docker/compose/profiles/remote-tls-http.yaml"
        else
          files="$files docker/compose/profiles/remote-tls-dns.yaml"
        fi
      else
        files="$files docker/compose/profiles/remote.yaml"
      fi
      if [ "$profile" = "remote-public" ]; then
        files="$files docker/compose/profiles/public.yaml"
      fi
      ;;
  esac

  if portta_is_true "${PORTTA_DASHBOARD:-false}"; then
    # The routed path and the loopback path are independent: domain never
    # composes with dashboard.yaml, so TRAEFIK_API_INSECURE stays off it.
    if [ "${PORTTA_DASHBOARD_EXPOSE:-local}" = "domain" ]; then
      files="$files docker/compose/features/dashboard-domain.yaml"
    elif [ "$attachment" = "tailscale" ]; then
      files="$files docker/compose/features/dashboard-tailscale.yaml"
    else
      files="$files docker/compose/features/dashboard.yaml"
    fi
  fi

  # Hostname routing for databases: one entrypoint per protocol, opt-in.
  if portta_is_true "${PORTTA_TCP:-false}"; then
    if [ "$attachment" = "tailscale" ]; then
      files="$files docker/compose/features/tcp-tailscale.yaml"
    else
      files="$files docker/compose/features/tcp.yaml"
    fi
  fi

  # The panel is opt-in and rides along with the gateway once enabled, so
  # `portta up` and `portta web` cannot drift apart.
  if portta_is_true "${PORTTA_WEB:-false}"; then
    files="$files docker/compose/features/web.yaml"
    [ "${PORTTA_RUNTIME_DB_MODE:-managed}" = external ] || files="$files docker/compose/features/db.yaml"
    # Exactly one overlay owns the panel's front door, so a host publish and
    # the public Traefik entrypoint can never both claim PORTTA_WEB_PORT.
    if [ "${PORTTA_WEB_EXPOSE:-local}" = "public" ]; then
      files="$files docker/compose/features/panel-public.yaml"
    elif [ "${PORTTA_WEB_EXPOSE:-local}" != "domain" ]; then
      # `domain` owns the front door too: a host publish beside the router
      # would be a second way in that the middleware never sees.
      files="$files docker/compose/features/web-bind.yaml"
    fi
    if portta_is_true "${PORTTA_WEB_BUILD:-false}"; then
      files="$files docker/compose/features/web-build.yaml"
    fi
    if portta_is_true "${PORTTA_WEB_DEV:-false}"; then
      files="$files docker/compose/features/web-dev.yaml"
    fi
    if [ "${PORTTA_WEB_EXPOSE:-local}" = "vpn" ]; then
      files="$files docker/compose/features/web-vpn.yaml"
    fi
    if [ "${PORTTA_WEB_EXPOSE:-local}" = "domain" ]; then
      files="$files docker/compose/features/panel-domain.yaml"
      # The one path GitHub can reach without a session, because it carries a
      # signature instead. Only with the App on, and only where the panel is
      # routed on a name a certificate covers.
      if portta_is_true "${GITHUB_APP_ENABLED:-false}"; then
        files="$files docker/compose/features/panel-webhook.yaml"
      fi
    fi
  fi

  # Auth is a gateway service: the migrator runs on `up` even when the panel
  # is off. Local builds are explicit; merely running inside a checkout must
  # not turn an otherwise production-like `up` into a build.
  if portta_is_true "${PORTTA_WEB_BUILD:-false}"; then
    files="$files docker/compose/features/auth-build.yaml"
  fi
  if portta_is_true "${PORTTA_WEB_DEV:-false}"; then
    files="$files docker/compose/features/auth-dev.yaml"
  fi

  # Last, and independent of every other axis: the connector is an extra way in,
  # never a replacement for one. A gateway can carry a tunnel while publishing
  # ports, or while publishing none at all.
  if portta_is_true "${CLOUDFLARE_TUNNEL_ENABLED:-false}"; then
    files="$files docker/compose/features/cloudflare-tunnel.yaml"
  fi

  local f out=""
  for f in $files; do
    [ -f "$PORTTA_ROOT/$f" ] || {
      err "missing compose file: $f"
      hint "profile '$profile' is not available in this version of the gateway"
      return 1
    }
    out="$out -f $PORTTA_ROOT/$f"
  done
  printf '%s' "${out# }"
}

# portta_compose <profile> <compose args...>
#
# --project-directory anchors every relative path in the overlays (./config,
# ./state, ./.env, and the build contexts) at the repository root. Without it
# Compose would resolve them against docker/compose/, where the first -f file lives.
portta_compose() {
  local profile="$1"; shift
  local files
  files=$(portta_compose_files "$profile") || return 1
  # shellcheck disable=SC2086
  ( cd "$PORTTA_ROOT" && docker compose --project-directory "$PORTTA_ROOT" $files "$@" )
}

# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

portta_network_exists() {
  docker network inspect "$1" >/dev/null 2>&1
}

# portta_network_ensure <name>: idempotent. Creates the shared network if absent,
# labelled so `doctor` and the cleanup paths can prove we own it. An existing
# network is reused untouched, even if it predates the gateway.
portta_network_ensure() {
  local name="$1"
  if portta_network_exists "$name"; then
    return 0
  fi
  docker network create \
    --label portta.managed=true \
    --label portta.component=shared-network \
    "$name" >/dev/null || return 1
  return 0
}

portta_network_is_managed() {
  [ "$(docker network inspect "$1" --format '{{ index .Labels "portta.managed" }}' 2>/dev/null)" = "true" ]
}

# portta_network_endpoints <name>: number of containers currently attached.
portta_network_endpoints() {
  docker network inspect "$1" --format '{{ len .Containers }}' 2>/dev/null || printf '0'
}

# ---------------------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------------------

# portta_container_labels <container>: every label as `key=value`, one per line.
#
# Docker's `inspect --format` runs Go templates with Docker's own small
# function map, which has no `hasPrefix`: a template using it fails to parse
# and prints nothing, so filtering has to happen out here. Getting this wrong
# is silent, which is exactly why it is worth a helper.
portta_container_labels() {
  docker inspect "$1" --format '{{ range $k, $v := .Config.Labels }}{{ $k }}={{ $v }}
{{ end }}' 2>/dev/null
}

# portta_container_is_managed <container>: true only for gateway-created
# containers. Every destructive code path must gate on this.
portta_container_is_managed() {
  [ "$(docker inspect "$1" --format '{{ index .Config.Labels "portta.managed" }}' 2>/dev/null)" = "true" ]
}

portta_container_state() {
  docker inspect "$1" --format '{{ .State.Status }}' 2>/dev/null || printf 'absent'
}

# portta_container_health <container>: "healthy", "unhealthy", "starting", or
# "none" when the image declares no healthcheck.
portta_container_health() {
  docker inspect "$1" --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' 2>/dev/null || printf 'absent'
}

# portta_gateway_container <component>: resolve a gateway container id by label.
portta_gateway_container() {
  docker ps -aq \
    --filter "label=portta.managed=true" \
    --filter "label=portta.component=$1" \
    2>/dev/null | head -1
}

# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

# portta_discover_http [project]: every container that opted into the gateway.
#
# Reads Docker labels directly rather than Traefik's API: discovery then works
# with the dashboard disabled and even while Traefik is down, and it needs no
# extra port open anywhere.
#
# Output, one line per container, tab separated:
#   project  service  container  hostname  port  state
portta_discover_http() {
  local want_project="${1:-}"
  local id project service name labels rule host port state

  for id in $(docker ps -q --filter "label=traefik.enable=true" 2>/dev/null); do
    project=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
    service=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.service" }}' 2>/dev/null)
    name=$(docker inspect "$id" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    state=$(portta_container_state "$id")

    labels=$(portta_container_labels "$id")

    # A datastore routed by hostname carries TCP router labels and no HTTP
    # ones. It opted into the gateway, but not into anything `urls` should
    # list: it is not reached with a browser. See docs/tcp-routing.md.
    if printf '%s' "$labels" | grep -q '^traefik\.tcp\.routers\.' \
       && ! printf '%s' "$labels" | grep -q '^traefik\.http\.'; then
      continue
    fi

    # An explicit Host(`...`) rule label wins over the derived hostname, the
    # same way it does inside Traefik.
    rule=$(printf '%s' "$labels" \
      | sed -n 's/^traefik\.http\.routers\..*\.rule=//p' | head -1)

    host=""
    if [ -n "$rule" ]; then
      host=$(printf '%s' "$rule" | sed -n 's/.*Host(`\([^`]*\)`).*/\1/p')
      # An explicit rule that names no host has no hostname to list, and the
      # derived one would be fiction: nothing answers there. The panel's public
      # entrypoint is exactly this shape (PathPrefix on its own entrypoint).
      [ -n "$host" ] || continue
    fi
    if [ -z "$host" ]; then
      if [ -n "$project" ]; then
        host="$(portta_slug "$project")-$(portta_slug "$service").${PORTTA_DOMAIN}"
      else
        host="$(portta_slug "$name").${PORTTA_DOMAIN}"
      fi
    fi

    port=$(printf '%s' "$labels" \
      | sed -n 's/^traefik\.http\.services\..*\.loadbalancer\.server\.port=//p' | head -1)
    [ -n "$port" ] || port="auto"

    [ -z "$want_project" ] || [ "$want_project" = "$project" ] || continue

    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${project:-<none>}" "${service:-<none>}" "$name" "$host" "$port" "$state"
  done
}

# portta_compose_projects: distinct Compose project names currently running.
portta_compose_projects() {
  docker ps -q 2>/dev/null | while read -r id; do
    docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null
  done | grep -v '^$' | sort -u
}
