#!/usr/bin/env bash
# ============================================================================
# Audit: invariants that must not regress
# ============================================================================
# These are the promises the gateway makes about what it will never do. Each
# was verified by hand once; this keeps them true.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
cd "$PORTTA_ROOT" || exit 1

# Tracked files, excluding the build brief and this file.
#
# This file is excluded because it contains every forbidden pattern as a search
# string (`docker system prune`, an absolute home path, `tskey-`) and would
# otherwise match itself. That is a real limitation: the audit cannot audit its
# own text, so keep the patterns here and the enforcement here only.
SELF="tests/unit/audit.test.sh"
tracked() { git ls-files "$@" 2>/dev/null | grep -v '^docs/prompts/' | grep -vx "$SELF"; }
# The operational surface, wherever it lives. It used to be `bin/` and
# `scripts/` alone, which meant these invariants quietly stopped covering each
# command as it was ported to TypeScript. Tests are excluded: a suite naming a
# forbidden pattern as a fixture is not the gateway doing it.
code() {
  git ls-files 'bin/*' 'scripts/**' 'docker/**' '.github/**' 'packages/*/src/**' 'apps/*/src/**' 2>/dev/null \
    | grep -v '\.test\.ts$' | grep -vx "$SELF"
}

describe "the gateway stays decoupled from consumer projects"

it "no absolute home paths are baked in"
# Tests may name example home paths; production code may not.
assert_eq "" "$(tracked | grep -vE '\.test\.(ts|js|mjs|sh)$' | xargs grep -ln '/Users/\|/home/[a-z]' 2>/dev/null || true)"

it "no consumer project is named in the code"
# Names may appear in prose as examples; code must be vendor-neutral.
assert_eq "" "$(code | xargs grep -lni 'brasil.data.hub\|base-empresarial\|base-eleicoes\|base-escolar\|issue-flow' 2>/dev/null || true)"

# `remote bootstrap` clones *Portta* onto another host, which is the one
# legitimate clone in the tree; nothing else may clone anything.
it "nothing clones a consumer project"
assert_eq "packages/cli/src/commands/remote.ts" \
  "$(code | xargs grep -ln 'git clone' 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')"

it "no consumer directory is mounted into the gateway"
# Only these mounts are legitimate here, and all of them are gateway-owned:
#   ./config, ./state          the gateway's own directories
#   ./.env, ./VERSION          the configuration the panel's Settings page edits
#   ./apps/web/                the panel's own source, in development mode
#   ./packages/core/           the workspace the panel imports, in development mode
#   ./docs, ./README.md, ./CHANGELOG.md   documentation the panel serves in development
#   /var/run/docker.sock       read-only, into a socket proxy and nothing else
#   /dev/net/tun               Tailscale's kernel networking
# Anything else would be reaching into somebody's project.
# A bind mount is `src:dst`; a tmpfs entry has no colon, so require one.
assert_eq "" "$(grep -hE '^\s+- [./][^ ]*:' docker/compose/compose.yaml docker/compose/*/*.yaml \
  | grep -vE '\./(config|state|apps|packages)/' \
  | grep -vE '\./(\.env|VERSION|README\.md|CHANGELOG\.md|docs):' \
  | grep -vE '/var/run/docker\.sock:/var/run/docker\.sock:ro' \
  | grep -vE '/dev/net/tun:/dev/net/tun' || true)"

describe "the applier is bounded by construction"

# One container on this host may drive Compose, and this is the whole of what
# keeps it from becoming a general remote-execution channel.
# See docs/adr/0026-applying-settings-from-the-panel.md.

it "only the applier mounts the docker socket writable, and only it"
# Everywhere else the socket is `:ro`, into a socket proxy. The compose audit
# above cannot see this one, because the applier is not a compose service.
assert_eq "packages/core/src/apply.ts packages/core/src/runner.ts scripts/lib/apply.sh scripts/lib/runner.sh" \
  "$(code | xargs grep -ln 'docker\.sock:/var/run/docker\.sock[^:]*$' 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')"

