# Testing

One principle decides what to run and when:

> **While you are working, test what you changed. Before you hand it over,
> widen the scope to match the risk.**

The full local pass takes about a minute, and most of that minute is spent
re-proving things your change could not have touched. Running it after every
edit does not make the change safer; it makes the edit slower, which is what
makes people stop running tests at all.

## While you are working

Run the suite that covers the file you edited, and the tests you wrote for it.
Nothing else.

| You changed | Run | Cost |
| --- | --- | --- |
| `packages/core/src/*.ts` | `npm test --workspace=portta-core` | ~0.5s |
| `packages/contracts/src/**` | `npm test --workspace=portta-contracts` | ~0.2s |
| `packages/db/src/schema/**` | `npm test --workspace=portta-db` and `npm run db:check --workspace=portta-db` | ~8s |
| `packages/server/src/**` | `npm test --workspace=portta-server` | ~35s |
| `packages/cli/src/**` | `npm test --workspace=portta` | ~0.7s |
| `apps/auth/src/**` | `npm test --workspace=portta-auth` | ~0.5s |
| `apps/web/{app,components,lib}/**` | `npm test --workspace=portta-web -- --project ui` | ~11s |
| `apps/web/server/**` | `npm test --workspace=portta-web -- --project server` | ~1s |
| `apps/web/lib/docs/**` | `npm test --workspace=portta-web -- --project docs` | ~0.5s |
| an API route or a schema | also `npm run openapi:check --workspace=portta-contracts` | ~0.5s |
| `scripts/lib/*.sh`, `bin/portta`, `install.sh` | `bash tests/unit/<subject>.test.sh` | 0.1–13s |
| `docker/compose/**`, `templates/**` | `bash tests/unit/profiles.test.sh` and `bash tests/unit/templates.test.sh` | ~6s |

Narrow further with a name filter, which every suite here accepts:

```bash
npm test --workspace=portta-server -- apply       # one file
npm test --workspace=portta-core -- -t 'refuses'  # one description
```

Widen only when there is a concrete reason to think something else is affected:
a shared type, an exported helper with several callers, a change to
`packages/core` or `packages/contracts` (which everything downstream imports),
or a compose overlay that more than one profile selects.

Do **not** run `./tests/run.sh`, the end-to-end suites, or the Playwright run
for an ordinary fix, feature increment or refactor. They exist for the moments
below.

## Before you hand it over

Run the full local pass when you finish a feature, when the change is
structural or crosses workspace boundaries, when it touches something shared
(`packages/core`, `src/shared/types.ts`, a compose overlay, the installer), and
always before a merge or a release:

```bash
./tests/run.sh          # shell lint, compose validation, unit and workspace suites (~1 min)
```

The two expensive layers stay opt-in, because both need a Docker daemon and
both take minutes. The panel's browser run needs one too now: PostgreSQL is a
boot dependency of the panel, so the harness starts a disposable database and
removes it afterwards. Point `PORTTA_E2E_DATABASE_URL` at one you already have
to skip that.

```bash
./tests/run.sh --e2e    # the gateway end to end, plus the panel in a browser
./tests/run.sh --all    # everything above in one run
```

**Nothing runs these for you.** The repository's one workflow publishes the
Docker image and checks nothing; a push is not verified by anything but you. So
the expensive layers are not a safety net someone else holds — run `--e2e`
yourself before a merge that touches the lifecycle commands, the compose files,
the installer or the panel's routing, and `--all` before a release.

## What belongs in the suite

The suite is small on purpose. Every test in it has to earn the time it costs
on every future run.

**Write a test when** it pins a business rule, a refusal, an exit code, a
security boundary, a data-loss path, or a bug that already happened once. The
shell audit suites (`tests/unit/audit.test.sh`, `install.test.sh`,
`web.test.sh`) are the clearest example: they assert invariants such as "no
prune, ever" and "no password on a command line" in milliseconds.

## The database in a test

