#!/usr/bin/env bash
# Profile resolution and overlay selection. Docker is used only for `compose
# config`, which renders without contacting the daemon's network.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"

# resolve <profile> <var> [env assignments...]: resolve in a subshell so each
# case starts from a clean environment.
resolve() {
  local profile="$1" want="$2"; shift 2
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_resolve_profile "$profile" >/dev/null 2>&1 || { printf 'REFUSED'; return 0; }
    eval "printf '%s' \"\${$want}\"" )
}

files_for() {
  local profile="$1"; shift
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_resolve_profile "$profile" >/dev/null 2>&1 || { printf 'REFUSED'; return 0; }
    # Repo-relative, so the assertions name the same paths the docs do.
    portta_compose_files "$profile" | tr ' ' '\n' | grep -v '^-f$' | sed "s#^$PORTTA_ROOT/##" | tr '\n' ' ' )
}

# A panel reachable from another machine is refused unless it signs people in,
# so every case that publishes it beyond loopback carries the mode and the
# secret. See docs/adr/0035-authentication-lives-in-the-panel.md.
PORTTA_RUNTIME_CREDENTIAL="PORTTA_AUTH_MODE=required PORTTA_AUTH_SECRET=a-test-secret-that-is-long-enough"

describe "domains follow the profile"
it "local uses localhost"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN)"
it "remote-private uses PRIVATE_DOMAIN"
assert_eq "vpn.example.test" "$(resolve remote-private PORTTA_DOMAIN PRIVATE_DOMAIN=vpn.example.test)"
it "remote-public uses PUBLIC_DOMAIN"
assert_eq "dev.example.test" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=dev.example.test)"
it "remote-public without PUBLIC_DOMAIN is refused"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN)"

describe "bind addresses: the security-relevant part"
it "local binds loopback"
assert_eq "127.0.0.1" "$(resolve local PORTTA_BIND_ADDRESS)"
it "remote-private with Tailscale binds loopback, reachable only via the tailnet"
assert_eq "127.0.0.1" "$(resolve remote-private PORTTA_BIND_ADDRESS TAILSCALE_ENABLED=true)"
it "remote-private keeps an explicit VPN address"
assert_eq "100.64.0.1" "$(resolve remote-private PORTTA_BIND_ADDRESS PORTTA_BIND_ADDRESS=100.64.0.1)"
it "remote-private REFUSES 0.0.0.0"
assert_eq "REFUSED" "$(resolve remote-private PORTTA_BIND_ADDRESS PORTTA_BIND_ADDRESS=0.0.0.0)"
it "remote-public binds every interface, deliberately"
assert_eq "0.0.0.0" "$(resolve remote-public PORTTA_BIND_ADDRESS PUBLIC_DOMAIN=dev.example.test)"
it "remote-public overrides an explicit narrow bind"
assert_eq "0.0.0.0" "$(resolve remote-public PORTTA_BIND_ADDRESS PUBLIC_DOMAIN=dev.example.test PORTTA_BIND_ADDRESS=127.0.0.1)"

describe "ACME needs a contact address"
it "remote-public with acme but no email is refused"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme)"
it "remote-public with acme and an email resolves"
assert_eq "d.test" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test)"

describe "exactly one attachment overlay is selected"
it "local attaches to the host"
assert_contains "$(files_for local)" "docker/compose/attach/host.yaml"
it "remote-private with Tailscale uses the namespace attachment"
assert_contains "$(files_for remote-private TAILSCALE_ENABLED=true)" "docker/compose/attach/tailscale.yaml"
it "remote-private without Tailscale falls back to the host attachment"
assert_contains "$(files_for remote-private PORTTA_BIND_ADDRESS=100.64.0.1)" "docker/compose/attach/host.yaml"
it "never both"
assert_not_contains "$(files_for remote-private TAILSCALE_ENABLED=true)" "docker/compose/attach/host.yaml"

