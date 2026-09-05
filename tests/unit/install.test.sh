#!/usr/bin/env bash
# The installer. Only the paths that cannot change the machine are executed:
# `--help` and argument validation both exit before any detection runs. The
# rest is asserted against the script, because the alternative is installing
# Portta on the machine running the test suite.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT

INSTALLER="$PORTTA_ROOT/install.sh"
SOURCE="$(cat "$INSTALLER")"

describe "the installer is a self-contained entry point"

it "exists and is executable"
assert_success test -x "$INSTALLER"

it "parses as bash"
assert_success bash -n "$INSTALLER"

it "answers --help without touching anything"
assert_contains "$(bash "$INSTALLER" --help 2>&1)" "Portta installer"

it "documents that the same command updates"
assert_contains "$(bash "$INSTALLER" --help 2>&1)" "The same command installs and updates"

describe "every helper it calls is a helper it defines"

# `bash -n` and shellcheck both accept a call to a function that does not
# exist; it fails at runtime, on the machine of whoever ran the installer.
# The helpers here are snake_case with an underscore, which external commands
# in this script are not, so the two sets can be compared.
it "no call resolves to nothing"
defined=$(grep -oE '^[a-z][a-z0-9_]*\(\)' "$INSTALLER" | tr -d '()' | sort -u)
called=$(grep -v '^[[:space:]]*#' "$INSTALLER" \
  | grep -oE '(^|[[:space:];&|(]|\$\()[a-z][a-z0-9]*_[a-z0-9_]+[[:space:]]' \
  | sed -E 's/^[^a-z]*//; s/[[:space:]]*$//' | sort -u)
# sw_vers is macOS. The portta_* helpers are called inside the subshell that
# sources the installed scripts/lib, and are defined there.
allowed="portta_env_get
portta_env_set
portta_prepare_env
portta_compose_files
portta_defaults
portta_load_env
portta_resolve_profile
sw_vers"
missing=$(comm -23 <(printf '%s\n' "$called") <(printf '%s\n%s\n' "$defined" "$allowed" | sort -u) | tr '\n' ' ')
assert_eq "" "$(printf '%s' "$missing" | sed 's/[[:space:]]*$//')"

it "no top-level variable is used before it is assigned"
# `set -u` turns one of these into "unbound variable" at the moment the line
# runs — a long way from the mistake, and a long way into a run that has already
# changed the machine. bash -n and shellcheck both accept it: the code is
# syntactically fine and the variable is assigned, just too late.
assert_success python3 "$PORTTA_TEST_DIR/lib/assignment-order.py" "$INSTALLER"

describe "arguments are validated before anything is detected"

it "documents Projects Home as a separate directory"
assert_contains "$(bash "$INSTALLER" --help 2>&1)" "--projects-home"
assert_contains "$SOURCE" 'Where should Portta manage your projects?'
assert_contains "$SOURCE" 'PORTTA_PROJECTS_HOME'
assert_contains "$SOURCE" 'never moves files'

it "an unknown flag fails"
assert_failure bash "$INSTALLER" --nonsense

it "an unknown panel access mode fails"
assert_failure bash "$INSTALLER" --panel-access nonsense

it "a non-numeric panel port fails"
assert_failure bash "$INSTALLER" --panel-port eighty

it "a panel user is refused outright: there is no such thing any more"
assert_failure bash "$INSTALLER" --panel-user 'admin;rm'

it "the four supported access modes reach the parser"
assert_contains "$SOURCE" "''|public|tailscale|local|domain) ;;"

# `domain` routes the panel on the gateway's own entrypoint, so it needs a
# hostname a certificate can be issued for, and TLS to issue it. Neither can be
# guessed, and configuring the mode without them fails the panel closed.
it "and domain refuses a name no certificate can cover, or TLS being off"
assert_contains "$SOURCE" "--panel-access domain needs a real hostname"
assert_contains "$SOURCE" "--panel-access domain would carry the panel's session cookie in clear text"

describe "the installer invents no panel password at all"

# The panel signs people in itself, and its first account is created once, at
# /setup or from this host. There is nothing here to generate, hash, hand over
# or print, so none of it exists.
it "there is no panel password, on the command line or anywhere else"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n -- '--panel-password' || true)"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'PORTTA_PANEL_PASSWORD' || true)"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'openssl passwd' || true)"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -nE 'PORTTA_WEB_AUTH' || true)"

