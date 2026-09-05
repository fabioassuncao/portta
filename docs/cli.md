# TypeScript CLI contract

`portta` is the installable, machine-first interface to
the gateway. It exposes the `portta` binary and requires Node 22.12 or
newer. The repository entry point, `./bin/portta`, delegates to it when
Node and the compiled package are present.

Five commands keep a Bash fallback for a bare host: `bootstrap`, `up`, `down`,
`status` and `doctor`. Every other command requires the TypeScript CLI.

### The two entry points offer the same commands

`./bin/portta` hands over to the TypeScript CLI whenever Node 22.12+ and the
compiled package are present, which is every host the installer touched. A
command the Bash dispatcher names and the TypeScript CLI does not is therefore
unreachable, not a fallback — `tunnel`, `backup`, `restore` and `repair` were
exactly that for one release. `tests/unit/cli.test.sh` fails when the two
surfaces disagree.

`toolbox` is the one command still implemented in shell and reached through a
passthrough: `scripts/lib/toolbox.sh` is the `docker run` wrapper the zero-Node
path needs. A passthrough is transparent — it inherits the terminal, so prompts,
streaming and Ctrl-C work; it forwards `--help` to the implementation rather
than answering with a stub; and it reports the implementation's exit code
unchanged. See [shell scripts](scripts.md) and
[ADR 0029](adr/0029-shell-only-for-bootstrap.md).

## Installation

```bash
npx portta --version
npm install --global portta
portta setup --dry-run
portta setup --yes
```

`setup` requires POSIX, Node 22.12+, npm, Git, network access, Docker Engine
24+ and Compose v2. It never installs system packages, invokes `sudo`, edits a
firewall or `/etc/hosts`, or overwrites an unrelated directory. It clones or
fast-forwards the gateway checkout, creates `.env` only when absent, ensures
gateway-owned directories and the shared network, pulls pinned images, starts
the selected profile and checks that components stayed running. Repeating it
is idempotent; `--dry-run` changes nothing.

## Global flags and streams

| Flag | Contract |
|---|---|
| `--json` | Emit the documented data object on stdout. Progress and warnings stay on stderr. |
| `-y`, `--yes` | Confirm every gated operation non-interactively. `PORTTA_ASSUME_YES` remains a compatibility alias. |
| `--quiet` | Suppress progress and the elapsed-time line; never suppress errors or requested data. |
| `--verbose` | Add diagnostic detail on stderr, and stream every child process's output. |
| `--profile <name>` | Select `local`, `remote-private` or `remote-public`. |
| `-h`, `--help` | Available at the root and every command level. |
| `-V`, `--version` | Available globally, including after a subcommand. |

### Progress and long operations

The CLI runs `docker`, `docker compose` and `git`. What happens to their output
is a contract, not an accident ([ADR 0034](adr/0034-child-process-output.md)):

- **Nothing is silent for long.** A child whose output is being captured
  announces itself on stderr after ten seconds and every thirty after that:
  `wait     still running: docker compose run --build … (1m20s)`. After three
  minutes it says what to do about it.
- **Work you are waiting on shows its own output.** Builds, pulls and the first
  start of the panel database stream while they run.
- **Child stderr is always mirrored; child stdout is mirrored except under
  `--json`.** `docker pull` writes layer progress to stdout, and that must not
  land inside the document a machine is reading. Build progress is on stderr,
  so a `--json` run still sees it.
- **`--verbose` streams everything**, including the short probes.
- **A build is never killed on a timer.** A cold first build legitimately takes
  minutes; the elapsed-time line is there so you can decide. `Ctrl-C` during a
  build is safe — BuildKit keeps its cache.

A command that needs confirmation never prompts when stdin is not a TTY. It
exits 4 and names `--yes` instead. Programs are always executed as an
executable plus an argument array with shell expansion disabled.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | Success. |
| 1 | The requested operation failed. |
| 2 | Usage error: unknown command, missing argument or invalid flag. |
| 3 | Precondition missing: Docker unavailable, checkout absent or gateway down. |
| 4 | Refused by a safety rule or because confirmation was not supplied. |

## Command tree

### Gateway

| Command | Command-specific flags |
|---|---|
| `setup` | `--dir`, `--repo`, `--branch`, `--profile`, `--dry-run`, `--skip-pull` |
| `bootstrap` | `--skip-pull` |
| `up [profile]` | `--attach`, `--demo`. `--demo` starts `docker/examples` and imports their panel records. |
| `dev [profile]` | `--reset`, `--demo`. Checkout setup from local Dockerfiles; never the published images. `--reset` wipes the panel database first. `--demo` is the complete demonstration (stacks and data). |
| `down` | `--demo`. Without it, consumer projects keep running. With it, `docker/examples` are stopped and their volumes dropped, then the gateway. |
| `restart`, `status`, `doctor`, `inspect`, `update`, `version` | Global flags only |
| `reset` | `--demo`. Alias for `dev --reset`. Other development project volumes stay; `--demo` also recreates the example stacks. |
| `logs [service]` | `--no-follow`, `--tail <lines>` |
| `urls` | `--project <name>` |

