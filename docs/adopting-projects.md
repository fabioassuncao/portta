# Adopting a project

Your project stays where it is, in its own repository, started from its own
directory. Adoption means adding one file to it.

## Start here

```bash
portta analyze /path/to/project
```

It reads the project and reports what adoption would take: every service and
what it looks like, the host ports it publishes and what already holds them,
fixed container names and whether the host already holds them, datastores that
are published, whether the namespace is implicit, and whether the namespace is
already in use by another checkout. It writes nothing. When the Compose file is
not `compose.yaml` in that directory, name it with `--file deploy/compose.yaml`
(relative to the path, or absolute): the file's directory becomes the project
directory, and `init --file` writes the overlay next to it.

Then generate the overlay:

```bash
portta init /path/to/project --project my-project
```

`--project` is optional. When supplied it writes `portta.project` on the
routed services, so several Compose namespaces (for example worktrees) can be
adopted by one logical Project without changing their isolation.

```bash
portta init /path/to/project --dry-run   # see the file first
portta init /path/to/project
```

`init` creates exactly one new file. It never edits `compose.yaml`, never
touches volumes or databases, shows you the file and a diff before writing, and
requires `--force` to overwrite (keeping a backup).

## The contract

A compatible project:

1. uses Docker and Compose v2;
2. sets a unique `COMPOSE_PROJECT_NAME`;
3. keeps its own private network;
4. declares `portta` as an external network;
5. attaches **only** its published HTTP services to it;
6. sets `traefik.enable=true` on those services;
7. declares the internal port when the image's `EXPOSE` does not match it;
8. avoids `container_name:`;
9. drops `ports:` for HTTP services reached through the gateway;
10. does not publish databases or caches on the host.

Nothing else. No Dockerfile changes, no directory moves, no shared base image.

## Optional Portta login

The project owns its router labels, so Portta never adds authentication behind
your back. To protect a hostname, create its credential and opt the router into
the generated middleware:

```bash
portta protect host demo-web.example.com --project demo --service web
```

```yaml
labels:
  - "traefik.http.routers.demo-web.middlewares=portta-forward-auth@file"
```

`/__portta/auth` is reserved on protected hosts for the login and logout routes.
See [Authentication](authentication.md) for rotation, removal and API clients.

## The overlay

Keep integration in its own file so `compose.yaml` still describes the
application, and the project still runs standalone without the gateway:

```yaml
# compose.portta.yaml
services:
  web:
    networks:
      - default        # keep reaching postgres/redis privately
      - portta    # accept traffic from the gateway
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=portta"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"

  api:
    networks: [default, portta]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=portta"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-api.loadbalancer.server.port=8000"

networks:
  portta:
    external: true
    name: portta
```

```bash
docker compose -f compose.yaml -f compose.portta.yaml up -d
```

Set `COMPOSE_FILE=compose.yaml:compose.portta.yaml` in the project's
`.env` to drop the `-f` flags entirely.

Working examples: [`docker/examples/demo-a`](../docker/examples/demo-a) and
[`docker/examples/demo-b`](../docker/examples/demo-b) for the CI pair; also
[`demo-site`](../docker/examples/demo-site) (single web),
[`demo-shop`](../docker/examples/demo-shop) (full stack with MySQL, Mailpit and RustFS),
[`demo-monorepo`](../docker/examples/demo-monorepo), and
[`demo-external`](../docker/examples/demo-external) (never adopted, for the panel's
External Docker section). Templates for the usual project shapes are in
[`templates/`](../templates/).

## Two rules that are easy to get wrong

**Write labels in list form.** Compose interpolates `${VAR}` inside a list entry
but **not** inside a mapping key. In map form the Traefik service name stays the
literal `${COMPOSE_PROJECT_NAME}` and every worktree of the project collapses
onto one load balancer.

**Prefix Traefik service names with the namespace.** Those names are flat across
the whole host; two projects both declaring `web` get merged into one load
balancer and start receiving each other's traffic.

