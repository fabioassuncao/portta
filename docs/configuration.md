# Configuration

The installation `.env` is the source of shared configuration and credentials.
`.env.example` defines its structure, groups, comments and supported variables.
`portta config prepare` creates or reconciles it without starting services;
`bootstrap`, `dev`, `up`, `web up`, `setup` and the installer also prepare it.

Persisted `.env` values **win over the inherited shell environment**. Explicit
configuration commands write the file before resolving Compose. Runtime selectors
such as `PORTTA_ROOT`, `PATH` and `PORTTA_FORCE_BASH` are process inputs, not
installation settings. Internal service ports and filesystem paths in containers
are architectural constants. `PORTTA_VERSION` derives from `VERSION`.

Preparation fills absent keys from the template and generates absent/empty secrets
once. It keeps configured values, including deliberate empty optional fields.
First structural normalization keeps a `0600` `.env.before-structure` backup;
known keys follow the template and personal comments/extensions are retained.
Future missing keys are inserted near their template neighbours. Ordinary edits
only replace the requested values, preserving comments, order, spacing and line
endings. Duplicate keys are rejected. Dotenv content is parsed, never executed;
Portta treats values literally rather than evaluating `${OTHER_VARIABLE}`.

CLI and panel share `portta-core`'s document editor. The zero-Node shell adapter
is checked against the same fixtures. A `.env-lock/writer` directory serializes
writes across the host and panel; `.env-lock` is a shared mount, not image content.
Backups and in-place writes preserve the file's inode and mode `0600`. A stale
lock fails with a diagnostic; only remove it after verifying no writer is active.

See [the configuration audit](configuration-audit.md) for the variable inventory,
container map, removals and validation results.

How those values relate — project hostnames, public access, the panel URL,
Traefik, TLS, VPN and DNS — is [addresses-and-access.md](addresses-and-access.md).
The Settings pages edit the same keys without asking you to think in variable
names.

```bash
portta inspect     # what the CLI actually resolved (secrets shown as <set>)
```

## Common

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_PROFILE` | `local` | Default profile for `up` |
| `PORTTA_PROJECT_NAME` | `portta` | Compose project name of the gateway itself |
| `PORTTA_NETWORK` | `portta` | Shared external network |
| `PORTTA_CONTROL_NETWORK` | `portta-control` | Internal Traefik ↔ socket proxy network |
| `PORTTA_ACCESS_NETWORK` | `portta-access` | Network for persistent TCP forwarders |
| `PORTTA_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `PORTTA_ACCESS_LOG` | `false` | Traefik access logs, useful when a route misbehaves |

`PORTTA_PROJECT_NAME` is load-bearing: ownership checks use it to tell
gateway containers from everything else. Changing it orphans the running stack.

## Local profile

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_DOMAIN` | `localhost` | Base domain for generated hostnames |
| `PORTTA_BIND_ADDRESS` | `127.0.0.1` | Host interface Traefik publishes on |
| `PORTTA_HTTP_PORT` | `80` | Host port for HTTP |
| `PORTTA_HTTPS_PORT` | `443` | Host port for HTTPS |

`PORTTA_BIND_ADDRESS` is the single most security-relevant setting here.
Loopback keeps the gateway invisible to everyone else on your network;
`doctor` fails if the local profile is bound to anything else.

If 80 is already taken, changing `PORTTA_HTTP_PORT` to, say, `8080` means
URLs become `http://demo-a-web.localhost:8080`.

## Header aliasing

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_ALIAS_HEADERS_STRATEGY` | `keep` | `keep`, `delete` or `reject` |

Headers whose names contain characters outside `[A-Za-z0-9-]` can alias a
canonical header once a backend normalises them (`X_Auth_User` becoming
`X-Auth-User` in CGI, WSGI, PHP or nginx), which lets a client spoof headers
Traefik manages.

`keep` is Traefik's default and is fine behind loopback or a VPN. `delete`
strips them, but also strips *legitimate* underscore headers, which can break
an app in a confusing way, so it is opt-in locally and applied automatically
by the public profile.

## Dashboard

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_DASHBOARD` | `false` | Enable Traefik's dashboard |
| `PORTTA_DASHBOARD_BIND_ADDRESS` | `127.0.0.1` | Interface for the dashboard port |
| `PORTTA_DASHBOARD_PORT` | `8080` | Host port |
| `PORTTA_DASHBOARD_EXPOSE` | `local` | `local` publishes `:8080` on loopback. `domain` is refused: see below |
| `PORTTA_DASHBOARD_ADVERTISED_HOST` | `<project>-traefik.<domain>` | Hostname for the routed dashboard; derived, never hardcoded |

