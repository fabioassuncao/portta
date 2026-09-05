# Authentication

Portta answers two different questions with two different mechanisms, and
keeping them apart is what makes each one simple.

**The panel** asks who *you* are. It signs people in itself: a session cookie
issued by the panel, a role that says what you may do, and optionally a Portta
token for a CLI or a coding agent. Nothing in front of it decides anything.

**A project hostname or a share** asks whether a request may reach an
application Portta routes but does not own. That is a separate process,
`portta-auth`, which Traefik consults through ForwardAuth before the application
receives anything.

```text
browser -> panel            -> session cookie -> the panel decides
agent   -> panel            -> Bearer ptt_…   -> the panel decides
browser -> Traefik -> ForwardAuth -> login/session -> a project's application
```

## The panel

### Two modes

| `PORTTA_AUTH_MODE` | What it means |
|---|---|
| `disabled` (default) | Every request is the local operator, holding everything. Allowed **only** on loopback: the panel refuses to start otherwise. |
| `required` | Everybody signs in. `/setup` creates the owner; everyone else is created by an administrator. |

`disabled` is not a weaker password. It is the statement that reaching the panel
already means having the machine, which is true of `127.0.0.1` and of nothing
else. `portta web up --expose vpn|public|domain` refuses to run without
`required`, and so does `portta config set panel.access`.

Switching `disabled → required` on an existing installation costs nothing: the
next boot has no owner, so the panel offers `/setup`. Switching back is accepted
only on loopback; the users and their tokens stay in the database, inert.

### The first user

A panel in `required` mode with no owner has exactly one page. Every route
redirects to `/setup`, and the API answers `503 setup_required` to everything
except `GET /api/health`, `GET /api/auth/status` and `POST /api/auth/setup`.

```bash
# in a browser
open http://127.0.0.1:8081/setup

# or from the host, which is what a server with no browser needs
printf %s "$PASSWORD" | portta auth bootstrap \
  --name 'Ada Lovelace' --email ada@example.com --password-stdin
```

The first account becomes the `owner`. Public sign-up does not exist: the
endpoint is disabled, and the panel refuses a second one even if it is reached.
Two people opening `/setup` at the same moment produce one owner and one 409 —
the creation happens under an advisory lock.

### Roles

| Role | Holds |
|---|---|
| `owner` | Everything. Exactly one, and the only one who can transfer ownership. |
| `admin` | Everything except acting on the owner. |
| `developer` | Works: tasks, sessions, environments, containers, repositories. Does not administer, destroy, or open network paths. |
| `viewer` | Reads, and their own tokens. |

Every API operation declares the permission it needs as `resource:action`, and
the OpenAPI document publishes it as `x-portta-permission`. A request with no
credential gets `401`; a request with one that is not enough gets `403`. Those
two are never interchanged.

### The rules a role cannot express

Four things are true regardless of what somebody holds, because the owner is a
person rather than a permission. An administrator holds every statement the
owner does; these are the whole difference, and they are why an admin cannot
take the panel:

- **Nobody changes their own role, and nobody removes their own account.**
- **Only the owner acts on the owner** — no role change, ban, password or
  removal, whoever is asking.
- **`owner` is never assigned.** It moves through
  `POST /api/users/:id/transfer-ownership`, which promotes the target and demotes
  the caller in one transaction. There is no moment with two owners.
- **The last owner cannot be removed.** A panel without one is a panel nobody
  can administer, and only before the bootstrap is that a legal state.

Two more follow from where the accounts live. Setting somebody's password
revokes every session they had, because a password that leaves the old sessions
open sets nothing. And administering accounts needs a signed-in person: a
machine token that has sat on a disk for six months is not what should be able
to create an administrator.

### Managing accounts

| What | Permission | Where |
|---|---|---|
| List, read | `user:list`, `user:get` | `GET /api/users`, `portta users list` |
| Create | `user:create` | `POST /api/users`, `portta users create` |
| Change a role | `user:set-role` | `PATCH /api/users/:id/role`, `portta users set-role` |
| Set a password | `user:set-password` | `PATCH /api/users/:id/password`, `portta users set-password` |
| Ban, unban | `user:ban` | `PATCH /api/users/:id/ban` |
| Remove | `user:delete` | `DELETE /api/users/:id`, `portta users remove` |
| See and end sessions | `session:list`, `session:revoke` | `GET`/`DELETE /api/users/:id/sessions` |
| Which Projects somebody reaches | `project:members` | `PUT /api/users/:id/projects` |
| Hand the panel over | `user:set-role`, and only the owner | `POST /api/users/:id/transfer-ownership` |

Removing an account takes its sessions, tokens and memberships with it. The work
it did stays, under the name it was done with.

