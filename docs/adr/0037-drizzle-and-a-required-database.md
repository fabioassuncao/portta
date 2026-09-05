# 0037. Drizzle, and a database the panel refuses to start without

**Status:** Accepted, supersedes the optional persistence in [0013](0013-what-the-panel-persists.md)

## Context

Persistence was optional by design: the panel kept observations in Docker and
decisions in PostgreSQL, and a panel whose database was down still answered
about the host. Rows were written through hand-written SQL and a migrator of
our own, and the tests ran against fakes that implemented the repository
interfaces.

Two things broke that. Accounts: a panel that signs people in cannot decide who
is asking when its database is gone, and answering as the local operator
instead would be a panel that opens itself when its database fails. And the
fakes: every repository had a second implementation that no query ever ran
against, so a wrong column name in real SQL was found by an operator rather
than by a test.

## Decision

**Drizzle over postgres-js, one schema, one migrator.** `packages/db` holds the
tables, the enums generated from `portta-core`'s own constants, the client and
`migrateWithLock`. Types come from the schema rather than being restated beside
it.

**PostgreSQL is a boot dependency.** `main` exits rather than serving a panel
that cannot remember anything or say who is asking. A connection that drops
*after* boot is a different thing and still becomes a 503 on the routes that
need it, so a database restart is a degraded panel rather than a dead one.

**Tests run against the real engine.** `packages/db`'s `createTestDb()` starts
PGlite and applies the same migrations; the repository fakes are deleted. A
suite is slower by seconds and tests the SQL that actually runs.

**The migration is a reset, not a conversion.** `0000_initial.sql` is the whole
schema. A volume holding the pre-Drizzle schema is detected — `schema_migrations`
present, `drizzle_migrations` absent — and the panel refuses to open it with
the command that fixes it. There is no compatibility path: the old schema had
no accounts, no roles and no memberships, and inventing them for existing rows
would be inventing an owner.

## Consequences

`portta reset --yes` is a required step for anybody upgrading, and it takes the
panel's data with it. That is stated in the release notes, in the error the
panel prints, and in `docs/persistence.md`.

`portta db` keeps its shape: status, shell, dump, restore. The CLI still never
opens PostgreSQL itself — it asks the panel, or runs `psql` in the ephemeral
toolbox on the private network.

What the database holds is unchanged in kind: decisions and identity, never
observations. Containers, networks, ports and health are still read from Docker
at request time, so a container that disappears simply stops appearing.