describe "profile overlays"
it "remote-public includes the public overlay"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "docker/compose/profiles/public.yaml"
it "local does not"
assert_not_contains "$(files_for local)" "docker/compose/profiles/public.yaml"
it "local TLS pulls in the local-tls overlay"
assert_contains "$(files_for local TLS_ENABLED=true TLS_MODE=local)" "docker/compose/profiles/local-tls.yaml"
it "the dashboard overlay follows the attachment"
assert_contains "$(files_for remote-private TAILSCALE_ENABLED=true PORTTA_DASHBOARD=true)" "docker/compose/features/dashboard-tailscale.yaml"
it "domain exposure is its own overlay, never composed with the loopback one"
assert_contains "$(files_for local PORTTA_DASHBOARD=true PORTTA_DASHBOARD_EXPOSE=domain)" "docker/compose/features/dashboard-domain.yaml"
assert_not_contains "$(files_for local PORTTA_DASHBOARD=true PORTTA_DASHBOARD_EXPOSE=domain)" "docker/compose/features/dashboard.yaml"

describe "the web panel is opt-in and never public"
it "off by default"
assert_not_contains "$(files_for local)" "docker/compose/features/web.yaml"
it "enabled by PORTTA_WEB"
assert_contains "$(files_for local PORTTA_WEB=true)" "docker/compose/features/web.yaml"

# PostgreSQL is a boot dependency of the panel, not a feature of it: the panel
# refuses to start without it, so a profile that selected one and not the other
# could only ever produce a panel that exits.
it "and never without its database"
for portta_profile in local remote-private remote-public; do
  portta_selection=$(files_for "$portta_profile" PORTTA_WEB=true PUBLIC_DOMAIN=d.test)
  case "$portta_selection" in
    *"docker/compose/features/web.yaml"*)
      assert_contains "$portta_selection" "docker/compose/features/db.yaml" ;;
  esac
done

it "and never the database without the panel"
assert_not_contains "$(files_for local)" "docker/compose/features/db.yaml"
it "passes Projects Home as configuration without mounting it"
web_overlay=$(cat "$PORTTA_ROOT/docker/compose/features/web.yaml")
assert_contains "$web_overlay" 'PORTTA_PROJECTS_HOME: ${PORTTA_PROJECTS_HOME:-}'
assert_eq "1" "$(printf '%s\n' "$web_overlay" | grep -c 'PORTTA_PROJECTS_HOME')"
it "development mode adds the HMR overlay"
assert_contains "$(files_for local PORTTA_WEB=true PORTTA_WEB_DEV=true)" "docker/compose/features/web-dev.yaml"
it "and does not add it otherwise"
assert_not_contains "$(files_for local PORTTA_WEB=true)" "docker/compose/features/web-dev.yaml"
it "the VPN overlay is opt-in"
assert_contains "$(files_for remote-private PORTTA_WEB=true PORTTA_WEB_EXPOSE=vpn TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test $PORTTA_RUNTIME_CREDENTIAL)" "docker/compose/features/web-vpn.yaml"
it "routing the panel on remote-public is REFUSED"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test PORTTA_WEB=true PORTTA_WEB_EXPOSE=vpn)"
it "the panel itself still runs there, just not routed"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true)" "docker/compose/features/web.yaml"
it "and gets no Traefik router"
assert_not_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true)" "docker/compose/features/web-vpn.yaml"

describe "TCP entrypoints are opt-in and never public"
it "off by default"
assert_not_contains "$(files_for local)" "docker/compose/features/tcp.yaml"
it "enabled by PORTTA_TCP"
assert_contains "$(files_for local PORTTA_TCP=true)" "docker/compose/features/tcp.yaml"
it "the Tailscale attachment publishes them from the Tailscale container"
assert_contains "$(files_for remote-private PORTTA_TCP=true TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "docker/compose/features/tcp-tailscale.yaml"
it "and never both overlays at once"
assert_not_contains "$(files_for remote-private PORTTA_TCP=true TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "docker/compose/features/tcp.yaml"
it "a database on the public profile is REFUSED"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test PORTTA_TCP=true)"
it "and the public profile still starts without them"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "docker/compose/profiles/public.yaml"