### Projects, environments and work

Two nouns. A **Project** is the product being developed: a decision the panel
persists, so these verbs call the panel API. An **environment** is a Compose
project Docker is running: an observation, read locally.

| Command | Command-specific flags |
|---|---|
| `projects list` | Global flags only |
| `projects show <slug>` | Repositories with git state, adopted environments |
| `projects create` | `--slug`, `--name`, `--description`, `--path <dir>` (first-level directory under Projects Home) |
| `projects context <slug>` | `--task <ref>`. The Development Context an agent reads before working; `--json` carries the instruction files in full |
| `projects resources <slug>` | Usage attributed through the adopted environments |
| `projects activity <slug>` | `--kind <a,b>`, `--limit <n>` |
| `overview` | The Development Dashboard |
| `envs list` (`env`, `environment` and `project` are aliases) | Global flags only |
| `envs show <name>` | Global flags only |
| `envs start\|stop\|restart <name>` | Dependency order; nothing is removed. |
| `envs logs <name>` | `--service <name>`, `--tail <lines>` |
| `envs endpoints <name>` | The routed hostnames |
| `envs services` | `--project <name>` |
| `envs analyze <path>` | Read-only. `--file <path>` names the Compose file (relative to `<path>` or absolute) when it is not `compose.yaml` in `<path>`; the project directory is then the file's. |
| `envs init <path>` | `--dry-run`, repeatable `--service <name:port>`, `--file`, `--project <slug>`, `--output`, `--force`; writing needs confirmation. With `--file` the overlay is written next to that Compose file. `--project` emits `portta.project` on routed services so worktree namespaces adopt the logical Project. |
| `envs namespace` | `--path`, `--base`, `--suffix`, `--no-check` |
| `tasks list` | Optional `--project`; filters for `--status`, `--priority`, `--type`, `--label`, `--assignee`, `--agent`, `--repository`, `--environment`, `--service`, `--parent`, `--open`, `--mine`, `-q` |
| `tasks next` | `--project <slug>`. The task to take, or nothing |
| `tasks show\|view\|subtasks <ref>` | `<ref>` is an id, `#id`, or `owner/repo#n`; `--json` includes properties, subtasks, comments and binding |
| `tasks create` | `--project`, `--title`, `--description`, `--priority`, `--status`, `--type`, `--parent`, `--repository`, `--environment`, `--service`, `--labels`, `--assignee`, `--agent`, `--deadline` |
| `tasks edit\|update <ref>` | Partial update of title, description and every common property; never overwrites unspecified fields |
| `tasks start\|status\|move\|block\|review\|finish\|complete\|reopen <ref>` | All status shortcuts use the same move API; `finish --close` also closes the bound issue |
| `tasks comment <ref>` | One of `-m/--message`, `--file`, `--stdin` or the legacy positional text; creates a local Markdown comment |
| `tasks subtask list\|create\|link` | Read the tree, create a child, or link an existing task |
| `tasks github status\|link\|publish\|sync` | `link` requires exactly one of `--pull` or `--push`; `sync --resolve local\|remote` settles a conflict |
| `sessions start\|end\|heartbeat\|list` | `start --project --task --repository --environment --summary`; `end --summary --abandon` |
| `activity` | `--project`, `--kind`, `--task`, `--repository`, `--environment`, `--limit` |
| `examples apply` | `--file`. Low-level re-import of `docker/examples/*/portta.example.json`. `--demo` on `up`/`dev`/`reset` is the complete demonstration. |

Every verb that calls the panel accepts `--url`, `--allow-remote` and
`--actor` (`PORTTA_ACTOR`), exactly as `portta mcp` does. `services`,
`analyze`, `init` and `namespace` remain compatibility aliases at the top
level.

`PORTTA_URL` is the preferred API base variable (`PORTTA_PANEL_URL` remains a
compatibility alias). `PORTTA_TOKEN` sends a Bearer token and takes precedence
over Basic credentials. The singular `portta task` is an alias of `tasks`.

### Private access

| Command | Command-specific flags |
|---|---|
| `access open` | Required `--project`, `--service`; optional `--port`, `--local-port`, `--ttl`, `--network`, `--bind` |
| `access list` | Global flags only. |
| `access close [id]` | Alternatively `--project` or `--all`. |
| `access inspect <id>`, `access gc` | Global flags only. |
| `service publish` | Required `--private`, `--project`, `--service`; optional `--port`, `--alias`. `--public` is always refused. |
| `service list` | Global flags only. |
| `service unpublish [alias]` | Alternatively `--project`. |