The loopback path exposes your full routing table on its own port, never
through `web`/`websecure`, so it can never appear under the public wildcard
domain. `doctor` still fails if that port is bound anywhere but loopback.

`PORTTA_DASHBOARD_EXPOSE=domain` is refused. It borrowed the panel's BasicAuth
credential, and the panel signs people in itself now
([ADR 0035](adr/0035-authentication-lives-in-the-panel.md)); the dashboard has no
credential of its own, and an unprotected view of every route on the host is not
something to warn about. Loopback is where it belongs.

## Databases by hostname

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_TCP` | `false` | Publish one entrypoint per protocol and route on the hostname |
| `PORTTA_TCP_POSTGRES_PORT` | `5432` | Host port for the PostgreSQL entrypoint |
| `PORTTA_TCP_REDIS_PORT` | `6379` | Host port for the Redis entrypoint |

Off by default, and opt-in twice: the gateway publishes the entrypoints, and a
project's datastore has to carry the router labels before anything routes to
it. Refused on the `remote-public` profile. TLS is required, because the
hostname travels in the TLS handshake. PostgreSQL and Redis work; MySQL cannot.
See [tcp-routing.md](tcp-routing.md).

## Web panel

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_WEB` | `false` | Start the administration panel with the gateway |
| `PORTTA_WEB_BIND_ADDRESS` | `127.0.0.1` | Interface the panel is published on |
| `PORTTA_WEB_PORT` | `8081` | Host port |
| `PORTTA_WEB_EXPOSE` | `local` | `local`, `tailscale`, `public`, `vpn`, or `domain` to route it on the gateway's domain over HTTPS |
| `PORTTA_PANEL_ADVERTISED_HOST` | derived | The hostname `domain` routes on, and the address a human types |
| `PORTTA_WEB_HOST` | `portta-web` | Hostname label used by `vpn` |
| `PORTTA_WEB_READ_ONLY` | `false` | Refuse every mutating endpoint, whoever signed in |
| `PORTTA_AUTH_MODE` | `disabled` | `disabled` answers everybody as the local operator and is allowed only on loopback; `required` makes people sign in |
| `PORTTA_PANEL_URL` | `http://127.0.0.1:<port>` | The origin a browser reaches the panel on. Decides where sign-in redirects to and whether the session cookie may be `Secure` |
| `PORTTA_PANEL_TRUSTED_ORIGINS` | empty | Other origins a browser may sign in from, comma-separated. Loopback and the panel URL are always trusted |
| `PORTTA_AUTH_SIGNIN_ATTEMPTS` | `5` | Sign-in attempts one address gets every ten minutes. 3–100; anything else reads as the default |
| `PORTTA_WEB_DEV` | `false` | Development mode: bind-mounted panel and ForwardAuth sources reload on change; the dev image only supplies dependencies |
| `PORTTA_WEB_NETWORK` | `portta-web` | The panel's own internal control network |
| `PORTTA_WEB_USER` | owner of `.env` | User the panel container runs as, so Settings can save |
| `PORTTA_APPLY` | `false` | Prepare the applier the panel may start to run `portta up` ([ADR 0026](adr/0026-applying-settings-from-the-panel.md)) |
| `PORTTA_RUNNER` | `false` | Prepare the project runner the panel may start to drive Compose for one project ([ADR 0030](adr/0030-the-panel-and-a-project-lifecycle.md)) |
| `PORTTA_PROJECTS_HOME` | `~/projects` (`/srv/projects` as root) | Projects Home, the directory managed Projects live under. `portta repos scan` reads it on the host; the panel only receives the path as a string to classify locations, and never mounts it ([ADR 0031](adr/0031-projects-home-and-project.md)) |
| `PORTTA_DB_NETWORK` | `portta-data` | Internal panel-to-PostgreSQL network |
| `PORTTA_DB_VOLUME` | `portta-db` | Named volume holding panel data |
| `PORTTA_RUNTIME_DB_PASSWORD` | generated | **Secret.** Panel PostgreSQL credential |
| `PORTTA_RUNTIME_DB_MODE` | `managed` | `managed` selects the private Compose database; `external` requires the URL below |
| `PORTTA_RUNTIME_DB_NAME` | `portta` | Database initialized in a fresh managed volume |
| `PORTTA_RUNTIME_DB_USER` | `portta` | Role initialized in a fresh managed volume |
| `PORTTA_RUNTIME_DATABASE_URL` | empty | Explicit external connection URL; rejected when set in managed mode |
| `PORTTA_AUTH_SECRET` | generated | **Secret.** Signs the panel's sessions and tokens, and the ForwardAuth process's host-scoped cookies. Rotating it signs everybody out of both |
| `PORTTA_AUTH_IMAGE` | Portta release image | Image running the isolated auth process |
| `PORTTA_RUNTIME_DOCS` | `true` | Serve this documentation at `/docs`, from the panel image. Static text with no host information in it, so a routed panel may serve it |
| `PORTTA_RUNTIME_API_DOCS` | empty | Serve the API reference and its console at `/docs/api`. Empty means the safe default: on for loopback, off when routed |

