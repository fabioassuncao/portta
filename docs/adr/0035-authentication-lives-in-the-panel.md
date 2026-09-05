# 0035. The panel authenticates its own requests

**Status:** Accepted, supersedes 0012 for the panel and amends 0027

## Context

Until now the panel had no idea who was asking. A credential was checked in
front of it — Traefik BasicAuth in [ADR 0012](0012-panel-authentication-is-traefiks.md),
then the ForwardAuth service in [ADR 0027](0027-forward-authentication-service.md) —
and everything that got through was the same caller: the operator, holding
everything. `X-Portta-Actor` narrowed an agent to a smaller set of capabilities,
but that header authenticated nothing; it was a request politely declaring what
it was.

That works exactly as long as a panel has one user. It stops working at the
first thing a team needs:

- Two people cannot have different powers, because there is one credential.
- A revoked credential cannot end a session, because there are no sessions to
  end — only a hash in `.env` that new requests are checked against.
- Nothing can be attributed. "Who archived this project" has no answer, because
  every request was the same anonymous operator.
- A per-project boundary is impossible. There is nobody for a project to have a
  member.
- The credential is a shared secret in a file, which is what teams then put in a
  password manager and paste into terminals.

Worse, the mechanism decided things it should not. The Traefik dashboard
borrowed the panel's BasicAuth. Routing the panel on a domain required a
credential that also protected an unrelated surface. The panel's own front door
was a generated YAML file it wrote for another process to read, so "is the panel
protected" was a question about three files rather than about the panel.

## Decision

The panel signs people in itself, using Better Auth against its own PostgreSQL
database. Nothing decides on its behalf in front of it, and the ForwardAuth
service stops knowing that the panel exists.

**Two modes, one variable.** `PORTTA_AUTH_MODE=disabled` makes every request the
local operator; it is refused on any address but loopback, at boot, rather than
warned about. `required` makes everybody sign in. There is no third state and no
partial one.

**One `Principal`, resolved once per request.** A session cookie, a `ptt_`
Bearer token, or — in `disabled` mode — the local operator. Every surface reads
the same object: the Hono API, a Server Component, the event stream. Nothing
else asks what mode the panel is in.

**Permissions are `resource:action`, declared by the route.** `documentRoute`
takes a permission, publishes it as `x-portta-permission`, and checks it before
the handler runs. Four roles map to sets of them. `401` means "say who you are";
`403` means "you did, and it is not enough"; a test walks the OpenAPI document
and fails if any non-public operation declares nothing.

**A token never exceeds its owner.** What it holds is the intersection of its
scopes and its owner's role, computed at resolution time, so lowering a role
lowers every token that leaned on it without touching the tokens.

**The first user is created once, under a lock.** `POST /api/auth/setup` while
there is no owner, and never again. Public sign-up does not exist. Until an
owner exists the API answers `503 setup_required` to everything but liveness,
the auth status and the setup itself.

**ForwardAuth keeps its job and loses ours.** It protects project hostnames and
shares. The `panel` scope, the `portta-web-auth` middleware and the `ptt_` token
branch are gone from it, and `portta-panel.yaml` is written empty so an upgrade
replaces whatever an older Portta left there.

## Consequences

`PORTTA_WEB_AUTH`, `PORTTA_WEB_AUTH_USER` and `PORTTA_WEB_AUTH_HASH` are gone,
and with them `portta web auth set|status|clear|apply`. `PORTTA_AUTH_MODE`,
`PORTTA_PANEL_URL` and `PORTTA_PANEL_TRUSTED_ORIGINS` replace them;
`PORTTA_AUTH_SECRET` already existed for ForwardAuth and is now shared.

Two things get worse, deliberately. The panel now requires PostgreSQL to
authenticate anybody, which it already required to remember anything. And the
Traefik dashboard, whose only protection was the panel's BasicAuth, can no
longer be routed on a domain: it has no credential of its own, it exposes the
routing of every project on the host, and an unprotected one is refused rather
than warned about. It remains available on loopback, which is where a dashboard
of that kind belongs.

The capability vocabulary (`packages/core/src/capabilities-api.ts`) is deleted
rather than mapped at runtime: every route was rewritten to the permission it
actually needs, which is finer than the capability it declared — `project:write`
became `project:create`, `project:update` and `project:delete`, and the Docker
routes moved from the host-wide `docker:*` to `container:*`, which is what a
developer and a viewer hold.
