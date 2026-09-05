# Panel persistence

The administration panel keeps its durable decisions in PostgreSQL: preferences,
project metadata, tasks and integration configuration. It is part of the panel,
not part of the HTTP gateway, and it never stores runtime observations as a
source of truth.

**PostgreSQL is required.** A panel that starts without it can show Docker and
nothing else, and every write it accepts is lost, so it says what is missing and
exits instead. The managed mode selects `docker/compose/features/db.yaml` with the panel.
External mode selects the panel without the local database. Both modes authenticate
and apply migrations before the HTTP listener starts.

## Where the schema lives

`packages/db` owns the schema, the migrations and the client, and holds no
business rule. `packages/server` owns the rules and reaches the tables through
it. The split is what lets a suite run the real migrations against an in-memory
PostgreSQL without starting a panel.

```text
packages/db/
├── drizzle/               0000_initial.sql and its journal — generated, never hand-written
├── drizzle.config.ts
└── src/
    ├── schema/            one file per area; the tables, checks, indexes and relations
    ├── client.ts          createDb(url) → { db, sql }
    ├── migrate.ts         migrateWithLock(url): advisory lock, then the migrator
    ├── seed.ts            seedMinimal(db): the instance row, and nothing else
    └── test-db.ts         createTestDb(): PGlite, migrated
```

## What is persisted

Decisions, and a bounded history of the development flow:

- one stable gateway instance identity;
- **People and access** (`users`, `sessions`, `accounts`, `verifications`,
  `api_keys`, `two_factors`, `project_members`): who may sign in, and which
  Projects a `developer` or `viewer` can see. The tables exist from the first
  migration; the panel starts using them when authentication is turned on;
- **Projects** (`projects`): the product the operator recognises, its slug,
  description and its place under Projects Home; which environments it
  adopted (`project_environments`), and why;
- **Repositories** (`repositories`): a Project's git repositories, local
  first — a path, a remote, a role — with a GitHub repository as an optional
  binding;
- **Tasks** (`tasks`, `task_notes`, `task_attachments`, `task_environments`):
  Portta's own unit of work, with subtasks, notes, attached files and the
  environments a task is worked in; `task_github_links` binds a task to a
  projected issue and remembers whether the last local edit reached GitHub;
- **Work sessions** (`work_sessions`): who worked on what, since when,
  and what came out;
- **Activity** (`activity_events`): what happened — a task moved, a session
  started, an environment rebuilt, a commit landed — pruned in code after
  ninety days or five thousand rows per Project;
- **Audit** (`audit_log`): the sensitive writes — who signed in, who changed a
  role, who destroyed an environment — so "who did that" is answerable months
  later. Never a request body, a password, a hash or a token;
- environment identity (`environments`, one row per `COMPOSE_PROJECT_NAME`
  ever seen, with `working_dir` and `config_files` as Docker last recorded
  them, so an environment whose containers are gone can be started again
  through the runner, or forgotten) and the closed catalogue of global,
  environment and service preferences (`settings`, `environment_settings`,
  `service_settings`);
- the GitHub projection (`github_installations`, `github_repositories`,
  `github_issues`, `github_issue_relationships`, `github_sync_state`): a
  cache of a remote source of truth, every row with its age.

Container state, health, ports, networks, URLs, logs, the repository scans
and Traefik status still come from their live owners. A stopped container
disappears from the next Docker snapshot; PostgreSQL is not a stale inventory
cache. `packages/db/tests/schema.test.ts` asserts that no table for any of them
exists.

Most of that state is true only of this machine. [ADR 0016](adr/0016-state-that-could-be-shared.md)
classifies what could ever be shared between two gateways (project and user
decisions) and what must never be (runtime observations and instance
configuration). No synchronisation is implemented.

## Changing the schema

The schema is TypeScript; the SQL is generated from it and committed.

```bash
# 1. edit packages/db/src/schema/*.ts
npm run db:generate --workspace=portta-db   # writes drizzle/NNNN_name.sql and its snapshot
# 2. read the SQL it produced, then commit both
npm run db:check --workspace=portta-db      # fails if the schema and the SQL disagree
```

Nothing in `packages/db/drizzle/` is written by hand. `db:check` runs the
generator and fails if it wanted to write anything, which is the only way to
notice a column added to the schema and never generated; `tests/run.sh` runs it.

Applied migrations are recorded in `drizzle_migrations`. Startup takes a
session-level advisory lock and applies what is pending, so two panels starting
at once cannot partially apply one; a failure there is a failure to boot.
`portta db migrate` applies what is pending without a restart, which is what
makes a newly generated file visible to a panel that is already up.

