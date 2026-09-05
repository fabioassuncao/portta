# 0020. Installing Portta means one directory and published images, not a checkout

**Status:** Accepted

## Context

Until now there were two ways to get a running gateway, and both of them handed
you the repository:

```bash
git clone git@github.com:fabioassuncao/portta.git && cd portta && ./bin/portta bootstrap
npx portta setup --yes          # which clones it for you
```

That is the right shape for developing Portta. It is the wrong shape for
running it, and the difference showed up in four places:

**The checkout became the version.** A host installed in March ran March's
gateway until somebody remembered to `git pull` in the right directory. There
was no answer to "what is installed here" that did not involve reading
`git log`, and no way to update that did not involve Git being present,
authenticated, and pointed at a clean working tree — `setup` refuses to
fast-forward a checkout with local changes, which is correct and also means an
edited `.env.example` blocks an upgrade.

**The panel was built on the host.** `docker/compose/features/web.yaml` carried
`build: {context: ., dockerfile: apps/web/Dockerfile}`, so the first
`portta web up` on a new VPS ran `npm ci` over the whole workspace inside a
container, twice (deps and runtime stages), before anything answered. That
needs the lockfile, the source of two packages and the app — which is to say,
it needs the checkout, which is why the checkout could not be dropped.

**Everything that had to persist was mixed with everything that did not.**
`state/`, `config/`, `.env` and the ACME material sat in the same directory as
`node_modules/`, `apps/`, `tests/` and `.git/`. Backing up the host meant
knowing which of those mattered. Moving it to another machine meant knowing
which of those must *not* come along.

**And the source was on the server for no reason.** A production host does not
need `tests/e2e`, Playwright, the demo stacks or the panel's TypeScript. It
needs Traefik, a socket proxy, PostgreSQL, the panel, and about thirty
kilobytes of configuration.

Dokploy and Coolify both solved this the same way, and it is worth naming why
the shape converges: a single `install.sh`, a fixed directory of state, and
containers pulled from a registry. Neither ships a source tree to a server.
Coolify keeps `/data/coolify/{source,ssh,proxy,applications}`; Dokploy keeps
`/etc/dokploy`. Both make re-running the installer the supported way to
upgrade. What they do that Portta deliberately does not is assume root, assume
a fresh machine, and install a Docker Swarm.

## Decision

A normal installation is **one directory and a set of published images**. The
repository is not involved.

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
```

### PORTTA_HOME

One directory holds everything the host keeps. It defaults to `/opt/portta` for
root and `~/.portta` otherwise, and the installer asks before using either.

```
<PORTTA_HOME>/
├── VERSION                     what is installed
├── .env                        configuration, 0600
├── install-manifest.json       version, ref, registry, access mode, when
├── bin/portta                  the shell CLI
├── scripts/                    what it sources: bootstrap, doctor, libraries
├── docker/compose/             the overlays, exactly as the repository has them
├── config/
│   ├── traefik/dynamic/        routing, and the generated BasicAuth middleware
│   └── tls/                    local CA material, when `tls init` has run
└── state/
    ├── traefik/acme/           certificates
    ├── tailscale/              node identity
    ├── git/                    what `git scan` collected
    ├── host/                   leftover of the first host.json collector
    ├── metrics/                what `host collect` / `host watch` wrote
    ├── logs/                   collector and other host-side logs
    └── github/                 the GitHub App key, if any
