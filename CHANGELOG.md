# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, minor releases may contain breaking changes.

## [Unreleased]

### The architecture migration

The panel is a Next application that signs people in, on a database it requires.
This is one release's worth of change to how a host is set up and operated, so
it is stated here before the rest.

**Upgrading takes one destructive step.** The panel's schema was rebuilt around
Drizzle with no compatibility path, and a volume holding the old one is
refused with the command that fixes it:

```bash
portta reset --yes     # removes the panel's database volume, and its data
portta web up
```

Projects, tasks, repositories and activity recorded by an older Portta do not
survive that. Nothing outside the panel's own volume is touched: no consumer
project, no container, no image.

**The panel asks who you are, when it is reachable.** `PORTTA_AUTH_MODE`
replaces `PORTTA_WEB_AUTH`, `_USER` and `_HASH`, and with them
`portta web auth set|status|clear|apply`.

- `disabled` answers everybody as the local operator, and is only allowed on
  loopback. The panel refuses to start any other way.
- `required` gives it accounts, four roles, sessions, an optional second factor
  and `ptt_` tokens, all in its own database.

The first account is created once, in a browser at `/setup` or from the host
with `portta auth bootstrap`. Sign-up closes the moment it exists. There is no
password reset by email; an administrator sets one, or
`portta auth reset-password` runs inside the panel's own container.

**Every access mode but `local` requires it.** `portta web up --expose public`,
`tailscale`, `vpn` and `domain` are refused without `PORTTA_AUTH_MODE=required`,
by the CLI, by `portta up`, and by the panel's process at boot. The Traefik
middleware that used to guard the panel's router is gone from every overlay;
ForwardAuth stays exactly where it was, in front of project hostnames and
shares.

**PostgreSQL is a boot dependency.** The panel exits rather than serving
without it. `docker/compose/features/db.yaml` is selected wherever the panel is.

**New commands.** `portta users` (list, create, set-role, set-password, grant,
revoke, remove), `portta auth` (status, login, logout, whoami, bootstrap,
reset-password, token), `portta protect` (host, status, remove). `portta web
auth` is gone.

**The installer no longer invents a panel password.** It asks `required` or
`disabled` — only offering the question when the panel stays on loopback —
records the mode, and ends by printing where to create the owner. `--panel-user`
is refused rather than ignored.

The details are in [authentication](docs/authentication.md),
[configuration](docs/configuration.md), and ADRs
[0035](docs/adr/0035-authentication-lives-in-the-panel.md),
[0036](docs/adr/0036-next-app-router-and-the-custom-server.md),
[0037](docs/adr/0037-drizzle-and-a-required-database.md),
[0038](docs/adr/0038-roles-and-project-access.md) and
[0039](docs/adr/0039-personal-api-tokens.md).

### Added