it "and --panel-user is refused rather than silently ignored"
assert_contains "$SOURCE" '--panel-user is gone'

it "the help sends people to /setup instead"
help=$(bash "$INSTALLER" --help 2>&1)
assert_contains "$help" "created once, in a browser at /setup"
assert_contains "$help" "--panel-auth <mode>"

it "and the mode it chose is written to .env"
assert_contains "$SOURCE" 'env_set "$ENV_FILE" PORTTA_AUTH_MODE "$PANEL_AUTH"'

it "with the URL a browser will be on, because the session cookie depends on it"
assert_contains "$SOURCE" 'env_set "$ENV_FILE" PORTTA_PANEL_URL'

it "the signing secret is generated once and never printed"
assert_contains "$SOURCE" 'portta_prepare_env "$ENV_FILE"'
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'say.*PORTTA_AUTH_SECRET' || true)"

describe "an update never destroys what the first install generated"

it ".env is created only when absent"
assert_contains "$SOURCE" '[ -f "$ENV_FILE" ] || ENV_WAS_CREATED=true'

it "the database credential is generated once"
assert_contains "$SOURCE" 'portta_prepare_env "$ENV_FILE"'

it "state, TLS material and the dynamic directory are never in the replaced set"
replaced=$(printf '%s' "$SOURCE" | sed -n 's/^for path in \(.*\); do$/\1/p' | head -n1)
assert_contains "$replaced" "docker/compose"
assert_contains "$replaced" "docker/images"
assert_not_contains "$replaced" "state"
assert_not_contains "$replaced" "config"

it "obsolete root image contexts are removed after the new layout lands"
assert_contains "$SOURCE" "for obsolete in apply toolbox"
assert_contains "$SOURCE" 'rm -rf "${PORTTA_HOME:?}/$obsolete"'

it "an existing dynamic configuration file is kept"
assert_contains "$SOURCE" 'if [ ! -e "$target" ]; then cp "$file" "$target"'

it "a mode the installer does not offer is carried through, not rewritten"
# `vpn` needs a domain and the remote-private profile, so the installer never
# offers it. An update of a host already configured that way must leave it be.
assert_contains "$SOURCE" 'vpn — routed by Traefik; kept as configured'

it "and an access mode it cannot understand stops the run"
assert_contains "$SOURCE" 'unknown panel access mode in $ENV_FILE'

# This assertion used to pin the exact one-liner, which is how it survived a new
# mode being added without being listed: the test passed because nothing had
# changed, which was the defect. It asserts the membership now.
it "every mode that leaves this host requires a sign-in"
assert_contains "$SOURCE" "public|vpn|domain|tailscale) return 0 ;;"

it "and disabled cannot be combined with one"
assert_contains "$SOURCE" '--panel-auth disabled cannot be combined with --panel-access'


it "an existing panel access mode is kept when no flag overrides it"
assert_contains "$SOURCE" 'PANEL_ACCESS=$(env_get "$ENV_FILE" PORTTA_WEB_EXPOSE)'

it "a directory that is not a Portta installation is refused, not adopted"
assert_contains "$SOURCE" 'exists and is not a Portta installation'

describe "the panel database survives an uninstall and reinstall"

# --uninstall keeps the volume and removes PORTTA_HOME, which is where the
# password lived. A later install generates a new one, PostgreSQL still expects
# the old, and the panel starts, answers /health and persists nothing: it is
# designed to run degraded, which is what makes this failure quiet.
it "the installer never changes a persistent cluster credential"
assert_not_contains "$SOURCE" 'ALTER USER'

it "and the password never crosses a command line to do it"
assert_contains "$SOURCE" 'POSTGRES_PASSWORD'
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'PASSWORD '"'"'\$DB_PASSWORD' || true)"

it "the credential is verified over TCP, the way the panel connects"
assert_contains "$SOURCE" 'the database rejects the configured credential'

it "and uninstall says where that credential went"
assert_contains "$SOURCE" 'its password lived in the .env just removed'

describe "the installer never builds and never clones"

it "it downloads a tarball rather than cloning"
assert_contains "$SOURCE" 'codeload.github.com'
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'git clone' || true)"

