# 0026. Applying settings from the panel is one opt-in container, outside the Compose project

**Status:** Accepted, amends [0011](0011-panel-reads-traefik-writes-one-file.md)

## Context

The Settings page writes `.env` and marks every key whose saved value differs
from the one the running gateway was started with as `pending restart`. Then it
stops, and prints a command for a human to run:

```
./bin/portta up local
```

That is honest, and until now it was the only honest thing available. Traefik
takes its static configuration from environment variables interpolated when
Compose renders the project ([ADR 0003](0003-traefik-static-config-via-env.md)),
so `PORTTA_DOMAIN` reaches it through `TRAEFIK_PROVIDERS_DOCKER_DEFAULTRULE` at
*creation* time. A saved setting needs the containers **recreated**, not
restarted — and `POST /containers/{id}/restart`, which the panel does have,
hands back the same container with the same environment.

Recreating means Compose, and the panel cannot reach Compose. It talks to Docker
through a socket proxy of its own plus a hard allowlist in its own process
([ADR 0008](0008-web-panel-socket-proxy.md)): start, stop, restart, one fixed
container shape, and remove. No `exec`, no images, no build. That boundary is
one of the few things in this repository that would be genuinely dangerous to
loosen, and none of the obvious ways to close the gap keep it:

- **Widen the socket proxy.** Even with `IMAGES` and a general
  `POST /containers/create`, recreating the stack means resolving four to eleven
  overlay files against `.env` and interpolating them. That is reimplementing
  Compose inside the panel.
- **Restart the panel's own container.** It picks up nothing: `restart` reuses
  the environment the container was created with, which is the whole problem.
- **A daemon on the host** watching for a request file. It works, and it adds a
  long-lived process the installer must create and maintain, per operating
  system, for one button.

On a host reached only through the panel — a VPS, which is the case this is
written for — the gap is the difference between a setting that can be changed
and one that cannot.

## Decision

`portta up` prepares **one container, stopped**, when `PORTTA_APPLY=true`. The
panel's part is to start it. Nothing else changes.

```
docker create --name portta-apply
  --label portta.managed=true --label portta.component=apply
  --restart no --network none --user 0:0 --security-opt no-new-privileges:true
  --workdir  $PORTTA_ROOT
  --volume   /var/run/docker.sock:/var/run/docker.sock
  --volume   $PORTTA_ROOT:$PORTTA_ROOT
  fabioassuncao/portta-apply:<VERSION>
  bash $PORTTA_ROOT/bin/portta up --wait
```

The argument list has one definition in `packages/core/src/apply.ts` and a
mirror in `scripts/lib/apply.sh`, because the core commands must run without
Node ([ADR 0015](0015-node-on-the-host.md)); `tests/unit/apply.test.sh` compares
the two argument for argument, the way `profiles.test.sh` compares overlay
selection.

### Not a Compose service

Compose decides what `--remove-orphans` deletes from the
`com.docker.compose.project` label and then from whether the service is still in
the project. An applier that were a Compose service would therefore delete
**itself**, mid-run, the moment `PORTTA_APPLY` went false — which is exactly the
apply that turns it off. It would also be recreated by any change to its own
rendered config, stopping the process that was doing the recreating.

It has to survive the `up` it runs for a second reason: its exit code and its
output are the only account of the apply anyone gets, because the process that
would have remembered was itself recreated.

A plain container carries no project label and is never a candidate.

### The repository is mounted at its host path

`portta_compose` passes `--project-directory "$PORTTA_ROOT"` and absolute `-f`
paths, and the overlays carry relative binds (`./config/traefik/dynamic`,
`./state/traefik/acme`). Compose resolves those against the project directory
and hands the daemon absolute paths **on the host**. Mounted anywhere else,
Docker would not fail — it would create empty directories in their place, and
Traefik would start with an empty dynamic directory, silently losing the
panel's own BasicAuth middleware and the local TLS configuration.

### It runs `bin/portta up`, in bash, with no profile

Not `docker compose up` directly: the file list depends on `.env`, which the
panel has just changed, and half the keys the Settings page can write
(`PORTTA_PROFILE`, `PORTTA_DASHBOARD`, `TLS_ENABLED`, `TAILSCALE_ENABLED`,
`PORTTA_WEB_EXPOSE`) change which overlays apply. `cmd_up` also creates the
access network when TCP was just enabled, and refuses five combinations that
would leave the gateway unable to start.

In bash, because `install.sh` copies `bin`, `scripts`, `docker/compose` and
`docker/images` into `PORTTA_HOME` and never `packages`: on an installed host
there is no TypeScript CLI. The image has no Node, so the shim in
`bin/portta` takes the shell path on its own; `PORTTA_FORCE_BASH=true` states
the intent rather than relying on that.

With no profile argument, so `up` falls back to `PORTTA_PROFILE` read from the
`.env` the panel just wrote. A profile change therefore applies to itself.

`--wait` is new, and is what makes the exit code mean *the gateway came back
healthy* rather than *Compose accepted the plan*.

### The panel reads the result back, and remembers nothing

