# Configuration and startup audit

This revision makes `.env.example` the structural template and `.env` the source
of installation values. No secret values are recorded here.

## Architecture found

| Entrypoint/component | Responsibility and dependencies |
| --- | --- |
| `install.sh` | Downloads runtime files/images; uses the shared zero-Node adapter, then resolves Compose. Preserves configured values and scopes database lookups to its Compose project. |
| `bin/portta` | Dispatches to the bundled TypeScript CLI; Bash remains for bootstrap/lifecycle on hosts without Node. |
| `bootstrap`, `setup`, `dev`, `up`, `web up` | Prepare the environment before starting services. `config prepare` performs only configuration preparation. |
| CLI / panel APIs | Share the Core editor; configuration and tunnel routes no longer implement separate file writers. |
| `justfile` | Delegates to the CLI, including explicit local-release selection. |
| `socket-proxy` → Traefik | Filtered Docker discovery over the internal control network. Traefik waits for the proxy healthcheck. |
| `web-socket-proxy` → web | Restricted Docker operations over the internal web control network; the panel waits for proxy health. |
| `db` → web | PostgreSQL 18.6, private data network, persistent named volume, no host port. TCP readiness precedes authenticated connection and migrations. |
| `portta-auth` / `portta-auth-migrate` | ForwardAuth and its explicit one-shot store preparation. Shared signing secret comes from `.env`; application state remains in `state/auth`. |
| Tailscale / Cloudflare Tunnel | Optional attachment/connector with existing real healthchecks. Traefik waits for Tailscale; the tunnel waits for Traefik. |
| Applier / runner / toolbox | Operational containers outside the Compose service list; use the installation root and the same fallback contract. They are not new databases or queues. |

Compose remains split into base, attachment, profile and feature overlays.
Development adds source bind mounts and Next.js hot reload in the same panel
container. Production uses the runtime image; both receive the same database and
shared configuration. HTTP/HTTPS and panel publication remain profile-controlled.
The installation retains existing network/volume names; validation used unique
names and never published PostgreSQL or the panel.

No Redis, S3 or queue is required by Portta itself. Redis/PostgreSQL/MySQL access
features concern consumer projects, whose configuration belongs to those projects.
The `docker/examples/*/.env.example`, E2E fixtures and worktree overlay are scoped
templates, not alternate installation templates. External test database URLs now
explicitly select external mode; the E2E suites were not executed.

## Environment files before the revision

The local template had **71 active keys** and `.env` had **53**. There were 25
keys only in the template and seven only in `.env`. The local file lacked newer
panel, domain, TCP, GitHub and database groups; commands had appended later values
after the older layout. `.env.example` also contained a Vite port no longer used
by the single-process Next.js panel.

Only in the former `.env`: `PORTTA_AUTH_USER`, `PORTTA_WEB_USER`,
`PORTTA_PROJECTS_HOME`, `PORTTA_DASHBOARD_ADVERTISED_HOST`, and the retired
`PORTTA_WEB_AUTH`, `PORTTA_WEB_AUTH_USER`, `PORTTA_WEB_AUTH_HASH`.

Only in the former template: `ACME_CHALLENGE`, `GITHUB_API_URL`, `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY_FILE`, `GITHUB_APP_WEBHOOK_SECRET`,
`GITHUB_SYNC_INTERVAL_MINUTES`, `PORTTA_ALIAS_HEADERS_STRATEGY`,
`PORTTA_AUTH_SIGNIN_ATTEMPTS`, `PORTTA_DB_NETWORK`, `PORTTA_DB_VOLUME`,
`PORTTA_DOMAIN_MODE`, `PORTTA_PANEL_ADVERTISED_HOST`,
`PORTTA_PANEL_TRUSTED_ORIGINS`, `PORTTA_PUBLIC_IP`, `PORTTA_RUNTIME_API_DOCS`,
`PORTTA_RUNTIME_DATABASE_URL`, `PORTTA_RUNTIME_DOCS`, `PORTTA_TCP`,
`PORTTA_TCP_POSTGRES_PORT`, `PORTTA_TCP_REDIS_PORT`, `PORTTA_WEB_BIND_ADDRESS`,
`PORTTA_WEB_DEV_PORT`, `PORTTA_WEB_HOST`, `PORTTA_WEB_NETWORK`, `PORTTA_WEB_PORT`.

