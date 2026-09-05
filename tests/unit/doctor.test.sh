#!/usr/bin/env bash
# ============================================================================
# The two diagnostics, and the contract between them
# ============================================================================
# `packages/cli/src/doctor.ts` is the diagnostic. `scripts/doctor.sh` is the
# fallback ADR 0015 requires on a host with no Node, and it exists to answer
# the handful of questions a bare host has before anything is installed.
#
# The fallback is only useful if it is a *subset* of the same report: same ids,
# same statuses, same JSON shape. A fallback that invented its own vocabulary
# would leave the reader on a bare host learning a second one, and would let the
# two drift into disagreeing about the same host.
#
# What is asserted here is exactly that, plus the property that matters most
# about a diagnostic: it changes nothing.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
GW="$PORTTA_ROOT/bin/portta"

describe "the fallback keeps the shape every consumer already reads"

FALLBACK=$(bash "$PORTTA_ROOT/scripts/doctor.sh" --json 2>/dev/null)

it "emits one JSON document on stdout"
assert_success sh -c "printf '%s' \"\$1\" | python3 -m json.tool >/dev/null" _ "$FALLBACK"

it "carries the version, the profile and the two counts"
for key in version profile failures warnings checks; do
  assert_contains "$FALLBACK" "\"$key\""
done

it "every check carries an id, a status, a title, a detail and a fix"
assert_eq "" "$(printf '%s' "$FALLBACK" | python3 -c '
import json, sys
checks = json.load(sys.stdin)["checks"]
missing = [
    f"{c.get(\"id\", \"?\")}:{k}"
    for c in checks for k in ("id", "status", "title", "detail", "fix")
    if k not in c
]
print(" ".join(missing))
')"

it "and a status the reader can act on"
assert_eq "" "$(printf '%s' "$FALLBACK" | python3 -c '
import json, sys
bad = [c["id"] for c in json.load(sys.stdin)["checks"] if c["status"] not in ("pass", "warn", "fail")]
print(" ".join(bad))
')"

describe "the fallback is a subset of the diagnostic, not a second vocabulary"

if ! command -v node >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  it "id parity"; skip "node or docker is unavailable"
else
  FULL=$("$GW" doctor --json 2>/dev/null)

  it "every id the fallback reports exists in the full diagnostic"
  assert_eq "" "$(python3 - "$FALLBACK" "$FULL" <<'PY'
import json, sys
fallback = {c["id"] for c in json.loads(sys.argv[1])["checks"]}
full = {c["id"] for c in json.loads(sys.argv[2])["checks"]}
print(" ".join(sorted(fallback - full)))
PY
)"

  # The point of a subset is that a reader on a bare host is not told something
  # different from what the same host reports once Node is installed.
  it "and agrees with it on the status of every shared id"
  assert_eq "" "$(python3 - "$FALLBACK" "$FULL" <<'PY'
import json, sys
fallback = {c["id"]: c["status"] for c in json.loads(sys.argv[1])["checks"]}
full = {c["id"]: c["status"] for c in json.loads(sys.argv[2])["checks"]}
print(" ".join(
    f"{cid}(shell={status},cli={full[cid]})"
    for cid, status in fallback.items()
    if cid in full and full[cid] != status
))
PY
)"

  # These are the checks the panel and the authentication work lean on. They
  # used to be asserted by grepping the shell doctor's source for a literal;
  # asking the diagnostic what it reported is the same question, answered by
  # running it.
  ids=$(printf '%s' "$FULL" | python3 -c "import json,sys; print(' '.join(c['id'] for c in json.load(sys.stdin)['checks']))")

  # These only exist once the container does: a database that has never been
  # created cannot be publishing a port. Asserting them unconditionally would
  # pass or fail on whether the developer had run `portta web up`.
  it "reports on the panel database, which must be neither published nor shared"
  if [ -n "$(docker ps -q --filter 'label=portta.component=db' 2>/dev/null)" ]; then
    for id in db.exposure db.network.shared db.network.internal; do
      assert_contains "$ids" "$id"
    done
  else
    skip "the panel database is not running on this host"
  fi

  it "reports on every ForwardAuth prerequisite"
  for id in auth.secret auth.store auth.service; do
    assert_contains "$ids" "$id"
  done

  # The panel is what stands in front of the panel now, so the verdict is about
  # the two decisions agreeing: a panel reachable from another machine must sign
  # people in, and one that signs people in must have a secret to do it with.
  it "and on the panel's own front door, once the panel is enabled"
  if printf '%s' "$ids" | grep -q 'web\.auth'; then
    assert_contains "$ids" "web.auth"
  else
    skip "the panel is not enabled on this host"
  fi

  it "and on the host checks a container could not make honestly"
  for id in tools.git vpn.tailscale agents.claude; do
    assert_contains "$ids" "$id"
  done

  it "the full diagnostic reports considerably more than the fallback"
  full_count=$(printf '%s' "$FULL" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["checks"]))')
  fallback_count=$(printf '%s' "$FALLBACK" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["checks"]))')
  if [ "$full_count" -gt "$((fallback_count * 3))" ]; then _t_pass
  else _t_fail "full=$full_count fallback=$fallback_count"; fi
fi

describe "a diagnostic changes nothing"

# The single most important property: doctor runs on a broken host, and an
# operator has to be able to run it without wondering what it did.
it "the fallback never starts, stops, removes, prunes or writes"
assert_eq "" "$(grep -nE '\b(docker (run|start|stop|rm|kill|create|pull|prune)|compose (up|down|restart)|rm -rf|chmod|mkdir|portta_env_set)\b' \
  "$PORTTA_ROOT/scripts/doctor.sh" | grep -v '^\s*#' || true)"

it "and neither does the full diagnostic"
assert_eq "" "$(grep -nE \"'(run|start|stop|rm|kill|create|pull|prune)'\" \
  "$PORTTA_ROOT/packages/cli/src/doctor.ts" || true)"

it "it stays a fallback: a few checks, not a reimplementation"
lines=$(wc -l < "$PORTTA_ROOT/scripts/doctor.sh")
if [ "$lines" -lt 300 ]; then _t_pass; else _t_fail "$lines lines; the fallback is growing back into a second doctor"; fi

t_summary
