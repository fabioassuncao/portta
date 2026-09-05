#!/usr/bin/env bash
# The CLI is the stable operational contract, so its surface is asserted: every
# command is registered under its parent, unknown input fails clearly, --json
# output actually parses, and the exit codes are the documented ones.
#
# Each `portta` here is a process spawn, so the suite reads one document per
# question rather than one per assertion: a command that answers several is run
# once and its output reused.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
GW="$PORTTA_ROOT/bin/portta"

# The command tree, read one group at a time. Asserting every leaf with its own
# `portta <leaf> --help` meant ~180 process spawns and 40 seconds; a group's
# help already lists every subcommand registered under it, so one invocation
# per group proves the same thing — a leaf that was never wired up is missing
# from its parent's help — at a fifteenth of the cost.
COMMAND_TREE=(
  ":version setup bootstrap build up down reset restart status logs doctor urls inspect update envs projects overview network public dns tls remote analyze init namespace access services service db redis web auth protect users git repos host share toolbox tunnel backup restore repair mcp config dev tasks sessions activity examples"
  "envs:list show services analyze init namespace start stop restart logs endpoints"
  "projects:list show create context resources activity"
  "network:status"
  "public:status enable disable"
  "dns:check status setup"
  "tls:status init trust untrust"
  "tunnel:status setup enable disable test logs"
  "remote:bootstrap status doctor urls exec access"
  "remote access:open list close"
  "access:open list close inspect gc"
  "service:publish list unpublish"
  "db:status shell dump restore open close url psql mysql"
  "redis:open close cli"
  "web:up dev down disable restart status open logs build"
  "auth:status login logout whoami bootstrap reset-password token"
  "auth token:list create revoke"
  "protect:status host remove"
  "users:list create set-role set-password grant revoke remove"
  "git:scan status clear"
  "repos:scan status clear"
  "tasks:list next show create start status finish edit note subtasks link unlink publish sync comment"
  "sessions:list start end heartbeat"
  "host:collect watch status"
  "share:list revoke gc"
  "examples:apply"
)

describe "every command in the tree is registered under its parent"
for group in "${COMMAND_TREE[@]}"; do
  parent="${group%%:*}"
  # bash 3.2 (the shell macOS ships) has no empty-array expansion under `set -u`,
  # so the top-level group is invoked without any word at all.
  if [ -z "$parent" ]; then
    help=$("$GW" --help 2>&1)
  else
    read -r -a words <<< "$parent"
    help=$("$GW" "${words[@]}" --help 2>&1)
  fi

  it "portta ${parent:-(top level)} --help is a help page"
  case "$help" in
    portta*|Usage:*) _t_pass ;;
    *) _t_fail "got: $(printf '%s' "$help" | head -1)" ;;
  esac

  for leaf in ${group#*:}; do
    it "portta ${parent:+$parent }$leaf is registered"
    # Anchored at the two-space indent Commander lists subcommands with, so a
    # leaf named only inside another command's description does not pass.
    if printf '%s\n' "$help" | grep -qE "^  $leaf( |\||$)"; then _t_pass
    else _t_fail "not listed under 'portta ${parent:-portta} --help'"; fi
  done
done

# `toolbox` is the last passthrough: ADR 0029 keeps scripts/lib/toolbox.sh as
# shell, so `portta toolbox` still re-enters bin/portta. A passthrough forwards
# `--help` rather than answering it, because Commander's own help option would
# print a stub naming `[args...]` over the implementation's page.
it "portta toolbox --help is the implementation's page, not a stub"
assert_eq "$(PORTTA_FORCE_BASH=true "$GW" toolbox --help 2>&1)" "$("$GW" toolbox --help 2>&1)"

describe "the two entry points offer the same commands"

# bin/portta hands over to the TypeScript CLI whenever Node is present, so a
# command the dispatcher names and Commander does not is unreachable on every
# host the installer touched. `tunnel`, `backup`, `restore` and `repair` were
# exactly that: intact implementations behind an `unknown command` and exit 2,
# reachable only through the undocumented PORTTA_FORCE_BASH.
it "every command bin/portta dispatches is registered in the Commander tree"
# Commander prints `  name|alias  description`, so splitting on the bar gives
# every spelling the tree answers to, aliases included.
registered=$("$GW" --help 2>&1 | sed -n 's/^  \([a-z][a-z|-]*\).*/\1/p' | tr '|' '\n' | sort -u)
missing=""
for arm in $(sed -n '/^  case "${cmd:-}" in$/,/^  esac$/p' "$GW" \
  | grep -oE '^    [a-z|]+\)' | tr -d ' )' | tr '|' '\n' | sort -u); do
  case "$arm" in help) continue ;; esac
  printf '%s\n' "$registered" | grep -qx "$arm" || missing="$missing $arm"
