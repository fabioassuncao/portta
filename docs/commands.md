# Command reference

`portta --help` is the authoritative compact list. Every command and
subcommand also accepts `--help`; this page groups the same surface by purpose
and points to the detailed guides.

## Gateway lifecycle and inspection

| Command | Purpose |
|---|---|
| `portta setup` | Provision or update a checkout idempotently; `--dry-run` prints the plan. |
| `portta bootstrap` | Check the runtime, create gateway state and the shared network, then run diagnostics. |
| `portta build` | Build the local `portta`, `portta-apply` and `portta-toolbox` images, all tagged with `VERSION`. |
| `portta up [profile]` | Start `local`, `remote-private` or `remote-public`. `--demo` also starts `docker/examples` and imports their panel records. |
| `portta dev [profile]` | Checkout development with bind mounts and watch for the panel and ForwardAuth. `--reset` wipes the panel database first. `--demo` starts `docker/examples` and imports their panel records. |
| `portta down` | Stop gateway components; consumer projects keep running. `--demo` also stops the example stacks and drops their volumes. |
| `portta reset` | Alias for `portta dev --reset`. Prints the steps it will run, and streams the builds. `--demo` recreates `docker/examples` and imports their panel records. Other development project volumes stay. Confirmation uses `--yes`, not `--force`. |
| `portta restart` | Recreate gateway components without restarting applications. |
| `portta status` | Print a compact runtime overview. |
| `portta logs [service]` | Follow gateway component logs. |
| `portta doctor` | Run deep diagnostics and print suggested fixes. |
| `portta urls` | List hostnames Traefik currently serves. |
| `portta inspect` | Print resolved configuration and Compose files. |
| `portta update` | Pull pinned images and recreate the gateway. |
| `portta version` | Print the installed version. |

## Maintenance and recovery

| Command | Purpose |
|---|---|
| `portta backup` | Archive `.env`, `VERSION`, `config/` and `state/`, plus a dump of the panel database. Written 0600; leaves out anything the installer can fetch again. |
| `portta restore <file>` | Put a backup back, keeping a safety copy of what it replaced. Refuses a running gateway without `--force`. |
| `portta repair` | Recreate missing directories, fix the modes on files that hold secrets, restore the shared networks, reconcile containers. `--dry-run` prints the plan. |
| `portta tunnel setup --zone <domain>` | Write the connector configuration from a tunnel token, read from a file or a hidden prompt. |
| `portta tunnel enable\|disable` | Start or stop the connector; `--forget` also deletes its configuration. |
| `portta tunnel status\|test\|logs` | Inspect the connector, confirm it carries traffic, follow its output. |

## Web panel and persisted state

| Command | Purpose |
|---|---|
| `portta web up` | Start the optional administration panel on loopback. |
| `portta web open` | Open the panel URL. |
| `portta web status` | Report panel, authentication and exposure state. |
| `portta web logs` | Follow panel logs. |
| `portta web down` | Stop the panel while leaving the gateway running. |
| `portta web disable` | Disable and stop the panel. |
| `portta db status` | Inspect the panel PostgreSQL. |
| `portta db migrate` | Apply pending panel SQL without restarting the panel. |
| `portta db shell` | Open a shell with private database connectivity. |
| `portta db dump` | Stream a restorable custom-format backup. |
| `portta db restore` | Restore a dump after explicit confirmation. |

See [Web panel](web-ui.md) and [Persistence](persistence.md).

## Private and TCP services

| Command | Purpose |
|---|---|
| `portta services` | List every running project service and how it can be reached. |
| `portta access open` | Open a temporary loopback bridge to a private TCP service. |
| `portta access list` | List active bridges and expiry. |
| `portta access close` | Close one gateway-owned bridge. |
| `portta access gc` | Remove expired or orphaned bridges. |
| `portta db psql` | Run `psql` inside a project's private network. |
| `portta db open` | Open a PostgreSQL bridge for a GUI client. |
| `portta redis cli` | Run `redis-cli` inside a project's private network. |
| `portta redis open` | Open a Redis bridge for a GUI client. |
| `portta service publish` | Give a service a persistent private address. |

See [Database access](database-access.md), [TCP access](tcp-access.md), and
[TCP routing](tcp-routing.md).

