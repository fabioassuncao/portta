# 0032. The Portta development model

**Status:** Accepted, amended by [0033](0033-tasks-are-local-issues.md) and by [0038](0038-roles-and-project-access.md) — a Project is now also a boundary, with members; amends [0010](0010-git-collected-on-the-host.md),
[0013](0013-what-the-panel-persists.md), [0018](0018-github-access-lives-in-the-panel.md)
and [0031](0031-projects-home-and-project.md)

## Context

[ADR 0031](0031-projects-home-and-project.md) settled the words: a Project
is what is being developed, a Repository is its Git, an Environment is one
execution of it on this Node. It left the persistence rename for later and
did not say what a Project *contains* beyond repositories and environments.

Three things the product had grown were still shaped by their first
implementation rather than by the work they serve:

- **A Repository existed only through the GitHub App.** The `Repository`
  type was never populated; the only repositories a Project could own were
  rows of `github_repositories`. A Project with a local clone and no App had
  no repository, and therefore no board, no tasks and no MCP.
- **A Task was a projected GitHub issue.** `core/tasks.ts` was a view over
  `github_issues`; status and priority were labels on GitHub; every task verb
  called `requireGitHub()`. Offline, or on a repository the App was not
  installed on, there was no work to do because there was nowhere to write it.
- **Nothing remembered what happened.** `X-Portta-Actor` went to stdout,
  SSE was ephemeral, and "who is working on what, since when, and what did
  they produce" had no answer the panel could give from another machine.

The centre of the experience has to be the Project and its development
cycle — demand, code, execution, test, analysis, correction, completion — for
a person and for an agent, through the UI, the API and the CLI alike.
Infrastructure stays; it is reorganised around that.

## Decision

> **Portta organises technology around the work of development, not the
> work of development around the infrastructure.**

### The model

```text
Node (Projects Home)
└── Project ──────────────── Tasks (parent → subtasks) ── GitHub Issue binding, optional
    ├── Repositories ─────── Git · recent commits · instruction files · pull requests
    ├── Environments ─────── Services ── Containers · endpoints · logs · resources
    ├── Development Sessions (actor × task × repository × environment)
    ├── Activity (what happened, with references to all of the above)
    └── Effective instructions = Platform + Project + Repository + Task
```

Invariants the code must keep:

1. **Everything above exists without GitHub.** GitHub adds a binding, pull
   requests and synchronisation. It never defines whether a Repository or a
   Task exists.
2. **Project, Repository and Task are decisions.** They are persisted.
   Environment, Service, Container, Git state and resources are observations:
   read from Docker and from files the host wrote, with their age on screen.
3. **A Task belongs to one Project**, and optionally to a Repository, an
   Environment and a Service. A Subtask is a Task with a parent in the same
   Project.
4. **A Repository belongs to exactly one Project.** ADR 0018 allowed one
   GitHub repository in several workspaces; nothing depended on it and it
   made Task, Activity and resource attribution ambiguous. The tightening
   ADR 0031 announced lands here.
5. **Every write that matters is an activity event with an actor.**

### Persistence

The rename ADR 0031 deferred is done: `workspaces → projects`,
`projects → environments`, with their settings tables. New tables:
`repositories`, `tasks`, `task_notes`, `task_github_links`,
`task_environments` (ex-`issue_environments`), `dev_sessions` and
`activity_events`. Migrations `0007` to `0010`.

The status vocabulary stays `backlog, ready, in_progress, review, blocked,
done`: it is what the `status:*` label convention already spells, so a bound
issue and a local task read the same. The UI may call `ready` "To do".

### GitHub is a binding, not the base

A projected issue is still a cache with an age (ADR 0018 §4). What changes
is what it feeds: a `task_github_links` row ties one Task to one issue. A
write to every Task is committed locally first. A bound Task then attempts an
explicitly defined push to GitHub; failure leaves the local write intact and
marks the binding `pending` or `error` for retry. A remote change that
lands on a pending local edit is a `conflict`, kept and shown, never silently
resolved. Existing issues on a repository a Project owns became Tasks in the
migration, so no board was lost.

### What the host collects, amended

ADR 0010 said *metadata only: never a diff, never a file's contents, never a
commit list beyond HEAD*. Two of those three are lifted, narrowly:

- **The last twenty commits, as metadata** (sha, subject, author, date).
  Reviewing what an agent produced without a terminal is the point of the
  Task page; a link to the forge does not work for a repository that has no
  forge.
- **The content of the instruction files an agent reads** — `AGENTS.md`,
  `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`, `.clinerules`, `.cursorrules`,
  `.windsurfrules`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`
  — from that allowlist and nowhere else, bounded at 64 KiB per file, with
  a hash and a dirty flag. Never a `.env`, never a diff, never an arbitrary
  path. `packages/core/src/repos-scan.ts` is the allowlist; a test asserts a
  `.env` next to an `AGENTS.md` stays out.

Collection is keyed by repository (the realpath of the git root), not by
Compose project, and an index maps each environment to the repository it
runs from. The metrics watcher runs the scan once a minute, so freshness no
longer depends on somebody running `portta up`. The panel still mounts no
project directory and runs no command.

### One API, three clients

The UI, the CLI and an agent (through `portta mcp`) use the same endpoints:
`/api/projects`, `/api/repositories`, `/api/tasks`, `/api/environments`,
`/api/sessions`, `/api/activity`, `/api/overview`, and
`/api/projects/:slug/context` — the Development Context an agent reads
before it starts. Every route declares a capability from
`packages/core/src/capabilities-api.ts`, published in the OpenAPI document
as `x-portta-capability`. A request carries a principal: the operator
(everything), read-only mode (every `*:read`), or an agent that announced
itself with `X-Portta-Actor` (the `agentCapabilities` setting; by default
everything except `*:destroy`, `config:write`, `access:write` and
`gateway:operate`). Revocable bearer tokens can carry an actor and a subset
of those capabilities; HTTP Basic remains available for operators and older
clients.

## Consequences

A Project with no GitHub has repositories, tasks, a board, sessions, an
activity timeline and a working MCP. Connecting the App later binds tasks
to issues without losing anything.

The panel is now an inventory of what is being worked on, by whom, and of
the instructions agents follow. ADR 0012's ordering — authentication before
any of this — still stands, and the collected instruction files are one more
reason the collected directory is `0700`/`0600`.

Two more tables persist decisions and two persist a bounded history.
Activity is pruned in code (ninety days, five thousand rows per Project)
rather than kept forever; it answers "what happened this week", not audit.

What this record deliberately does not build: a file browser beyond
instruction files, GitHub Projects v2 or multiple hosts.
The model above is what makes each of them an addition rather than a
rewrite.