done
assert_eq "" "$missing"

describe "unknown input fails clearly instead of doing something"
it "an unknown command exits non-zero"; assert_failure "$GW" definitely-not-a-command
it "and says so"
assert_contains "$("$GW" definitely-not-a-command 2>&1)" "unknown command"
it "an unknown subcommand exits non-zero"; assert_failure "$GW" access definitely-not-a-subcommand
it "an unknown flag exits non-zero"; assert_failure "$GW" urls --definitely-not-a-flag

describe "commands that need an argument say so"
it "analyze without a path"; assert_failure "$GW" analyze
it "init without a path"; assert_failure "$GW" init
it "access open without a project"; assert_failure "$GW" access open
it "remote bootstrap without a target"; assert_failure "$GW" remote bootstrap

describe "--json output parses"
# `doctor` is by far the most expensive command here (it walks the host), so it
# is run once and the document reused by every assertion that needs one.
DOCTOR_JSON=""
if ! docker info >/dev/null 2>&1; then
  it "json output"; skip "docker unavailable"
else
  DOCTOR_JSON=$(PORTTA_WEB=true "$GW" doctor --json 2>/dev/null)
  it "portta doctor --json"
  assert_success sh -c "printf '%s' \"\$1\" | python3 -m json.tool >/dev/null" _ "$DOCTOR_JSON"
  for c in "status --json" "urls --json" "services --json" "access list --json" "web status --json" "git status --json" "share list --json"; do
    it "portta $c"
    # shellcheck disable=SC2086
    assert_success sh -c "\"$GW\" $c 2>/dev/null | python3 -m json.tool >/dev/null"
  done
fi

describe "version reporting"
VERSION_OUT=$("$GW" version 2>&1)
it "version prints a semver-shaped string"
assert_success sh -c "printf '%s' \"\$1\" | grep -qE 'portta [0-9]+\.[0-9]+\.[0-9]+'" _ "$VERSION_OUT"
it "VERSION and the CLI agree"
assert_contains "$VERSION_OUT" "$(tr -d '[:space:]' < "$PORTTA_ROOT/VERSION")"
it "--version is the same surface"
assert_contains "$("$GW" --version 2>&1)" "portta"

describe "the host needs no Node for the commands the shell implements"
# ADR 0015. The installer ships this entry point and nothing else on a host
# without Node, so a command it implements must be reachable there: every
# cmd_* defined in bin/portta has to have a dispatch arm.
for c in version bootstrap up down status doctor restart logs urls inspect update toolbox; do
  it "PORTTA_FORCE_BASH portta $c is dispatched, not refused"
  out=$(PORTTA_FORCE_BASH=true "$GW" "$c" --help 2>&1)
  assert_not_contains "$out" "requires Node"
done

it "PORTTA_FORCE_BASH portta up --demo requires the full CLI"
assert_contains "$(PORTTA_FORCE_BASH=true "$GW" up --demo 2>&1)" "requires Node"
it "PORTTA_FORCE_BASH portta down --demo requires the full CLI"
assert_contains "$(PORTTA_FORCE_BASH=true "$GW" down --demo 2>&1)" "requires Node"

describe "--demo is the complete demonstration on the lifecycle commands"
for c in up dev down reset; do
  it "portta $c --help names --demo"
  assert_contains "$("$GW" "$c" --help 2>&1)" "--demo"
