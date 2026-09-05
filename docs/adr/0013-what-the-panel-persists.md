# 0013. The panel persists decisions, never observations

**Status:** Accepted, amended by [0037](0037-drizzle-and-a-required-database.md) — the database is no longer optional, and the panel refuses to start without it

## Context

The panel has an optional PostgreSQL database. Before persistence, `.env` was
the only durable configuration and Docker, Git and Traefik were the live
sources. A database makes preferences, project metadata and integrations
possible, but it must not become a second inventory or a place to copy a
consumer project's configuration.

The implementation landed in advance of this record. This ADR therefore both
states the boundary and audits the schema, repositories and degraded behavior
delivered by issue #4.

## Decision

> A value stays in `.env` if something needs it before the panel's first query,
> or if changing it requires recreating a container. Everything else that
> belongs to the gateway may live in PostgreSQL. Nothing that belongs to a
> consumer project lives in either.

The shorter review rule is: **persist a decision, never an observation**. If
Docker, Git or Traefik can answer a fact now, the panel asks that owner rather
than storing a copy. The panel may also cache what a remote source of truth
owns, provided every projected row records origin and age, the UI shows that
age, and nothing cached is ever the only copy. That third category is empty
today; [ADR 0018](0018-github-access-lives-in-the-panel.md) is what may fill
it.

### The three buckets

1. **Bootstrap and infrastructure:** values needed by the CLI, Compose,
   Traefik, Tailscale or the panel before PostgreSQL is reachable. They remain
   in `.env`; secrets remain there too.
2. **Gateway-owned durable decisions:** preferences, annotations, portable
   project coordinates and integration bindings. They may live in PostgreSQL
   behind a closed, typed catalogue.
3. **Consumer-project configuration:** application environment variables,
   credentials, framework settings and application database configuration.
   The gateway neither reads nor stores these.

## Current `.env` classification

The inventory on 2026-09-01 contains 51 active keys. All are bucket 1 because
they affect bootstrap, container construction, static routing or credentials.
This table is the worked example; the rule above governs new keys.