describe "every profile renders a valid compose configuration"
if ! docker compose version >/dev/null 2>&1; then
  it "compose validation"; skip "docker compose unavailable"
else
  validate() {
    local profile="$1"; shift
    ( for kv in "$@"; do export "${kv?}"; done
      portta_defaults
      portta_resolve_profile "$profile" >/dev/null 2>&1 || return 1
      portta_compose "$profile" config >/dev/null 2>&1 )
  }
  it "local";                       assert_success validate local
  it "local with TLS";              assert_success validate local TLS_ENABLED=true TLS_MODE=local
  it "local with the dashboard";    assert_success validate local PORTTA_DASHBOARD=true
  it "remote-private + tailscale";  assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy
  it "remote-private, own VPN";     assert_success validate remote-private PORTTA_BIND_ADDRESS=100.64.0.1 PRIVATE_DOMAIN=vpn.test
  it "remote-public";               assert_success validate remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test
  it "remote-public + tailscale";   assert_success validate remote-public PUBLIC_DOMAIN=d.test TAILSCALE_ENABLED=true TS_AUTHKEY=dummy TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test
  it "local with the web panel";    assert_success validate local PORTTA_WEB=true
  it "local with the panel in dev"; assert_success validate local PORTTA_WEB=true PORTTA_WEB_DEV=true
  # shellcheck disable=SC2086  # the credential is three separate assignments
  it "remote-private + panel/vpn";  assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy PORTTA_WEB=true PORTTA_WEB_EXPOSE=vpn $PORTTA_RUNTIME_CREDENTIAL
  it "local with tcp entrypoints";  assert_success validate local PORTTA_TCP=true
  it "remote-private + tcp";        assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy PORTTA_TCP=true
fi

describe "panel access selects exactly one front door"

# See docs/adr/0021-panel-access-modes.md. The invariant worth testing is that
# `web-bind.yaml` (a host port on the panel container) and `panel-public.yaml`
# (a Traefik entrypoint with ForwardAuth) are never both applied, because they
# would claim the same host port and one of them would bypass the credential.
for mode in local tailscale vpn; do
  it "$mode publishes the panel container, not a Traefik entrypoint"
  # shellcheck disable=SC2086
  selected=$(files_for local PORTTA_WEB=true "PORTTA_WEB_EXPOSE=$mode" $PORTTA_RUNTIME_CREDENTIAL)
  assert_contains "$selected" "docker/compose/features/web-bind.yaml"
  assert_not_contains "$selected" "docker/compose/features/panel-public.yaml"
done

it "public publishes a Traefik entrypoint, not the panel container"
# shellcheck disable=SC2086
selected=$(files_for local PORTTA_WEB=true PORTTA_WEB_EXPOSE=public $PORTTA_RUNTIME_CREDENTIAL)
assert_contains "$selected" "docker/compose/features/panel-public.yaml"
assert_not_contains "$selected" "docker/compose/features/web-bind.yaml"

it "public without a credential is refused"
assert_eq "REFUSED" "$(files_for local PORTTA_WEB=true PORTTA_WEB_EXPOSE=public)"

it "public is refused where Traefik has no namespace of its own"
# shellcheck disable=SC2086
assert_eq "REFUSED" "$(files_for remote-private PRIVATE_DOMAIN=vpn.test TAILSCALE_ENABLED=true TS_AUTHKEY=dummy PORTTA_WEB=true PORTTA_WEB_EXPOSE=public $PORTTA_RUNTIME_CREDENTIAL)"

it "a normal install never selects the panel build overlay"
assert_not_contains "$(files_for local PORTTA_WEB=true)" "docker/compose/features/web-build.yaml"