Anything that touches a row opens [PGlite](https://pglite.dev) — PostgreSQL
compiled to WebAssembly — and applies the real migrations:

```ts
import { createTestDb } from 'portta-db/testing'

const { db, close } = await createTestDb()
```

There used to be hand-written stand-ins for each repository instead. They were
faster and they were wrong in the way stand-ins always are: they accepted rows a
check would refuse, they returned ids in a shape the driver never produces, and
a query the panel got wrong passed anyway. Three tests in the panel's own suite
were asserting a fake's behaviour rather than the database's, and only noticed
when the fake went away.

The cost is a few seconds per file, nearly all of it compiling the WebAssembly
once per worker; each test after the first costs about a hundred milliseconds.
`packages/server/tests/helpers.ts` has `seededDatabase()`, which is one already
holding a Project, a repository and two environments.

`tests/unit/boundaries.test.sh` is the same idea applied to the monorepo's
shape: an import that crosses a boundary the [map](monorepo.md) does not allow
compiles perfectly well, because npm workspaces resolve every package from one
`node_modules`. Nothing but that suite would notice.

**Do not write a test that** restates the implementation, asserts a static
label or a class name, checks that a file exists next to another assertion that
reads it, covers browser plumbing with no rule behind it (`localStorage`,
`document.title`), or duplicates a decision another layer already asserts. When
the panel and the server both look at the same rule, the server test is the one
to keep: it runs in about 3ms, the component test in about 50ms.

Two implementations of one decision — the shell gateway and the TypeScript CLI,
per [ADR 0015](adr/0015-node-on-the-host.md) — are not duplication. Both are
shipped, so both are tested, and a parity assertion keeps them in step.

## Keeping it fast

The suite is only worth running often if it stays quick, so cost is part of
review:

- **One document per question, not one per assertion.** A `portta` invocation
  is a process spawn. `tests/unit/cli.test.sh` reads each command's help once
  and makes every assertion against that output.
- **Drive timers, do not wait on them.** `useApply` polls on a plain
  `setTimeout` loop precisely so a test can step it with `vi.useFakeTimers()`.
  Waiting on the real clock cost eight seconds for two tests.
- **Assert on the server where the rule lives.** A jsdom environment costs
  roughly ten times what a Node one does.
- **Watch the slowest file, not the total.** The suites run in parallel, so
  wall-clock time is the longest single file.

## Layers

| Layer | Where | Needs Docker | Runs in |
| --- | --- | --- | --- |
| Shared core | `packages/core/src/*.test.ts` | no | `tests/run.sh`, CI |
| The contract | `packages/contracts/src/*.test.ts` | no | `tests/run.sh`, CI |
| Schema and migrations | `packages/db/tests/` | no (PGlite) | `tests/run.sh`, CI |
| Services and API | `packages/server/tests/` | no (PGlite) | `tests/run.sh`, CI |
| CLI | `packages/cli/src/**/*.test.ts` | no | `tests/run.sh`, CI |
| ForwardAuth | `apps/auth/src/*.test.ts` | no | `tests/run.sh`, CI |
| Panel components | `apps/web/tests/ui/` | no | `tests/run.sh`, CI |
| The panel's dispatcher | `apps/web/tests/server/` | no | `tests/run.sh`, CI |
| Documentation collection | `apps/web/tests/docs/` | no | `tests/run.sh`, CI |
| Shell gateway, invariants and workspace boundaries | `tests/unit/` | compose only | `tests/run.sh`, CI |
| Gateway end to end | `tests/e2e/` | yes | `--e2e`, CI |
| Panel in a browser | `apps/web/e2e/` | yes (a disposable PostgreSQL; the Engine API is faked) | `--e2e`, CI |
| Panel layout at every width | `apps/web/e2e/viewports.mjs` | yes (a disposable PostgreSQL) | by hand |

### The suites that guard the boundaries

Four of them exist for one reason each, and all four are cheap enough to leave
in the fast run:

| Suite | What it is for | What it costs |
| --- | --- | --- |
| `packages/auth/tests/` | Who a request is, and what a role may do. The whole matrix — four roles against every permission, scopes, tokens, the bootstrap — against PGlite. | ~2s |
| `packages/server/tests/api/security.test.ts` | The rules that live in one place and are easy to lose: the origin guard, read-only, 401 against 403, credential shapes the panel refuses, the rate limit in front of guessing, and the promise that no secret reaches the output. | ~3s |
| `packages/server/tests/audit-actions.test.ts` | One line per action. Table-guided from the vocabulary itself, so an action nobody records fails the build rather than going unnoticed. | ~2s |
| `packages/server/tests/realtime/` | The event stream's scope filter, the WebSocket handshake (401/403/404 before a socket exists), and the framing a live stream needs. Runs a real HTTP server on an ephemeral port. | ~2s |

In the browser, `apps/web/e2e/roles.spec.ts` is the one that cannot be replaced
by a unit test: an owner creates an admin, a developer and a viewer, gives two
of them one Project each, and every refusal is checked twice — once as what the
panel offers, and once as what the server answers a `fetch` from that person's
own session. It signs in four times, which matters because sign-in is
rate-limited per address and the whole run comes from `127.0.0.1`; the harness
raises `PORTTA_AUTH_SIGNIN_ATTEMPTS` for that reason and for no other.

### The layout check

```bash
npm run viewports --workspace=portta-web           # report
node apps/web/e2e/viewports.mjs --shots            # and write the frames to /tmp
```

It boots the panel against the documentation host at five widths, from a 1920
desktop to a tablet in portrait, and asserts the one thing that actually breaks
a layout: the window must not scroll sideways, and no control may end up
off-screen. Anything wide — a table, the board, a toolbar — has to scroll
inside its own container.

Run it after changing a table, the shell, or anything that decides a width. It
is not in `tests/run.sh` because it wants Docker and a full build; it is the
check to run when you have been looking at the panel.