| Key | Reason it remains in `.env` |
|---|---|
| `PORTTA_PROFILE` | The CLI selects the Compose attachment and exposure policy before the panel starts. |
| `PORTTA_PROJECT_NAME` | Compose uses it to name and find the gateway's own resources. |
| `PORTTA_NETWORK` | Compose and bootstrap create and attach the shared HTTP network. |
| `PORTTA_CONTROL_NETWORK` | Compose creates the private Traefik-to-proxy network. |
| `PORTTA_ACCESS_NETWORK` | Compose and the CLI attach temporary and persistent TCP bridges to it. |
| `PORTTA_LOG_LEVEL` | Component logging is injected when containers are created. |
| `PORTTA_ACCESS_LOG` | Traefik access logging is static startup configuration. |
| `PORTTA_ALIAS_HEADERS_STRATEGY` | Traefik's request-header defense is selected before it starts. |
| `PORTTA_DOMAIN` | The CLI and Traefik derive routing names from it at startup. |
| `PORTTA_BIND_ADDRESS` | Compose publishes entrypoints on this host interface. |
| `PORTTA_HTTP_PORT` | Compose publishes Traefik's HTTP entrypoint with this port. |
| `PORTTA_HTTPS_PORT` | Compose publishes Traefik's HTTPS entrypoint with this port. |
| `PORTTA_DASHBOARD` | Compose decides whether to enable and publish the dashboard. |
| `PORTTA_DASHBOARD_BIND_ADDRESS` | Compose binds the optional dashboard before the panel can query anything. |
| `PORTTA_DASHBOARD_PORT` | Compose publishes the optional dashboard on this host port. |
| `PORTTA_DASHBOARD_EXPOSE` | Compose chooses the loopback overlay or the domain overlay. |
| `PORTTA_DASHBOARD_ADVERTISED_HOST` | Traefik's dashboard router is generated from this hostname. |
| `PORTTA_TCP` | Compose decides whether hostname-routed TCP entrypoints exist. |
| `PORTTA_TCP_POSTGRES_PORT` | Compose publishes the PostgreSQL entrypoint at container creation. |
| `PORTTA_TCP_REDIS_PORT` | Compose publishes the Redis entrypoint at container creation. |
| `PORTTA_WEB` | The CLI decides whether the optional panel stack starts. |
| `PORTTA_WEB_BIND_ADDRESS` | Compose publishes the panel on this host interface. |
| `PORTTA_WEB_PORT` | Compose publishes the panel on this host port. |
| `PORTTA_WEB_EXPOSE` | The CLI and Compose choose loopback-only or VPN routing before startup. |
| `PORTTA_WEB_HOST` | Traefik's panel router is generated from this startup hostname. |
| `PORTTA_WEB_READ_ONLY` | The mutation boundary must exist when the panel process starts. |
| `PORTTA_WEB_AUTH` | Compose and generated Traefik middleware select authentication before routing. |
| `PORTTA_WEB_AUTH_USER` | Traefik BasicAuth needs the user before the panel is reachable. |
| `PORTTA_WEB_AUTH_HASH` | This authentication secret is consumed by Traefik and never returned by the API. |
| `PORTTA_RUNTIME_API_DOCS` | The API reference and its console are mounted at panel startup, including the routed default. |
| `PORTTA_RUNTIME_DOCS` | The documentation routes are mounted at panel startup, before the SPA's catch-all. |
| `PORTTA_DB_NETWORK` | Compose must create the private data network before PostgreSQL or the panel starts. |
| `PORTTA_DB_VOLUME` | Compose selects the durable volume before PostgreSQL starts. |
| `PORTTA_RUNTIME_DB_PASSWORD` | This bootstrap secret is needed to start PostgreSQL and construct the panel connection. |
| `PORTTA_RUNTIME_DATABASE_URL` | The panel needs its optional connection string before its first database query. |
| `PORTTA_WEB_DEV` | The CLI chooses the development Compose overlay before starting containers. |
| `PORTTA_WEB_DEV_PORT` | The development Vite container publishes this port at creation. |
| `PORTTA_WEB_NETWORK` | Compose creates the private panel-to-proxy control network. |
| `TLS_ENABLED` | Traefik entrypoints and routers are constructed from this startup switch. |
| `TLS_MODE` | The CLI and Traefik choose local certificates or ACME before startup. |
| `ACME_EMAIL` | Traefik needs the ACME account identity before requesting a certificate. |
| `ACME_CA_SERVER` | Traefik's certificate resolver is static startup configuration. |
| `ACME_DNS_PROVIDER` | Traefik selects the DNS-01 provider at startup. |
| `ACME_DNS_RESOLVERS` | Traefik configures DNS-01 propagation checks at startup. |
| `TAILSCALE_ENABLED` | Compose chooses the Tailscale network-namespace attachment before startup. |
| `TAILSCALE_HOSTNAME` | The Tailscale node takes this identity when its container starts. |
| `TS_AUTHKEY` | Tailscale needs this bootstrap credential before joining the tailnet. |
| `TS_EXTRA_ARGS` | Compose passes these advanced startup arguments directly to Tailscale. |
| `PRIVATE_DOMAIN` | The CLI and Traefik derive private-profile routes from it. |
| `PUBLIC_ENABLED` | The CLI and Compose decide whether internet-facing entrypoints may start. |
| `PUBLIC_DOMAIN` | The public Traefik routing namespace is built from it. |
| `CLOUDFLARE_ENABLED` | Bootstrap and routing decide whether the Cloudflare integration is active. |
| `CF_DNS_API_TOKEN` | Traefik needs this scoped DNS credential before ACME can run. |
| `CLOUDFLARE_ZONE` | DNS validation and diagnostics need the zone before routing starts. |

The cross-check found 44 `portta_defaults()` entries and 32 `FIELDS` entries.
Seven keys deliberately have no CLI default because empty means unset or they
are conditional input: `ACME_EMAIL`, `CF_DNS_API_TOKEN`, `CLOUDFLARE_ZONE`,
`PRIVATE_DOMAIN`, `PUBLIC_DOMAIN`, `TS_AUTHKEY` and `TS_EXTRA_ARGS`.

Nineteen infrastructure keys are intentionally absent from `FIELDS`; the
Settings API is a smaller editing capability than `.env`. `TS_EXTRA_ARGS` is
the only key in neither catalogue: Compose itself applies the empty default,
and the panel must not offer arbitrary Tailscale command arguments as a form
field. This is intentional, not an unowned setting.

## What PostgreSQL may hold

- a stable gateway instance identity;
- the local Compose environment identity plus nullable portable repository
  coordinates and display metadata;
- closed, typed global, project and service preferences;
- gateway-owned integration bindings and non-secret configuration.

Credentials remain bootstrap secrets in `.env`. An integration row may point
to a credential by a declared environment key, but must not copy a consumer
project secret or accept arbitrary JSON from an API. A repository or route
must use a typed catalogue before it writes any settings or integration data.

## What PostgreSQL never holds