it "the derived domain and bind address are handed to Compose"
# Both are derived — the domain from the mode, the bind address from the
# profile — and an environment variable beats the env-file. Without this the
# public profile starts bound to loopback, which is the one thing it exists
# not to do.
assert_contains "$SOURCE" 'export PORTTA_DOMAIN="$RESOLVED_DOMAIN" PORTTA_BIND_ADDRESS="$RESOLVED_BIND"'

it "and they come from the installed gateway's own resolver"
assert_contains "$SOURCE" 'portta_resolve_profile "$profile"'

it "it pulls images"
assert_contains "$SOURCE" 'run_compose pull'

it "and never asks Compose to build"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -nE 'compose[^\n]*build|--build' || true)"

describe "project hostnames get a base that resolves where the panel is read"

# The failure this fixes: a VPS installed with a public panel handed out
# *.localhost URLs, which only resolve on the machine nobody was sitting at.
it "a host reached from elsewhere defaults to the auto mode"
assert_contains "$SOURCE" 'if [ "$PANEL_ACCESS" != "local" ] && [ -n "$PUBLIC_IP" ]; then'
assert_contains "$SOURCE" 'DOMAIN_MODE="auto"'

it "and a machine you are sitting at keeps localhost"
assert_contains "$SOURCE" 'good "projects will answer on *.localhost"'

it "a tailnet host builds the name from its tailnet address, not its public one"
# sslip.io resolves a 100.64/10 address like any other, so the names lead over
# the VPN and nowhere else: reachable, with no public exposure at all.
assert_contains "$SOURCE" 'if [ "$PANEL_ACCESS" = "tailscale" ] && [ -n "$TAILSCALE_IP" ]; then'

it "an existing mode is kept on an update"
assert_contains "$SOURCE" 'DOMAIN_MODE=$(env_get "$ENV_FILE" PORTTA_DOMAIN_MODE)'

# `.env.example` ships a value for everything, so reading one back cannot tell
# "the operator chose this" from "this is the template's default". Reading it on
# a fresh install pinned every new host to `local` — including one whose panel
# is on a tailnet, which then advertised *.localhost to somebody who could not
# open it. Found by installing from scratch on a real host.
it "but the template's default is not mistaken for a choice on a fresh install"
assert_contains "$SOURCE" 'ENV_WAS_CREATED=true'
assert_contains "$SOURCE" 'if [ -z "$DOMAIN_MODE" ] && [ "$ENV_WAS_CREATED" = "false" ]; then'

# A bind-mounted directory the installer does not create is created by Docker,
# owned by root at 0755. For the tunnel credential that is both the wrong mode
# and the wrong owner: the panel has to write it.
it "creates the directories it bind-mounts, privately where they hold a secret"
assert_contains "$SOURCE" 'state/github state/cloudflared'
assert_contains "$SOURCE" 'chmod 700 "$PORTTA_HOME/state/traefik/acme" "$PORTTA_HOME/state/cloudflared"'

it "and the same distinction guards the profile"
assert_contains "$SOURCE" '[ "$ENV_WAS_CREATED" = "false" ] && EXISTING_PROFILE=$(env_get "$ENV_FILE" PORTTA_PROFILE)'

it "the detected address is written down, so no later command has to look it up"
assert_contains "$SOURCE" 'env_set "$ENV_FILE" PORTTA_PUBLIC_IP "$PUBLIC_IP"'

it "auto without an address falls back rather than building a broken hostname"
assert_contains "$SOURCE" 'domain mode auto was asked for and no public address was detected'

it "--domain-mode is validated before anything is detected"
assert_failure bash "$INSTALLER" --domain-mode nonsense

it "the name is not an exposure, and the installer says so"
assert_contains "$SOURCE" "the name resolves already; 'portta public enable' is what makes Traefik answer there"

describe "the installer configures panel access, and nothing else"

it "it pins the gateway to the local profile, so applications stay unexposed"
assert_contains "$SOURCE" 'env_set "$ENV_FILE" PORTTA_PROFILE "local"'

it "an update keeps a profile the operator chose"
# `portta public enable` writes remote-public deliberately. Reimposing `local`
# on every update would silently un-expose the host.
assert_contains "$SOURCE" 'EXISTING_PROFILE=$(env_get "$ENV_FILE" PORTTA_PROFILE)'
assert_contains "$SOURCE" 'keeping the configured profile'