it "and a developer can opt back into it"
assert_contains "$(files_for local PORTTA_WEB=true PORTTA_WEB_BUILD=true)" "docker/compose/features/web-build.yaml"

it "a checkout alone does not imply an auth build"
assert_not_contains "$(files_for local)" "docker/compose/features/auth-build.yaml"

it "development mode selects the auth development overlay once"
selected="$(files_for local PORTTA_WEB=true PORTTA_WEB_DEV=true)"
assert_contains "$selected" "docker/compose/features/auth-dev.yaml"
assert_eq "1" "$(printf '%s\n' $selected | grep -c 'docker/compose/features/auth-dev.yaml')"

describe "both entry points create the networks the overlays declare external"

# Compose refuses to start while an `external: true` network is missing, so
# whichever surface starts the gateway has to create both.
it "the shell entry point ensures the access network when TCP routing is on"
assert_contains "$(cat "$PORTTA_ROOT/bin/portta")" 'portta_network_ensure "$PORTTA_ACCESS_NETWORK"'

it "and so does the TypeScript one"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/lifecycle.ts")" 'ensureNetwork(context.config.accessNetwork)'

describe "a remote profile without TLS serves plain HTTP"

# Redirecting :80 to :443 without a certificate the browser accepts turns a
# working URL into a warning page. An auto domain can never have one: no public
# CA issues a wildcard for sslip.io.
it "no TLS means the plain overlay, and no redirect"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test)
assert_contains "$selected" "docker/compose/profiles/remote.yaml"
assert_not_contains "$selected" "docker/compose/profiles/remote-tls.yaml"

it "and TLS swaps it for the one that redirects"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test)
assert_contains "$selected" "docker/compose/profiles/remote-tls.yaml"
assert_not_contains "$selected" "docker/compose/profiles/remote.yaml"

it "the public overlay comes along either way"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "docker/compose/profiles/public.yaml"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test)" "docker/compose/profiles/public.yaml"

describe "exactly one ACME challenge overlay, and DNS-01 is the default"

# A wildcard is the reason DNS-01 is the default: it is the only challenge that
# can issue `*.example.com`, and the only one a gateway the ACME server cannot
# reach can use at all. HTTP-01 is the trade a public host may prefer -- one
# certificate per hostname, issued on demand, and no DNS credential to hold.
it "TLS without a choice takes DNS-01"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test)
assert_contains "$selected" "docker/compose/profiles/remote-tls-dns.yaml"
assert_not_contains "$selected" "docker/compose/profiles/remote-tls-http.yaml"

it "and ACME_CHALLENGE=http swaps the one overlay, keeping the shared one"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test ACME_CHALLENGE=http)
assert_contains "$selected" "docker/compose/profiles/remote-tls.yaml"
assert_contains "$selected" "docker/compose/profiles/remote-tls-http.yaml"
assert_not_contains "$selected" "docker/compose/profiles/remote-tls-dns.yaml"

it "no challenge overlay at all without TLS"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test ACME_CHALLENGE=http)
assert_not_contains "$selected" "remote-tls"

# A wildcard SAN cannot be issued over HTTP-01, and asking for one makes every
# issuance fail rather than fall back. The overlay must not carry the domains.
it "the HTTP-01 overlay never asks for a wildcard"
http_overlay=$(cat "$PORTTA_ROOT/docker/compose/profiles/remote-tls-http.yaml")
assert_contains "$http_overlay" "ACME_HTTPCHALLENGE"
assert_eq "" "$(printf '%s' "$http_overlay" | grep 'TLS_DOMAINS' || true)"

it "and the DNS-01 overlay is the only one holding a provider credential"
assert_contains "$(cat "$PORTTA_ROOT/docker/compose/profiles/remote-tls-dns.yaml")" "CF_DNS_API_TOKEN"
assert_eq "" "$(grep -l CF_DNS_API_TOKEN "$PORTTA_ROOT/docker/compose/profiles/remote-tls.yaml" "$PORTTA_ROOT/docker/compose/profiles/remote-tls-http.yaml" 2>/dev/null || true)"