| Never stored as source of truth | Live owner |
|---|---|
| Container state, health, uptime and exit codes | Docker Engine container inspection |
| Published or exposed ports, networks and mounts | Docker Engine container and network inspection |
| Derived URLs and default hostnames | Docker labels interpreted by `urlsFor()` using Traefik's naming rule |
| Routers, services and middlewares currently active | Traefik API |
| Git branch, commit, dirty state and forge status | Host-collected Git snapshot from ADR 0010 |
| Project environment variables, credentials and database configuration | The consumer project's own configuration |
| Log lines | Docker's live log stream |
| Metrics and time series | Docker's live stats response; historical metrics remain out of scope |

The database may remember that an environment was seen and what the gateway's
operator decided about it. It may not claim that an absent container is
running or preserve a stale route as current reality.

## Project identity and worktrees

`COMPOSE_PROJECT_NAME` is the external identity of an environment, as decided
by [ADR 0006](0006-compose-project-name-as-namespace.md). The relational model
uses `projects.id` as its stable internal anchor and enforces a unique
`projects.compose_project` value. `working_dir`, `repo_url`, `repo_subpath` and
`slug` are nullable coordinates for display and later matching; none replaces
the Compose namespace as the local identity.

Removing containers does not delete the row. It becomes known-but-absent until
the same Compose namespace is observed again. Renaming the namespace creates a
new environment identity. Likewise, two worktrees using distinct Compose
project names receive distinct rows and do not inherit each other's aliases or
preferences, even when `repo_url` and `repo_subpath` match. That prevents
parallel worktrees from fighting over one route.

## CLI and panel agreement

The CLI does not query PostgreSQL. Both surfaces continue to agree on facts
read from Docker and Traefik. Panel-only preferences and metadata are not
shown by the CLI, so there is no parity claim for them.

Any persisted preference that changes routing, beginning with the alias work
planned by issue #5, must also materialize the bounded generated Traefik file.
The CLI reads that routing artifact rather than the database. Documentation
must say that live routing is shared; it must not claim that the CLI and panel
can never disagree about panel-only data.

## Degraded operation

PostgreSQL is a soft dependency. If it is absent or becomes unreachable, the
panel still starts and serves health, Docker inventory, services, network,
access, gateway, configuration and OpenAPI endpoints. Overview and diagnostics
report persistence as a warning. A future operation that actually needs a
durable decision returns a clear 503, and the next inventory cycle retries
migrations and project recording after recovery.

## Entity model and future task-board seam

The audited model is:

```text
instance          (UUID id, singleton, name, timestamps)
projects          (id, unique compose_project, portable coordinates,
                   display metadata, first_seen_at, last_seen_at, updated_at)
settings          (typed key, JSON value, updated_at)
project_settings  (project_id, typed key, JSON value, updated_at)
service_settings  (project_id, service, typed key, JSON value, updated_at)
integrations      (kind, optional project_id, typed config, updated_at)
schema_migrations (version, applied_at)
```

A future task board attaches to the stable `projects.id` foreign key. The task
schema, workflow and UI are explicitly out of scope here; no task table is
created by this decision.

## Audit of the issue #4 implementation

The delivered migration and repositories conform to this ADR:

- `instance.id` is a generated UUID and `projects.id` is the durable relational
  anchor; Compose identity and nullable repository coordinates are present;
- project rows are upserted by Compose namespace and never deleted merely
  because Docker no longer reports the environment;
- setting writes pass through Zod catalogues and reject unknown keys before a
  database call;
- every decision table has `updated_at`, while the schema has no container,
  route, health, port, network, log or metrics table;
- PostgreSQL runs without a host port on its own internal network, and startup
  failure leaves existing read surfaces available with retry on recovery.

The generic `integrations.config` column has no writer yet. Before issue #5 or
another feature uses it, that feature must add a closed schema, avoid secrets
and document any routing artifact it materializes. New HTTP endpoints must
also join the OpenAPI contract and regenerate `apps/web/openapi.json` in the same
change.

## Consequences

- Core inventory remains correct when PostgreSQL is stale or unavailable.
- Infrastructure changes still require `.env` plus the documented restart.
- Parallel worktrees remain isolated by their Compose namespaces.
- Durable features need a typed key or integration catalogue, not a generic
  write endpoint.
- Routing decisions have two representations for different purposes: the
  durable decision in PostgreSQL and the generated Traefik artifact consumed
  as live routing configuration. Drift checks must compare them when issue #5
  implements that surface.
- The three buckets above classify *where a value lives*.
  [ADR 0016](0016-state-that-could-be-shared.md) classifies *whether a value
  could ever travel between two gateways*. They agree: observations stay
  with their live owner, and only project and user decisions are eligible.