it "it never enables public application exposure"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'PUBLIC_ENABLED "true"' || true)"

it "a base domain is recorded without activating anything"
assert_contains "$SOURCE" 'recorded only; applications stay unexposed'

it "and it says so at the end"
assert_contains "$SOURCE" 'publishing the panel published nothing else'

describe "the panel is verified, not assumed"

# The old probe expected 401 from every routed panel, because Traefik refused
# everything without a credential. The panel answers this one endpoint to
# everybody now -- a browser has to learn whether to show a sign-in page -- and
# it is the only thing that can say whether an owner exists.
it "the installer asks the panel what it is, and fails when it will not say"
assert_contains "$SOURCE" '/api/auth/status'
assert_contains "$SOURCE" 'the panel did not answer on ${PANEL_PROBE_WHERE}'

it "a panel that still needs its first account says so"
assert_contains "$SOURCE" '"setupRequired":true'
assert_contains "$SOURCE" 'the first account is created at /setup'

it "and a panel running open while .env says required is a failure"
assert_contains "$SOURCE" 'running in open mode with PORTTA_AUTH_MODE=required'

describe "Tailscale is observed, never driven"

it "no tailscale up, no login, no set"
# Only an actual invocation counts: the script mentions `tailscale up` several
# times to tell the reader to run it themselves, which is the whole point.
assert_eq "" "$(printf '%s' "$SOURCE" | grep -nE '(^|[;&|(]|\$\()[[:space:]]*tailscale[[:space:]]+(up|login|set|logout)([[:space:]]|$)' || true)"

it "only the read-only address lookup"
assert_contains "$SOURCE" 'tailscale ip -4'

it "and its absence never stops the install"
assert_contains "$SOURCE" 'optional: the panel can be reached publicly or over an SSH tunnel instead'

describe "AI agent CLIs are reported, never touched"

it "every agent check is a version probe"
assert_contains "$SOURCE" 'agent_report "Claude Code"  claude'
assert_contains "$SOURCE" 'agent_report "Codex CLI"    codex'

it "a tool off this PATH is reported as such, not as missing"
# nvm in .zshrc, agent CLIs symlinked into ~/.local/bin: a non-interactive
# shell sees none of it, and "not found" would be a wrong answer.
assert_contains "$SOURCE" "not on this PATH"
assert_contains "$SOURCE" '.nvm/versions/node'

it "and the installer and doctor look in the same places"
for place in '.local/bin' '.nvm/versions/node' '.bun/bin' '.volta/bin'; do
  assert_contains "$SOURCE" "$place"
  assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/common.sh")" "$place"
done

it "nothing is installed or authenticated"
assert_contains "$SOURCE" 'the installer never installs, authenticates or reconfigures these'

describe "uninstall is conservative"

it "it asks first"
assert_contains "$SOURCE" 'confirm "Continue?" || die "aborted"'

it "it keeps the database volume"
assert_contains "$SOURCE" 'the panel database volume was kept'

it "it keeps the shared network, because projects may still be attached"
assert_contains "$SOURCE" 'the shared network was kept'

it "it finds the installation when no directory is given"
assert_contains "$SOURCE" 'no installation found at $PORTTA_HOME, and none in the usual places'

it "and honours an explicit --install-dir exactly"
assert_contains "$SOURCE" 'if [ -z "$INSTALL_DIR_EXPLICIT" ] && [ ! -f "$PORTTA_HOME/VERSION" ]; then'

it "it never prunes"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'system prune' || true)"

describe "one host runs one Portta"

it "a second installation is refused, with the first one named"
assert_contains "$SOURCE" 'Portta is already installed at $err_home and running'

it "and it is detected from the label Compose already writes"
assert_contains "$SOURCE" 'com.docker.compose.project.working_dir'

describe "the runtime layout the installer writes is a valid gateway root"

# packages/cli/src/context.ts recognises a root by VERSION plus a compose file
# under docker/compose/. `npx portta` on an installed host depends on it.
it "VERSION is downloaded"
assert_contains "$SOURCE" 'for path in VERSION'

it "and so is docker/compose"
assert_contains "$SOURCE" 'docker/compose'

it "and so are the operational image contexts"
assert_contains "$SOURCE" 'docker/images'