`db open|close|url|psql|mysql` and `redis open|close|cli` are typed
conveniences over the same bridges or one-shot toolbox clients. Client
commands require `--project`, accept `--service` and `--port`, and pass trailing
arguments directly to the selected client. `db status|migrate|shell|dump|restore`
operate on the panel's private PostgreSQL. `migrate` asks the running panel
to apply pending SQL and needs no flags. Restore needs `--yes` and accepts a
file or stdin.

### Panel, network and integrations

| Command | Command-specific flags |
|---|---|
| `web up`, `web dev` | `--expose local|vpn`, `--port`, `--read-only`, `--writable` |
| `web down|disable|restart|status|open|build` | Global flags only. |
| `web logs [service]` | `web`, `web-ui`, `web-socket-proxy` or `db`. |
| `auth bootstrap` | `--name`, `--email`, `--password-stdin`; creates the panel owner, once. The password is only ever read from stdin. |
| `auth login` | `--token`; omitted, the token is read from the terminal without echoing. Checked against the panel before it is saved. |
| `auth status` | Global flags only. Says the panel's mode and who this terminal is. |
| `auth logout` | Global flags only. Forgets the credential; does not revoke the token. |
| `auth whoami` | Global flags only. Never prints a token. |
| `auth token list` | `--all` for everybody's; needs `user:list`. |
| `auth token create` | `--name`, `--human`, `--scopes <a,b>`, `--expires-in-days`; the secret is shown once. |
| `auth token revoke <id>` | Global flags only. Somebody else's needs `user:update`. |
| `protect host <host>` | `--user`, `--password-stdin`, `--project`, `--service`; creates or rotates a protected-host record. |
| `protect status [host]` | Read-only; never returns credential hashes. |
| `protect remove <host>` | Removes the record; the consumer project's middleware label is unchanged. |
| `auth reset-password <email>` | `--password-stdin`; otherwise a password is generated and shown once. Runs inside the panel container and ends every session of that account. |
| `users list` | Global flags only. |
| `users create` | `--name`, `--email`, `--role`, `--projects`, `--password-stdin`; a generated password is shown once. |
| `users set-role <email> <role>` | Global flags only. The email is resolved to an id through the panel. |
| `users set-password <email>` | `--password-stdin`; ends every session of that account. |
| `users grant <email> <project>` | Global flags only. Sends the whole list, with this Project added. |
| `users revoke <email> <project>` | Global flags only. Sends the whole list, with this Project removed. |
| `users remove <email>` | Global flags only. |
| `auth token list\|create\|revoke` | Personal Bearer tokens. `create --name [--human] [--scopes <a,b>] [--expires-in-days <n>]` prints the secret once; `list --all` needs `user:list`. |
| `network status` | `--public-ip` explicitly permits one external lookup. |
| `public status|enable|disable` | Enable needs confirmation; TCP services are never published. |
| `dns check|status` | Read-only. |
| `dns setup` | `--target <ip>`, `--dry-run`; Cloudflare needs a scoped token. |
| `repos scan` | `--environment <name>`, `--path <dir>`, `--with-prs`, `--forge-ttl <seconds>`. Collects every repository (git state, the last twenty commits, the instruction files on the allowlist) into `state/git/<key>.json` plus `state/git/index.json`, which maps each environment to the repository it runs from. The metrics watcher runs it once a minute. |
| `repos status`, `repos clear` | Inspect or remove only `state/git/*.json`. |
| `git scan`, `git status`, `git clear` | Deprecated aliases of `repos …`; `--project` is `--environment`. |
| `host collect` | Write one host and project metrics snapshot into `state/metrics/current.json`. |
| `host watch` | Start the detached collector, or run it in the foreground with `--loop`. |
| `host status` | Whether the collector is running, and how old the last snapshot is. |
| `share list`, `share revoke <id>`, `share gc` | Shares can only be created in the panel. |
| `tls status|init` | `init` runs OpenSSL in the toolbox container and enables TLS in `.env`. |
| `tls trust|untrust` | Print the privileged command for this operating system; never run it. |
| `remote bootstrap <target>` | `--profile`, `--dir`, `--repo`, `--branch`, `--install-docker`, `--dry-run`. Never copies a secret, never overwrites a remote `.env`. |
| `remote status|doctor|urls <target>` | Read-only, over SSH. `--json` is forwarded. |
| `remote exec <target> -- <cmd>` | Runs the command there with the terminal attached. |
| `remote access open <target>` | `--project`, `--service`, `--port`, `--local-port`, `--dir`. Leaves an SSH tunnel running after the command exits. |
| `remote access list|close` | `close` takes an id or `--all`; the remote bridge is left for the remote host to close. |
| `toolbox ...` | Passthrough to the one-shot Docker wrapper. |
| `mcp` | `--url`, `--allow-remote`, `--actor`. Serves the task verbs to an agent over stdio; refuses a non-loopback panel URL without the flag, because that is where a credential would be sent. See [MCP](mcp.md). |

