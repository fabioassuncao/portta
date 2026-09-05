# 0040 — The installation environment is the configuration contract

Status: accepted (development revision, 2026-09-05).

## Decision

`.env.example` owns the installation's structure; `.env` owns concrete values.
Preparation creates from the template, fills missing keys, generates missing
secrets once, and persists before consumers run. Existing values win over shell
variables. Explicit CLI configuration choices are written before resolving
Compose. Operational process selectors and fixed container paths/ports are not
parallel installation settings.

`portta-core` owns parsing, structural edits, normalization and persistence. The
zero-Node contract keeps a shared Bash/AWK adapter, used by the installer and
fallback CLI, with executable parity fixtures against TypeScript. The installer
uses an existing installation’s adapter for early reads and the downloaded
adapter for writes. A new installation has no environment to read beforehand.

Ordinary edits preserve unrelated bytes. Preparation normalizes unmarked files
once, keeps a private backup, preserves personal comments/extensions and rejects
duplicate assignments. A structural marker prevents normal preparation from
reformatting subsequent edits. Future template keys are inserted by neighbouring
keys rather than appended arbitrarily. Unknown extension keys are preserved;
only explicitly retired keys are removed at normalization.

Writes retain the inode because `.env` is bind-mounted as a file. The host and
panel share `.env-lock` for mutual exclusion and backups; it is excluded from
image contexts. A failed write is restored from backup. A crashed writer leaves
a recoverable lock instead of permitting silent concurrent writes.

## Database

`PORTTA_RUNTIME_DB_MODE=managed` maps the configured name, role and password to
`POSTGRES_*`; both application and administrative clients derive the same URL.
Internal DNS `db` and port `5432` are constants. The managed database stays on a
private network with a persistent named volume and no published port.

`external` requires `PORTTA_RUNTIME_DATABASE_URL` and omits the managed overlay.
A URL in managed mode is an error. Passwords and names are escaped in derived
URLs, and derived URLs are never persisted as an independent setting.

The managed database healthcheck waits for TCP readiness with the configured
role/database. The application authenticates and runs the existing locked
migrator before opening HTTP. An initialized volume does not follow changes to
`POSTGRES_*` automatically: startup fails on incompatible credentials, and the
installer never rotates a role or removes a volume to repair that failure.

## Consequences

The `justfile` delegates release selection to `portta up --local-release` or
`portta web --local-release up`. Development preserves source mounts and hot
reload; production consumes a built image and operational mounts only.

No legacy installation or data conversion is provided for this development
revision. Retired Vite-port and panel BasicAuth keys leave the active contract;
their previous contents remain in the private normalization backup. Existing
schema migrations and volumes otherwise retain their lifecycle.

See [configuration](../configuration.md), [persistence](../persistence.md), and
[the audit](../configuration-audit.md) for consumers and validation.