`GET /api/gateway/apply` derives `idle | running | ok | failed` from the
container: `State.Running`, `State.StartedAt`, `State.ExitCode`, and the tail of
its log since this run started. There is deliberately no state in the panel
process, because the apply recreates that process — anything held in memory is
gone before there is a result to report. A browser that reloads mid-apply, or a
second tab, resumes from the same place for the same reason.

`POST /api/gateway/apply` starts it and answers immediately. Docker returns from
`start` as soon as the container is running, and Compose takes seconds to
converge, so the response is written long before this panel is recreated. The
browser then polls `/api/health` and this endpoint; a network failure there is
the expected state, not an error.

## Consequences

**What this grants, without softening it:** anyone who can write through the
panel can run `portta up` on the host, in a root container holding the Docker
socket. That is root on the host. The most concrete new capability is
`PORTTA_PROFILE`, which the Settings page can already write: saving
`remote-public` and applying puts every opted-in service on the internet with no
human at a terminal. Previously that still required someone to type the command.

What bounds it:

- Off by default, and `PORTTA_APPLY` is deliberately **absent from the panel's
  field catalogue**, so the panel cannot enable itself. Turning it on is an edit
  on the host.
- Refused outright in read-only mode, by the existing guard, and refused
  cross-origin by the existing guard.
- The command is fixed in the container spec at creation. The panel passes no
  argument and has no channel to the applier beyond `.env`, which is already
  filtered by the field catalogue.
- The panel gains **no new Docker permission**. `start`, `inspect` and `logs`
  were already on the allowlist; the socket proxy flags are untouched.
  `tests/unit/audit.test.sh` fails the build if either grows.
- No network, so the applier cannot resolve a name, reach a registry or act as a
  pivot. The cost is that enabling a component whose image is not yet on the
  host fails at Compose's pull phase — which runs before convergence, so the
  failure is clean and the gateway is never left half applied.
- The host refuses to prepare one at all when the panel is exposed publicly, or
  on the `remote-public` profile. It used to refuse `PORTTA_WEB_BUILD` and
  `PORTTA_WEB_DEV` as well; the amendment below says why that was wrong.

**What can still go wrong.** If the saved configuration is valid enough to write
but not to start, `up` can take the panel down and fail before recreating it.
The applier's exit code and log survive, but the reader does not — the browser
sees only a timeout. The recovery is a shell on the host, and the timeout dialog
says so rather than claiming a failure it cannot see.

Two `docker compose up` runs against the same project at the same time conflict
over container names. The panel refuses a second apply while one is running;
nothing can stop an operator running `portta up` by hand at that moment, and
`portta up` repairs the result.

The applier's Compose is the one in its own image, not the host's. Both are
above the documented minimum, but they are separately versioned.

**What is unchanged.** With `PORTTA_APPLY=false`, which is the default, the
panel behaves as it did: it says what is pending and prints the command. The
only difference is that it now says so on every page rather than only on the
Settings page. Consumer projects are never touched, in either case
([ADR 0001](0001-decoupled-infrastructure.md)): the applier drives the
gateway's own Compose project and no other.

### Amendment: a host that builds its own images may still prepare an applier

The refusal above originally covered two more cases, `PORTTA_WEB_BUILD` and
`PORTTA_WEB_DEV`, on the grounds that the applier "would try to build the panel
image inside itself, with no network". That reasoning was wrong on both counts,
and it cost the one host where applying from the panel is most useful — a
development checkout, where settings change constantly — the ability to do it at
all. The panel then compounded it: with no applier to find, it reported
`set PORTTA_APPLY=true`, telling operators to set a key they had already set.

**Nothing is built inside the applier.** It holds the host's Docker socket, so
`compose build` packs the context and sends it over that socket; the *host
daemon* runs the build, with the host's network and its layer cache.
`--network none` never had a say in it — the socket is a unix socket, which is
exactly why the applier can have no network and still drive Compose. What the
image did lack is the buildx plugin that the Compose CLI reaches the daemon's
builder through, and it now carries `docker-cli-buildx`.

**A failed build cannot leave the gateway half applied**, which was the sharper
half of the fear. Compose builds before it stops anything, so a build that fails
aborts the plan with every container still running — a strictly better failure
than the ones this ADR already accepts.

What is genuinely different on such a host is *time*. `up --build` on a cold
cache runs `npm ci` twice, once for the panel's `dev` target and once for the
authentication image, and that is minutes rather than the few seconds the
progress dialog was written for. So `ApplyStatus` carries `buildsImages`, the
confirmation says an apply includes a Docker build before the operator commits
to it, and the browser's polling budget rises to 900s when it is set. Without
that, the first apply on a checkout looks like a hang and gets abandoned halfway.

The image is therefore `0.2.0`. The tag has to move: `up` builds the applier
image only when it is *absent*, so a host with `0.1.0` cached would keep an
image with no buildx forever. Because `applySpec` embeds the image reference in
the `portta.apply.spec` label, the next `up` also finds the existing container
stale and recreates it. No migration, and nothing for an operator to do.

**The panel now says which case it is in.** Three situations produce the same
missing container and have three different fixes, so `ApplyStatus` gained
`unavailableReason` — `disabled`, `refused`, or `not-prepared` — and the bar
picks a translated sentence from it instead of printing one fixed English hint
for all three. `refused` is the only one that quotes the host's own wording,
because there the host phrased it better than the panel can.