it "the redirect lives only in the TLS overlay"
assert_eq "" "$(grep -l REDIRECTIONS "$PORTTA_ROOT/docker/compose/profiles/remote.yaml" 2>/dev/null || true)"
assert_contains "$(cat "$PORTTA_ROOT/docker/compose/profiles/remote-tls.yaml")" "REDIRECTIONS"

describe "the panel's front door is owned by exactly one overlay"

# `domain` routes the panel on the gateway's own entrypoint. A published host
# port beside that router would be a second way in, and the middleware would
# never see it -- so the bind overlay must not come along.
it "domain routes the panel and publishes no host port"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true PORTTA_WEB_EXPOSE=domain $PORTTA_RUNTIME_CREDENTIAL)
assert_contains "$selected" "docker/compose/features/panel-domain.yaml"
assert_not_contains "$selected" "docker/compose/features/web-bind.yaml"
assert_not_contains "$selected" "docker/compose/features/panel-public.yaml"

it "public keeps its own entrypoint and no router on the domain"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true PORTTA_WEB_EXPOSE=public $PORTTA_RUNTIME_CREDENTIAL)
assert_contains "$selected" "docker/compose/features/panel-public.yaml"
assert_not_contains "$selected" "docker/compose/features/panel-domain.yaml"

it "and local publishes a host port, routing nothing"
selected=$(files_for local PORTTA_WEB=true PORTTA_WEB_EXPOSE=local)
assert_contains "$selected" "docker/compose/features/web-bind.yaml"
assert_not_contains "$selected" "docker/compose/features/panel-domain.yaml"

# Nothing in front of the router: the panel signs its own people in, and
# `web up --expose domain` refuses unless it is in `required` mode with TLS on.
it "the routed panel carries no Traefik middleware"
assert_eq "" "$(grep -n 'middlewares' "$PORTTA_ROOT/docker/compose/features/panel-domain.yaml" || true)"

describe "the webhook is the one path that authenticates itself"

# GitHub sends no cookie and no Basic credential, so every panel path behind
# ForwardAuth refuses a delivery before the panel sees it. The exemption is one
# exact path, and it is safe only because that path verifies an HMAC signature
# over the raw body before parsing anything.
CREDENTIALLED_DOMAIN="PORTTA_WEB=true PORTTA_WEB_EXPOSE=domain $PORTTA_RUNTIME_CREDENTIAL"

it "is off until the App is"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test $CREDENTIALLED_DOMAIN)
assert_not_contains "$selected" "docker/compose/features/panel-webhook.yaml"

it "and rides with a routed panel once it is on"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test $CREDENTIALLED_DOMAIN GITHUB_APP_ENABLED=true)
assert_contains "$selected" "docker/compose/features/panel-webhook.yaml"

# `public` serves the panel over plain HTTP on an entrypoint that terminates no
# TLS, usually on a bare IP. GitHub will not deliver there, so opening the path
# would be an unauthenticated route to nothing.
it "never rides with the panel entrypoint, which GitHub cannot reach"
selected=$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true PORTTA_WEB_EXPOSE=public $PORTTA_RUNTIME_CREDENTIAL GITHUB_APP_ENABLED=true)
assert_not_contains "$selected" "docker/compose/features/panel-webhook.yaml"

# An exact path, never a prefix: a prefix would carry every path under it.
it "names one exact path and no middleware"
overlay=$(cat "$PORTTA_ROOT/docker/compose/features/panel-webhook.yaml")
assert_contains "$overlay" 'Path(`/api/integrations/github/webhook`)'
assert_eq "" "$(printf '%s' "$overlay" | grep -E 'PathPrefix|middlewares' || true)"

# Traefik picks the highest priority, and the panel's own router matches the
# same host: the exact path has to win or the delivery meets ForwardAuth.
it "outranks the panel router that would otherwise catch it"
assert_contains "$overlay" "portta-panel-webhook.priority"