Owner and admin see every Project, so a membership list does not apply to them
and setting one is refused. Promoting somebody to admin clears the memberships
they had, because leaving them would suggest a boundary nothing enforces.

All of it is also **Settings → Users** in the panel, for somebody who holds
`user:list`. An action a rule would refuse is not offered there: there is no
"change your own role", no ban on the owner from an administrator, and no
removal of the last owner. Removing asks for the account's email to be typed
first.

### Access by Project

A role says what somebody may do. A membership says where. `owner` and `admin`
see every Project; a `developer` and a `viewer` see the ones somebody put them
in, and nothing else — not the tasks, not the environments, not the activity,
not the events.

```bash
portta users grant  ada@example.com shop
portta users revoke ada@example.com shop
```

Every route that names a resource asks twice: the permission first, at the door,
and the Project second, once the resource has been read and it is known which
one it belongs to. Which Project a thing is in comes from where it actually
lives:

| Resource | Its Project |
|---|---|
| Project, repository, task, note, attachment, work session, activity | the row's own `project_id` |
| Environment, service, container, logs, per-environment resources | the Project that adopted the environment; **none** if no Project did |
| Bridge, forwarder, share | the environment it targets |
| Docker's raw host inventory, gateway, network, tunnel, settings, users, audit | nothing: they are about the host, and the permission decides alone |

An environment no Project adopted has no membership to check, so it is visible
to `owner` and `admin` and to nobody else. The same is true of a repository the
host scanned that nobody registered, and of an event with no Project in it.

**Listings filter; named resources refuse.** Asking for the Projects returns
yours, not a 403 about somebody else's. Asking for one by name that you are not
in is a 403. The Overview sums only what you can see, and the event stream
delivers only events about it — losing a membership closes the door on the next
request, not the next sign-in.

Read-only mode (`PORTTA_WEB_READ_ONLY=true`) intersects every principal with the
reads, whoever signed in.

### Sessions and the second factor

Sign-in sets `portta.session_token`: `HttpOnly`, `SameSite=Lax`, `Path=/`, and
`Secure` whenever `PORTTA_PANEL_URL` is HTTPS. Sessions last seven days and are
refreshed daily. Signing out revokes the session; banning a user takes effect on
their *next request*, not their next sign-in.

Sign-in, TOTP verification and backup codes are rate-limited to five attempts in
ten minutes, per address. A team behind one NAT is one address, which is what
`PORTTA_AUTH_SIGNIN_ATTEMPTS` is for; it accepts 3 to 100, and anything else is
read as the default, so the limit cannot be configured away. A user who has turned on a second factor is sent to `/two-factor`
after their password is accepted.

**Settings → Security** is where somebody turns it on. The panel asks for the
password, shows the QR code and the secret behind it, and only counts the factor
as on once a code from the app comes back — an interrupted setup leaves the
account exactly as it was. The backup codes are shown once, in a dialog that
does not close on an escape key. Turning it off asks for the password again.

The same page lists every session of the account, marks the browser it is being
read in, and ends the others one at a time. An administrator sees the same list
for somebody else under **Settings → Users**, where the only action is ending
all of them at once: a session id is not something anybody recognises, and the
question that gets asked is "sign this account out everywhere".

There is no email transport in a self-hosted panel, so there is no reset link.
A forgotten password is reset from the host that owns the panel:

```bash
printf %s "$NEW" | portta auth reset-password ada@example.com --password-stdin
portta auth reset-password ada@example.com    # or let it generate one, shown once
```

That runs inside the panel's own container, where the database already is. It is
deliberately not an API call: the case it exists for is the one where no
credential works. Being able to run it means having the machine, which is the
same authority the owner had when they created the account. Every session of
that account is ended.

### Tokens for the CLI and agents

A Portta token is a `ptt_`-prefixed Bearer credential belonging to a user. It
never exceeds its owner's role: what it holds is the intersection of its own
scopes and that role, computed on every request. Lowering somebody's role lowers
every token they made without touching the tokens; banning them stops all of
them at once; revoking one takes effect on the next request that carries it.

```bash
portta auth token create --name laptop            # the secret is shown once
portta auth token create --name ci --scopes task:read,task:write --expires-in-days 90
portta auth token list
portta auth token revoke <id>
```

Asking for no scopes gives the sensible default for what the token is: a
person's token (`--human`) holds their whole role, and an agent's holds what
agents hold — a developer minus the three things that change how the panel
behaves. Asking for scopes the owner does not hold is a 400 that names exactly
which ones did not fit.

Your tokens are yours to make and revoke. Somebody else's needs `user:list` to
see (`--all`) and `user:update` to revoke, because revoking a colleague's
credential is an administrative act — and the one that makes a lost laptop
somebody else's problem to solve.