`portta doctor` reports both.

## Checklist

- [ ] `COMPOSE_PROJECT_NAME` set, unique on this host
- [ ] no `container_name:` on any service
- [ ] HTTP services join `default` **and** `portta`
- [ ] databases and caches join **only** `default`
- [ ] `traefik.enable=true` on HTTP services only
- [ ] internal port declared when it differs from the image's `EXPOSE`
- [ ] Traefik service names prefixed with `${COMPOSE_PROJECT_NAME}`
- [ ] labels written in list form
- [ ] `ports:` removed for services reached through the gateway
- [ ] `ports:` removed for databases and caches
- [ ] `portta urls` lists the expected hostnames
- [ ] a second copy with a different `COMPOSE_PROJECT_NAME` runs alongside the first
- [ ] `portta doctor` is clean

## Verifying

```bash
portta urls --project <name>
curl -sI http://<name>-web.localhost | head -1

# the real test: a second environment, in parallel
COMPOSE_PROJECT_NAME=<name>-issue1 \
  docker compose -f compose.yaml -f compose.portta.yaml up -d
portta urls
```

Both environments should be listed and both should answer.

## Documenting it in the project

Copy [`templates/project/PORTTA.md`](../templates/project/PORTTA.md)
into the project and adjust the names. It covers only what someone working on
that project needs: how to start it, its URLs, how to reach its database, how
to run a second copy. The rules stay here.

## Monorepos

Nothing changes: a monorepo is one Compose project with more services in it.
See [monorepos.md](monorepos.md).

## Optional: declaring what cannot be inferred

The panel works out a project's identity from the labels Compose already
injects: the project name, the working directory, and a worktree namespace when
the directory basename disagrees with the project name. Three optional labels
settle what that inference cannot. **All of them are optional, and a project
that sets none behaves exactly as it does today**, which is asserted in the test
suite rather than promised here.

| Label | When it helps |
|---|---|
| `portta.project` | `COMPOSE_PROJECT_NAME` is a per-worktree namespace and five worktrees should group under one heading |
| `portta.repo` | `owner/name` or a remote URL. Gives repository and commit links with no host-side Git at all |
| `portta.git.root` | The repository root, when the Compose file is not at it (see [monorepos.md](monorepos.md)) |

```yaml
services:
  web:
    labels:
      - "portta.project=base-empresarial"
      - "portta.repo=owner/base-empresarial"
```

Declare them on any one service; the first that does wins for the whole
project. `portta analyze` reports which ones a project sets, and says
"none (inferred from the Compose labels)" when it sets none, because that is
the normal answer rather than a finding.

See [ADR 0010](adr/0010-git-collected-on-the-host.md).

## Keeping the project runnable without the gateway

The overlay adds only networks and labels, so `docker compose up -d` on its own
still works; you just lose hostname routing. If a developer needs a published
port for a one-off, that is their `compose.override.yaml`, not the shared file.

## Optional: reaching this project's database by hostname

Everything above is about HTTP. A project can additionally opt its datastores
into hostname routing, so they are reachable on the gateway's shared port
without publishing one:

```bash
cp templates/overlays/09-tcp-routing.yaml compose.portta-tcp.yaml
docker compose -f compose.yaml -f compose.portta.yaml \
               -f compose.portta-tcp.yaml up -d
```

It needs `PORTTA_TCP=true` on the gateway, works for PostgreSQL and Redis,
and requires TLS on the client. Read [tcp-routing.md](tcp-routing.md) first: it
explains what each protocol can and cannot do, and why MySQL is not on the
list.


## Presentation needs no change to the project

Once a project is running, its name, description, primary service, collapsed
services, ordering and a short hostname are all adjustable from the panel's
**Settings** control, and none of it touches the project. The values live in the
gateway's own database, and a hostname alias becomes one router in a file the
gateway owns. `git status` inside the clone stays clean.

See [Naming a project without touching it](web-ui.md#naming-a-project-without-touching-it).