it "the applier is not a compose service"
# A compose applier would be an orphan the moment PORTTA_APPLY went false, and
# would remove itself in the middle of the `up` it was running.
assert_eq "" "$(grep -rn 'portta-apply\|component: apply' docker/compose/ 2>/dev/null || true)"

it "the applier carries no compose project label"
# Set, not merely named: both files explain in prose why the label is absent.
assert_eq "" "$(grep -nE '(--label|label=)[^ ]*com\.docker\.compose' scripts/lib/apply.sh packages/core/src/apply.ts 2>/dev/null || true)"

it "the applier command is fixed, never composed from input"
assert_contains "$(cat scripts/lib/apply.sh)" 'bash "$PORTTA_ROOT/bin/portta" up --wait'
assert_eq "" "$(grep -n 'PORTTA_APPLY_COMMAND\|APPLY_ARGS\|APPLY_PROFILE' scripts/lib/apply.sh || true)"

it "the applier bakes in no profile, so a profile change applies to itself"
assert_eq "" "$(grep -nE 'up.*(local|remote-private|remote-public)' scripts/lib/apply.sh || true)"

it "the applier mounts the root at its host path, and nothing else"
assert_contains "$(cat scripts/lib/apply.sh)" '"$PORTTA_ROOT:$PORTTA_ROOT"'
assert_eq "2" "$(grep -c -- '--volume' scripts/lib/apply.sh)"

it "the applier has no network and is never disposable"
assert_contains "$(cat scripts/lib/apply.sh)" '--network none'
assert_eq "" "$(grep -n -- '--rm' scripts/lib/apply.sh || true)"

it "removing the applier checks ownership first"
assert_contains "$(cat scripts/lib/apply.sh)" 'portta_container_is_managed'

it "the panel cannot enable the applier"
# Turning it on is a host decision: the key is deliberately absent from the
# catalogue of everything the Settings page may write.
assert_eq "" "$(grep -n \"PORTTA_APPLY\" packages/server/src/services/settings.ts || true)"

it "the runner is not a compose service"
assert_eq "" "$(grep -rn 'portta-runner\|component: runner' docker/compose/ 2>/dev/null || true)"

it "the runner command is fixed, never composed from input"
assert_contains "$(cat scripts/lib/runner.sh)" 'bash "$PORTTA_ROOT/scripts/lib/runner-exec.sh"'

it "the panel cannot enable the runner"
assert_eq "" "$(grep -n \"PORTTA_RUNNER\" packages/server/src/services/settings.ts || true)"

it "the panel gains no new Docker permission for it"
# start, inspect and logs were already allowed; that is the whole point. Four
# POST rules and one create, exactly as before this feature existed.
assert_eq "4" "$(grep -c "method: 'POST'" packages/server/src/services/docker/allowlist.ts)"
assert_eq "1" "$(grep -c 'containers..create' packages/server/src/services/docker/allowlist.ts)"

describe "file modes are read portably"

