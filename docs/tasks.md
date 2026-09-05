# Tasks

A Portta task is local work. It belongs to a Project and may point at a
repository, an environment and a service. A GitHub issue is an optional
binding, never the row itself. See [ADR 0032](adr/0032-portta-development-model.md).

The workspace is `/projects/:slug/tasks/:id`. `/tasks/:id` reaches the same page from an id alone, which is what `portta tasks show` prints. Creating a task from the panel
is kick-create: **Nova tarefa** inserts a draft and opens that page. The title
starts as `New task` (shown localised). The first real edit promotes it. An
untouched draft stays off the board; a second click reopens it; intact drafts
older than 24 hours are removed.

`portta tasks create`, MCP and GitHub sync write published tasks.

## Board and editing

The board persists a sparse integer rank in `tasks.position`. Ranks normally
have a gap of 1024; moving a card writes a midpoint between its neighbours.
Only the destination column is compacted when no integer gap remains. The UI
updates optimistically and rolls back if `POST /api/tasks/:ref/move` fails.

The task page is read-first: the title and properties edit inline, while the
description and comments share one GitHub-Flavoured Markdown editor and one
sanitised renderer. Description edits autosave after 800 ms. Escape and a
click outside flush a pending save before returning to rendered Markdown; a
failed save keeps the local draft open so text is never discarded.

## Status

The six statuses live in `TASK_STATUS_CATALOG` in `packages/core`. Each entry
has a tone, a category and whether it is terminal. The SQL check and the Zod
enum still list those six values. A later change can add per-project workflows
without rewriting the board.

## Attachments

A task carries files: the screenshot of the bug, the log that proves it, the
JSON the API actually returned. Attach one from the file picker, by dropping it
onto the Attachments section, or by pasting a screenshot straight from the
clipboard.

| Limit | Value | Enforced by |
|---|---|---|
| Size per file | 10 MB | `ATTACHMENT_LIMITS` and a SQL `CHECK` |
| Files per task | 25 | `ATTACHMENT_LIMITS` |
| Filename | one path segment, 255 chars | `safeFilename` |

The bytes live in `task_attachments` in PostgreSQL rather than on disk. Every
filesystem path the panel touches is a channel shared with the host —
`state/metrics` is written by the collector, `state/runner` is read by the
runner, `traefik-dynamic` is read by Traefik. An attachment is none of those:
it belongs to a task, it is only ever read back through the API, and it must
disappear when the task does, which makes it a durable decision and puts it in
the database ([ADR 0013](adr/0013-what-the-panel-persists.md)). It also means
an existing install gains attachments by running a migration rather than by
re-running Compose with a new mount, and that a database backup is complete.

The content type is an allowlist, not a guess. A type the panel will render —
PNG, JPEG, GIF, WebP, AVIF, PDF, plain text, Markdown, CSV, JSON — is kept;
anything else, SVG included, is stored as `application/octet-stream` and only
ever downloaded. SVG is excluded deliberately: it can carry script, and these
bytes are served from the panel's own origin. Every download goes out with
`X-Content-Type-Options: nosniff` and a `sandbox` CSP.

`GET /api/tasks/:ref/attachments` lists the metadata; the bytes are behind the
`downloadUrl` each entry carries, so a task with ten screenshots is not a
ten-megabyte JSON response. `POST` takes `multipart/form-data` with the file in
a `file` field, which is what a browser's file input and `curl -F` both speak.

## Import and export

Example stacks under `docker/examples/*/portta.example.json` are the first
consumers. The schema is versioned (`schemaVersion: 1`) and lives in
`packages/core` as `ExampleDocument`.

References are names: `repository`, `environment`, `service`, `parent`. Never
database ids. `key` is stored as `source_key` and is unique per project. A
second apply updates the same rows.

```bash
just dev
just dev --demo           # stacks and panel records
portta examples apply     # re-import manifests without cycling containers
```

`GET /api/projects/:slug/tasks/export` writes the same shape back. Tasks
without a `source_key` export as `task-<id>` so a later import can reconcile.