Host key verification is never relaxed: `StrictHostKeyChecking` defaults to
`accept-new`, which records a key the first time and still refuses a *changed*
one. `PORTTA_SSH_HOST_KEY_POLICY` can tighten it; nothing in the tree sets it
to `no`, and `tests/unit/audit.test.sh` fails if anything ever does.


### Maintenance and tunnelling

| Command | Command-specific flags |
|---|---|
| `tunnel status|setup|enable|disable|test|logs` | `setup` takes `--zone` and reads the token from `--token-file` or a prompt, never from an argument. |
| `backup` | `-o <file>`, `--no-database`; the archive holds credentials and is written 0600. |
| `restore <file>` | `--force`; refuses to overwrite a live installation without it, and always writes a safety copy. |
| `repair` | `--dry-run`; never deletes data, never touches a volume. |


## JSON shapes

Every read command accepts the global `--json`. Stable top-level fields are:

| Command | Top-level data |
|---|---|
| `status` | `version`, `instance`, `profile`, `domain`, `bindAddress`, `network`, `components`, `projectCount`, `routeCount`, `tls`, `public` |
| `doctor` | `ok`, `instance`, `checks[]` (`id`, `status`, `message`, optional `fix`) |
| `urls` | `instance`, `routes[]`, and the compatibility alias `urls[]` (`project`, `service`, `container`, `hostname`, `url`, `port`, `state`) |
| `inspect` | `profile`, redacted `configuration`, `composeFiles` |
| `envs list` | `instance`, `projects[]` (`name`, `state`, `serviceCount`, `urls`) |
| `envs show` | `instance`, `name`, `state`, `services`, `urls` |
| `envs services` | `instance`, `services[]` |
| `envs logs` | `lines[]` (`service`, `line`, `stream`) |
| `envs analyze` | `path`, `compose_file`, `gateway_overlay`, `project`, `domain`, `services`, `findings` |
| `envs namespace` | `namespace`, `base`, `suffix` |
| `projects list` | `projects[]` (`ProjectSummary` of the API) |
| `projects show` | the API's `Project` |
| `projects context` | the API's `DevelopmentContext` |
| `projects resources` | the API's `ProjectResources` |
| `overview` | the API's `DevelopmentOverview` |
| `tasks list` | `tasks[]` (`TaskSummary`); `tasks show` is a `Task` |
| `sessions list` | `sessions[]` (`Session`) |
| `activity` | `events[]` (`ActivityEvent`) |
| `access list` | `bridges[]` (`id`, `project`, `service`, `target_port`, `local_port`, `kind`, `expires`, `bind`, `network`, `state`) |
| `service list` | `forwarders[]` |
| `web status` | `enabled`, `devMode`, `readOnly`, `expose`, `url`, `panel`, `socketProxy` |
| `network status` | `instance`, `bindAddress`, `publicIp`, `bindings`, `publicBindings` |
| `public status` | `enabled`, `profile`, `domain`, `bindAddress` |
| `dns check` | `domain`, `hostname`, `addresses`, `resolves` |
| `dns status` | `enabled`, `zone`, `domain`, `tokenSet` |
| `repos status` | `collectedAt`, `home`, `repositories[]` (`key`, `path`, `name`, `remote`, `location`, `relativePath`, `branch`, `dirty`, `environments[]`, `ageSeconds`) |
| `repos scan` | `index` (the written index) and `repositories[]` (each collected file) |
| `share list` | `shares[]` |
| `db status` | `state`, `container`, `network` |
| `db migrate` | `applied[]`, `migrations[]` |
| `tls status` | `enabled`, `mode`, `domain`, `certificate`, `authority`, `acme` |
| `tunnel status` | `state`, `detail`, `hint`, `zone`, `wildcard`, `tunnel`, `connector`, `credential` |
| `tunnel setup` | `zone`, `tunnel`, `origin`, `routes[]`, `dns` (`type`, `name`, `target`, `proxied`) |
| `tunnel test` | `host`, `code`, `ok`, `detail`, `hint` |
| `backup` | `file`, `size`, `paths[]`, `database` |
| `repair --dry-run` | `dryRun`, `changes[]` |
| `remote access list` | `tunnels[]` (`id`, `pid`, `target`, `project`, `service`, `remotePort`, `localPort`, `started`, `address`) |

Fields are additive within `0.x`; incompatible changes are called out in the
changelog. Secret values never appear in JSON.