The panel accepts a token as `Authorization: Bearer ptt_…` and in no other
form; `x-api-key` is not accepted. Housekeeping disables a token that expired
more than thirty days ago and deletes one revoked more than ninety days ago.

**Settings → API tokens** is the same thing in the panel: your tokens by
default, everybody's for somebody with `user:list`. A new secret appears once,
in a dialog that will not close on an escape key and asks the person to say they
copied it — because the panel keeps a hash, and a lost secret means making
another token.

### Signing a terminal in

```bash
portta auth login --url http://127.0.0.1:8081     # asks for the token, without echoing it
portta auth status                                # who this terminal is
portta auth logout
portta auth whoami                                # every panel this host has a credential for
```

`login` checks the token against the panel before saving it, so a typo fails
here rather than on the next command. The store is
`~/.config/portta/credentials.json` (`$XDG_CONFIG_HOME` respected), mode 0600,
one entry per panel URL — a laptop panel and a server panel are not the same
credential.

What a command sends is, in order: `--token`, then `PORTTA_TOKEN`, then whatever
`login` saved for that panel. `portta mcp` uses the same resolution, so an agent
configured once keeps working after a token is rotated. A non-loopback panel URL
still needs `--allow-remote`: that URL is where a credential would be sent.

`logout` forgets the credential; it does not revoke the token. The message says
so, because the two are different answers to "my laptop is gone".

### Agents in `disabled` mode

With no sign-in there is nobody to be, so `X-Portta-Actor` is attribution: it
says which caller behind the machine this is. The one thing it decides is that a
request announcing itself as an agent is held to what agents may do — the
`agentPermissions` setting, which defaults to a developer minus the three things
that change how the panel behaves (`environment:settings`, `repository:manage`,
`github:sync`).

That setting is editable in **Settings → General → Panel**, one permission at a
time, and `GET`/`PUT /api/settings/agent-permissions` is the same list for a
script. It is a ceiling in both modes: with accounts on, an agent holds the
intersection of this list and the role of whoever the token belongs to.

## Project hostnames and shares

`portta-auth` publishes no host port, has no Docker socket or database, and
mounts `state/auth/protections.json` read-only. Credentials use scrypt; migrated
apr1, bcrypt and `{SHA}` hashes remain valid. Hashes never appear in generated
Traefik YAML. This process knows nothing about the panel, its users or its
tokens.

A successful login there sets `__portta_session` as `HttpOnly`, `SameSite=Lax`,
`Path=/`, host-only, and `Secure` on HTTPS, for twelve hours. Each protected host
has an epoch; changing or removing its credential invalidates the sessions that
came before. `/__portta/auth` is reserved on every protected host, and only
same-host paths are accepted as redirects.

REST, webhook, health-check, SSE and WebSocket requests never receive a login
redirect. They get 401 until they supply the Basic credential:

```bash
curl -u reviewer:password https://demo-web.example.com/api/health
```

Failed logins are delayed progressively; five failures in ten minutes lock that
host/IP pair for fifteen minutes. Logs carry scope, client address and outcome —
never a password, cookie or Authorization value.

### Shares

```bash
portta share list
portta share revoke a7f3
portta share gc
```

Protected-share passwords are shown once. Rotation bumps the share epoch; revoke
and garbage collection remove its protection record.

### Protecting a project hostname

Portta never edits a consumer project's router. Create the host record, then opt
that router into the generated middleware in the project's own Compose file:

```bash
portta protect host demo-web.example.com --project demo --service web
```

```yaml
labels:
  - "traefik.http.routers.demo-web.middlewares=portta-forward-auth@file"
```

Inspect or remove records without exposing hashes:

```bash
portta protect status
portta protect status demo-web.example.com
portta protect remove demo-web.example.com
```

Removing the record does not edit the project label. Until the label is removed,
the unresolved protection fails closed.

## State and recovery

- `PORTTA_AUTH_SECRET` in `.env` signs the panel's sessions and tokens, and the
  ForwardAuth process's cookies. `portta bootstrap` generates it. Rotating it
  signs everybody out of both.
- The panel's users, sessions and tokens live in its PostgreSQL database.
- `state/auth/protections.json` holds project and share credentials. It is
  versioned, atomic and mode 0600.
- `config/traefik/dynamic/portta-auth.yaml` contains only services, routers and
  middleware — no credential material. `portta-panel.yaml` is written empty:
  nothing routes through Traefik middleware to reach the panel any more.
- `portta doctor` checks the mode against the bind address, the secret, the
  database, and the auth container's health.

See [ADR 0035](adr/0035-authentication-lives-in-the-panel.md) for why the panel
authenticates itself, and [ADR 0027](adr/0027-forward-authentication-service.md)
for the ForwardAuth trust boundary.