- **Files attach to a task.** A screenshot, a log, the JSON that reproduces
  it — from the file picker, by dropping onto the Attachments section, or by
  pasting straight from the clipboard. Up to 10 MB each and 25 per task, stored
  in `task_attachments` (migration `0014`) because an attachment belongs to a
  task rather than to a channel shared with the host. The content type is an
  allowlist, not a guess: what the panel renders inline is enumerated, and
  anything else — SVG included, since it can carry script — is a download only.
  See [docs/tasks.md](docs/tasks.md#attachments).
- **A verdict on the host.** `hostPressure` reads CPU, memory, swap, disk, GPU,
  temperature, load per core and battery against one set of thresholds and
  answers Normal, Watch, Under pressure or Critical, with the readings behind
  it. The Overview says it before it says any number.
- **The collector reports battery and CPU temperature**, so a laptop's own
  limits are visible. A host that does not report a metric grows no tile for
  it.
- **Bulk actions on Projects**, and contextual actions on every project card
  and row: start, stop, restart, archive, delete — only when the project's
  state makes them mean something.
- **`npm run viewports`** checks the panel at five widths, from a desktop to a
  tablet in portrait, and fails when the page scrolls sideways or a control
  ends up off-screen.

### Changed

- **`--demo` is the complete demonstration.** `portta up --demo`, `dev --demo`,
  `reset --demo` and `down --demo` start or stop every stack under
  `docker/examples/` and, on the way up, import each `portta.example.json` into
  the panel. It replaces `--examples` (data only) and the Make targets
  `demo-up`, `demo-down` and `examples`. `just` is the checkout wrapper; the
  Makefile is gone. `portta examples apply` remains for re-seeding without
  cycling containers.
- **The Overview leads with the host.** The machine's state moved from the
  bottom of the page to a band at the top, adaptive to what the host reports,
  with the last thirty minutes beside each measurement.
- **"List" is a real table**, for Projects and for Tasks: sortable columns,
  column visibility, multi-selection, and an arrangement remembered per table.
  Docker's container tables use it too, and now show what each container costs.
- **Task actions say what they do.** Changing a status is separate from taking
  the work, and finishing a bound task names the issue it will close.
- **Destructive actions state their impact.** Stopping a project names its
  environments and counts its containers; deleting one asks for its slug.
- **One design system.** Status, priority, type and labels are drawn from one
  presentation module, so a task looks the same on the board, in the table and
  on its own page.

### Fixed

- **`portta reset` and `portta dev` went silent for minutes.** `migrateAuthState`
  was the one `docker compose` call on that path that took `runProcess`'s piped
  default while carrying `--build`, so it built the whole panel image with
  nothing on screen. It streams now, and so do the pull, the first start of the
  panel database and the applier and runner builds. Underneath, any child whose
  output is captured reports how long it has been running after ten seconds, so
  no call site can be mistaken for a hang again; `--verbose` streams everything,
  `--quiet` silences it, and `--json` keeps stdout to itself.
  [ADR 0034](docs/adr/0034-child-process-output.md).
- **"This host is under pressure" could never appear.** It compared ratios
  against percentages. It compares ratios against ratios now.
- **A wide table pushed the whole page sideways** on anything narrower than a
  large laptop. It scrolls inside its own container, with the column that
  identifies the row pinned to the left edge.

## [0.8.0] — 2026-09-03

### Changed

- **Portta is a development platform, organised around the Project.**
  The centre of the panel, the API and the CLI is now the product being
  developed and its cycle — demand, code, execution, test, analysis,
  correction, completion — for a person and for an agent alike. Docker,
  Traefik, Git, GitHub, Cloudflare, Tailscale and the metrics stay, as the
  tools that serve it. [ADR 0032](docs/adr/0032-portta-development-model.md)
  records the model: Project → Repositories, Tasks (with subtasks),
  Environments → Services → Containers, Development Sessions, Activity,
  Instructions.
- **The schema says Project and Environment.** Migration `0007` renames
  `workspaces → projects` and `projects → environments` with their settings
  tables, drops the dead columns and the unused `integrations` table, and
  makes a Project's `relativePath` writable. `/api/workspaces`, `#/workspaces`,
  `#/board/<slug>` and `GET /api/host` are gone; the old hashes redirect.
- **`portta repos scan` replaces `portta git scan`.** Collection is keyed by
  repository (the realpath of the git root), writes an index that maps every
  Compose project to the repository it runs from, and adds what ADR 0010
  left out on purpose: the last twenty commits as metadata, and the content
  of the instruction files an agent reads (`AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/*.mdc`, …), from an allowlist, bounded at 64 KiB, never a
  `.env`. The metrics watcher runs the scan once a minute. The old verbs
  are aliases that say so.
- **`portta envs` is what `portta project` was**, with `logs` and
  `endpoints` added; `project`, `environment` and `env` remain aliases.
- **Repository discovery understands a workspace of repositories.** The host
  scan inspects Git roots directly under Projects Home and one workspace level
  below it, keeps the complete relative path (for example
  `BrasilDataHub/base-eleicoes`), and still ignores hidden and deeper
  directories. A duplicate remote never overrides an exact local-path match.

### Added

- **`portta reset` and `portta dev --reset`.** Wipe the panel database
  volume (`${PORTTA_DB_VOLUME:-portta-db}`) and restart the checkout as
  `dev`. `--yes` skips the TTY confirmation; `--examples` imports
  `docker/examples` afterwards. `make reset` and `make dev RESET=1 YES=1`
  are the Make forms. Development project volumes, `.env`, GitHub keys and
  `state/auth/` stay. `state/git/` and `state/metrics/` are cleared because
  the scan and the collector rewrite them.

- **Remembered environments.** An environment whose containers were all
  removed stays listed, with `presence: remembered`, no services, and where
  it ran: `working_dir` and now `config_files` (migration `0011`), as Docker
  last recorded them. It keeps its Project, its overrides and its task links.
- **Start through the runner when nothing is left to iterate.** Start on a
  remembered environment dispatches runner verb `up` carrying the working
  directory and the Compose files, both bounded the way directory removal
  already is; without the runner the 409 carries the exact
  `docker compose … up -d` to run on the host. Portta's own project is
  refused by name and by directory.
- **Forget.** `DELETE /api/environments/<name>` drops a remembered
  environment's row (overrides, Project link and task links go with it) and
  touches nothing on the host; a live one is refused until it is stopped and
  removed. Activity records `environment.forgotten`.
- **Repository, local-first.** A Project's repositories are rows of their
  own (`0008`): a path under Projects Home, a remote, a role; a GitHub
  repository is an optional binding, and one GitHub repository belongs to
  one Project. The panel lists the repositories the scan discovered and not
  yet registered, and a repository page shows git state, recent commits,
  pull requests, the environments running from it and its instruction files.
- **Task, Portta's own unit of work** (`0009`). It exists without GitHub:
  title, description, status (`backlog, ready, in_progress, review, blocked,
  done`), priority, type, labels, assignee, agent, parent and subtasks, an
  optional repository, environment and service, notes and history. Every
  issue of a repository a Project owned became a bound task in the
  migration, so no board was lost. A write to a bound task reaches GitHub
  first; without the App it stays local and `pending`; a remote change over
  a pending edit is a `conflict`, kept and shown. `#/projects/<slug>/tasks`
  is the board and the list; `#/projects/<slug>/tasks/<id>` is the task.
- **Development sessions and activity** (`0010`). Who is working on what,
  since when, with which commits; and what happened — task moves, notes,
  sessions, environments started, stopped, rebuilt and removed, commits the
  scan noticed — as a timeline on the Project and on the dashboard. A
  commit watch runs once a minute; maintenance prunes activity after ninety
  days or five thousand rows per Project.
- **Capabilities.** Every route declares the capability it needs, published
  in the OpenAPI document as `x-portta-capability`. A request carries a
  principal: the operator, read-only mode (every read), or an agent that
  announced itself with `X-Portta-Actor`, which holds what the
  `agentCapabilities` setting grants — by default everything but
  destroying, reconfiguring the gateway and opening a network path. The
  actor is recorded on tasks, notes, sessions and activity.
- **The consolidated Service.** `GET /api/environments/:name/services`
  answers one row per service — state, health, access with a primary
  address, resources, runtime, uptime and the actions that apply — and
  `POST …/services/:service/actions/{start,stop,restart}` operates one by
  name. The environment page is that table, with a drawer per service and an
  Open / Test menu that lists every way to reach it.
- **The Development Context and the dashboard.** `GET
  /api/projects/:slug/context` is what an agent reads before it works;
  `GET /api/projects/:slug/resources` attributes usage Host → Project →
  Environment → Container; `GET /api/overview` is the Development Dashboard
  the Overview page renders: work, sessions, attention, projects, code,
  runtime, resources.
- **`portta projects`, `tasks`, `sessions`, `activity` and `overview`** over
  the panel client, all with `--json`; `portta mcp` serves twenty-seven
  tools, one endpoint each, addressed by project.
- **Explicit Compose files and logical Projects during adoption.** `portta
  analyze|init <path> --file <compose-file>` supports a Compose file outside
  the repository root without a heuristic search. `portta init --project
  <slug>` writes `portta.project` on routed services so isolated Compose
  namespaces can belong to one Project.
- **Adoption collision diagnostics.** Analyze reports fixed `container_name`
  collisions, a Compose namespace already running from another working
  directory, and ambiguous `name:`/`COMPOSE_PROJECT_NAME` choices. The panel
  reports a suspicious split working directory as a warning rather than a
  fatal error.

### Added (earlier in this cycle)

- **`portta db migrate` and `make db-migrate`.** Apply pending panel SQL
  without restarting the panel. `portta dev`, `portta web up` and
  `portta web dev` do the same after the panel is healthy; a failure is a
  warning, because PostgreSQL is a soft dependency. The development overlay
  bind-mounts `apps/web/migrations` so a new file is visible without
  rebuilding the image. The CLI calls `POST /api/database/migrate` and
  never opens PostgreSQL.

- **Projects Home, and the words Project and Environment.** A Node has one
  filesystem root (`PORTTA_PROJECTS_HOME`) where managed Projects live. A
  Project is the product; an Environment is one execution of it on this
  host (today, a Compose project). `GET /api/projects` lists Projects;
  `GET /api/environments` lists what `/api/projects` used to list.
  `/api/workspaces` is a deprecated alias. The panel lists products at
  `#/projects` and Compose stacks at `#/environments/<name>`; an old
  `#/projects/<compose-name>` bookmark still opens the environment when
  that slug is not a registered product. `portta environment` is an
  alias of `portta project`. The installer asks where projects should
  live. Changing the Home changes the reference; files are not moved.
  See [ADR 0031](docs/adr/0031-projects-home-and-project.md).

- **Rebuild a project, and remove one from this host.** Rebuild asks the
  runner for `compose up --build` and shows the log; rebuild without cache
  is offered with its cost stated and is never the default. Removal is two
  named actions — keep data, or include local data — each requiring the
  Compose project name typed back, checked on the server. The dialog states
  that GitHub is not touched. Without the runner the panel removes the
  containers it can and prints the exact remaining command. Directory
  removal is opt-in, runner-only, and refused on a dirty tree.

- **Start, stop and restart a whole project from the panel.** The action
  iterates the project's existing containers in Compose dependency order,
  refuses the lot if any container is a Portta component, and reports each
  service. Restart is an ordered stop then start. Containers that have
  vanished leave Start disabled, with a reason that names the runner.
  `portta project start|stop|restart` does the same from the host.

- **The Overview shows this machine's real capacity.** The CLI collector
  talks to `systeminformation` for the machine and to `docker` for
  runtime and container stats, writes
  `state/metrics/current.json` and a 60-minute JSONL history, and never
  runs inside the panel. On macOS the host is the Mac; OrbStack or Docker
  Desktop is a runtime hint, not the machine. Projects are aggregated from
  Compose and `portta.project` labels. A snapshot older than 30 seconds is
  marked stale. `portta up` and `portta web up` start the watcher; `down`
  stops it. See [Host metrics](docs/host-metrics.md).

- **The Traefik dashboard is reachable from the panel, behind ForwardAuth.**
  `PORTTA_DASHBOARD_EXPOSE=domain` routes `api@internal` on a derived
  hostname, with the same login as the panel and without `TRAEFIK_API_INSECURE`.
  Settings show the address, its scope, and Open only when it is usable.
  The loopback path and the `doctor` verdict are unchanged.

- **Every address a datastore has, and a connection string that works.**
  TCP services share the endpoint model HTTP already used, so a routed
  Postgres shows one address per network that can carry it, in the hostname
  style Traefik actually routes. Connect reads conventional environment
  variables on demand — never during a snapshot — and masks the password
  until asked. A kind whose routing is unsupported still shows only the
  internal endpoint.

- **The panel may operate a project, without owning it.** ADR 0030 amends
  ADR 0001: Portta still does not own a project's containers, volumes or
  release cycle, but it may start, stop and restart what it can see, and it
  may ask Compose to rebuild or take a project down through one opt-in runner
  (`PORTTA_RUNNER=true`) whose command is fixed at creation. The runner is
  absent from the Settings catalogue. A project without a Compose working
  directory label is reported as not operable, with a reason.

### Changed

- **The documentation site is three columns.** The table of contents sits on
  the right edge, matching the sidebar on the left, so the article uses the
  space between. The page shows its section and title above the Markdown,
  the search sits in the middle of the header, and the heading in view is
  marked in the contents list.

- **Mermaid diagrams render in the documentation site.** The library ships in
  the docs bundle and draws the fence in the browser, in both themes. A
  diagram that fails to parse stays as the source. GitHub still shows the
  fence.

- **Documentation tables have a thin border.** Data tables and the overview
  screenshot grid share the same light outline and internal dividers, with
  rounded corners.

- **Panel screenshots live in `docs/images/`.** The README, the web-ui guide
  and the documentation site read them from the same directory as the
  corpus, not from `.github/images/`.

### Fixed

- **`include:` under the runner.** The runner handed Compose `-f /host<file>`,
  so any path a Compose file named (`include:`, `extends`, `env_file`, a
  relative bind) resolved against the runner's own root and was not found.
  It now links the host directories it needs under their own paths and
  passes Compose the host paths, so files resolve as they do on the host. A
  remembered request is also refused when its working directory or Compose
  file is Portta's own root or anything below it.

- **Internal processes are no longer presented as web applications.** Worker,
  scheduler and completed migration/init services stay internal even when
  their base image exposes an HTTP port; Mailpit and object-storage consoles
  keep their real UI ports and databases never receive an invented URL.

- **The documentation site opened the panel Overview in development.** Vite on
  :5173 only proxied `/api`, so `/docs/` fell through to the panel SPA. A
  second Vite now serves the docs app and the UI proxies `/docs` to it.
  Citations to `docs/*.md` and `/docs` in Settings, diagnostics and empty
  states are deep links to that page.

- **The overview screenshots were shown as raw HTML.** The README table is
  the one HTML block in the corpus; the collector now keeps a table (and the
  tags it needs) and still escapes a script or an event handler. The image
  paths are rewritten to the copies the image carries, as they already were
  for Markdown images.

## [0.7.2] — 2026-09-02

### Fixed

- **A fresh install with `--panel-access domain` created no credential at all.**
  `needs_auth` in the installer listed `public` and `vpn` and was never updated
  when `domain` was added, so the whole authentication step was skipped — and
  the CLI refuses `domain` without a credential, leaving a host that installed
  cleanly and could not start its own panel. An update was unaffected: the
  existing credential survived through the fallback branch, which is why this
  went unnoticed.

  The test that should have caught it pinned the exact one-liner
  (`assert_contains ... 'needs_auth() { [ "$PANEL_ACCESS" = "public" ] || ...'`),
  so it passed because nothing had changed — which was the defect. It asserts
  the membership now.

### Internal

- **Two end-to-end tests raced the applier they were driving.** One finished the
  fake applier the instant it clicked Apply, before the panel had started it —
  `__finish-apply` then answered `404` for a container that did not exist yet,
  the test ignored the response, and the applier never exited. It waited the
  full twenty seconds and failed with nothing to say. It waits for the phase
  the panel only renders once the poll has seen the applier running, and both
  call sites assert the response rather than discarding it, so the next race of
  this shape fails at the line that causes it.

## [0.7.1] — 2026-09-02

### Added

- **The GitHub webhook can reach a routed panel.** Every panel path sits behind
  ForwardAuth, which expects a session cookie or a Basic credential — GitHub
  sends neither, so a delivery was refused before the panel ever saw it: a
  `401` with an empty body and nothing in the panel's log. One overlay exempts
  exactly one path, applied when `GITHUB_APP_ENABLED=true` and the panel is
  routed with `PORTTA_WEB_EXPOSE=domain`.

  It is not a hole in the panel's authentication. That path authenticates
  differently, and for a machine-to-machine callback more strongly than a
  cookie would: GitHub signs the raw body with HMAC-SHA256 under a shared
  secret, and nothing is parsed before the constant-time check passes. It is
  **not** a general "these URLs are public" list, and Portta does not offer one
  — every other panel path authenticates by session and by nothing else. The
  router names one exact path with `Path(...)`, never a prefix.
- **`portta doctor` warns when the App is on and the panel is in a mode GitHub
  cannot deliver to**, because the symptom otherwise is deliveries GitHub
  retries and this host refuses, invisibly.

### Fixed

- **The installer called a working gateway a failure.** It probes the panel for
  a `401` without credentials, once, immediately after the containers are
  recreated — and for a second or two Traefik has the container but not yet the
  router, so the probe gets a `404` that is indistinguishable from a real one.
  Updating a healthy host reported "some health checks did not pass" while the
  panel answered `401` moments later. The probe waits for the answer it expects
  now, and still gives up.
- **The probe reaches a routed panel by name.** In `domain` mode nothing is
  published on the host, so a probe at a host port checked a door that does not
  exist.

## [0.7.0] — 2026-09-02

### Added

- **`PORTTA_WEB_EXPOSE=domain`: the panel on the gateway's own domain, over
  HTTPS.** The `public` mode the installer offers first puts the panel on its
  own Traefik entrypoint, which terminates no TLS — by design, because there is
  no certificate a public CA will issue for a bare IP. Once a host has a real
  domain that constraint is gone, and what remained was a panel credential
  crossing the internet in clear text on every request. `domain` routes the
  panel at one hostname on `websecure`, where the certificate the gateway
  already terminates covers it, behind the same login page a protected project
  gets. It requires TLS and a credential, and is refused without either.

  It keeps both properties that made `public` safe enough to be the default:
  the router names exactly one host, so publishing the panel still publishes no
  application, and no host port is published beside it, so there is no second
  door the middleware never sees. It gives up one — `websecure` carries every
  routed application, where the `panel` entrypoint carried only the panel.
  [ADR 0021](docs/adr/0021-panel-access-modes.md) records the trade, and why
  ADR 0012's blanket refusal of a routed panel on a public profile no longer
  applies now that [ADR 0027](docs/adr/0027-forward-authentication-service.md)
  replaced BasicAuth with a real login page, host-scoped sessions and a limiter.
- **`install.sh --panel-access domain`** and **`portta config set panel.host`**,
  the hostname the router matches and the credential is looked up by. They are
  one setting because a mismatch fails the panel closed.
- **`portta doctor` checks a routed panel**: that TLS is on, and which host it
  answers on.

## [0.6.1] — 2026-09-02

### Added

- **`install.sh --tls <email>`.** The installer asked for a domain and then left
  the operator on plain HTTP with no flag to say otherwise; enabling HTTPS meant
  editing `.env` by hand afterwards. It is one flag now, and HTTP-01 is what
  makes that possible: DNS-01 would need a provider credential the installer has
  no business prompting for. It refuses a bare IP or an auto domain, because no
  public CA will sign one.

## [0.6.0] — 2026-09-02

### Added

- **ACME over HTTP-01, for a public host that holds no DNS credential.**
  Portta asked for a wildcard, and a wildcard can only be issued over DNS-01,
  so every remote install needed a DNS provider token before it could serve
  HTTPS at all. `ACME_CHALLENGE=http` proves control over `:80` instead and
  gets a certificate per hostname — nothing but an A record and a wildcard A
  record, which is what comparable platforms ask for and why they ask for
  nothing else. `dns` stays the default: it is the only challenge that issues
  a wildcard, so a hostname works over HTTPS before anything runs on it, and
  the only one a gateway Let's Encrypt cannot reach can use at all.
  [DNS and TLS](docs/dns-and-tls.md) compares the two. The overlay is split so
  exactly one challenge is ever configured — asking for a wildcard SAN over
  HTTP-01 makes every issuance fail rather than fall back — and the provider
  credential now lives only in the DNS-01 overlay.
- **`portta doctor` names the challenge in use and checks its one
  prerequisite**: a credential for DNS-01, a reachable `:80` for HTTP-01.
- **`portta config set acme.email`, `acme.challenge` and `acme.caServer`.**
  Without them an ACME setup could be started from the CLI and not finished
  with it, because `TLS_MODE=acme` is refused until `ACME_EMAIL` is set.

### Fixed

- **A proxied wildcard is no longer reported as a broken one.** `portta doctor`
  compared the resolved address against this host's and called anything else a
  failure, so a domain behind Cloudflare's orange cloud, a CDN or a load
  balancer failed a check it could never pass while the traffic arrived here
  perfectly well. It is a warning now, naming both causes.

## [0.5.1] — 2026-09-02

### Fixed

- **`portta public enable` pointed every bind mount at the wrong directory.**
  It built the Compose file list by hand instead of going through
  `composeArguments`, which is what carries `--project-directory`, so Compose
  anchored every relative bind at `docker/compose/` and created `.env`,
  `VERSION`, `config/traefik/dynamic` and `state/auth` there as empty
  directories. The gateway came back up healthy and reading none of its own
  configuration: the panel answered `500 EISDIR` for `/api/status` with a
  gateway version of `unknown`, and the authentication service had lost the
  protection store it fails closed without. The audit now fails any Compose
  invocation that names a file under the gateway root without going through
  `composeArguments`.

## [0.5.0] — 2026-09-02

### Added

- **The panel serves the project's own documentation, offline.** Every guide and
  ADR in the repository is rendered at build time into the panel image and
  served at `/docs/` with search, in-page navigation and working links between
  pages — no network request, no CDN, no Markdown parser in the panel's
  production tree. The build is also the link checker this repository never had:
  a link that meant to reach a documentation page and named one that does not
  exist fails the build. The API console moved in beside it, and the two
  switches are independent (`PORTTA_RUNTIME_DOCS`, `PORTTA_RUNTIME_API_DOCS`).
- **A task-shaped API, and `portta mcp` over it.** Issues, sub-issues and their
  state are reachable as verbs rather than as rows, over the same projection and
  authorization boundary the panel uses. `portta mcp` exposes eight of them to
  an agent over stdio; it refuses a non-loopback panel URL unless you pass
  `--allow-remote`. See `docs/mcp.md`.
- **`portta tunnel`, `backup`, `restore` and `repair` exist on every host.**
  They were documented, shipped and unreachable on any host with Node, because
  the TypeScript entry point had never heard of them: `portta backup` answered
  `unknown command` and exited 2. All four are now real commands with real
  help, and a failing one exits with the code it actually failed with.

### Changed

- **Shell is for bootstrap; TypeScript is the default.** `scripts/cmd` is empty:
  `tunnel`, `tls`, `remote` and `maintenance` are TypeScript, and `doctor` is a
  typed diagnostic of forty-odd checks against one container inspection, with
  the shell keeping a seven-check fallback for a host with no Node. The boundary
  is written down in `docs/adr/0029-shell-only-for-bootstrap.md`, with a verdict
  for every script that remains, and a parity test that runs both and pins the
  fallback to a subset of the same check ids and statuses.
- **One table says what a service is.** Kind, default port, TCP entrypoint,
  hostname and connection string moved into `packages/core`, so the CLI, the
  panel and the diagnostic answer from the same place. Cassandra and Neo4j route
  as TCP with the rest.

### Fixed

- **The authentication service could not read its own files on a Linux host.**
  It and its migrator were pinned to the image's default uid, while `.env` (600)
  and `state/auth` (700) belong to whoever ran the installer — root, on a VPS.
  A clean install died on the migration step with `EACCES: permission denied,
  open '/app/state/.env'` and never came up; a Mac hid it, because Docker
  Desktop maps ownership across the bind mount. Both now take
  `PORTTA_AUTH_USER`, written by the installer and by `portta web up`, the way
  the panel already took `PORTTA_WEB_USER`.
- **The login page was never shown for a protected project hostname.** The auth
  service answered a browser with a relative `Location`, which Traefik resolved
  against the auth service's own URL — so the browser was sent to
  `http://portta-auth:4180/...`, a name only Docker can resolve. The redirect is
  now absolute, built from `X-Forwarded-Host` and `X-Forwarded-Proto`.
- **The GitHub reconciliation timer the documentation already promised** now
  runs; `GITHUB_SYNC_INTERVAL_MINUTES` was a setting nothing read.
- **A unit suite recreated the developer's own gateway.** `maintenance.test.sh`
  ran a real `portta repair` against the real PATH, which on any machine with
  Docker reconciled the developer's containers with Traefik's dynamic directory
  bind-mounted from a temporary directory the test then deleted. Every protected
  host 404'd afterwards. The suite routes through the existing stub, and an
  audit check now fails any unit suite that runs a container-reconciling command
  against the real PATH.
- **The apply end-to-end suite passed or failed on the developer's own `.env`.**
  It wrote a value that was already set on a host at that log level, so the
  `up` it asserted on was a no-op.
- **The installer's closing summary contradicted an enabled public install**,
  telling the reader to run the command they had already run.

## [0.4.0] — 2026-09-02

### Added

- **A login page in front of the panel, protected shares and project
  hostnames.** Traefik's BasicAuth kept the credential check ahead of the
  protected process, but it handed browsers an unbranded native dialog with no
  session and no logout, wrote hashes into Traefik's dynamic directory, and
  could not slow an attacker down. `portta-auth` now runs as a separate process
  on the HTTP network with no published port, no Docker socket, no database and
  a read-only mount of its own store, and Traefik calls its `/verify` endpoint
  before forwarding a protected request. A browser navigation without a
  credential is redirected to `/__portta/auth/login` on the host it asked for
  and returned to the path it wanted; REST, webhook, health-check, SSE and
  WebSocket requests are never redirected, and keep answering `401` until they
  send the Basic credential they always sent. Sessions are stateless HMAC
  cookies — `HttpOnly`, `SameSite=Lax`, host-only, `Secure` over HTTPS — and
  last twelve hours; setting or clearing a credential bumps that host's epoch
  and signs its existing sessions out. Five failures in ten minutes lock a
  host and address pair for fifteen minutes, after progressive delays, and the
  logs carry the scope, the address and the outcome, never a password, cookie
  or authorization header. New credentials use scrypt while existing apr1,
  bcrypt and `{SHA}` hashes keep working, so nothing has to be re-set on
  upgrade, and `portta web auth` and `portta share` keep the shape they had.
  An unavailable auth service fails closed. Read
  `docs/adr/0027-forward-authentication-service.md` for the trust boundary.
- **`portta auth protect <host>`** extends that same front door to a project's
  own hostname. Portta never edits a consumer project's router, so you opt the
  router in with one label; until you do, an unresolved protection fails
  closed. `portta auth status` and `portta auth unprotect` inspect and remove
  the records without ever exposing a hash. See `docs/authentication.md`.
- **`portta doctor` checks the authentication service**: the signing secret
  `portta bootstrap` generates, the store's mode, and the container's health.
- **A seven-step guide from creating the GitHub App to a filled-in panel.**
  The Settings screen points at `docs/github.md` for "the App to create and the
  exact permissions it needs", and landed on four short paragraphs. The
  permission table now says what each permission pays for and which belong to
  later phases, the webhook is covered in practice, and every error the
  integration can show is mapped to a cause.
- **Applying saved settings from the panel, with a stopwatch while it restarts.**
  Changing `PORTTA_DOMAIN` wrote `.env`, marked the field `pending restart`, and
  then printed a command for someone to run on the host — which on a VPS reached
  only through the panel is where the flow stopped. Traefik takes its static
  configuration from the environment its container was created with, so a saved
  setting needs the containers *recreated*, and recreating them means Compose,
  which the panel deliberately cannot reach. With `PORTTA_APPLY=true` (off by
  default, a host decision, absent from the panel's field catalogue so the panel
  cannot enable itself), `portta up` now prepares a stopped container whose
  command is fixed at creation, and the panel gains an **Apply and restart**
  button that only starts it. The panel goes offline while it is recreated and
  comes back on its own; the dialog counts the time, says not to close the tab,
  and reports the applier's exit code and output if it failed. The state is read
  back from the applier rather than remembered, so a reload mid-apply resumes.
  Read `docs/adr/0026-applying-settings-from-the-panel.md` before enabling it:
  it says without softening that this lets anyone who can write through the
  panel run `portta up` on the host.
- **Pending settings are visible on every page**, not only on Settings — the one
  page where the operator already knew. With the applier off, the bar shows the
  same host command the Settings banner used to.
- **`portta up --wait`** exits only once every component is healthy, or fails
  after 180s. The applier runs with it, so its exit code means the gateway came
  back rather than that Compose accepted the plan.
- **`make dev`**: gateway up plus the panel with hot reloading, in one command.

### Fixed

- **The panel can now apply settings on a development checkout, and says why
  when it cannot.** With `PORTTA_APPLY=true` already set, a checkout still got
  no **Apply and restart** button and a bar that advised setting
  `PORTTA_APPLY=true` — advice for a key that was on. Two faults: `up` refused to
  prepare the applier whenever `PORTTA_WEB_BUILD` or `PORTTA_WEB_DEV` was set,
  on the incorrect grounds that the applier would build the panel image inside
  itself; it does not, because it holds the host's Docker socket and the host
  daemon runs the build, so the refusal is gone and the image carries buildx.
  And the panel described every missing applier with one fixed sentence, so it
  now reports which of the three reasons it is — the key is off, this host
  refuses, or `portta up` has not prepared one yet — translated rather than
  printed. An apply that rebuilds images announces it in the confirmation and
  gets a longer budget before the browser calls it a timeout.

- **The panel could not save settings from a checkout, and lost sight of `.env`
  entirely after any host-side write.** Two defects stacked. `.env` is
  owner-only, so the container has to run as whoever owns it; `install.sh`
  records that, and nothing else did, so a panel started from a checkout ran as
  the image's `node` (uid 1000) and could not write a file owned by anyone else.
  `bootstrap` and `web up` now record it too. The documentation's claim that the
  default was fine on macOS was never true — the host uid there is usually 501.
  Separately, `.env` is bind-mounted into the panel as a single *file*, and a
  file bind follows the inode: both writers replaced it through an atomic
  rename, which left the panel holding an unlinked file and reporting `.env` as
  missing until the container was recreated. Every `portta config set`,
  `web up`, `tunnel enable` and editor save did it. Both writers now rewrite in
  place, keeping a recovery copy until the write lands, and the inode is
  asserted in `packages/core/src/env.test.ts` and `tests/unit/common.test.sh`.
- **The panel ignored the private key path its own Settings page writes.**
  `GITHUB_APP_PRIVATE_KEY_FILE` was the only key in the GitHub block Compose
  did not interpolate, so the field that validated the path and flagged a
  restart decided nothing: the panel always read `/app/state/github/app.pem`.
  An operator who kept the filename GitHub gives the download got a passing
  `portta doctor` and an `unreachable` badge naming a file they had never
  typed, because the two diagnostics were reading different paths. The field
  now decides which file the panel opens. What is fixed is the *directory*,
  since `./state/github` is the only mount the key arrives through: a path
  outside it is refused on save with a message that says why, and `doctor`
  fails on such a path rather than certifying a file the panel never reads.
  An operator who set nothing notices no change.
- **The panel's Git cards went stale after `portta up`.** The automatic
  metadata scan lived in the shell entry point, which the TypeScript CLI
  replaced (ADR 0015), so the command most people run collected nothing and the
  panel kept serving whatever `state/git` last held. `up` and `web up` refresh
  it themselves now, best effort and never fatal, and the shell no longer does
  it a second time.
- **`npm run openapi` and the panel's own snapshot test disagreed on every
  release.** The generator stamps `info.version` from `VERSION`, while the test
  built the document with a hardcoded fixture version, so `openapi:check` was
  already failing on `develop` after the 0.3.0 bump while the vitest snapshot
  demanded the old value. The test now reads `VERSION` too.
- **`make help` never listed `test-e2e`**: its filter did not allow digits in a
  target name.

### Changed

- **Operational Docker image contexts now live under `docker/images/`.** The
  root-level `apply/` and `toolbox/` directories moved to
  `docker/images/{apply,toolbox}/`; application Dockerfiles remain colocated
  with their applications. The installer migrates existing runtime trees and
  manual builds must use the new paths. CLI commands, image tags and runtime
  behavior are unchanged.
- **The test suite tells you what to run while you work.** The full local pass
  took 97 seconds, so it stopped being run, and most of that minute re-proved
  what a given change could not have touched. Two thirds of it was one file
  asserting `--help` and `--version` for 91 command paths, which a group's help
  already proves in a seventeenth of the spawns, plus `doctor` walking the host
  five times where once is enough: 48.8s to 13.2s. Two panel tests waited on the
  real clock for a poll loop that exists as a plain `setTimeout` precisely so a
  test can step it. Against that, `tests/run.sh` never ran `packages/cli` or
  `apps/auth` at all, and the second is the ForwardAuth boundary: 32 assertions
  on open redirects, session scoping and cross-origin login that ran nowhere
  locally. New in `docs/testing.md`: the cost of each layer, and what does and
  does not deserve a test.
- **CI runs on Linux and one Node version.** The `cli` job was a four-way matrix
  over two operating systems and two Node versions re-running identical
  assertions, the `audit` job duplicated what `tests/run.sh` already runs, and
  the panel's unit suite ran in two jobs. macOS is verified by hand with
  `make test`, which is what `docs/compatibility.md` already claimed.

## [0.3.0] — 2026-09-02

### Fixed

- **A procfs path hung the whole panel suite on every Linux CI run.** Two tests
  needed a directory that cannot be written and used a path inside procfs. macOS
  has no such filesystem, so the write failed immediately and both passed in
  milliseconds; on Linux `mkdirSync(…, { recursive: true })` there never returns,
  and the spin is synchronous, so no test timeout can interrupt it. Every test
  that reported was passing, and the run simply never finished. Reproduced in a
  two-CPU Linux container, then replaced with a path whose parent is a regular
  file, which fails `ENOTDIR` instantly for every user including root. Fixing it
  surfaced four more defects that had been unreachable behind it, each also fixed
  here: a stale end-to-end assertion, a locale still calling the base domain
  "Local domain" after it became the `custom` value, an awk escape that behaved
  differently on mawk, and a CI job that never built the package its server
  imports.

- **Every CI job now declares a timeout.** Without one a hung step sat for
  GitHub's six-hour default reporting nothing, twice, which is how the above
  stayed invisible for so long.


- **The panel started in development mode and the production image did not
  build at all.** Four defects in the same path, each dating from the workspace
  conversion: the dev image never received `packages/core`, so `portta-core`
  could not resolve and the panel crashed on boot; the dev command restated
  `node --watch` and dropped `--conditions=development`, which pointed the same
  import at a `dist/` that stage does not build; the build stage never copied
  `tsconfig.build.json`, so `docker build` failed on the shared package; and
  leaving development mode left the Vite container serving a stale panel on its
  own port. `portta web` also reported `:8081` in development, where the
  server serves no UI, and `doctor` printed a fix under checks that had passed.

### Added

- **Installing and updating with one command.** `curl -fsSL …/install.sh | bash`
  installs, updates, recovers and prepares a host. The same command does all
  four, and running it twice changes nothing the second time. It never clones:
  it downloads only the files needed to run published images, keeps everything
  under one `PORTTA_HOME`, and never overwrites `.env`, `state/`, `config/tls/`
  or an existing dynamic Traefik file. Panel access is chosen during install
  (`public` behind mandatory BasicAuth, `tailscale`, or loopback only) and can
  be changed later without reinstalling. Publishing the panel publishes no
  application: a public panel gets its own Traefik entrypoint, which keeps the
  two decisions separate at the router level. `--non-interactive` and eight
  flags cover automation, and a credential is never accepted as an argument
  where `ps` would show it. See
  [ADR 0020](docs/adr/0020-installer-and-portta-home.md),
  [ADR 0021](docs/adr/0021-panel-access-modes.md) and [installing](docs/install.md).

- **The base domain is a mode, so a host with no domain still hands out URLs
  that resolve.** `local` keeps `*.localhost`, `auto` derives a name from the
  machine's address through sslip.io or nip.io with no record to create, and
  `custom` uses a wildcard you own. Hostnames are derived and never persisted,
  so changing the mode relabels every project at once with nothing to migrate.
  A mode that cannot be honoured falls back and says why rather than refusing to
  start. See [ADR 0022](docs/adr/0022-project-domain-modes.md).

- **Cloudflare Tunnel, as an optional way in.** A gateway can be reached over
  HTTPS from the internet with no open port, no public address and no
  certificate on the host, which is the only arrangement that works behind
  CGNAT or in a home lab. The connector carries **one** wildcard ingress rule
  for the whole gateway; Traefik keeps routing by Host, so publishing a project
  is a Docker operation and needs no Cloudflare change. Setup asks only for the
  tunnel token, which decodes into the credentials file a locally managed
  tunnel reads. The token is stored `0600`, never written to `.env`, never
  returned by any endpoint, never logged, and refused as a command-line
  argument. Measured against a live tunnel before being built: the wildcard
  matched every derived hostname, the Host header survived to the container,
  WebSocket completed a 101 upgrade, and each failure mode is distinguishable.
  Configured through the CLI and the API; the panel interface is still to come.
  See [ADR 0025](docs/adr/0025-cloudflare-tunnel.md) and
  [the guide](docs/cloudflare-tunnel.md).

- **A service has endpoints, not an access mode.** Capabilities are detected
  (localhost, LAN, Tailscale and its DNS, HTTPS and Funnel, a public address, an
  automatic or custom domain, a tunnel, Access), each with six states rather than
  yes or no, so "cannot" and "could, once somebody decides" stay distinct. A
  capability never publishes anything. Endpoints carry `usable` and `shareable`
  separately, and a name that resolves to an address Traefik does not listen on
  is reported as broken instead of offered as a URL. Detection is shell so the
  gateway still runs without Node, the verdicts are shared TypeScript, and a
  contract test compares the two shapes field by field. Present in the core and
  not yet exposed in the interface. See
  [ADR 0024](docs/adr/0024-capabilities-providers-endpoints.md).

- **`backup`, `restore` and `repair`.** `backup` archives what an installation
  cannot regenerate, `.env`, `config/` and `state/`, plus a `pg_dump` of the
  panel database taken by PostgreSQL rather than copied from its volume. It
  deliberately excludes the code, so restoring onto a newer Portta cannot
  silently downgrade it, and the archive is created under a private umask rather
  than chmod'ed afterwards. `restore` refuses a running gateway by default and
  always keeps what it replaced. `repair` recreates missing bind-mount
  directories, tightens permissions on files that must be private, recreates the
  networks and reconciles containers, without ever deleting data or touching a
  volume. `--dry-run` reports without acting.

- **A service's whole name lives in one DNS label.** `service--project` and
  `service--project--context` separate components with `--`, which `slug` can
  never produce inside one, so a hostname can be read back. Measured, not
  assumed: Cloudflare's Universal SSL covers the apex and first-level subdomains
  only, so a second level needs a paid add-on, and no wildcard certificate covers
  it either. The original `project-service` style stays the default so no
  existing URL moves. See [ADR 0023](docs/adr/0023-flat-hostname-labels.md).

- **A page per project, organised in tabs.** `#/projects/<name>` is now a
  destination of its own instead of the list filtered to one card: Overview,
  Services, Git and Logs, each addressable, reloadable and reachable with the
  browser's back button. Overview carries the tiles, the host directory and the
  endpoints grouped by service; Services gives each service its ports, networks,
  mounts, restart count, Traefik verdict and Exposure controls; Git shows the
  whole collected snapshot including **every** open pull request. A project that
  stopped renders an empty state with a route back to the list. See
  [docs/web-ui.md](docs/web-ui.md).

- **Every service's logs, in one place.** `GET /api/projects/:project/logs`
  reads each service of a project concurrently and returns one stream ordered by
  the timestamp Docker already stamps on each line, with the originating service
  on every line. A source that could not be read is reported beside the ones
  that answered instead of blanking the view, and a stopped container keeps
  whatever it logged. The Logs tab on the project page renders it through the
  existing log viewer, with a service selector whose choice lives in the URL.

- **Per-project overrides that never touch the project.** A display name,
  description, primary service, collapsed services, ordering, pin, archive and
  per-service note are set from the panel and kept in the gateway's own
  database; the derived name and hostname stay on screen beside every override,
  so nothing is ever only-renamed. A **hostname alias** genuinely resolves: it
  becomes one router in `portta-aliases.yaml`, the third generated file the
  panel may write ([ADR 0011](docs/adr/0011-panel-reads-traefik-writes-one-file.md)),
  is additive to the project's own hostname, and is refused before any write
  when it collides, sits outside a served domain, targets a non-HTTP service or
  has no unambiguous port. `portta urls` lists aliases and `doctor` flags
  one whose container is gone. With PostgreSQL stopped every project renders
  exactly as before and the override endpoints answer 503.

- **A GitHub App, and the repository projection behind it.** The panel can
  authenticate as a GitHub App, list the installations and repositories it was
  granted, and hold them in `github_installations`, `github_repositories` and
  `github_sync_state` — the projection every later phase hangs from, and the
  authorisation boundary every later operation is checked against.
  `GET /api/integrations/github` reports configuration, reachability,
  installations, repository count, rate-limit budget and last sync; the
  projected list answers from PostgreSQL while GitHub is unreachable; and
  `POST .../sync` is idempotent. Off by default, so a panel that never sets
  `GITHUB_APP_ENABLED` behaves exactly as before and makes no outbound request.
  **Added runtime dependencies: zero** — App authentication is RS256 on
  `node:crypto`, not Octokit. The private key is a file the panel mounts
  read-only and cannot write, installation tokens live an hour in memory and
  are never persisted, and no token, key or webhook secret appears in any API
  response. `doctor` fails on a missing, unreadable or world-readable key. See
  [docs/github.md](docs/github.md) and [docs/security.md](docs/security.md).

- **Workspaces: a project that owns several repositories and environments.** A
  workspace is a grouping a person creates — a name, a slug, a description, the
  repositories it owns and the environments that belong to it — and it stays
  visible with nothing running, because it is a decision rather than an
  observation. One repository may belong to several workspaces; a monorepo is
  one repository in one workspace. An environment is adopted by a manual link,
  by its `portta.project` label, or by an unambiguous repository match, and
  the reason is recorded and shown rather than left mysterious. A repository the
  App installation did not grant is refused, and deleting a workspace removes the
  grouping only — no container, volume, environment or repository is touched.
  `GET /api/projects` and every other existing endpoint are unchanged.

- **GitHub issues and sub-issues, projected and kept in step.** Issues from every
  repository a workspace owns are projected locally with their identity, state,
  type, labels, assignees, milestone and parent link, and every response carries
  `syncedAt` and a staleness flag so the list answers while GitHub is
  unreachable. Status and priority are read through one abstraction — native
  fields where a repository has them, a documented `status:` / `priority:` label
  convention where it does not — and the response always says which, because
  writing through labels shows in the issue's timeline. Sub-issue links come from
  GitHub's own API and cannot cycle; a parent in an unauthorised repository is
  dropped rather than left dangling. Three sync paths exist and are separately
  testable: initial, cursor-based reconciliation bounded per run, and a webhook
  whose HMAC signature is verified **before** the body is parsed. That route is
  the one narrow, documented exemption from the cross-origin write guard, and
  read-only mode still refuses it. `PATCH /api/issues/:id` writes to GitHub and
  updates the projection from GitHub's answer, never from the request. Open pull
  requests now have one stated source: the App when it is configured and the
  repository authorised, the host `gh` scan otherwise.

- **A backlog and a board that write back to GitHub.** `#/board/<workspace>`
  puts a workspace's open issues in six configurable-by-design columns, each card
  badged with its repository. A card moves by drag **or** through a
  keyboard-reachable actions menu using the same mutation; the move is optimistic
  and a refusal rolls it back visibly with the reason, announced in a live
  region. Filters live in the hash, so a filtered board is a link. The backlog is
  a separate list of work with no status yet, with sub-issues nested. Issues can
  be created and edited from the panel, and the panel shows only what GitHub
  confirmed. Read-only mode disables the affordances rather than failing on use.
  Drag support is a **devDependency**; the runtime image's package count is
  unchanged.

- **The issue is the link between work, code and environment.** An issue now
  shows the environments it is being worked in — state, services, endpoints,
  branch, and a link straight into the project page's Logs tab — and an
  environment shows the issue it belongs to on its Overview tab. The link is
  inferred from conventions already in use (a `portta.issue` label, a
  branch like `fix/182-…`, a namespace ending in `issue182`), can be corrected by
  hand, and **always says which**, so an association is never mysterious. An
  ambiguous match links nothing. One issue may have several environments; an
  environment belongs to at most one issue. `GET /api/projects/:project` gains a
  nullable `issue` block, so no existing client breaks, and linking writes one
  row — no container, volume or environment is touched.

### Changed

- **The fifteen compose files moved out of the repository root into
  `docker/compose/`, one directory per axis of the decision.**
  `docker/compose/attach/` decides how Traefik meets the world,
  `docker/compose/profiles/` which entrypoints answer, and
  `docker/compose/features/` what is opted into — the matrix that was previously
  legible only inside `portta_compose_files`. Names drop the prefix the directory carries:
  `compose.attach-host.yaml` is `docker/compose/attach/host.yaml`. Nothing was deleted,
  merged or renamed semantically, and `git mv` carried the history; the
  `*-tailscale` pairs stay separate because Compose profiles gate whole services,
  not the one `ports:` entry that differs between them. Every invocation now
  passes `--project-directory`, so the relative bind mounts and the monorepo
  build context resolve exactly where they did before, and the project name is
  unchanged — container names, networks and volumes are identical. `make` and
  `./bin/portta` are unaffected; only a hand-written
  `docker compose -f compose.yaml …` needs the new paths. See
  [ADR 0019](docs/adr/0019-compose-files-live-under-docker.md).

- **The self-contained Compose demos now live under `docker/examples/`.** Each
  stack moved with its supporting web content and configuration, so relative
  mounts and default Compose project names remain unchanged. Make targets, CI,
  E2E tests and documentation now use the new paths; `demo-up-all` and
  `demo-down-all` are working aliases for the existing demo targets.

## [0.2.0] — 2026-09-01

### Added

- **A publishable, machine-first CLI.** `portta` exposes the
  `portta` binary through npm and `npx`, with structured JSON, stable exit
  codes, non-interactive confirmations, safe argument-array process execution,
  idempotent `setup`, tarball smoke tests on Linux and macOS, and a complete
  contract in [docs/cli.md](docs/cli.md). Shared environment, configuration,
  namespace and inventory logic now lives in `packages/core` and is consumed
  by both the CLI and panel. The repository entry point delegates to Node when
  available while keeping the five zero-Node lifecycle fallbacks.

- **A decided monorepo and a decided answer on Node.** [ADR 0014](docs/adr/0014-monorepo-and-the-typescript-cli.md)
  records the workspace layout (`apps/web`, `packages/core`, `packages/cli`),
  the CLI / API / Core rule, the npm name `portta`, and the
  file-by-file Bash migration map. [ADR 0015](docs/adr/0015-node-on-the-host.md)
  keeps `bootstrap`, `up`, `down`, `status` and `doctor` working without Node.
  [docs/monorepo.md](docs/monorepo.md) is the contributor map.

- **A classification of state that could be shared.**
  [ADR 0016](docs/adr/0016-state-that-could-be-shared.md) records the
  five-way split, portable project identity, instance UUID and alias-as-label
  rule. No synchronisation is implemented. Issue #4 already shipped the
  schema seams this page validates.

- **GitHub access is decided, not built.**
  [ADR 0018](docs/adr/0018-github-access-lives-in-the-panel.md) puts issues
  behind a GitHub App in the panel, keeps local `git` on the host, and names
  the cost of egress, webhooks, secrets and a projection cache.
  [docs/github.md](docs/github.md) holds the source-of-truth table.

### Changed

- **The repository is an npm workspace.** The panel moved from `web/` to
  `apps/web` with history preserved. `packages/core` and `packages/cli` exist
  as private empty shells. One root `package-lock.json` feeds `npm ci` and
  the panel image, which now builds from the repository root with an explicit
  `.dockerignore` so `.env`, `state/`, `config/tls/` and `.git` never enter
  the build context.

- **Private, degradable persistence for the panel.** A pinned PostgreSQL 18
  container now stores only durable decisions and identity on its own internal
  network and named volume; it publishes no host port and never joins the
  shared HTTP network. Ordered transactional migrations establish the stable
  instance, portable project coordinates, typed settings and integrations,
  while Docker, Git and Traefik remain the sources of runtime observations.
  The panel still starts and all existing Docker-backed routes remain healthy
  when PostgreSQL is down, with an explicit diagnostic warning. `doctor`
  enforces the isolation, and `portta db status|shell|dump|restore`
  provides password-safe operations through the toolbox, including a
  confirmation-gated restorable custom-format backup.

- **A discoverable API contract for people and agents.** The panel now serves
  an OpenAPI 3.1 document at `/api/openapi.json`, generated from the registered
  Hono routes and the same Zod schemas that define the TypeScript contracts.
  Every endpoint carries parameters, request bodies, response and error
  schemas, status codes, read-only and cross-origin refusals, and the SSE event
  payload. `apps/web/openapi.json` is checked in and CI fails on byte-level drift.
  `/api/docs` is a self-contained interactive browser with no external assets;
  it defaults on for loopback and off for a routed panel unless
  `PORTTA_RUNTIME_API_DOCS=true` explicitly enables it.

- **The panel has a front door, and it is Traefik's.** `--expose vpn` used to
  put start, stop, restart and remove over every container on the host behind
  nothing but the tailnet. It now requires a credential and is refused without
  one.
  - `portta web auth set` generates a password (twenty characters over a
    thirty-two symbol alphabet, so about a hundred bits), shows it exactly once,
    and stores only its apr1 hash. Nothing puts it on a command line, where `ps`
    would show it to every user on the host. `--password-stdin` supplies your
    own; `web auth`, `web auth apply` and `web auth clear` do the rest.
  - `PORTTA_WEB_AUTH`, `_USER` and `_HASH` join the settings catalogue,
    with the hash marked secret so the API reports it as set and never returns
    it. The field refuses anything that is not a hash, which is what stops a
    plaintext password reaching Traefik because somebody filled in the wrong
    box.
  - None of it lives in the panel: no login form, no session, no cookie, no user
    store, and no route handler a bug could let past. The middleware is rendered
    into `config/traefik/dynamic/portta-panel.yaml` and referenced by the
    router in `compose.web-vpn.yaml`. A middleware Traefik cannot resolve makes
    the router fail closed. The trade is one credential for the whole panel,
    with no users and no roles ([ADR 0012](docs/adr/0012-panel-authentication-is-traefiks.md)).
  - A routed panel now defaults to read-only. `--writable` opts out.
  - `portta doctor` and the panel's own diagnostics **fail**, not warn, on
    a routed panel with no credential, matching the existing precedent for a
    non-loopback dashboard.
- **The panel says what each environment is running.** Each project carries its
  branch, HEAD with the commit subject, how much is uncommitted, and how far it
  has drifted from the remote, with the branch, commit and repository as links
  derived from the remote by string work alone.
  - `portta git scan` collects it on the host, where `git` already is and
    where the Compose labels already say which directory belongs to which
    project, and writes `state/git/<project>.json` (mode `600`) into a
    directory the panel mounts **read-only**. The panel gains no new access at
    all: no project directory is mounted into it, `EXEC` stays off, and it
    still runs no shell commands
    ([ADR 0010](docs/adr/0010-git-collected-on-the-host.md)).
  - Nothing polls. The card always says how old the scan is, marks anything
    past the threshold as stale, and shows the exact host command to refresh
    it. `portta up` and `portta web up` run one for you.
  - Read-only in both directions: no checkout, merge, rebase, fetch or push, no
    diffs, no file contents, and nothing beyond HEAD.
  - A project with no Git gets no card; a repository with no remote keeps its
    branch and loses the links; a forge nobody recognises keeps the repository
    link and loses the commit one; a project nobody scanned shows the command.
    All four are tested.
  - `portta git status` says what was collected and when, and
    `portta git clear` removes it.
- **Open pull requests, through `gh`.** `git scan --with-prs` adds each
  project's open pull requests with their review decision and whether checks
  pass. It reuses the authentication `gh` already has, so there is no token in
  `.env`, nothing for a routed panel to leak, and no rate limit of ours to
  account for. Opt-in because it is a network call per project, and cached for
  `--forge-ttl` seconds. No `gh`, a signed-out `gh` and a forge `gh` cannot talk
  to all render nothing rather than an error, and the repository link survives
  all three because it is derived from the remote.
- **Sharing one service, temporarily, with one person.** The choices used to be
  "not routed", "routed on the VPN so everyone on the tailnet can reach it" and
  "`PUBLIC_ENABLED=true`, so every opted-in service on the host is on the
  internet". None of those is "show this one thing to this one person until
  tomorrow". See [docs/sharing.md](docs/sharing.md).
  - Three states per service, and `private` is the absence of a share rather
    than a new deny mechanism: `protected` is an additional hostname behind a
    generated password, `public` one with none.
  - A share is an **addition**: a router in one generated file, pointing at the
    container by name because two projects on the shared network can both alias
    `web`. The project's own router, labels and configuration are never
    touched, so revoking one deletes a block and changes nothing else.
  - The password is generated, shown exactly once and stored only as a hash. No
    response ever carries it again; regenerating replaces the hash and shows a
    new one.
  - Every share carries a mandatory expiry, between a minute and a week. Active
    shares are counted on the Overview and expired or dangling ones show up in
    the diagnostics, because an exposure nobody remembers is the one worth
    surfacing.
  - Refusals rather than warnings, following the `service publish` precedent: a
    non-HTTP service, a service off the shared network, `public` without
    `PUBLIC_ENABLED` and `PUBLIC_DOMAIN`, and a password over plaintext HTTP on
    a remote profile.
  - `portta share list | revoke | gc` manages the same objects from the
    host, the way `access` already does for bridges.
- **Traefik's own verdict on a route.** Opening a service shows the router
  Traefik actually built, its rule, entrypoints, middlewares and resolved
  backend, and its status with Traefik's own error text when it refused one.
  That is the question labels cannot answer: the panel derives hostnames the
  same way Traefik does and is right about them, so "the labels look right and
  it still 404s" had nowhere to go.
  - `doctor` gains two checks that use it: a routed service Traefik never built
    a router for, and a router it refused, quoted rather than guessed at.
  - Read-only, over the shared network the panel is already on and never over
    `control`, which would put Traefik's read-only socket proxy within its
    reach. The host is resolved from the attachment, since Traefik has no name
    of its own inside the Tailscale namespace
    ([ADR 0011](docs/adr/0011-panel-reads-traefik-writes-one-file.md)).
  - Its own cache, its own timeout, and never on the path a page render waits
    on. A dead Traefik API costs this block and nothing else.
  - It needs `PORTTA_DASHBOARD=true`, which is off by default, and the UI
    then says the API **was not asked** rather than implying the labels were
    confirmed. The dashboard is linked to, never embedded.
- **Three optional labels, for the things inference cannot get right.**
  `portta.project` groups several worktrees under one heading when
  `COMPOSE_PROJECT_NAME` is a per-worktree namespace; `portta.repo`
  (`owner/name` or a remote URL) gives repository links with no host-side Git at
  all; `portta.git.root` says where the repository starts when the Compose
  file is not at its root. A project that sets none behaves exactly as it did
  before they existed, and the test suite asserts that rather than the
  documentation promising it. `portta analyze` reports which ones a project
  sets ([ADR 0010](docs/adr/0010-git-collected-on-the-host.md)).
- The panel mounts `config/traefik/dynamic/` read-write and may write exactly
  two filenames there, refusing every other path in its own process the way it
  already refuses a Docker call outside its allowlist. Everything else in that
  directory stays yours
  ([ADR 0011](docs/adr/0011-panel-reads-traefik-writes-one-file.md)).
- **A web administration panel, off by default.** `portta web up` starts a
  small panel on `127.0.0.1:8081` that answers the lookups that come up when
  several environments run at once: which URL a project has today, what is
  holding a port, which containers are still up from last week, and how to
  point a GUI client at a database. It complements the CLI rather than
  replacing it, and both read the same Docker labels, so they cannot disagree.
  See [docs/web-ui.md](docs/web-ui.md).
  - Projects and services grouped by `COMPOSE_PROJECT_NAME`, with their local,
    VPN and public addresses, each one copyable.
  - Every other container on the host, kept in its own section: External
    Docker and Standalone are never mixed into the list of projects the gateway
    manages. Published ports are listed with the container holding them, and a
    port claimed twice is flagged.
  - TCP access: opening and closing a bridge from the browser, creating exactly
    the bridge `portta access open` creates, labels included, so
    `access list`, `close` and `gc` keep managing it.
  - Logs, start, stop, restart, and a removal that names the container, its
    image and its volumes, and takes the container and nothing else.
  - Diagnostics the panel can make honestly from inside its container, pointing
    at `portta doctor` for the host-level checks it cannot see.
  - Settings for the common `.env` keys, from a fixed catalogue. Secrets are
    never returned by the API, only reported as set or unset.
  - Live updates over server-sent events, fed by Docker's own event stream. No
    polling.
- `portta web up | down | disable | restart | status | open | logs | build | dev`.
  `up` waits for the panel to answer before it reports success, so the URL it
  prints is never dead by the time you open it.
- The panel's own Docker socket proxy, so Traefik's stays read-only
  ([ADR 0008](docs/adr/0008-web-panel-socket-proxy.md)). It grants the read
  endpoints plus the container lifecycle and denies images, volumes, exec,
  build, swarm, secrets and the system endpoints; the panel then refuses to
  emit any call that is not on its own allowlist.
- `PORTTA_WEB*` settings, all documented in `.env.example`, and the
  `compose.web.yaml`, `compose.web-vpn.yaml` and `compose.web-dev.yaml`
  overlays.
- Screenshots in the README and in `docs/web-ui.md`, generated by the real
  panel against a fixed host (`cd web && npm run screenshots`) rather than
  taken by hand, so they stay in step with the UI and never contain whatever
  happened to be running on the machine that produced them.
  - Each service carries the mark of the technology behind it, resolved from
    the image, then the Compose service name, then the OCI title label, and
    falling back to a generic container mark. It sits next to the name, never
    instead of it, and is decorative: screen readers read the name only.

- **Databases told apart by hostname, on one shared port.** With
  `PORTTA_TCP=true` the gateway publishes one entrypoint per protocol and
  picks the backend from the TLS Server Name Indication, so two projects can
  both run PostgreSQL on 5432 inside their own containers and neither has to
  publish a port or renumber anything:

  ```
  base-empresarial-postgres.localhost:5432  ->  base-empresarial's postgres
  base-eleicoes-postgres.localhost:5432     ->  base-eleicoes's postgres
  ```

  Verified with two live instances and distinct data, for PostgreSQL and Redis.
  **MySQL cannot do this**: its protocol has the server send the first packet,
  so there is no hostname to route on before a backend must be chosen, and no
  substitute was invented for it. It keeps the loopback bridge, which still
  works for every protocol. The analysis, the measurements and the exact limits
  are in [docs/tcp-routing.md](docs/tcp-routing.md) and
  [ADR 0009](docs/adr/0009-tcp-routing-by-hostname.md).
  - TLS is terminated at the gateway, so consumer projects need no certificate,
    no `ssl = on` and no renewal. `sslmode=require` is enough.
  - Opted-in datastores join the access network, never the shared HTTP one.
  - Hostnames stay flat, `<project>-<service>.<domain>`, because a wildcard
    certificate covers exactly one label and the gateway already issues one.
  - Refused on the `remote-public` profile: a database is never reachable from
    the internet.
- `templates/overlays/09-tcp-routing.yaml` and
  `docker/examples/demo-a/compose.portta-tcp.yaml`, so a project opts in by
  copying a file.
- `portta services` and the panel's Access page show the hostname address
  where a protocol supports it, and say plainly when one does not.
- Four more example stacks, so the shapes the gateway meets are all runnable:
  [`demo-site`](docker/examples/demo-site) (one service), [`demo-shop`](docker/examples/demo-shop)
  (web, API, worker, MySQL, Redis, Mailpit and RustFS),
  [`demo-monorepo`](docker/examples/demo-monorepo), and
  [`demo-external`](docker/examples/demo-external), which never adopts the gateway and
  exists to be seen under External Docker. `demo-a` and `demo-b` stay the CI
  pair. `make demo-up-all` starts every adopted one.
- `templates/overlays/10-mailpit.yaml` and `templates/overlays/11-rustfs.yaml`:
  the UI joins the gateway, SMTP and the S3 API stay on the project network.

### Fixed

- **A share answered 502 while looking perfectly configured.** The backend port
  was taken from the container's exposed ports, but a project that already told
  Traefik which port to use (`loadbalancer.server.port`) usually exposes
  another: a base image's 80 in front of an application on 3000. The label now
  wins, so a share reaches the same backend the project's own router does.
- **One generated file with nothing in it broke every other file in the
  directory.** `http: {}` is not an empty configuration to Traefik, it is an
  invalid one, and `collecting file configs` aborts the whole directory when
  any file in it fails: with no shares and no panel credential, no generated
  router was served at all. Both files now carry comments and no `http` key
  when they have nothing to declare.
- **`portta web auth set` exited 141 and printed nothing.** Reading
  `/dev/urandom` into `tr` and closing the pipe from `head -c` kills `tr` with
  SIGPIPE, which `set -o pipefail` then reports as a failed command. The input
  is bounded first, so every stage reaches EOF.
- **`portta urls` ignored every explicit `Host()` label and every
  `loadbalancer.server.port`.** Both were read with a Go template using
  `hasPrefix`, which Docker's `inspect --format` does not have: the template
  failed to parse, printed nothing, and the code fell back to the derived
  hostname and `auto` without a word. `scripts/cmd/clients.sh` had documented
  that exact trap since it was written. Labels are now read out of the template
  and filtered in the shell, and a test fails the build if `hasPrefix` reappears
  in a shipped script.
- **The panel called a hostname-routed database an HTTP service.** Opting a
  datastore into TCP routing also sets `traefik.enable`, and the container's
  kind was read from that label alone, so PostgreSQL was listed as `http`. It
  is now derived from whether the container actually ended up with a URL, the
  same question `urls` and the Access page already ask.
- The TCP routing suite waited for the PostgreSQL routes and then asserted
  against Redis, which has routers of its own that do not necessarily go live
  at the same moment. It passed on a quiet machine and failed on a loaded CI
  runner. Each protocol now waits for its own routes.

### Security

- The panel is never published on the internet: `--expose public` is refused,
  the VPN overlay is refused on the `remote-public` profile, and the default
  bind is loopback. Routing it over the VPN now also requires a credential.
- **Enabling the Traefik dashboard is broader than its published port
  suggests, and this is now documented.** Insecure mode listens inside a
  namespace attached to the shared network, so while the dashboard is on, any
  adopted project's container can `curl http://traefik:8080/api/rawdata` and
  read the routing configuration of every other project on the host. The
  loopback bind constrains the host, not the network. This was already true; it
  is now in [docs/security.md](docs/security.md) rather than inherited by
  accident.
- Mutating requests must come from the panel's own origin, so a page on another
  site cannot drive it through `127.0.0.1`.
- A removal always sends `v=0&link=0`: volumes, networks and images outlive the
  container, and no code path in the panel can prune anything.

## [0.1.1] — 2026-08-31

### Fixed

- **`analyze` aborted halfway through its report on any host without `lsof`.**
  `portta_analyze_port_holder` returned the exit status of its last probe, so
  "nothing holds this port" came back as a failure; under `set -e` that killed
  the assignment and the rest of the report with it. It passed on macOS, where
  `lsof` is always present, and failed on Linux. The helper now always succeeds,
  also understands `ss`, and has a regression test that runs it with an empty
  `PATH`.
- The `*.localhost` resolution check demanded `127.0.0.1`. RFC 6761 requires
  loopback, and systemd-resolved answers `::1`, which is equally correct.
- The audit suite matched its own text, since it contains every forbidden
  pattern as a search string.
- `bootstrap` now tightens `.env` to `0600` when it is looser. The documented
  quick start, `cp .env.example .env`, inherits the umask and immediately
  tripped `doctor`'s own permission check.

### Changed

- CI uses `actions/checkout@v5`; v4 runs on a deprecated Node runtime.

`v0.1.0` is tagged but was never green on Linux. Use `v0.1.1`.

## [0.1.0] — 2026-08-31

First release. Experimental, and the "Not verified" section below is part of
the release notes, not a footnote.

### The gateway

- **Traefik `v3.7.12`** holding 80 and 443 for the whole host, so no project
  needs to publish an HTTP port. Discovery goes through
  `tecnativa/docker-socket-proxy:v0.5.0`, which mounts the Docker socket
  read-only, allows only the five endpoints the provider calls, denies every
  write, publishes no host port, and sits on a network created `internal: true`.
  The socket is never mounted into Traefik.
- **Hostnames derived automatically** from the labels Compose already injects:
  `<compose-project>-<service>.<domain>`. A project opts in without naming
  itself anywhere, and a new worktree gets new hostnames from one environment
  variable.
- **`exposedByDefault=false`**, so a service is routed only when it sets
  `traefik.enable=true`.
- **Three profiles** as composable Compose overlays: `local`,
  `remote-private`, `remote-public`. Exactly one attachment overlay decides how
  Traefik meets the world.

### Parallel environments

- `COMPOSE_PROJECT_NAME` is the whole mechanism. Four environments, two
  worktrees of one project among them, run at once with web on 3000, api on
  8000, Postgres on 5432 and Redis on 6379, and no host port published by any
  of them.
- `portta namespace` derives a DNS-safe name from the repository and
  branch.
- Stopping or restarting the gateway leaves applications running; starting it
  again rediscovers them.

### Adopting a project

Projects stay in their own repositories and are never moved, cloned or mounted.

- `portta analyze <path>` gives a read-only report: services and what they
  look like, published host ports and what already holds them, fixed container
  names, published datastores, an implicit namespace.
- `portta init <path>` writes exactly one new file, shows it and a diff
  first, never edits `compose.yaml`, supports `--dry-run`, keeps a backup.
- Eight overlay templates, and a page to copy into the consumer repository.

### Databases, caches and other TCP services

- `portta access open` creates a per-session bridge on the project's
  private network, published on `127.0.0.1` on a port the kernel picks. Any number of
  databases are reachable at once without one of them giving up 5432.
- `portta db psql` and `redis cli` run a client inside the project's own
  network. Nothing published, nothing left behind.
- `portta remote access open` sets up a loopback bridge on a VPS plus an
  SSH tunnel here, over Tailscale SSH or plain SSH.
- `portta service publish --private` creates a dedicated forwarder per
  service on the gateway's access network, for a stable tailnet address. Project
  networks are never merged.

### Remote and TLS

- Tailscale container with Traefik in its network namespace, so a VPS publishes
  nothing on its public interface.
- ACME wildcard certificates over DNS-01, with Cloudflare as the reference
  provider behind a scoped token.
- `portta public enable` prints the domain, interfaces, ports and the
  exact URLs that would become reachable, then asks.
- `portta tls init` for optional local HTTPS from a local CA.

### Diagnostics

- `doctor` covers runtime, networks, component health, exposure, DNS, TLS, routing,
  hostname and Traefik service-name collisions, uninterpolated `${...}` in
  labels, bridge binds, and forwarder placement. Read-only, with a suggested
  fix per failure, and `--json`.
- `status`, `urls`, `services`, `network status` and `inspect`, all with
  `--json` where it makes sense.

### Security

- Nothing is exposed by default: loopback bind, no dashboard, no datastore ever
  published, `service publish --public` on a datastore refused outright.
- Secrets never reach the process list: the Cloudflare token goes to curl on
  stdin, database passwords are inherited by Docker rather than interpolated
  into `-e`.
- `.env` is created `0600`; `bootstrap` tightens it if it is looser.
- Every path that removes a container checks `portta.managed=true` first.
  Nothing prunes, and no volume or network is ever removed.
- SSH host key verification is never disabled.

### Tests

326 checks: lint, documentation-link and audit invariants; unit tests for the
shell library, profiles, templates and the CLI surface; end-to-end suites for
parallel environments, lifecycle independence, adopting an unknown project,
local HTTPS, and TCP access to four simultaneous databases.

The audit suite is the interesting one: it turns the promises above into
regression tests: no absolute home paths, no consumer project named in the
code, no prune of any kind, every container removal ownership-checked, no
secret in argv, nothing exposed by default, every image pinned.

### Not verified

Stated plainly, because the alternative is a claim we cannot back:

- **The tailnet and ACME paths.** They need a real tailnet, a real DNS zone and
  a real ACME account. Configuration tests assert that every profile renders
  and that `remote-private` never binds `0.0.0.0`; the rest is a manual
  checklist in `docs/remote-development.md`.
- **Tailscale Services.** The forwarder half is tested. The Service
  advertisement and grants are printed for you to apply and are not exercised
  here.
- **macOS + Docker Desktop, Debian, Linux arm64, Windows/WSL2.** Expected to
  work, not verified. See `docs/compatibility.md`.
- **UDP.** Not supported, and listed as absent rather than as a caveat.

### Known limitations

- No authentication layer. Anything routed is reachable by anyone who can reach
  the gateway; an optional basic-auth and `forwardAuth` middleware ships
  disabled.
- Single-tenant. Every project on a host shares one Traefik and one shared
  network.
- A compromised Traefik could still read container environment variables
  through `/containers/{id}/json`, which discovery requires. Inherent to
  Traefik's Docker provider; see ADR 0002.