The resulting template and local `.env` have **82 active keys in identical
order**. Local values were retained and `.env.before-structure` holds the private
backup. Personal comments remain in a marked trailing section; the canonical
configuration section follows the template. The existing edit of `PORTTA_RUNNER`
in `.env.example` and unrelated `docs/research/` files were preserved.

## Variable decisions

All rows below are active, used installation variables. “Added” means added to
the canonical template, including existing variables previously omitted there.
Consumer paths are evidence of use, not an exhaustive reference list.

| Variable | Decision | Consumers |
| --- | --- | --- |
| `PORTTA_PROFILE` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/apply.ts` |
| `PORTTA_PROJECT_NAME` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_PROJECTS_HOME` | Added | `docker/compose/features/web.yaml`, `install.sh` |
| `PORTTA_NETWORK` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_CONTROL_NETWORK` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_ACCESS_NETWORK` | Retained | `docker/compose/features/tcp-tailscale.yaml`, `docker/compose/features/tcp.yaml` |
| `PORTTA_LOG_LEVEL` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_ACCESS_LOG` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_ALIAS_HEADERS_STRATEGY` | Retained | `docker/compose/compose.yaml`, `docker/compose/profiles/public.yaml` |
| `PORTTA_DOMAIN_MODE` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/capabilities.ts` |
| `PORTTA_PUBLIC_IP` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `PORTTA_AUTO_DOMAIN_PROVIDER` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `PORTTA_DOMAIN` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web-vpn.yaml` |
| `PORTTA_BIND_ADDRESS` | Retained | `docker/compose/attach/host.yaml`, `docker/compose/attach/tailscale.yaml` |
| `PORTTA_HTTP_PORT` | Retained | `docker/compose/attach/host.yaml`, `docker/compose/attach/tailscale.yaml` |
| `PORTTA_HTTPS_PORT` | Retained | `docker/compose/attach/host.yaml`, `docker/compose/attach/tailscale.yaml` |
| `PORTTA_DASHBOARD` | Retained | `docker/compose/features/dashboard-domain.yaml`, `docker/compose/features/dashboard-tailscale.yaml` |
| `PORTTA_DASHBOARD_BIND_ADDRESS` | Retained | `docker/compose/features/dashboard-tailscale.yaml`, `docker/compose/features/dashboard.yaml` |
| `PORTTA_DASHBOARD_PORT` | Retained | `docker/compose/features/dashboard-tailscale.yaml`, `docker/compose/features/dashboard.yaml` |
| `PORTTA_DASHBOARD_EXPOSE` | Retained | `docker/compose/features/dashboard-domain.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_DASHBOARD_ADVERTISED_HOST` | Added | `docker/compose/features/dashboard-domain.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_TCP` | Retained | `docker/compose/features/tcp-tailscale.yaml`, `docker/compose/features/tcp.yaml` |
| `PORTTA_TCP_POSTGRES_PORT` | Retained | `docker/compose/features/tcp-tailscale.yaml`, `docker/compose/features/tcp.yaml` |
| `PORTTA_TCP_REDIS_PORT` | Retained | `docker/compose/features/tcp-tailscale.yaml`, `docker/compose/features/tcp.yaml` |
| `PORTTA_WEB` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/auth-build.yaml` |
| `PORTTA_WEB_BIND_ADDRESS` | Retained | `docker/compose/features/panel-public.yaml`, `docker/compose/features/web-bind.yaml` |
| `PORTTA_WEB_PORT` | Retained | `docker/compose/features/panel-public.yaml`, `docker/compose/features/web-bind.yaml` |
| `PORTTA_WEB_EXPOSE` | Retained | `docker/compose/features/panel-domain.yaml`, `docker/compose/features/panel-public.yaml` |
| `PORTTA_WEB_HOST` | Retained | `docker/compose/features/web-vpn.yaml`, `packages/core/src/config.ts` |
| `PORTTA_PANEL_ADVERTISED_HOST` | Retained | `docker/compose/features/panel-domain.yaml`, `docker/compose/features/panel-webhook.yaml` |
| `PORTTA_WEB_READ_ONLY` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `PORTTA_AUTH_MODE` | Retained | `docker/compose/features/panel-domain.yaml`, `docker/compose/features/panel-public.yaml` |
| `PORTTA_AUTH_SECRET` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_PANEL_URL` | Retained | `docker/compose/features/web.yaml`, `install.sh` |
| `PORTTA_PANEL_TRUSTED_ORIGINS` | Retained | `docker/compose/features/web.yaml`, `packages/auth/src/security-mode.ts` |
| `PORTTA_AUTH_SIGNIN_ATTEMPTS` | Retained | `docker/compose/features/web.yaml`, `packages/auth/src/security-mode.ts` |
| `PORTTA_RUNTIME_DOCS` | Retained | `docker/compose/features/web.yaml`, `packages/server/src/config.ts` |
| `PORTTA_RUNTIME_API_DOCS` | Retained | `docker/compose/features/web.yaml`, `packages/server/src/config.ts` |
| `PORTTA_DB_NETWORK` | Retained | `docker/compose/features/db.yaml`, `packages/core/src/config.ts` |
| `PORTTA_DB_VOLUME` | Retained | `docker/compose/features/db.yaml`, `packages/cli/src/commands/lifecycle.ts` |
| `PORTTA_RUNTIME_DB_MODE` | Added | `docker/compose/features/web.yaml`, `packages/core/src/database-config.ts` |
| `PORTTA_RUNTIME_DB_NAME` | Added | `docker/compose/features/db.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_RUNTIME_DB_USER` | Added | `docker/compose/features/db.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_RUNTIME_DB_PASSWORD` | Retained | `docker/compose/features/db.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_RUNTIME_DATABASE_URL` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/database-config.ts` |
| `PORTTA_WEB_IMAGE` | Retained | `docker/compose/features/web-build.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_AUTH_IMAGE` | Retained | `docker/compose/compose.yaml`, `docker/compose/features/auth-build.yaml` |
| `PORTTA_WEB_BUILD` | Retained | `docker/compose/features/auth-build.yaml`, `docker/compose/features/web-build.yaml` |
| `PORTTA_WEB_DEV` | Retained | `docker/compose/features/web-dev.yaml`, `packages/core/src/apply.ts` |
| `PORTTA_WEB_NETWORK` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `PORTTA_WEB_USER` | Added | `docker/compose/compose.yaml`, `docker/compose/features/web.yaml` |
| `PORTTA_AUTH_USER` | Added | `docker/compose/compose.yaml`, `packages/core/src/env.ts` |
| `PORTTA_APPLY` | Retained | `packages/core/src/apply.ts`, `bin/portta` |
| `PORTTA_RUNNER` | Retained | `packages/cli/src/commands/lifecycle.ts`, `packages/cli/src/commands/projects.ts` |
| `TLS_ENABLED` | Retained | `docker/compose/features/web.yaml`, `docker/compose/profiles/local-tls.yaml` |
| `TLS_MODE` | Retained | `docker/compose/features/web.yaml`, `docker/compose/profiles/local-tls.yaml` |
| `ACME_EMAIL` | Retained | `docker/compose/features/web.yaml`, `docker/compose/profiles/remote-tls.yaml` |
| `ACME_CHALLENGE` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `ACME_CA_SERVER` | Retained | `docker/compose/features/web.yaml`, `docker/compose/profiles/remote-tls.yaml` |
| `ACME_DNS_PROVIDER` | Retained | `docker/compose/features/web.yaml`, `docker/compose/profiles/remote-tls-dns.yaml` |
| `ACME_DNS_RESOLVERS` | Retained | `docker/compose/features/web.yaml`, `docker/compose/profiles/remote-tls-dns.yaml` |
| `TAILSCALE_ENABLED` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `TAILSCALE_HOSTNAME` | Retained | `docker/compose/attach/tailscale.yaml`, `docker/compose/features/web.yaml` |
| `TS_AUTHKEY` | Retained | `docker/compose/attach/tailscale.yaml`, `bin/portta` |
| `TS_EXTRA_ARGS` | Retained | `docker/compose/attach/tailscale.yaml` |
| `PRIVATE_DOMAIN` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `PUBLIC_ENABLED` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `PUBLIC_DOMAIN` | Retained | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `CLOUDFLARE_ENABLED` | Retained | `docker/compose/features/web.yaml`, `bin/portta` |
| `CF_DNS_API_TOKEN` | Retained | `docker/compose/profiles/remote-tls-dns.yaml`, `bin/portta` |
| `CLOUDFLARE_ZONE` | Retained | `docker/compose/features/web.yaml`, `packages/cli/src/commands/network.ts` |
| `GITHUB_APP_ENABLED` | Retained | `docker/compose/features/panel-webhook.yaml`, `docker/compose/features/web.yaml` |
| `GITHUB_APP_ID` | Retained | `docker/compose/features/web.yaml`, `packages/cli/src/doctor.ts` |
| `GITHUB_APP_PRIVATE_KEY_FILE` | Retained | `docker/compose/features/web.yaml`, `packages/cli/src/doctor.ts` |
| `GITHUB_APP_WEBHOOK_SECRET` | Retained | `docker/compose/features/web.yaml`, `packages/cli/src/commands/config.ts` |
| `GITHUB_API_URL` | Retained | `docker/compose/features/web.yaml`, `packages/cli/src/doctor.ts` |
| `GITHUB_SYNC_INTERVAL_MINUTES` | Retained | `docker/compose/features/web.yaml`, `apps/web/server/main.ts` |
| `CLOUDFLARE_TUNNEL_ENABLED` | Added | `docker/compose/features/cloudflare-tunnel.yaml`, `docker/compose/features/web.yaml` |
| `CLOUDFLARE_TUNNEL_ZONE` | Added | `docker/compose/features/web.yaml`, `packages/core/src/config.ts` |
| `CLOUDFLARE_TUNNEL_ID` | Added | `packages/cli/src/commands/tunnel.ts`, `packages/server/src/api/routes/tunnel.ts` |
| `PORTTA_CLOUDFLARED_IMAGE` | Added | `docker/compose/features/cloudflare-tunnel.yaml`, `scripts/lib/common.sh` |
| `PORTTA_RUNTIME_TRAEFIK_API` | Added | `docker/compose/features/web.yaml`, `packages/server/src/config.ts` |

Removed active keys:

- `PORTTA_WEB_DEV_PORT`: only historical Vite documentation referenced it; no
  current Compose, process or command consumes it. The panel uses internal 8081.
- `PORTTA_WEB_AUTH`, `PORTTA_WEB_AUTH_USER`, `PORTTA_WEB_AUTH_HASH`: superseded by
  the panel's database-backed authentication (ADR 0035). Their remaining runtime
  references were obsolete diagnostics, not authentication consumers.

No variables were renamed, and no alias migration was introduced. Historical
ADRs remain historical. The explicitly retired names are removed only during
structural normalization, with a private backup; unknown extension keys remain.
No compatibility aliases are retained for a released installation because none
exists for this development revision.

`PORTTA_RUNTIME_DATABASE_URL` is retained **only for explicit external mode**.
Managed mode rejects a nonempty URL and derives it from `_DB_USER`, `_DB_NAME`
and `_DB_PASSWORD`. `POSTGRES_*` are container mappings, not separately editable
installation values. `PORTTA_VERSION` comes from `VERSION`; fixed runtime paths,
ports, socket-proxy allowlists and daemon/tool selectors remain runtime constants
or operational inputs rather than fake settings in the template.

## Mutation and validation contract

Updates use a shared parser and template-aware insertion. They retain unrelated
lines, whitespace, comments, line endings and the file inode. Normalization is
separate from ordinary value edits. Duplicates fail before writing. Host and
panel writers share a directory lock and recover interrupted writes from a
private backup. Both TypeScript and shell generate secrets only when needed.

Literal serialization is checked against Docker Compose as well as both Portta
parsers, including dollars, quotes and backslashes. The distinction between
single-quoted literal values and escaped double-quoted values follows the
[Compose dotenv rules](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

Validation results are recorded below after the final targeted runs. No full
suite, full E2E run or Playwright run is part of this revision's validation.

## Executed validation

Final results (only affected tests; repeated debugging runs are not added to the
counts):

| Validation | Result |
| --- | --- |
| Core: `env.test.ts`, `env-contract.test.ts`, `env-recovery.test.ts`, `database-config.test.ts`, `config.test.ts` | 39 passed |
| CLI: `context.test.ts`, `commands/web.test.ts`, `commands/lifecycle.test.ts`, `commands/setup.test.ts`, `commands/tunnel.test.ts`, `commands/tls.test.ts`, `local-release.test.ts` | 52 passed |
| Server: `settings.test.ts` | 49 passed |
| Web server dispatcher: `--project server` | 10 passed |
| Documentation collector: `--project docs` | 21 passed; checked after the production build exposed a documentation link written before its target file existed |
| Shell: `common.test.sh` | 43 passed |
| Shell: `install.test.sh` | 90 passed |
| Shell: `profiles.test.sh` | 134 passed |
| Shell: `templates.test.sh` | 71 passed |
| Shell: `web.test.sh` | 163 passed; refusal cases now use an isolated installation instead of the developer's `.env` |
| Workspace typechecks: Core, CLI, Server, Web | Passed |
| `openapi:check` | Passed; no wire schema changes |
| ShellCheck at the repository's warning level; shell/modified harness syntax; `git diff --check` | Passed |
| Compose literal serialization | 8 cases passed, including dollar signs, quotes and backslashes |
| Development, production and external Compose configuration | Passed |
| Production runtime image build | Passed |

The smoke installation was created under `/tmp` through the official
`portta config prepare` command, starting without `.env`. Its project, networks,
volume and image tag were unique. Only `db`, `web-socket-proxy` and `web` were
started; neither PostgreSQL nor the panel published a host port.

Verified in development and in the newly built production image:

- PostgreSQL TCP readiness, authenticated `select 1`, custom database/role and
  agreement between `.env`, database container and application container;
- the actual initial migration applied and panel health returned HTTP 200;
- a second preparation produced an identical `.env`;
- an API configuration patch changed only the requested value; the host writer
  restored the exact previous file, proving the shared file bind and lock work;
- container recreation retained credentials and a persisted test row;
- an intentionally wrong password prevented the HTTP listener from starting,
  while the original password still accessed the unchanged database and row;
  the development watcher remained alive, correctly distinguished from an
  available application;
- external mode started the production panel against an endpoint on the isolated
  test network with no managed database overlay; health returned HTTP 200;
- production used no application source bind mounts.

The backup directory issue found by the API smoke was corrected: backups now
live in the shared writable `.env-lock`, not the panel's unwritable parent.
The full OS installer was **not** run against the host; installer coverage was
its targeted audit plus the shared preparation fixtures and operational smoke.
No installed gateway or pre-existing volume was restarted or removed. Temporary
containers, networks, volume and the smoke image tag were removed after testing.
The local `.env` was rechecked against its original backup: zero persistent
values changed, and its canonical section matches `.env.example` apart from
values. Unrelated changes to `AGENTS.md`, `CLAUDE.md` and `docs/research/` were
left intact.

**A suíte completa de testes do Portta não foi executada nesta tarefa, conforme
solicitado, e será executada manualmente posteriormente.**