done

it "every cmd_* in bin/portta has a dispatch arm"
missing=""
for fn in $(grep -oE '^cmd_[a-z_]+' "$GW" | sed 's/^cmd_//' | sort -u); do
  case "$fn" in help_for) continue ;; esac
  grep -qE "^\s+([a-z|]*\|)?$fn\)" "$GW" || missing="$missing $fn"
done
assert_eq "" "$missing"

describe "automatic Git collection uses the implementation that exists"

# Git collection moved to the full TypeScript CLI. Leaving the old shell call
# behind made every `up` silently invoke an undefined function.
it "the Bash fallback has no reference to the removed helper"
assert_not_contains "$(cat "$GW")" "portta_git_scan"

it "the full up command refreshes Git metadata"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/lifecycle.ts")" "await refreshRepositories(context.config.profile, output)"

it "web up refreshes the same metadata"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/web.ts")" "await refreshRepositories(context.config.profile, output)"

it "the full up command starts the host metrics collector"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/lifecycle.ts")" "await ensureMetricsCollector(context.config.profile, output)"

it "web up starts the same host metrics collector"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/web.ts")" "await ensureMetricsCollector(context.config.profile, output)"

describe "a closed pipe is not an error"

# `portta status | head -3` is ordinary, and it used to end in an unhandled
# EPIPE and a Node stack trace printed over the output the reader asked for.
# `doctor` walks the host and is the slowest command in the CLI, so the cheap
# three carry this check; the pipe handling is one `tolerateClosedOutput()` for
# all of them, not something each command implements.
for c in status urls inspect; do
  it "portta $c | head -2 exits cleanly and prints no stack trace"
  head=$("$GW" "$c" 2>/dev/null | head -2); rc=$?
  if [ "$rc" -ne 0 ]; then _t_fail "exit $rc"
  else assert_not_contains "$head" "EPIPE"; fi
done

describe "public access accepts a derived base domain"

# Requiring PUBLIC_DOMAIN on top of an auto base would mean buying a domain to
# publish on a name that already resolves here.
it "the derived base is offered when PUBLIC_DOMAIN is unset"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/network.ts")" "context.config.domainMode !== 'local'"

it "and localhost is still refused, with the way out named"
network="$(cat "$PORTTA_ROOT/packages/cli/src/commands/network.ts")"
assert_contains "$network" 'public access needs a domain, and this host has only localhost'
assert_contains "$network" 'portta config set domain.mode auto'

describe "the diagnostic reports the whole host"
# The checks live in packages/cli/src/doctor.ts over the verdicts in
# packages/core/src/diagnostics.ts. What matters here is the surface: a reader
# asks `portta doctor` one question and gets the runtime, the exposure, the
# panel's front door, the toolchain and the agents in one report.
# tests/unit/doctor.test.sh owns the relationship with the zero-Node fallback.
if ! docker info >/dev/null 2>&1; then
  it "shared checks"; skip "docker unavailable"
else
  it "reports the host checks a container could not make honestly"
  ids=$(printf '%s' "$DOCTOR_JSON" | python3 -c "import json,sys; print(' '.join(c['id'] for c in json.load(sys.stdin)['checks']))")
  for id in agents.claude tools.git vpn.tailscale; do
    assert_contains "$ids" "$id"
  done

  # `panel.access` exists only while the panel is enabled, and a .env in this
  # checkout overrides the environment, so whether it is emitted depends on the
  # machine. Asserting it unconditionally passed for a developer with the panel
  # on and failed on CI, which has no .env at all.
  it "including panel access, whenever the panel is on"
  if [ "$(PORTTA_WEB=true "$GW" inspect 2>/dev/null | sed -n 's/^ *PORTTA_WEB *//p' | head -1)" = "false" ]; then
    skip "this checkout's .env disables the panel"
  else
    assert_contains "$ids" "panel.access"
  fi
  it "and a warning is not a failure"
  assert_contains "$DOCTOR_JSON" '"status": "warn"'
fi