```

`/opt/portta` over `/var/lib/portta`: the FHS reading that fits is
"add-on software package", and everything here — configuration, state, and the
CLI — belongs to one such package. Splitting it across `/etc`, `/var/lib` and
`/usr/local` would be more orthodox and would give up the property that makes
this worth doing: **`tar -czf portta.tgz $PORTTA_HOME` is the backup, and
untarring it on another machine is the restore.**

This layout is deliberately a *valid gateway root*: it has `VERSION` and
`docker/compose/compose.yaml`, which is exactly what `findGatewayRoot` looks
for. `npx portta` therefore works against an installation with no checkout
anywhere, and the CLI additionally looks in `$PORTTA_HOME`, `/opt/portta`,
`~/.portta` and `/var/lib/portta` when walking up from the working directory
finds nothing.

### What the installer downloads

The GitHub tarball for the requested ref, from which it takes `VERSION`,
`.env.example`, `bin/`, `scripts/`, `docker/compose/` and `docker/images/`, and
nothing else. No `apps/`, no `packages/`, no `node_modules/`, no `.git`, and no
demonstration stacks from `docker/examples/`.

The shell CLI comes along because it is operational tooling, not application
source: it is what makes `portta status`, `portta doctor`, `portta up` and
`portta logs` work on a host with no Node at all ([ADR 0015](0015-node-on-the-host.md)).
It is roughly a hundred kilobytes of shell that reads the same `.env` and
selects the same overlays as the TypeScript CLI.

Files are replaced on every run *except* four kinds, which are the ones a
second run must never destroy: `.env`, everything under `state/`, everything
under `config/tls/`, and any file that already exists in
`config/traefik/dynamic/` — that directory holds the generated BasicAuth
middleware and hand-written routing. New dynamic files added by an upgrade
appear; existing ones are left exactly as they are.

### The panel is a published image

`docker/compose/features/web.yaml` no longer builds. It pulls
`ghcr.io/fabioassuncao/portta:<version>`, published by
`.github/workflows/publish.yaml` for `linux/amd64` and `linux/arm64`, pinned by
tag like every other component image ([ADR 0004](0004-pinned-versions.md)).

The build moved to `docker/compose/features/web-build.yaml`, applied only when
`PORTTA_WEB_BUILD=true`, which only makes sense inside a checkout. `portta web
dev` still builds the `dev` target, because hot reload has nowhere else to come
from.

Local release builds are explicit: `portta build` (normally `just build`)
builds the runtime, applier and toolbox images with the release in `VERSION`.
`just up` consumes those tags and refuses a partial local release before
converging any container. Merely running from a checkout no longer implies a
build.

### Install and update are the same command

There is no `portta update-from-the-internet`. Running the installer again
detects `$PORTTA_HOME/VERSION`, keeps every answer already recorded in `.env`,
re-downloads the runtime files, pulls the new images, and recreates. The panel
database password, the panel credential, the ACME material and the Tailscale
identity are generated once and never regenerated.

### Persistence: bind mounts, except for PostgreSQL

Everything a human might read, edit, back up or copy to another machine is a
**bind mount under `PORTTA_HOME`**: `.env`, the Traefik dynamic directory, the
ACME store, the Tailscale state, the collected Git metadata. They are visible
in a file manager, greppable, and included in the tarball above. That is worth
more than the portability a named volume would add, because none of them is
performance-sensitive and all of them are things you want to look at when
something is wrong.

The panel's PostgreSQL data is the exception and stays in the **named volume**
`portta-db`. Bind-mounting `PGDATA` costs real correctness: the directory must
be owned by the container's `postgres` uid, which is not the uid that owns
`PORTTA_HOME`; on macOS it goes through a filesystem virtualisation layer that
PostgreSQL has no reason to trust with `fsync`; and a stray `rm -rf` of the
install directory would take the database with it. The portable backup for a
database is a dump, not a directory, and `portta db dump` / `portta db restore`
already exist.

## Consequences

A VPS goes from bare to running in one command and about ninety seconds, most
of which is image pulls. Nothing is compiled on the host, so a host needs
Docker, `curl`, `tar` and a shell — not Node, not Git, not a toolchain.

**Two things must stay in step with `VERSION`.** The default image tag in
`docker/compose/features/web.yaml` and the tag the publish workflow pushes. CI
fails the publish if they disagree, and `tests/unit/audit.test.sh` fails the
build if the compose default drifts. This is the cost of pinning; the
alternative is `:latest`, which would make "what is installed here" unanswerable
again.

**A first publish creates the GHCR package as private.** It has to be made
public once, by hand, in the repository's package settings. Until that happens
the installer fails at the pull with a clear message rather than falling back to
a build, which would quietly reintroduce the thing this decision removes.

**Developers get a behaviour change.** `portta web up` inside a checkout uses
the published panel unless an image override is explicit. `just build` plus
`just up` is the production-like local path; `portta web dev` uses source
mounts and watch. `PORTTA_WEB_BUILD=true` remains an advanced explicit build
switch, tagged with `VERSION`.

**`npx portta setup` keeps doing what it did.** It provisions a *checkout*, and
that remains the right tool for working on Portta. It is no longer the way to
install it.