There is one migration, `0000_initial`. The schema before it was replaced rather
than converted: what it held was a projection of Docker, GitHub and the host,
and it rebuilds itself. A volume from before the change is detected at boot —
`schema_migrations` present, `drizzle_migrations` absent — and the panel refuses
to start with the instruction to run `portta reset`.

## Isolation and lifecycle

PostgreSQL uses the pinned image in `docker/compose/features/db.yaml`, a named
volume and the dedicated `portta-data` network. The network is `internal`; the
database publishes no host port and never joins the shared `portta` HTTP
network. `doctor` fails if either invariant is broken.

`portta web up` generates the database password in the git-ignored `.env`
when needed. The panel API reports only whether that setting exists and never
returns its value. `portta web down`, `portta down` and subsequent
`up` operations preserve the named volume. `portta dev --reset` (or
`portta reset`) is the command that removes it and starts the checkout again;
development project volumes are not touched.

A connection that drops *after* boot is a different thing from a missing one:
the panel keeps serving every Docker-backed page, `/api/health` and the
existing read surfaces, Overview and diagnostics show a persistence warning,
and only an operation that needs stored state returns 503.

## Operations

All clients run in an ephemeral toolbox container on the private data network.
The host needs no `psql`, and the password is inherited through the container
environment rather than placed in command arguments.

```bash
portta db status
portta db migrate
portta db shell
portta db dump > portta.dump
portta db restore portta.dump
# or: portta --yes db restore < portta.dump
```

`db status` prints container health. `db migrate` asks the running panel to
apply every pending migration and is the command to run after generating one
while the panel is already up. `portta web up`, `portta web dev` and
`portta dev` do the same after the panel is healthy. The CLI never opens
PostgreSQL: it calls `POST /api/database/migrate`.

In a checkout, `docker/compose/features/web-dev.yaml` bind-mounts
`packages/db/drizzle` into the API container so a newly generated migration is
visible without rebuilding the image. Production reads the files copied into
the image.

`db dump` writes a PostgreSQL custom-format archive and nothing else to
stdout. `db restore` uses `--clean --if-exists`, asks for confirmation and
restores ownership-neutral objects. Back up `.env` with the dump: the database
credential belongs to that file, not to the archive.

The similarly named `portta db psql --project ...` remains the client for
a consumer project's own PostgreSQL. `db shell`, `status`, `migrate`, `dump`
and `restore` refer specifically to the panel database.

## Testing against it

Suites open [PGlite](https://pglite.dev) — PostgreSQL compiled to WebAssembly —
and apply the same migrations. Checks, enums, cascades, advisory locks and
`jsonb` are the real ones, so a query the panel gets wrong fails in the suite
rather than in production.

```ts
import { createTestDb } from 'portta-db/testing'

const { db, close } = await createTestDb()
```

One instance per test file. The first costs about three seconds to compile the
WebAssembly; every one after it costs about a hundred milliseconds.

## Configuration and an existing volume

`PORTTA_RUNTIME_DB_MODE=managed` uses internal DNS `db` and port `5432`; neither
is a pretend configurable setting. `PORTTA_RUNTIME_DB_USER`, `_NAME` and
`_PASSWORD` are shared by PostgreSQL and the application's URL resolver. The
password is generated into `.env` once. It is never generated inside PostgreSQL
or discovered from a different container. The database has no host port.

`PORTTA_RUNTIME_DB_MODE=external` requires `PORTTA_RUNTIME_DATABASE_URL`.
The managed fields are inactive, no local `db` is started, and readiness comes
from the application's authenticated connection and migrations. Administrative
clients use the same resolver, running in the toolbox on the gateway network.
Client TLS file paths must be available inside the toolbox; they are not mounted
from arbitrary host paths automatically.

Changing `.env` does not modify an initialized PostgreSQL cluster. The installer
never issues an automatic `ALTER USER` or deletes a volume to make a password
work. An incompatible credential prevents the panel from starting. Recover the
original `.env`/backup first. For deliberate password rotation, connect using the
current credential (`portta db shell`), use psql's interactive `\password` for
the configured role, update `PORTTA_RUNTIME_DB_PASSWORD` on the host, and recreate
the panel/database containers with `portta up`. A changed database or role name
requires explicit PostgreSQL administration or dump/restore, not new defaults.

The volume name and PostgreSQL major version remain unchanged in this revision.
Schema migrations still use the existing advisory lock. There is no conversion
of pre-Drizzle data or legacy configuration aliases in this development revision.
