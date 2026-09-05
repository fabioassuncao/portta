#!/usr/bin/env bash
# ============================================================================
# E2E: the web panel against a real Docker host
# ============================================================================
# The panel's own suites cover its logic against a fake Docker API. This one
# checks the part only a real host can prove: that it comes up through the CLI,
# classifies a real project correctly, tells gateway containers from external
# ones, creates a bridge the CLI then manages, and never publishes its socket
# proxy.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
portta_load_env; portta_defaults

GW="$PORTTA_ROOT/bin/portta"
export PORTTA_ASSUME_YES=true

portta_require_docker >/dev/null 2>&1 || { echo "docker unavailable, skipping"; exit 0; }

BASE="http://127.0.0.1:${PORTTA_WEB_PORT:-8081}"
WEB_WAS_ENABLED="$PORTTA_WEB"
STRAY="portta-web-e2e-stray"

cleanup() {
  [ -z "$DB_CONTAINER" ] || docker start "$DB_CONTAINER" >/dev/null 2>&1
  [ -z "$DB_CONTAINER" ] || docker exec "$DB_CONTAINER" psql -U portta -d portta \
    -c "DELETE FROM settings WHERE key = 'web-e2e-persistence';" >/dev/null 2>&1
  curl -s -X DELETE "$BASE/api/access/$BRIDGE_ID" >/dev/null 2>&1
  "$GW" access close --all >/dev/null 2>&1
  docker rm -f "$STRAY" >/dev/null 2>&1
  ( cd "$PORTTA_ROOT/docker/examples/demo-a" && docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
  portta_is_true "$WEB_WAS_ENABLED" || "$GW" web disable >/dev/null 2>&1
}
BRIDGE_ID=""
DB_CONTAINER=""
trap cleanup EXIT INT TERM

# get <path>: the panel's JSON, or nothing.
get() { curl -fsS -m 10 "$BASE$1" 2>/dev/null; }

# jq_py <expression>: read stdin as JSON and print one value, with no jq
# dependency (the host only needs Docker, Git and a shell).
jq_py() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# wait_until <seconds> <command...>: poll until it succeeds, or give up.
#
# A fixed `sleep` is a guess about how slow the machine is, and it is wrong in
# both directions: too long on a workstation, too short on a loaded CI runner,
# where it turns a passing assertion into a flake nobody can reproduce.
wait_until() {
  local deadline=$(( $(date +%s) + $1 )); shift
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

describe "the panel starts through the CLI"

( cd "$PORTTA_ROOT/docker/examples/demo-a" && docker compose \
    -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1

# A container that belongs to nobody: exactly what the Docker page exists for.
docker run -d --name "$STRAY" --label portta.e2e=true alpine:3.24.1 sleep 600 >/dev/null 2>&1

# Kept, not discarded: when `web up` fails, its own output is the only thing
# that says why, and every assertion below then fails for a reason none of them
# can explain.
WEB_UP_LOG=$(mktemp "${TMPDIR:-/tmp}/portta-web-up.XXXXXX")
"$GW" web up >"$WEB_UP_LOG" 2>&1 || true
if ! get /api/health >/dev/null 2>&1; then
  printf '\n--- web up said ---\n%s\n--- end ---\n\n' "$(cat "$WEB_UP_LOG")" >&2
  docker ps -a --filter 'label=portta.managed=true' --format '{{.Names}} {{.Status}}' >&2
  docker logs "$(portta_gateway_container db)" 2>&1 | tail -20 >&2 || true
fi
rm -f "$WEB_UP_LOG"

it "answers as soon as 'web up' returns"
# Regression: `web up` used to report success the moment Compose created the
# container, so the URL it printed was dead for the first few seconds and every
# caller had to guess how long to sleep. It now waits for the healthcheck.
assert_success get /api/health

it "reports the gateway version it is running beside"
assert_eq "$(portta_version)" "$(get /api/health | jq_py "d['gatewayVersion']")"

describe "its PostgreSQL is private, migratable and optional at runtime"

DB_CONTAINER=$(portta_gateway_container db)

it "the database starts healthy"
assert_eq "healthy" "$(portta_container_health "$DB_CONTAINER")"

it "it publishes no host port"
assert_eq "" "$(docker inspect "$DB_CONTAINER" \
  --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)"

it "its only network is the internal data network"
assert_eq "$PORTTA_DB_NETWORK" "$(docker inspect "$DB_CONTAINER" \
  --format '{{ range $name, $_ := .NetworkSettings.Networks }}{{ println $name }}{{ end }}' 2>/dev/null \
  | tr -d '[:space:]')"

it "the data network has no external route"
assert_eq "true" "$(docker network inspect "$PORTTA_DB_NETWORK" --format '{{ .Internal }}')"

# Drizzle keeps its own ledger (`drizzle_migrations`, one row per applied file)
# and the panel applies whatever the image carries at boot. Counting the files
# rather than naming the newest keeps this from being edited on every migration.
MIGRATION_COUNT=$(find "$PORTTA_ROOT/packages/db/drizzle" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')

it "every migration the image carries is recorded"
assert_eq "$MIGRATION_COUNT" "$(docker exec "$DB_CONTAINER" psql -U portta -d portta \
  -At -c 'SELECT count(*) FROM drizzle_migrations')"

it "and the pre-Drizzle ledger is gone"
assert_eq "" "$(docker exec "$DB_CONTAINER" psql -U portta -d portta \
  -At -c "SELECT to_regclass('public.schema_migrations')")"

docker stop "$DB_CONTAINER" >/dev/null

# The panel notices the database is gone on its next query, and how long that
# takes depends on the machine, not on anything worth asserting.
wait_until 30 sh -c 'curl -fsS -m 10 "'"$BASE"'/api/health" >/dev/null'

it "health remains available while PostgreSQL is down"
assert_success get /api/health

it "Docker-backed environment discovery remains available too"
wait_until 30 sh -c 'curl -fsS -m 10 "'"$BASE"'/api/environments" >/dev/null'
assert_contains "$(get /api/environments)" '"environments"'

it "the degraded database is an explicit warning"
db_status=""
for _ in $(seq 1 10); do
  db_status=$(get /api/status)
  case "$db_status" in *'"id":"database","status":"warn"'*) break ;; esac
  sleep 1
done
assert_contains "$db_status" '"id":"database","status":"warn"'

docker start "$DB_CONTAINER" >/dev/null
for _ in $(seq 1 30); do
  [ "$(portta_container_health "$DB_CONTAINER")" = "healthy" ] && break
  sleep 1
done

docker exec "$DB_CONTAINER" psql -U portta -d portta -v ON_ERROR_STOP=1 \
  -c "DELETE FROM settings WHERE key = 'web-e2e-persistence';
      INSERT INTO settings (key, value) VALUES ('web-e2e-persistence', 'true');" >/dev/null

describe "it describes the host the way the CLI does"

status=$(get /api/status)

it "sees the gateway as up"
assert_eq "True" "$(printf '%s' "$status" | jq_py "d['gateway']['up']")"

it "agrees with the CLI about the profile"
assert_eq "$PORTTA_PROFILE" "$(printf '%s' "$status" | jq_py "d['gateway']['profile']")"

it "counts the same routes as portta urls"
assert_eq "$("$GW" urls --json 2>/dev/null | jq_py "len(d['routes'])")" \
  "$(printf '%s' "$status" | jq_py "d['counts']['routes']")"

it "lists demo-a as an integrated environment"
assert_contains "$(get /api/environments | jq_py "[e['name'] for e in d['environments'] if e['integrated']]")" "demo-a"

it "groups the environment's database under it, though it never joined the gateway"
assert_contains \
  "$(get /api/environments/demo-a | jq_py "[s['service'] for s in d['services']]")" "postgres"

it "shows the URL Traefik actually serves"
assert_contains "$(get /api/environments/demo-a | jq_py "[u['host'] for u in d['urls']]")" \
  "demo-a-web.$PORTTA_DOMAIN"

describe "it tells the gateway's containers from everybody else's"

containers=$(get /api/docker/containers)
owner_of() {
  printf '%s' "$containers" | python3 -c "
import json,sys
for c in json.load(sys.stdin)['containers']:
    if c['name'] == '$1': print(c['ownership']); break"
}

it "the gateway's own containers are marked as its own"
assert_eq "gateway" "$(owner_of portta-traefik-1)"

it "the panel itself is gateway-owned too"
assert_eq "gateway" "$(owner_of portta-web-1)"

it "an adopted project's service is integrated"
assert_eq "integrated" "$(owner_of demo-a-web-1)"

it "a container started by hand is standalone"
assert_eq "standalone" "$(owner_of "$STRAY")"

describe "it says what mode it is in, and the CLI agrees"

# The panel is what stands in front of the panel now, so `.env` and the running
# process have to agree about whether it signs people in. This host is on
# loopback, which is the one place `disabled` is legal.
it "the public status endpoint answers in both modes"
assert_success get /api/auth/status

it "and reports open mode on a loopback panel"
assert_eq "open" "$(get /api/auth/status | jq_py "d['mode']")"

it "with nothing to set up, because there is nobody to be"
assert_eq "False" "$(get /api/auth/status | jq_py "d['setupRequired']")"

it "web status reports the same mode from .env"
assert_eq "disabled" "$("$GW" web status --json | jq_py "d['authMode']")"

# A host upgraded from an older Portta may still have the keys in .env; what
# matters is that nothing hands them to the panel any more.
it "and no credential of the panel's own reaches the container"
panel_container=$(portta_gateway_container web)
assert_eq "" "$(docker inspect "$panel_container" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^PORTTA_WEB_AUTH' || true)"

describe "it refuses what it must refuse"

it "will not stop a gateway component"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
  "$BASE/api/docker/containers/portta-traefik-1/stop")
assert_eq "403" "$code"

it "and the component is still running"
assert_eq "running" "$(portta_container_state portta-traefik-1)"

it "will not remove a container without an explicit confirmation"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X DELETE \
  -H 'content-type: application/json' -d '{}' \
  "$BASE/api/docker/containers/$STRAY")
assert_eq "400" "$code"

it "and the container is still there"
assert_eq "running" "$(portta_container_state "$STRAY")"

it "refuses a write from another origin"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
  -H 'Origin: https://evil.example' \
  "$BASE/api/docker/containers/$STRAY/restart")