# `stat -f` means "file system status" to GNU stat: it exits 0 and prints
# something else entirely, so a BSD-first fallback returns nonsense on Linux
# rather than failing over. Every permission assertion built that way passed
# against garbage. portta_file_mode in scripts/lib/common.sh is the one
# implementation, and it tries GNU first.
it "nothing reads a mode with BSD stat first"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' 'tests/**' | xargs grep -ln "stat -f" 2>/dev/null \
  | grep -v 'scripts/lib/common.sh' | grep -v 'tests/unit/audit.test.sh' || true)"

describe "tests do not reach into procfs"

# `/proc` looks like a conveniently unwritable directory and is not: on Linux a
# recursive mkdir inside it never returns, and the spin is synchronous, so no
# test timeout can interrupt it. One such path hung the entire panel suite on
# every Linux CI run for hours while passing on macOS, where /proc does not
# exist. Use a path whose parent is a regular file instead: ENOTDIR, instantly,
# for every user including root.
# Assembled from pieces so this file does not match its own rule, the same way
# the prune audit below avoids naming its literals.
PROCFS_PATH="/pro""c/"
it "no test uses a procfs path to simulate a failure"
assert_eq "" "$(grep -rn -- "$PROCFS_PATH" apps/web/tests packages/server/tests tests 2>/dev/null || true)"

describe "the gateway never destroys what it does not own"

it "no prune, ever"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' 'tests/**' '.github/**' | xargs grep -n 'docker system prune\|docker volume prune\|docker network prune\|docker image prune' 2>/dev/null || true)"

it "nothing removes a volume"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'docker volume rm' 2>/dev/null || true)"

it "only reset removes the panel database volume"
assert_eq "packages/cli/src/commands/lifecycle.ts" \
  "$(code | xargs grep -ln "volume', 'rm'" 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')"

it "nothing removes a network"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'docker network rm' 2>/dev/null || true)"

it "every file that removes a container also checks ownership"
offenders=""
for f in $(tracked 'bin/*' 'scripts/**' | xargs grep -ln 'docker rm ' 2>/dev/null || true); do
  grep -q 'portta_container_is_managed' "$f" || offenders="$offenders $f"
done
assert_eq "" "$offenders"

# `down` must never reach past the gateway's own Compose project.
# `--demo` stops docker/examples with `-v` on purpose: those stacks are
# disposable fixtures, not consumer projects, and live in examples.ts.
it "compose down never takes volumes or orphans with it"
assert_eq "" "$(grep -n 'portta_compose .* down' bin/portta 2>/dev/null | grep -E '\-v|--volumes|--remove-orphans' || true)"
down_flags="(-v|--volumes|--remove-orphans)"
assert_eq "" "$(grep -rn "'down'" packages/cli/src --include='*.ts' | grep -v commands/examples | grep -E "'$down_flags'" || true)"

describe "secrets never reach the process list or the repository"

it "no bearer token on a command line"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'Authorization: Bearer' 2>/dev/null | grep -v 'printf' || true)"

it "no password interpolated into a docker -e flag"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -nE '\-e (PGPASSWORD|MYSQL_PWD|POSTGRES_PASSWORD)=' 2>/dev/null || true)"

it "no auth key or private key is tracked"
assert_eq "" "$(tracked | xargs grep -lE 'tskey-(auth|client)-[A-Za-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null || true)"

it "no .env is tracked"
assert_eq "" "$(tracked | grep -E '(^|/)\.env$' || true)"

it "no TLS material is tracked"
assert_eq "" "$(tracked | grep -E '\.(key|crt|pem|p12|srl)$' || true)"

it "inspect reports secrets as set/unset, never by value"
assert_contains "$(grep -A2 'TS_AUTHKEY' bin/portta | head -3)" "<set>"

describe "nothing is exposed by default"

it "the local profile binds loopback"
assert_contains "$(cat .env.example)" "PORTTA_BIND_ADDRESS=127.0.0.1"

it "public access is off in the example configuration"
assert_contains "$(cat .env.example)" "PUBLIC_ENABLED=false"

it "the dashboard is off in the example configuration"
assert_contains "$(cat .env.example)" "PORTTA_DASHBOARD=false"

it "traefik does not expose containers by default"
assert_contains "$(cat docker/compose/compose.yaml)" 'TRAEFIK_PROVIDERS_DOCKER_EXPOSEDBYDEFAULT: "false"'

it "the socket proxy publishes no host port"
assert_eq "" "$(sed -n '/socket-proxy:/,/^  [a-z]/p' docker/compose/compose.yaml | grep -E '^\s+ports:' || true)"

it "the socket proxy mounts the socket read-only"
assert_contains "$(cat docker/compose/compose.yaml)" "/var/run/docker.sock:/var/run/docker.sock:ro"

it "the socket proxy denies writes"
assert_contains "$(cat docker/compose/compose.yaml)" 'POST: "0"'

it "the control network is internal"
assert_contains "$(cat docker/compose/compose.yaml)" "internal: true"

it "the docker socket is never mounted into traefik"
assert_eq "" "$(sed -n '/^  traefik:/,$p' docker/compose/compose.yaml | grep 'docker.sock' || true)"

describe "SSH keeps host verification on"

it "StrictHostKeyChecking is never disabled"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' 'packages/**' 'apps/**' | xargs grep -n 'StrictHostKeyChecking=no' 2>/dev/null || true)"

# `accept-new` records a key the first time and still refuses a *changed* one,
# which is the attack host key verification exists for. `no` would accept both.
it "the default policy still refuses a changed host key"
assert_contains "$(cat packages/cli/src/commands/remote.ts)" "accept-new"

it "and nothing reaches ssh except through that one option list"
assert_eq "packages/cli/src/commands/remote.ts" \
  "$(grep -rln "runProcess('ssh'\|spawnDetached('ssh'" packages/cli/src --include='*.ts' | grep -v '\.test\.ts$' | sort | tr '\n' ' ' | sed 's/ $//')"

describe "supply chain"

it "every image pins an explicit version"
# Multi-stage builds refer to their own earlier stages by name, and `FROM x AS y`
# carries the stage name on the end. Neither is an unpinned image.
#
# `image: ${PORTTA_WEB_IMAGE:-ghcr.io/…/portta:0.2.0}` is pinned too: the
# override exists so a developer can point at a local build, and the default
# is what a normal installation pulls. Unwrap the interpolation and judge the
# default the same way as a literal.
assert_eq "" "$(grep -rhE '^\s*(image|FROM):?\s' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml docker/images/*/Dockerfile apps/web/Dockerfile 2>/dev/null \
  | sed -E 's/[[:space:]]+[Aa][Ss][[:space:]]+[A-Za-z0-9_.-]+[[:space:]]*$//' \
  | sed -E 's/\$\{[A-Za-z0-9_]+:-([^}]*)\}/\1/g' \
  | grep -vE '^[[:space:]]*FROM[[:space:]]+(deps|base|build|dev|runtime)[[:space:]]*$' \
  | grep -v '\${PORTTA_VERSION}' \
  | grep -vE ':[A-Za-z0-9][A-Za-z0-9._-]*[[:space:]]*$' || true)"