describe "the base domain comes from the mode"

# See docs/adr/0022-project-domain-modes.md. `localhost` is right for a machine
# you are sitting at and useless from anywhere else, which is why a mode exists
# at all.
it "local is localhost"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=local)"

it "and stays localhost even with a domain configured, because the mode decides"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=local PORTTA_DOMAIN=dev.example.test)"

it "auto builds one from the detected address"
assert_eq "203-0-113-10.sslip.io" \
  "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.10)"

it "auto honours the other provider"
assert_eq "203-0-113-10.nip.io" \
  "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.10 PORTTA_AUTO_DOMAIN_PROVIDER=nip.io)"

it "custom uses the configured domain"
assert_eq "dev.example.test" \
  "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=custom PORTTA_DOMAIN=dev.example.test)"

# A gateway that refuses to start over an unreachable hostname is worse than the
# hostname, so every failure falls back to localhost and reports why.
it "auto without an address falls back rather than failing"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto)"
assert_contains "$(resolve local PORTTA_DOMAIN_PROBLEM PORTTA_DOMAIN_MODE=auto)" "no public address"

it "auto with a value that is not an address falls back rather than failing"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=nonsense)"

it "custom without a domain falls back rather than failing"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=custom)"

it "an octet out of range is not turned into a hostname"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.999)"

describe "private and public addresses are told apart"

# Only for advice, never for policy: a name resolving to a tailnet address is
# served by binding that address, and suggesting public exposure instead would
# be a far larger change than the one needed.
for ip in 10.0.0.1 192.168.1.5 172.16.0.1 172.31.255.1 100.64.0.1 100.87.243.7 100.127.255.1 127.0.0.1; do
  it "$ip is private"
  assert_success portta_ip_is_private "$ip"
done
for ip in 2.28.24.129 8.8.8.8 100.63.255.1 100.128.0.1 172.15.0.1 172.32.0.1; do
  it "$ip is not"
  assert_failure portta_ip_is_private "$ip"
done

describe "a domain mode can satisfy the public profile"

# Going public used to mean buying a domain first; an auto base is a domain.
it "remote-public accepts an auto base when PUBLIC_DOMAIN is unset"
assert_eq "203-0-113-10.sslip.io" \
  "$(resolve remote-public PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.10)"

it "and an explicit PUBLIC_DOMAIN still wins"
assert_eq "dev.example.test" \
  "$(resolve remote-public PORTTA_DOMAIN PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.10 PUBLIC_DOMAIN=dev.example.test)"

it "remote-public is still refused with nothing but localhost"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PORTTA_DOMAIN_MODE=local)"

describe "the shell and the TypeScript CLI select the same overlays"

# ADR 0015: the core commands must run without Node, so the selection logic has
# two implementations. This is what keeps them honest.
if ! command -v node >/dev/null 2>&1 || [ ! -f "$PORTTA_ROOT/packages/core/dist/config.js" ]; then
  it "parity"; skip "node or the built core package is unavailable"
