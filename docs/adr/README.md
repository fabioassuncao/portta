# Architecture decision records

Short records of decisions that are expensive to reverse. Each states the
context, the decision, and what it costs us.

| # | Decision | Status |
|---|---|---|
| [0001](0001-decoupled-infrastructure.md) | The gateway is infrastructure, not a parent project | Accepted, amended by 0030 |
| [0002](0002-docker-socket-proxy.md) | Traefik reaches Docker through a filtered read-only proxy | Accepted |
| [0003](0003-traefik-static-config-via-env.md) | Traefik static configuration lives in environment variables | Accepted |
| [0004](0004-pinned-versions.md) | Every component image pins an explicit version | Accepted |
| [0005](0005-hostname-convention.md) | Hostnames are derived from the labels Compose already injects | Accepted, amended by 0023 |
| [0006](0006-compose-project-name-as-namespace.md) | `COMPOSE_PROJECT_NAME` is the namespace for parallel environments | Accepted |
| [0007](0007-tailscale-sidecar.md) | Traefik runs inside the Tailscale container's network namespace | Accepted |
| [0008](0008-web-panel-socket-proxy.md) | The web panel gets its own Docker socket proxy | Accepted |
| [0009](0009-tcp-routing-by-hostname.md) | Databases are told apart by hostname, with TLS terminated at the gateway | Accepted |
| [0010](0010-git-collected-on-the-host.md) | Git is collected on the host, and the panel only reads the result | Accepted, amended by 0018 |
| [0011](0011-panel-reads-traefik-writes-one-file.md) | The panel reads Traefik's API, and writes exactly four generated files | Accepted, amended by 0027 |
| [0012](0012-panel-authentication-is-traefiks.md) | The panel's authentication is Traefik's, and public stays refused | Superseded by 0027 |
| [0013](0013-what-the-panel-persists.md) | The panel persists decisions, never runtime observations | Accepted, amended by 0037 |
| [0014](0014-monorepo-and-the-typescript-cli.md) | The repository is a small npm workspace, with a shared core | Accepted, its script inventory superseded by 0029 |
| [0015](0015-node-on-the-host.md) | Node is not required for the core commands | Accepted |
| [0016](0016-state-that-could-be-shared.md) | State that could be shared, and what must never be | Accepted |
| [0017](0017-no-docker-sdk.md) | The panel speaks the Docker Engine API directly, without a general SDK | Accepted |
| [0018](0018-github-access-lives-in-the-panel.md) | GitHub access lives in the panel, through a GitHub App | Accepted |
| [0019](0019-compose-files-live-under-docker.md) | The compose files live under `docker/compose/`, one directory per axis | Accepted |
| [0020](0020-installer-and-portta-home.md) | Installing means one directory and published images, not a checkout | Accepted |
| [0021](0021-panel-access-modes.md) | Panel access is its own decision, and a public panel gets its own entrypoint | Accepted, amended by 0027 and 0035 |
| [0022](0022-project-domain-modes.md) | The base domain is a mode, and a host with no domain gets one from its address | Accepted |
| [0023](0023-flat-hostname-labels.md) | A service's whole name lives in one DNS label | Accepted, amends 0005 |
| [0024](0024-capabilities-providers-endpoints.md) | A service has endpoints, not an access mode | Accepted, amended 2026-09-02 |
| [0025](0025-cloudflare-tunnel.md) | One tunnel, one wildcard rule, and Traefik keeps routing | Accepted |
| [0026](0026-applying-settings-from-the-panel.md) | Applying settings from the panel is one opt-in container, outside the Compose project | Accepted, amends 0011 |
| [0027](0027-forward-authentication-service.md) | Protected HTTP access is checked by a separate ForwardAuth service | Accepted, supersedes 0012 and amends 0011/0021; amended by 0035 |
| [0028](0028-operational-images-live-under-docker.md) | Operational image contexts live under `docker/images/` | Accepted |
| [0029](0029-shell-only-for-bootstrap.md) | Shell is for bootstrap; TypeScript is the default | Accepted, supersedes 0014's script inventory |
| [0030](0030-the-panel-and-a-project-lifecycle.md) | The panel may operate a project, without owning it | Accepted, amends 0001 |
| [0031](0031-projects-home-and-project.md) | Projects Home, Project, and Environment | Accepted, amends 0006/0013/0016/0018/0020/0030 |
| [0032](0032-portta-development-model.md) | The Portta development model: Project, Repository, Task, Session, Activity | Accepted, amends 0010/0013/0018/0031; amended by 0038 |
| [0033](0033-tasks-are-local-issues.md) | Tasks are local issues with sparse board ranks and API credentials | Accepted, amends 0032 |
| [0034](0034-child-process-output.md) | A child process is never silent for long | Accepted |
| [0035](0035-authentication-lives-in-the-panel.md) | The panel authenticates its own requests | Accepted, supersedes 0012 for the panel and amends 0027 |
| [0036](0036-next-app-router-and-the-custom-server.md) | The panel is a Next application on a server of its own | Accepted, amends 0011 |
| [0037](0037-drizzle-and-a-required-database.md) | Drizzle, and a database the panel refuses to start without | Accepted, amends 0013 |
| [0038](0038-roles-and-project-access.md) | Four roles, and access by Project | Accepted, extends 0035, amends 0032 |
| [0039](0039-personal-api-tokens.md) | A token belongs to a person, and never exceeds them | Accepted, extends 0035, supersedes the panel tokens in 0033 |

- [0040 — Installation environment contract](0040-installation-environment-contract.md)