it "every Portta image the installer pulls matches VERSION"
# A tag that drifts from VERSION means an installation pinned by the compose
# file would pull an image that was never published for it. The panel was the
# only file asserted here, so `portta-auth` sat a whole release behind and only
# a `docker pull` on a fresh host would have said so.
assert_eq "" "$(grep -rhoE 'ghcr\.io/fabioassuncao/portta:[0-9][^}]*' docker/compose/compose.yaml docker/compose/*/*.yaml \
  | sort -u | grep -vxF "ghcr.io/fabioassuncao/portta:$(tr -d '[:space:]' < VERSION)" || true)"

it "and every Portta image is pinned, so none of them can float"
assert_eq "" "$(grep -rhE 'image:.*fabioassuncao/portta' docker/compose/compose.yaml docker/compose/*/*.yaml \
  | grep -vE 'ghcr\.io/fabioassuncao/portta:[0-9]|fabioassuncao/portta:(dev|\$\{PORTTA_VERSION\})' || true)"

it "pulling never reaches for an image that only a local build produces"
# An explicit local-build overlay gives the auth services a `build:` and a
# local tag. Every `pull` has to skip those or it
# asks a registry for an image nobody ever pushed, and both CI jobs that boot
# the gateway died there. ADR 0015: the shell and the CLI must agree.
assert_contains "$(cat bin/portta)" "pull --ignore-buildable"
for source in packages/cli/src/commands/lifecycle.ts packages/cli/src/commands/setup.ts; do
  assert_eq "" "$(grep -n "'pull'\]" "$source" || true)"
done

it "no floating latest tag"
assert_eq "" "$(grep -rn ':latest' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml docker/images/*/Dockerfile apps/web/Dockerfile 2>/dev/null || true)"

it "the versions table in ADR 0004 lists every pinned image"
adr="docs/adr/0004-pinned-versions.md"
missing=""
for img in $(grep -rhoE 'image: [a-z0-9./_-]+' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml scripts/lib/discovery.sh 2>/dev/null \
             | awk '{print $2}' | sort -u); do
  grep -q "$(basename "$img")" "$adr" || missing="$missing $img"
done
assert_eq "" "$missing"