assert_eq "403" "$code"

it "never returns an endpoint it does not have"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE/api/containers/prune")
assert_eq "404" "$code"

describe "a bridge opened in the panel is a bridge the CLI manages"

BRIDGE_ID=$(curl -fsS -m 30 -X POST -H 'content-type: application/json' \
  -d '{"project":"demo-a","service":"postgres"}' "$BASE/api/access" 2>/dev/null \
  | jq_py "d['bridge']['id']" 2>/dev/null)

it "the panel opened one"
assert_not_contains "x$BRIDGE_ID" "xNone"

it "portta access list sees it"
assert_contains "$("$GW" access list --json 2>/dev/null)" "\"id\": \"$BRIDGE_ID\""

it "it binds loopback, like every other bridge"
assert_not_contains "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^portta-access-')" "0.0.0.0"

it "closing it in the panel removes the container"
curl -fsS -m 10 -X DELETE "$BASE/api/access/$BRIDGE_ID" >/dev/null 2>&1
sleep 1
assert_eq "" "$(docker ps -q --filter "label=portta.access.id=$BRIDGE_ID")"
BRIDGE_ID=""

it "and the database it bridged to is untouched"
assert_eq "running" "$(portta_container_state demo-a-postgres-1)"

describe "the panel's socket proxy is unreachable"