## Network, exposure and sharing

| Command | Purpose |
|---|---|
| `portta network status` | Show interfaces, binds, listeners and reachability. |
| `portta public status` | Report internet exposure, disabled by default. |
| `portta public enable` | Enable the public wildcard after review and confirmation. |
| `portta public disable` | Return to private or local exposure. |
| `portta share list` | List temporary panel-created hostnames. |
| `portta share revoke` | Revoke one temporary share. |
| `portta share gc` | Remove expired shares. |
| `portta protect host <host>` | Create or rotate a protected-host credential. |
| `portta protect status [host]` | Inspect protected hosts without exposing hashes. |
| `portta protect remove <host>` | Remove a host record; the project label remains yours to remove. |
| `portta dns status` | Show DNS configuration and provider records. |
| `portta dns check` | Verify the wildcard points at this host. |
| `portta dns setup` | Plan or apply the wildcard record. |
| `portta tls status` | Report TLS mode and certificate state. |
| `portta tls init` | Create a local CA and wildcard certificate. |
| `portta tls trust` | Print the platform-specific CA trust command. |
| `portta tls untrust` | Print the command that removes it again. |

## The panel's accounts

| Command | What it does |
|---|---|
| `portta auth login` | Save a token for a panel, after checking it. |
| `portta auth status` | Whether this panel asks who you are, and who it thinks you are. |
| `portta auth logout` | Forget the saved credential. The token itself stays valid. |
| `portta auth whoami` | Every panel this host has a credential for. |
| `portta auth token list\|create\|revoke` | Personal API tokens. A new secret is shown once. |
| `portta auth bootstrap` | Create the owner, once, from this host. |
| `portta auth reset-password <email>` | Reset a password inside the panel's container, when nobody can sign in to do it. |
| `portta users list` | Every account, its role, and the Projects it reaches. |
| `portta users create` | Create an account; a generated password is shown once. |
| `portta users set-role <email> <role>` | Change a role. `owner` is transferred, not assigned. |
| `portta users set-password <email>` | Set a password and end that account's sessions. |
| `portta users grant <email> <project>` | Let an account reach one more Project. |
| `portta users revoke <email> <project>` | Stop an account reaching a Project. |
| `portta users remove <email>` | Remove an account, with its sessions, tokens and memberships. |

See [Authentication](authentication.md) for the rules these obey.

## Projects, worktrees and remote hosts

| Command | Purpose |
|---|---|
| `portta analyze <path>` | Read a project's Compose model without writing. |
| `portta init <path>` | Generate an adoption overlay after confirmation. |
| `portta namespace` | Derive a collision-free Compose project name for a worktree. |
| `portta project start\|stop\|restart <name>` | Act on every container in a project, in dependency order. |
| `portta repos scan` | Collect every repository's git state, recent commits and instruction files on the host. |
| `portta git status` | Report collected Git metadata and its age. |
| `portta host collect` | Write one host and project metrics snapshot. |
| `portta host watch` | Keep collecting (started by `up`); `--loop` runs in the foreground. |
| `portta host status` | Whether the collector is running, and how old the last snapshot is. |
| `portta remote bootstrap <user@host>` | Prepare and start a remote gateway over SSH. |
| `portta remote status|doctor|urls <user@host>` | Query a remote gateway. |
| `portta remote exec <user@host> -- <command>` | Run an explicit remote gateway command. |
| `portta remote access open <user@host>` | Open a bridge there and an SSH tunnel to it, and print a local address. |
| `portta remote access list\|close` | List open tunnels, or close one by id (or `--all`). |
| `portta toolbox build` | Build the pinned operational toolbox. |
| `portta toolbox run -- <command>` | Run a one-shot tool in its container. |

## Common flags

`--profile <name>` selects a profile for the invocation, `-y` / `--yes`
accepts confirmation prompts, and `--json` provides machine-readable output on
every read command. `--quiet` suppresses progress, `--verbose` adds diagnostics,
and data stays on stdout while warnings and progress stay on stderr. The stable
JSON shapes and exit codes are specified in [the CLI contract](cli.md).

```bash
portta bootstrap
portta up local
portta urls --project demo-a
portta doctor --json
portta remote bootstrap deploy@vps --profile remote-private
```