it "the CLI still finds its libraries through that symlink"
# The installer links PORTTA_HOME/bin/portta into a bin directory on PATH, so
# bin/portta has to resolve the link before looking for scripts/lib beside it.
link=$(mktemp -u "${TMPDIR:-/tmp}/portta-link.XXXXXX")
ln -sf "$PORTTA_ROOT/bin/portta" "$link"
assert_contains "$("$link" version 2>&1)" "portta "
rm -f "$link"

it "and that link does not shadow a globally installed npm CLI"
# PORTTA_HOME has no packages/ directory, so without this the linked entry
# point would answer with the reduced shell command set even where the full
# TypeScript CLI is installed.
assert_contains "$(cat "$PORTTA_ROOT/bin/portta")" "lib/node_modules/portta/dist/cli.js"

it "and it links only into a directory already on PATH"
assert_contains "$SOURCE" 'for candidate in /usr/local/bin "$HOME/.local/bin"'

it "the CLI looks in the directories the installer defaults to"
context="$(cat "$PORTTA_ROOT/packages/cli/src/context.ts")"
assert_contains "$context" "'/opt/portta'"
assert_contains "$context" "'.portta'"

describe "the installer offers the full command set without depending on it"

# `bin/portta` implements the ADR 0015 commands and reports that the rest need
# the full CLI. That report is only useful if the CLI can be installed, so the
# installer installs it -- and Portta's promise is Docker, Git and a shell, so
# an npm registry that is unreachable must not turn a successful install into a
# failed one.
it "installs the published CLI when the host can run it"
assert_contains "$SOURCE" "npm install -g"

it "and never lets that decide whether the install succeeded"
assert_eq "" "$(sed -n '/^CLI_STATE=/,/^fi$/p' "$PORTTA_ROOT/install.sh" | grep -n 'die ' || true)"

it "reporting what happened either way"
for state in installed unavailable; do
  assert_contains "$SOURCE" "$state)"
done

describe "--tls is the one flag that turns a domain into HTTPS"

# The installer asked for a domain and then left the operator on plain HTTP
# with no flag to say otherwise. HTTP-01 is what makes this a single flag:
# DNS-01 would need a provider credential the installer has no business
# prompting for.
it "writes the four settings the ACME overlay reads"
for key in TLS_ENABLED TLS_MODE ACME_CHALLENGE ACME_EMAIL; do
  assert_contains "$SOURCE" "env_set \"\$ENV_FILE\" $key"
done

it "and asks for HTTP-01, which needs nothing but :80"
assert_contains "$SOURCE" 'env_set "$ENV_FILE" ACME_CHALLENGE http'

# No public CA issues a certificate for a bare IP or an sslip.io name, so the
# flag has to refuse rather than configure an issuance that can only fail.
it "refuses a domain no certificate authority will sign"
assert_contains "$SOURCE" 'localhost|*.sslip.io|*.nip.io'
assert_contains "$SOURCE" '--tls needs a real domain'

it "the contact address is a flag, never a prompt"
assert_contains "$SOURCE" '--tls) shift; TLS_EMAIL='

describe "the panel probe waits for Traefik to catch up"

# Traefik learns about a recreated container from the socket proxy, and for a
# second or two it has the container but not the router -- so the probe gets a
# 404 that is indistinguishable from a real one. A single shot made a working
# update report failure; found doing exactly that.
it "retries until the expected code, rather than asking once"
assert_contains "$SOURCE" "probe_until() {"
assert_contains "$SOURCE" 'while [ "$_attempt" -lt 20 ]'
assert_eq "" "$(printf '%s' "$SOURCE" | grep -E '^probe\(\) \{' || true)"

# In `domain` mode nothing is published on the host, so a probe at a host port
# would check a door that does not exist.
it "reaches a routed panel by name, through the gateway entrypoint"
assert_contains "$SOURCE" '--resolve ${ADVERTISED}:443:127.0.0.1'

describe "every mode that publishes the panel makes it sign people in"

# `domain` was missing from needs_auth when the mode was added, so a fresh
# install with it generated no credential at all -- and the CLI refused `domain`
# without one, leaving a host that installed cleanly and could not start its
# own panel. The step has to cover every mode that puts the panel beyond this
# host, which is now every mode but `local`.
it "the modes that do not publish it are still skipped"
assert_contains "$SOURCE" "needs_auth() {"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -E 'needs_auth\(\) \{ \[' || true)"

t_summary