## GitHub binding

`task_github_links.sync_state` is `synced`, `pending`, `conflict` or `error`.

- No pending local edit → remote wins on the next sync.
- Pending local edit and a still remote → keep local.
- Both moved → `conflict`; resolve with `POST /tasks/:ref/github/sync` and
  `resolve: local|remote`.

Title, description, status, priority, labels and assignee travel across the binding.
Comments, parent, agent, type, service, due date and draft do not. A local
comment can be explicitly published as a copy on the bound issue; its GitHub
id, URL and publication state are recorded without changing the local source
of truth. A draft cannot
be published to GitHub until it has a real title.

Linking an existing issue requires choosing an initial direction: `pull`
imports the issue fields into Portta; `push` publishes the current Portta task.
There is no implicit winner at link time.

## REST surface

The UI, CLI and MCP share the same task routes. `GET /api/tasks` offers global
filtering; project-scoped list/create routes remain available. A task supports
partial `PATCH`, `DELETE`, `/move`, `/comments`, `/subtasks`, `/activity` and
the explicit `/github/*` operations. Mutations carry a source and generate the
same activity regardless of whether they came from web, CLI, MCP or API.

## Commits and a task

How Portta can tell which commits belong to a task, and how reliable each
signal is.

| Strategy | Reliability | Notes |
|---|---|---|
| `task → dev_sessions → commits[]` | High | The session carries `task_id` and `repository_id`. `commit-watch` appends new HEADs to the active session. This is the path agents already use (`portta sessions start --task`). |
| Explicit record at commit time | Highest | The same chain, written when the agent (or the host watcher) sees the commit, not reconstructed later. Prefer this. |
| Task id / `PORTTA-123` / `task:123` in the message | Low | Easy to omit, forge or collide. Useful as a fallback, not as the source of truth. |
| `#123` in the message | Low | Ambiguous once more than one GitHub repository is in play, and unused for local-only tasks. |
| Branch `task-42-*` | Medium | Already used to infer `task_environments`. Good for "this environment is for that task", weaker for every commit on a long-lived branch. |
| Linked GitHub issue + PR | Medium | Works when the task is bound and the PR is the unit of merge. Silent when GitHub is down or the work never opened a PR. |

**Local git, GitHub API, or both?** Both, with different jobs. `portta repos
scan` already collects the last twenty commits from the host without mounting
the tree into the panel. The GitHub API adds pull requests and remote-only
history. Neither replaces the session record.

**Agent commits.** An execution that starts as `task → session → repository`
should keep writing `dev_sessions.commits` (and `activity_events` of kind
`repository.commit`) as HEAD moves. Heuristics on the subject line are a
backfill for sessions that were not opened, not the primary design.

**A human-friendly task key (`BDH-42`).** Not minted yet. `#id` is already the
stable ref in the API, the CLI, MCP, `portta.task=#42` and branch names. A
prefix per project would help commit messages and chat, but it is a product
choice (slug? custom prefix? collision with GitHub `#n`) and can wait.

**Several repositories.** One session is one repository. A task that spans
repos is several sessions, aggregated on the task page the way it already
aggregates session commits today.

**What to show later.** Keep the current list (sha, subject, actor, age),
sourced from sessions first, then optionally from the scan / a bound PR. Do
not scrape every message looking for `#123` and present that as certainty.

## Follow-ups

Left out of this workspace on purpose, tracked as issues:

- [#40](https://github.com/fabioassuncao/portta/issues/40) — workflows per Project, on top of the catalog
- [#41](https://github.com/fabioassuncao/portta/issues/41) — a human-friendly key besides `#id`
- [#42](https://github.com/fabioassuncao/portta/issues/42) — a complete activity timeline
- [#43](https://github.com/fabioassuncao/portta/issues/43) — richer GitHub conflict resolution
- [#44](https://github.com/fabioassuncao/portta/issues/44) — commits bound through the session
- [#45](https://github.com/fabioassuncao/portta/issues/45) — import/export from the panel