The panel binds loopback by default, and `PORTTA_AUTH_MODE=disabled` is only
allowed there: reaching a loopback panel already means having the machine, which
is true of nothing else, so the panel refuses to start rather than warn. Every
other access mode — `tailscale`, `public`, `vpn`, `domain` — requires
`required`, and `vpn` is refused on the `remote-public` profile. On a Linux host set `PORTTA_WEB_USER` to
`$(id -u):$(id -g)` if you want the Settings page to be able to write `.env`.

`portta web up` sets these for you and generates the database credential and the
signing secret without printing either. PostgreSQL publishes no host port and is
a boot dependency: the panel remembers everything there, including who its users
are. See [web-ui.md](web-ui.md), [authentication.md](authentication.md) and
[persistence.md](persistence.md).

## TLS

| Variable | Default | Meaning |
|---|---|---|
| `TLS_ENABLED` | `false` | Master switch for HTTPS |
| `TLS_MODE` | `local` | `local` (local CA) or `acme` (Let's Encrypt) |
| `ACME_EMAIL` | — | Required when `TLS_MODE=acme` |
| `ACME_CA_SERVER` | production LE | Point at staging while testing |
| `ACME_CHALLENGE` | `dns` | `dns` (one wildcard, needs a credential) or `http` (one per hostname, needs `:80`) |
| `ACME_DNS_PROVIDER` | `cloudflare` | lego provider name for DNS-01 |
| `ACME_DNS_RESOLVERS` | `1.1.1.1:53,8.8.8.8:53` | Propagation checks |

Wildcard certificates require DNS-01; HTTP-01 cannot issue them, which is why
`dns` is the default. A public gateway that would rather not hold a DNS
credential can set `ACME_CHALLENGE=http` and get a certificate per hostname
instead — see [DNS and TLS](dns-and-tls.md). Use `ACME_CA_SERVER` with the
staging endpoint while you get either working, because Let's Encrypt rate
limits are unforgiving.

## Private access

| Variable | Default | Meaning |
|---|---|---|
| `TAILSCALE_ENABLED` | `false` | Run the Tailscale component |
| `TAILSCALE_HOSTNAME` | `portta` | Node name on the tailnet |
| `TS_AUTHKEY` | — | **Secret.** Prefer an ephemeral, tagged, pre-authorized key |
| `TS_EXTRA_ARGS` | — | Extra flags for `tailscale up` |
| `PRIVATE_DOMAIN` | — | Wildcard namespace served over the VPN |

## Public access

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_ENABLED` | `false` | Opt in to internet exposure |
| `PUBLIC_DOMAIN` | — | Public wildcard, e.g. `dev.example.com` |

Off by default and deliberately awkward to turn on. `portta public enable`
prints exactly what will become reachable and asks for confirmation.

## Cloudflare

| Variable | Default | Meaning |
|---|---|---|
| `CLOUDFLARE_ENABLED` | `false` | Use Cloudflare for DNS-01 |
| `CF_DNS_API_TOKEN` | — | **Secret.** Scoped API Token |
| `CLOUDFLARE_ZONE` | — | Target zone |

Use a scoped token with `Zone:DNS:Edit` on the one zone. Never the Global API
Key, which authenticates everything in the account and cannot be scoped.

## Secrets

`.env` is git-ignored, `bootstrap` writes it `0600`, `inspect` prints `<set>`
rather than values, and lint fails on tracked auth keys or private keys. Gateway
state, including ACME material, lives under `state/`, which is also ignored.

## Host metrics

`portta host collect` writes `state/metrics/current.json` on the host. The
panel only reads that file — it cannot see the real machine from inside its
container, and it never calls `systeminformation`. `portta up` and
`portta web up` start a detached watcher that refreshes the snapshot every
five seconds. See [Host metrics](host-metrics.md).

There is no operator setting for collection. The panel's
`PORTTA_RUNTIME_METRICS_DIR` is the mount path inside the container
(default `/app/state/metrics`).