describe "the CLI says which installation it is talking to"
# A CLI installed from npm outlives the installation it addresses in both
# directions, so `version` reports both and whether they agree.
it "it names the gateway it resolved"
assert_contains "$VERSION_OUT" "gateway"
it "and the root it found"
assert_contains "$VERSION_OUT" "$PORTTA_ROOT"
it "the JSON form carries a compatibility verdict"
assert_success sh -c "'$GW' version --json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert set([\"cli\",\"gateway\",\"panel\",\"compatible\",\"apiSeries\"]) <= set(d)'"
it "and this checkout is self-consistent"
assert_success sh -c "'$GW' version --json | python3 -c 'import json,sys; assert json.load(sys.stdin)[\"compatible\"] is True'"
it "a mismatched installation is reported, not ignored"
mismatch=$(mktemp -d "${TMPDIR:-/tmp}/portta-version.XXXXXX")
mkdir -p "$mismatch/docker/compose/attach" "$mismatch/docker/compose/profiles"
printf '9.9.9\n' > "$mismatch/VERSION"
for f in compose.yaml attach/host.yaml profiles/local.yaml; do printf '{}\n' > "$mismatch/docker/compose/$f"; done
assert_contains "$(PORTTA_ROOT="$mismatch" "$GW" version 2>&1)" "installation is 9.9.9"
rm -rf "$mismatch"

describe "exit codes have a stable machine contract"
it "success is 0"; assert_success "$GW" version
failure_root=$(mktemp -d "${TMPDIR:-/tmp}/portta-cli-exit.XXXXXX")
mkdir -p "$failure_root/state/git" "$failure_root/docker/compose/attach" "$failure_root/docker/compose/profiles"
printf '0.1.1\n' > "$failure_root/VERSION"
printf '{}\n' > "$failure_root/docker/compose/compose.yaml"
printf '{}\n' > "$failure_root/docker/compose/attach/host.yaml"
printf '{}\n' > "$failure_root/docker/compose/profiles/local.yaml"
printf '{broken\n' > "$failure_root/state/git/index.json"
it "an operational failure is 1"; assert_exit 1 env PORTTA_ROOT="$failure_root" "$GW" git status
rm -rf "$failure_root"
it "usage is 2"; assert_exit 2 "$GW" definitely-not-a-command
it "a missing runtime precondition is 3"
# Through the TypeScript CLI directly, because bin/portta deliberately carries
# the root it lives in: an installed PORTTA_HOME links its entry point onto
# PATH, and running it from elsewhere must still address that installation.
assert_exit 3 sh -c "cd /tmp && env -u PORTTA_ROOT -u PORTTA_HOME node '$PORTTA_ROOT/packages/cli/dist/cli.js' inspect >/dev/null 2>&1"

it "and the entry point addresses the installation it belongs to"
assert_contains "$(cd /tmp && env -u PORTTA_ROOT "$GW" inspect 2>&1)" "PORTTA_ROOT"
it "a refused unsafe operation is 4"
assert_exit 4 "$GW" service publish --public --project demo --service db

describe "checkout-local read commands emit one JSON document on stdout"
for c in "inspect" "git status" "share list" "tls status" "public status" "dns status" "project namespace --no-check"; do
  it "$c --json"
  read -r -a words <<< "$c"
  assert_success sh -c "'$GW' ${words[*]} --json 2>/dev/null | python3 -m json.tool >/dev/null"
done

describe "the published CLI declares everything it imports"

# esbuild bundles with `packages: 'external'` and inlines packages/core through
# an alias, so core's dependencies become bare imports in dist/cli.js while
# staying invisible in packages/cli/package.json. `bcryptjs` arrived with the
# auth work that way, and the tarball crashed on `npx portta` with
# ERR_MODULE_NOT_FOUND — a failure no test in the repo could see, because every
# other surface runs from the workspace where the package is hoisted.
it "no runtime import is missing from its dependencies"
assert_eq "" "$(python3 "$PORTTA_TEST_DIR/lib/cli-deps.py" "$PORTTA_ROOT")"

t_summary