describe "the panel image build context excludes secrets and state"

it "the root dockerignore exists"
assert_success test -f .dockerignore

it "excludes .env, state/, TLS material and .git as whole lines"
ignore="$(grep -E '^(\.env|state|config/tls|\.git)$' .dockerignore | sort | paste -sd, -)"
assert_eq ".env,.git,config/tls,state" "$ignore"

it "the Dockerfile builds from the repository root"
assert_contains "$(cat apps/web/Dockerfile)" "COPY package.json package-lock.json ./"
# The build lives in the two overlays that are only ever applied inside a
# checkout. web.yaml itself pulls, because an installed PORTTA_HOME has no
# source tree to build from. See docs/adr/0020-installer-and-portta-home.md.
assert_contains "$(cat docker/compose/features/web-build.yaml)" "dockerfile: apps/web/Dockerfile"
assert_contains "$(cat docker/compose/features/web-dev.yaml)" "dockerfile: apps/web/Dockerfile"
assert_contains "$(cat docker/compose/features/auth-build.yaml)" "dockerfile: apps/web/Dockerfile"
assert_contains "$(cat docker/compose/features/auth-build.yaml)" "target: runtime"
assert_eq "" "$(grep -n 'portta-auth:' docker/compose/features/web-build.yaml || true)"

it "a normal installation never builds the panel"
assert_eq "" "$(grep -n 'build:' docker/compose/features/web.yaml || true)"

it "Just never pulls a published Portta image"
assert_eq "" "$(grep -E 'ghcr.io/fabioassuncao' justfile || true)"

it "just dev calls the checkout setup command"
assert_contains "$(awk '/^dev /,/^$/' justfile)" '{{gw}} dev {{args}}'

it "just reset calls the checkout reset command"
assert_contains "$(awk '/^reset /,/^$/' justfile)" '{{gw}} reset {{args}}'

it "just up, down, dev and reset forward remaining arguments, including --demo"
for recipe in up down dev reset; do
  assert_contains "$(awk "/^${recipe} /,/^$/" justfile)" '{{args}}'
done

it "just has no leftover demo-up or examples recipes"
assert_eq "" "$(grep -E '^(demo-up|demo-down|examples)' justfile || true)"

it "just build produces the explicit local release"
assert_contains "$(awk '/^build:/,/^$/' justfile)" '{{gw}} build'

it "just up and just web consume the local release without building"
assert_contains "$(awk '/^up /,/^$/' justfile)" 'PORTTA_LOCAL_RELEASE=true'
assert_contains "$(awk '/^up /,/^$/' justfile)" 'PORTTA_WEB_BUILD=false'
assert_contains "$(awk '/^up /,/^$/' justfile)" 'PORTTA_WEB_DEV=false'
assert_contains "$(awk '/^web /,/^$/' justfile)" 'PORTTA_LOCAL_RELEASE=true'
assert_contains "$(awk '/^web /,/^$/' justfile)" 'PORTTA_WEB_BUILD=false'
assert_contains "$(awk '/^web /,/^$/' justfile)" 'PORTTA_WEB_DEV=false'

it "reset is the checkout setup with --reset"
assert_contains "$(sed -n '/export async function resetCommand/,/^export async function /p' packages/cli/src/commands/lifecycle.ts)" 'reset: true'

it "dev --reset wipes the panel volume before the checkout setup"
dev_body="$(sed -n '/export async function devCommand/,/^export async function /p' packages/cli/src/commands/lifecycle.ts)"
assert_contains "$dev_body" 'options.reset'
assert_contains "$dev_body" 'wipePanelDatabase'

it "dev prepares the panel around one gateway convergence"
assert_contains "$dev_body" 'prepareWebUp'
assert_contains "$dev_body" 'finishWebUp'
assert_eq "" "$(printf '%s' "$dev_body" | grep -n 'webUp(' || true)"

it "the wipe goes down, removes the panel volume, then returns"
wipe_body="$(sed -n '/export async function wipePanelDatabase/,/^export async function /p' packages/cli/src/commands/lifecycle.ts)"
assert_contains "$wipe_body" 'await downCommand({}, command)'
assert_contains "$wipe_body" "['volume', 'rm', volume]"
assert_contains "$wipe_body" 'clearRegenerableState'

