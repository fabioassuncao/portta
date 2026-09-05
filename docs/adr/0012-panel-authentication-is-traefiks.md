# 0012. The panel's authentication is Traefik's, and public stays refused

**Status:** Superseded by [0027](0027-forward-authentication-service.md) for project hostnames, and by [0035](0035-authentication-lives-in-the-panel.md) for the panel itself

ADR 0027 preserves this decision's proxy-before-panel boundary but replaces
BasicAuth with a separate ForwardAuth process, a branded login and host-scoped
sessions.

## Context

The panel has no authentication at all. `docs/web-ui.md` lists it under *Out of
scope*, `portta web up --expose public` is refused outright, and
`docker/compose/features/web-vpn.yaml` adds a Traefik router with no middleware in front of it.
`docs/security.md` states the position plainly under *What is not protected*:
there is no identity layer, and the network is the boundary.

On a laptop that is correct. The panel binds `127.0.0.1`, and anything that can
reach loopback has already lost.

On a VPS with `--expose vpn` it is not. Everyone on the tailnet gets start,
stop, restart and remove over every container on the host, plus an inventory of
project names, container names, internal URLs, mounts and network topology. A
tailnet is a good boundary and a poor last one, and it usually contains more
than one person, more than one device, and occasionally a shared node.

[ADR 0010](0010-git-collected-on-the-host.md) makes that worse on purpose:
branch names, commit subjects and pull request titles say what is being worked
on, not merely what is running. Adding them to an unauthenticated panel would
be the wrong order.

`doctor` already fails a non-loopback dashboard. It has no equivalent check for
a routed panel, which is the same class of mistake with a larger blast radius.

## Decision

The panel gets BasicAuth, and none of it lives in the panel.

Traefik holds the middleware; the panel renders it into
`config/traefik/dynamic/portta-panel.yaml`
([ADR 0011](0011-panel-reads-traefik-writes-one-file.md)), and
`docker/compose/features/web-vpn.yaml` points its router at it. There is no login form, no
session, no cookie, no user store and no code path inside the panel that can be
bypassed: a request either reaches the container or it does not.

Three settings join the `settings.ts` catalogue:

| Key | Values | Meaning |
|---|---|---|
| `PORTTA_WEB_AUTH` | `none` \| `basic` | Off, or a BasicAuth middleware on the panel's router |
| `PORTTA_WEB_AUTH_USER` | string | Username |
| `PORTTA_WEB_AUTH_HASH` | hash | Marked `secret: true`, never returned by the API in whole or in part |

The default behaviour follows the exposure, not a preference:

- **Loopback (`local`): `none`.** Unchanged, and correct. A password in front
  of `127.0.0.1` protects nothing and costs every visit.
- **`--expose vpn`: `basic` is required.** The overlay is refused when
  `PORTTA_WEB_AUTH=none`, the way the remote-public profile is already
  refused, and `portta web auth set` generates the credential in one step.
- **`--expose public`: still refused.** BasicAuth over the internet, in front
  of container lifecycle control on a shared development host, is not a
  boundary worth trusting. The VPN stays the answer, with the SSH tunnel
  `docs/web-ui.md` already documents as the fallback.
- **A routed panel is read-only unless asked otherwise.**
  `PORTTA_WEB_READ_ONLY` defaults to true whenever the panel is routed
  beyond loopback. The mode already exists, refuses every mutating endpoint,
  and costs nothing to anyone who only wants to look.

Both `apps/web/src/server/core/diagnostics.ts` and `portta doctor` fail, not
warn, when a routed panel has no authentication, matching the precedent set for
a non-loopback dashboard.

## Consequences

The panel's authentication cannot be bypassed by a bug in a route handler,
because no route handler is involved. It also cannot be granular: BasicAuth is
one credential for the whole panel, with no users, no roles and no audit trail.
That is the trade being made, and it is the right one for a single-developer
tool that would otherwise carry a second identity implementation to keep
correct.

The credential is generated, displayed exactly once and stored only as a hash,
so a lost password is regenerated rather than recovered.
`PORTTA_WEB_AUTH_HASH` is a secret in `settings.ts`, which means the
Settings page can report it as set and can never show it.

A middleware that is missing fails closed: Traefik rejects a router whose
middleware does not resolve, so a panel whose generated file was deleted
becomes unreachable rather than open. That is the correct direction to fail,
and the panel is still on loopback for whoever can reach the host.

`--expose vpn` becomes a two-step operation for anyone upgrading: the overlay
refuses to start until a credential exists. The error says exactly which
command creates one, and this is a deliberate break rather than a silent
migration, because the alternative is an unauthenticated panel that used to
work and quietly still does.

This is the first amendment to the position in `docs/security.md`. The gateway
still ships no identity layer for consumer projects: this is the panel's own
front door, not a feature projects can adopt. Projects that want authentication
still point `forwardAuth` at their own provider, as
`config/traefik/dynamic/auth.example.yaml.disabled` describes.