else
  ts_files_for() {
    ( for kv in "$@"; do export "${kv?}"; done
      node --input-type=module -e '
        import { loadGatewayConfig, composeFilesForRoot } from "'"$PORTTA_ROOT"'/packages/core/dist/config.js"
        try { process.stdout.write(composeFilesForRoot(loadGatewayConfig(process.env), process.env.PORTTA_ROOT).join(" ") + " ") }
        catch { process.stdout.write("REFUSED") }
      ' 2>/dev/null )
  }

  ts_domain_for() {
    ( for kv in "$@"; do export "${kv?}"; done
      node --input-type=module -e '
        import { loadGatewayConfig } from "'"$PORTTA_ROOT"'/packages/core/dist/config.js"
        try { process.stdout.write(loadGatewayConfig(process.env).domain) }
        catch { process.stdout.write("REFUSED") }
      ' 2>/dev/null )
  }

  # The base domain is baked into Traefik's default rule by whichever surface
  # started the gateway, so the two resolvers have to agree exactly.
  for domain_case in \
    "PORTTA_DOMAIN_MODE=local" \
    "PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.10" \
    "PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=203.0.113.10 PORTTA_AUTO_DOMAIN_PROVIDER=nip.io" \
    "PORTTA_DOMAIN_MODE=auto" \
    "PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=nonsense" \
    "PORTTA_DOMAIN_MODE=custom PORTTA_DOMAIN=dev.example.test" \
    "PORTTA_DOMAIN_MODE=custom"
  do
    it "same domain for: $domain_case"
    # shellcheck disable=SC2086
    assert_eq "$(resolve local PORTTA_DOMAIN $domain_case)" "$(ts_domain_for PORTTA_PROFILE=local $domain_case)"
  done

  for case_env in \
    "PORTTA_PROFILE=local" \
    "PORTTA_PROFILE=local PORTTA_TCP=true" \
    "PORTTA_PROFILE=local PORTTA_DASHBOARD=true" \
    "PORTTA_PROFILE=local TLS_ENABLED=true TLS_MODE=local" \
    "PORTTA_PROFILE=local PORTTA_WEB=true" \
    "PORTTA_PROFILE=local PORTTA_WEB=true PORTTA_WEB_BUILD=true" \
    "PORTTA_PROFILE=local PORTTA_WEB=true PORTTA_WEB_DEV=true" \
    "PORTTA_PROFILE=remote-private PRIVATE_DOMAIN=vpn.test TAILSCALE_ENABLED=true" \
    "PORTTA_PROFILE=remote-public PUBLIC_DOMAIN=d.test" \
    "PORTTA_PROFILE=remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test" \
    "PORTTA_PROFILE=remote-private PRIVATE_DOMAIN=vpn.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test" \
    "PORTTA_PROFILE=local CLOUDFLARE_TUNNEL_ENABLED=true" \
    "PORTTA_PROFILE=local PORTTA_WEB=true CLOUDFLARE_TUNNEL_ENABLED=true" \
    "PORTTA_PROFILE=remote-public PUBLIC_DOMAIN=d.test CLOUDFLARE_TUNNEL_ENABLED=true"
  do
    it "same files for: $case_env"
    # shellcheck disable=SC2086
    profile=$(printf '%s' "$case_env" | sed -n 's/.*PORTTA_PROFILE=\([a-z-]*\).*/\1/p')
    # shellcheck disable=SC2086
    assert_eq "$(files_for "$profile" $case_env)" "$(ts_files_for $case_env)"
  done

  # The panel modes are the new axis, and the one most likely to drift.
  for mode in local tailscale public vpn; do
    it "same files for panel access: $mode"
    # shellcheck disable=SC2086
    assert_eq \
      "$(files_for local PORTTA_PROFILE=local PORTTA_WEB=true "PORTTA_WEB_EXPOSE=$mode" $PORTTA_RUNTIME_CREDENTIAL)" \
      "$(ts_files_for PORTTA_PROFILE=local PORTTA_WEB=true "PORTTA_WEB_EXPOSE=$mode" $PORTTA_RUNTIME_CREDENTIAL)"
  done
fi

describe "the private profile never publishes on a public interface"
if ! docker compose version >/dev/null 2>&1; then
  it "rendered binds"; skip "docker compose unavailable"
else
  rendered=$(
    export TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy PORTTA_TCP=true
    portta_defaults; portta_resolve_profile remote-private >/dev/null 2>&1
    portta_compose remote-private config 2>/dev/null
  )
  it "no 0.0.0.0 anywhere in the rendered private profile"
  assert_not_contains "$rendered" "0.0.0.0"
  it "traefik shares the tailscale namespace"
  assert_contains "$rendered" "network_mode: service:tailscale"
  it "the socket proxy is still unpublished"
  assert_not_contains "$rendered" "2375:2375"
fi

t_summary
