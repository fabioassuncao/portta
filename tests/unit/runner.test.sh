#!/usr/bin/env bash
# The runner's shape. No Docker daemon is contacted: this asserts the argument
# list the two CLIs build, the closed verb set, and the conditions under which
# they refuse to build one at all.
#
# See docs/adr/0030-the-panel-and-a-project-lifecycle.md.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
. "$PORTTA_ROOT/scripts/lib/apply.sh"
. "$PORTTA_ROOT/scripts/lib/runner.sh"

describe "the runner reuses the applier image"

it "is the same image the applier uses"
assert_eq "$PORTTA_APPLY_IMAGE" "$PORTTA_RUNNER_IMAGE"

it "the exec script the container runs is in the repository"
assert_success test -f "$PORTTA_ROOT/scripts/lib/runner-exec.sh"

shell_create_arguments() {
  ( docker() { printf '%s\n' "$@"; }
    portta_runner_create )
}

describe "the runner refuses hosts it cannot serve"

refusal() {
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_runner_refusal )
}

it "a plain local host is fine"
assert_eq "" "$(refusal PORTTA_PROFILE=local)"

it "a publicly exposed panel is refused"
assert_contains "$(refusal PORTTA_WEB_EXPOSE=public)" "on the host instead"

it "the remote-public profile is refused"
assert_contains "$(refusal PORTTA_PROFILE=remote-public)" "on the host only"

describe "the container the shell CLI would create"

args=$(shell_create_arguments)

it "is created, never run"
assert_contains "$args" "create"

it "carries the ownership labels every destructive path checks"
assert_contains "$args" "portta.managed=true"
assert_contains "$args" "portta.component=runner"

it "mounts the repository root at its host path"
assert_contains "$args" "$PORTTA_ROOT:$PORTTA_ROOT"

it "mounts the docker socket and the host filesystem"
assert_contains "$args" "/var/run/docker.sock:/var/run/docker.sock"
assert_contains "$args" "/:/host"
assert_eq "3" "$(printf '%s\n' "$args" | grep -c '^--volume$')"

it "has no network of its own"
assert_contains "$args" "--network"
assert_contains "$args" "none"

it "runs one fixed command"
assert_contains "$args" "bash"
assert_contains "$args" "$PORTTA_ROOT/scripts/lib/runner-exec.sh"

it "is never disposable, so its exit code survives to be read"
assert_eq "" "$(printf '%s\n' "$args" | grep -x -- '--rm' || true)"

describe "the exec script accepts only the closed verb set"

it "names every verb and no others"
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'up|stop|restart|build|down|down-volumes'
assert_eq "" "$(grep -nE 'eval |\$\(' "$PORTTA_ROOT/scripts/lib/runner-exec.sh" | grep -vE 'sed -n|head -n|grep -q|printf|docker |realpath ' || true)"

it "removes the working directory only after the same path bound as the core"
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'remove_working_dir'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'refusing working directory that walks up'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'directory=$(grep -q '"'"'"directory"'"'"''

it "reads the remembered paths from the request, and only uses them when no container exists"
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" '"workingDir"'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" '"configFiles"'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" '[ "$verb" = "up" ] || die "no container on this host belongs to project'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'assert_request_path "$request_working_dir" "working directory"'

it "hands Compose the host paths, linked into the container, so include: resolves"
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'link_host_path "$working_dir"'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'files+=(-f "$file")'
assert_eq "" "$(grep -n 'files+=(-f "${HOST_ROOT}' "$PORTTA_ROOT/scripts/lib/runner-exec.sh" || true)"

it "refuses remembered working directories and Compose files under Portta's own root"
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" '"$PORTTA_ROOT"|"$PORTTA_ROOT"/*'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'assert_not_portta_path "$request_working_dir" "a working directory"'
assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/runner-exec.sh")" 'assert_not_portta_path "$file" "a compose file"'

describe "the shell and the TypeScript CLI create the same container"

if ! command -v node >/dev/null 2>&1 || [ ! -f "$PORTTA_ROOT/packages/core/dist/runner.js" ]; then
  it "parity"; skip "node or the built core package is unavailable"
else
  ts_args=$(PORTTA_VERSION="$(portta_version)" node --input-type=module -e '
    import { runnerCreateArguments, runnerSpec } from "'"$PORTTA_ROOT"'/packages/core/dist/runner.js"
    const root = process.env.PORTTA_ROOT
    process.stdout.write(runnerCreateArguments(root, runnerSpec(root, process.env.PORTTA_VERSION), process.env.PORTTA_VERSION).join("\n"))
  ' 2>/dev/null)

  it "argument for argument"
  assert_eq "$ts_args" "$args"
fi

t_summary