it "it publishes no host port"
assert_eq "" "$(docker inspect portta-web-socket-proxy-1 \
  --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)"

it "its network is internal"
assert_eq "true" "$(docker network inspect "${PORTTA_WEB_NETWORK:-portta-web}" \
  --format '{{ .Internal }}' 2>/dev/null)"

it "and doctor agrees"
assert_success "$GW" doctor

describe "stopping the panel leaves everything else alone"

"$GW" web down >/dev/null 2>&1

it "the panel is gone"
# The daemon settles a removal asynchronously, so poll rather than sleeping a
# second and hoping that was enough.
wait_until 30 sh -c '[ -z "$(docker ps -q --filter label=portta.component=web)" ]'
assert_eq "" "$(docker ps -q --filter 'label=portta.component=web')"

it "Traefik is still running"
assert_eq "running" "$(portta_container_state portta-traefik-1)"

it "so is the project"
assert_eq "running" "$(portta_container_state demo-a-web-1)"

describe "the named volume survives a complete panel down/up"

"$GW" web up >/dev/null 2>&1
DB_CONTAINER=$(portta_gateway_container db)

it "the persisted marker comes back"
assert_eq "1" "$(docker exec "$DB_CONTAINER" psql -U portta -d portta -At \
  -c "SELECT count(*) FROM settings WHERE key = 'web-e2e-persistence'")"

it "the migrations are still recorded exactly once"
assert_eq "$MIGRATION_COUNT" "$(docker exec "$DB_CONTAINER" psql -U portta -d portta -At \
  -c "SELECT count(*) FROM drizzle_migrations")"

docker exec "$DB_CONTAINER" psql -U portta -d portta \
  -c "DELETE FROM settings WHERE key = 'web-e2e-persistence';" >/dev/null

t_summary