it "the checkout setup command keeps Commander’s (arg, options, command) arity"
assert_contains "$(cat packages/cli/src/cli.ts)" 'devCommand(profile, options, command)'

it "the checkout setup never pulls the published image"
assert_contains "$(sed -n '/export async function devCommand/,/^export async function /p' packages/cli/src/commands/lifecycle.ts)" 'skipPull: true'
assert_contains "$(sed -n '/export function checkoutLocalEnv/,/^}/p' packages/cli/src/commands/lifecycle.ts)" "PORTTA_WEB_BUILD: 'false'"
assert_contains "$(cat packages/core/src/images.ts)" 'fabioassuncao/portta:${release}'
assert_eq "" "$(sed -n '/export function checkoutLocalEnv/,/^}/p' packages/cli/src/commands/lifecycle.ts | grep -E 'ghcr.io/fabioassuncao' || true)"


describe "a unit test never reaches the developer's own Docker"

# `portta repair` and `portta up` end by reconciling containers. A unit test
# that runs one against a temporary PORTTA_ROOT, on a machine that has Docker,
# recreates the *developer's* gateway with every bind mount aimed at a
# directory the test is about to delete -- and the gateway keeps running,
# pointing at nothing, until somebody notices. Found exactly that way.
#
# Every suite that runs a command which can reach `compose up` must go through
# a stubbed PATH.
it "no unit suite runs a container-reconciling command against the real PATH"
offenders=""
for suite in "$PORTTA_ROOT"/tests/unit/*.test.sh; do
  case "$(basename "$suite")" in audit.test.sh) continue ;; esac
  # A call that names `repair` or `up` without a --dry-run and without a
  # stubbed PATH on the same line.
  while IFS= read -r line; do
    case "$line" in
      *--dry-run*|*PATH=*|*STUB*|*'#'*) continue ;;
      *run_in_home*repair*|*run_in_home*' up'*)
        offenders="$offenders $(basename "$suite")" ;;
    esac
  done < "$suite"
done
assert_eq "" "$offenders"

# The same failure from the other direction. `composeArguments` is what carries
# --project-directory; a hand-built `-f` list omits it, and Compose then anchors
# every relative bind at docker/compose/, where it creates `.env`, `VERSION`,
# the dynamic directory and the auth store as empty directories. The gateway
# comes back up healthy and reading none of its own configuration.
#
# Found on a real host: `portta public enable` did exactly this, and the panel
# answered 500 EISDIR with a gateway version of "unknown".
it "every compose invocation that names a gateway file goes through composeArguments"
offenders=""
for source in packages/cli/src/*.ts packages/cli/src/commands/*.ts; do
  case "$source" in *.test.ts) continue ;; esac
  while IFS= read -r line; do
    case "$line" in
      *composeArguments*) continue ;;
      # A -f whose path is joined onto the gateway root is a gateway compose
      # file; a consumer project's own compose file is not.
      *"'compose'"*"join("*".root,"*)
        offenders="$offenders $(basename "$source")" ;;
    esac
  done < "$source"
done
assert_eq "" "$offenders"

describe "the TypeScript CLI never constructs a shell command from input"

it "the process primitive disables shell execution"
assert_contains "$(cat packages/cli/src/process.ts)" "shell: false"

# One file may reach child_process, and only to give `remote access open` a
# tunnel that outlives the command. Everything else goes through runProcess,
# so "no shell string is ever built" is a property of one module rather than a
# habit spread across twenty command files.
it "commands call the primitive with argument arrays"
assert_eq "packages/cli/src/process.ts" \
  "$(grep -rln "from 'node:child_process'" packages/cli/src --include='*.ts' | grep -v '\.test\.ts$' | sort | tr '\n' ' ' | sed 's/ $//')"

it "and the detached spawn disables the shell too"
assert_contains "$(sed -n '/export function spawnDetached/,/^}/p' packages/cli/src/process.ts)" "shell: false"

t_summary
