#!/usr/bin/env bash
# ============================================================================
# E2E: lifecycle independence
# ============================================================================
# The gateway is shared infrastructure, so its lifecycle must not be entangled
# with any project's. Restarting or stopping it leaves applications running;
# starting it again rediscovers them.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
portta_load_env; portta_defaults

GW="$PORTTA_ROOT/bin/portta"

up_demo() {
  ( cd "$PORTTA_ROOT/docker/examples/$1" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 120 ) >/dev/null 2>&1
}
down_demo() {
  ( cd "$PORTTA_ROOT/docker/examples/$1" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
}
# http_code <url>: resolves the hostname to the gateway's bind address
# explicitly. Routing and name resolution are separate concerns: `doctor`
# checks that *.localhost resolves, and these suites check that Traefik routes,
# so they keep working on hosts and CI runners whose resolver does not
# implement RFC 6761 for localhost subdomains.
http_code() {
  local url="$1" host
  host=$(printf '%s' "$url" | sed -e 's#^https\{0,1\}://##' -e 's#[:/].*$##')
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "${host}:${PORTTA_HTTP_PORT}:${PORTTA_BIND_ADDRESS}" "$url"
}

# wait_for_route <url> <expected>: Traefik rediscovers asynchronously.
wait_for_route() {
  local i=0
  while [ "$i" -lt 30 ]; do
    [ "$(http_code "$1")" = "$2" ] && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

# wait_for_health <container>: a freshly started container reports
# `starting` until its healthcheck has had a chance to run at least once.
wait_for_health() {
  local i=0
  while [ "$i" -lt 40 ]; do
    [ "$(portta_container_health "$1")" = "healthy" ] && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

cleanup() { down_demo demo-a; down_demo demo-b; "$GW" up local >/dev/null 2>&1; }

portta_require_docker >/dev/null 2>&1 || { echo "docker unavailable, skipping"; exit 0; }

trap cleanup EXIT INT TERM
describe "authentication migration"
it "starts the gateway with a writable disposable migrator"
assert_success "$GW" up local
it "writes the owner-only protection store"
assert_success test -f "$PORTTA_ROOT/state/auth/protections.json"
assert_eq "600" "$(portta_file_mode "$PORTTA_ROOT/state/auth/protections.json")"
it "keeps the persistent authentication service read-only"
auth_container=$(portta_gateway_container auth)
assert_eq "true false" "$(docker inspect "$auth_container" --format '{{.HostConfig.ReadonlyRootfs}} {{range .Mounts}}{{if eq .Destination "/app/state/auth"}}{{.RW}}{{end}}{{end}}')"

# The panel signs its own people in, so the file that used to carry its
# credential declares nothing. Written rather than deleted: Traefik watches the
# directory, and a file that merely stops being updated keeps working.
it "leaves no middleware behind for the panel"
panel_file="$PORTTA_ROOT/config/traefik/dynamic/portta-panel.yaml"
if [ -f "$panel_file" ]; then
  assert_eq "" "$(grep -n 'middlewares:' "$panel_file" || true)"
else
  skip "no generated panel file on this host"
fi

it "and the store carries no panel or dashboard scope"
assert_eq "" "$(python3 -c "
import json, sys
store = json.load(open('$PORTTA_ROOT/state/auth/protections.json'))
print(' '.join(p['scope'] for p in store.get('protections', []) if p['scope'] in ('panel', 'dashboard')))
")"

up_demo demo-a
up_demo demo-b
sleep 4

describe "baseline"
it "demo-a is routed"; assert_eq "200" "$(http_code http://demo-a-web.localhost/)"

describe "restarting the gateway"
"$GW" restart >/dev/null 2>&1
it "the application container was not restarted"
assert_eq "running" "$(portta_container_state demo-a-web-1)"
it "routes come back on their own"; assert_success wait_for_route http://demo-a-web.localhost/ 200

describe "stopping the gateway"
"$GW" down >/dev/null 2>&1
it "applications keep running"; assert_eq "running" "$(portta_container_state demo-a-web-1)"
it "the private network survives"; assert_success portta_network_exists demo-a_default
it "the shared network is NOT removed"; assert_success portta_network_exists "$PORTTA_NETWORK"
it "consumer volumes survive"
assert_success sh -c "docker volume ls --format '{{.Name}}' | grep -q '^demo-a_pgdata$'"

describe "starting the gateway again"
"$GW" up local >/dev/null 2>&1
it "existing applications are rediscovered"; assert_success wait_for_route http://demo-a-web.localhost/ 200
it "so is the second project"; assert_success wait_for_route http://demo-b-web.localhost/ 200

describe "stopping one project does not disturb the other"
down_demo demo-a
it "demo-b is still served"; assert_eq "200" "$(http_code http://demo-b-web.localhost/)"
it "the gateway is still healthy"; assert_success wait_for_health "$(portta_gateway_container traefik)"
it "demo-a's route is gone"; assert_ne "200" "$(http_code http://demo-a-web.localhost/)"

t_summary
