#!/usr/bin/env bash
# The applier's shape. No Docker daemon is contacted: this asserts the argument
# list the two CLIs build, and the conditions under which they refuse to build
# one at all.
#
# See docs/adr/0026-applying-settings-from-the-panel.md.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
. "$PORTTA_ROOT/scripts/lib/apply.sh"

describe "the applier image source"

it "lives with the other Docker-owned image contexts"
assert_eq "$PORTTA_ROOT/docker/images/apply" "$PORTTA_APPLY_CONTEXT"
assert_success test -f "$PORTTA_APPLY_CONTEXT/Dockerfile"

it "is also used by the TypeScript CLI"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/apply.ts")" "join(context.root, 'docker', 'images', 'apply')"

# The create arguments, without running docker: replace the binary with a
# recorder for the length of one call.
shell_create_arguments() {
  ( docker() { printf '%s\n' "$@"; }
    portta_apply_create )
}

describe "the applier refuses hosts it cannot serve"

refusal() {
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_apply_refusal )
}

it "a plain local host is fine"
assert_eq "" "$(refusal PORTTA_PROFILE=local)"

# Both overlays add a `build:` stanza whose context is the repository root, and
# both used to be refused on the grounds that the applier would build the image
# "inside itself". It does not: it holds the host's Docker socket, so the
# context is streamed over that socket and the host daemon does the build, with
# the host's network and layer cache. Compose also builds *before* it stops
# anything, so a build that fails leaves the gateway untouched.
it "a host building the panel image is served"
assert_eq "" "$(refusal PORTTA_WEB_BUILD=true)"

it "a host in panel development mode is served"
assert_eq "" "$(refusal PORTTA_WEB_DEV=true)"

# Applying rewrites how the whole host is exposed. That is a different decision
# from the one the operator made when they opened the panel on loopback.
it "a publicly exposed panel is refused"
assert_contains "$(refusal PORTTA_WEB_EXPOSE=public)" "apply on the host instead"

it "the remote-public profile is refused"
assert_contains "$(refusal PORTTA_PROFILE=remote-public)" "on the host only"

describe "the container the shell CLI would create"

args=$(shell_create_arguments)

it "is created, never run"
assert_contains "$args" "create"

it "carries the ownership labels every destructive path checks"
assert_contains "$args" "portta.managed=true"
assert_contains "$args" "portta.component=apply"

it "mounts the repository root at its host path"
assert_contains "$args" "$PORTTA_ROOT:$PORTTA_ROOT"

it "mounts the docker socket, and nothing else besides the root"
assert_contains "$args" "/var/run/docker.sock:/var/run/docker.sock"
assert_eq "2" "$(printf '%s\n' "$args" | grep -c '^--volume$')"

it "has no network of its own"
assert_contains "$args" "--network"
assert_contains "$args" "none"

it "runs one fixed command, with no profile baked in"
assert_contains "$args" "bash"
assert_contains "$args" "$PORTTA_ROOT/bin/portta"
assert_contains "$args" "--wait"
assert_eq "" "$(printf '%s\n' "$args" | grep -xE 'local|remote-private|remote-public' || true)"

it "is never disposable, so its exit code survives to be read"
assert_eq "" "$(printf '%s\n' "$args" | grep -x -- '--rm' || true)"

describe "the shell and the TypeScript CLI create the same container"

# ADR 0015: the core commands must run without Node, so the argument list has
# two implementations. This is what keeps them honest, exactly as the overlay
# selection is kept honest in profiles.test.sh.
if ! command -v node >/dev/null 2>&1 || [ ! -f "$PORTTA_ROOT/packages/core/dist/apply.js" ]; then
  it "parity"; skip "node or the built core package is unavailable"
else
  # The shell reads VERSION through portta_version; hand the core the same
  # string, so the comparison is about the arguments and not about how the
  # version was read.
  ts_args=$(PORTTA_VERSION="$(portta_version)" node --input-type=module -e '
    import { applyCreateArguments, applySpec } from "'"$PORTTA_ROOT"'/packages/core/dist/apply.js"
    const root = process.env.PORTTA_ROOT
    process.stdout.write(applyCreateArguments(root, applySpec(root, process.env.PORTTA_VERSION), process.env.PORTTA_VERSION).join("\n"))
  ' 2>/dev/null)

  it "argument for argument"
  assert_eq "$ts_args" "$args"
fi

t_summary
