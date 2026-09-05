# 0021. Panel access is its own decision, and a public panel gets its own entrypoint

**Status:** Accepted, amended by [0027](0027-forward-authentication-service.md), by the `domain` mode below (2026-09-02), and by [0035](0035-authentication-lives-in-the-panel.md) — every mode but `local` now requires the panel to sign people in, and no mode carries a Traefik middleware

## Context

[ADR 0012](0012-panel-authentication-is-traefiks.md) settled that the panel's
authentication is Traefik's, and that a routed panel is refused on the
`remote-public` profile: BasicAuth in front of container lifecycle control is
not a boundary to put on the open internet.

That reasoning holds. What it left unsolved is the case the installer has to
answer on its first screen: **somebody just created a VPS and wants to see the
panel.** The options as they stood were:

| Mode | What it did | Why it did not answer the question |
|---|---|---|
| `local` | loopback only | needs an SSH tunnel before you can see anything |
| `vpn` | routed at `portta-web.<domain>` | needs a domain, DNS, and `remote-private` |

Neither works for "a fresh VPS with an IP address and nothing else", which is
the overwhelmingly common first five minutes. In practice people solve it by
setting `PORTTA_WEB_BIND_ADDRESS=0.0.0.0` and publishing the panel's own port —
which is precisely the outcome ADR 0012 refused, except now with no
authentication at all, because the panel's host port has never had any: the
credential lives in a Traefik middleware, and a published container port does
not pass through Traefik.

There is a second problem tangled up in the first. `PORTTA_PROFILE` had come to
mean two unrelated things at once. `remote-public` binds Traefik's web and
websecure entrypoints to every interface, which is about **applications**. But
it was also the switch that decided what the panel was allowed to do, which is
about the **panel**. Choosing to look at your own dashboard therefore meant
opting every routed application into the internet — and `PUBLIC_ENABLED` exists
precisely so that is a separate, deliberate act.

## Decision

**Panel access is a first-class setting, independent of the gateway profile.**
`PORTTA_WEB_EXPOSE` takes five values, and none of them changes what
applications are reachable:

| Mode | Where the panel answers | Credential |
|---|---|---|
| `local` | `127.0.0.1:<port>` | not required |
| `tailscale` | `100.x.y.z:<port>`, the tailnet address only | not required |
| `public` | every interface, on Traefik's `panel` entrypoint | **mandatory** |
| `vpn` | `portta-web.<domain>`, routed (`remote-private`) | **mandatory** |
| `domain` | one hostname of the gateway's domain, on `websecure` | **mandatory**, and TLS |

`portta config set panel.access public|tailscale|local|domain` moves between
them on a running host and recreates what needs recreating. The installer asks
the same question once and writes the same variable.

### A public panel gets its own Traefik entrypoint

`docker/compose/features/panel-public.yaml` gives Traefik an entrypoint named
`panel` on `:8090` inside the container, published on
`${PORTTA_WEB_BIND_ADDRESS}:${PORTTA_WEB_PORT}`, and attaches exactly one
router to it: the panel's, carrying `portta-web-auth@file`.

Three properties follow, and all three are the point:

**Publishing the panel publishes nothing else.** The router is scoped to the
`panel` entrypoint. An application that sets `traefik.enable=true` attaches to
`web`/`websecure`, which on the default `local` profile are still bound to
`127.0.0.1`. There is no rule on `panel` that could match it. The reverse holds
too: the panel is not reachable on 80 or 443.

**The request cannot reach the panel without passing the middleware.** In
`public` mode the panel container publishes no host port at all —
`docker/compose/features/web-bind.yaml`, which is what publishes it in the other
modes, is simply not applied. Exactly one overlay owns the panel's front door,
so the two can never both claim `PORTTA_WEB_PORT`, and there is no second door
that bypasses Traefik.

**It fails closed.** `portta-web-auth@file` is rendered into
`config/traefik/dynamic/portta-panel.yaml`. If that file is missing, Traefik
cannot resolve the middleware and the router does not serve — the panel answers
404, never unauthenticated. On top of that the CLI, the shell profile resolver
and the installer each refuse `public` without a credential, and the installer
verifies the outcome by asking for `/api/health` without credentials and
requiring a 401 before it reports success.

### Amendment (2026-09-02): `domain`, and what it costs

`public` was the answer to "a fresh VPS with an IP address and nothing else",
and it is still the right first screen. It has one property this record did not
weigh, because at the time every mode shared it: **the `panel` entrypoint
terminates no TLS.** There is no certificate a public CA will issue for a bare
IP, so `public` was designed for plain HTTP and says so. Once the host has a
real domain that is no longer a constraint, and what remains is a panel
credential crossing the internet in clear text on every request.

`domain` routes the panel at one hostname on `websecure`, where the certificate
the gateway already terminates covers it. It costs exactly one of the three
properties above:

- **Publishing the panel publishes nothing else** — *kept.* The router names one
  host. An application is reachable only through a router of its own, and no
  rule on `websecure` matches a hostname nobody claimed.
- **No second door that bypasses Traefik** — *kept.* `web-bind.yaml` is not
  applied in `domain` either, so the panel container publishes no host port.
  Exactly one overlay still owns the front door.
- **The panel's entrypoint carries nothing else** — *given up.* `websecure`
  carries every routed application. This is the whole of the trade.

That is a smaller loss than it looks, because entrypoint separation was never
the boundary: `portta-web-auth@file` is, and it is unchanged. What separation
bought was a panel that needs no hostname, which is precisely what a host with
a domain does not need.

ADR 0012's refusal — "a routed panel is refused on `remote-public`" — was
written when the panel's protection was Traefik's BasicAuth: an unbranded
dialog, no session, no logout, no rate limit. [ADR 0027](0027-forward-authentication-service.md)
replaced that with a login page, host-scoped sessions, epochs that sign sessions
out, and a limiter. The refusal survives for `vpn`, which routes on a *tailnet*
hostname and would answer the internet by accident on a profile that binds every
interface. `domain` answers there on purpose, with TLS and a credential both
required, and is refused without either.

### The password

Generated by default: 20 characters from an unbiased 32-symbol alphabet with
the ambiguous glyphs removed, about 100 bits, printed once. Never a fixed
default, never derived from the hostname. Only the `apr1` hash is stored — in
the middleware file, which is what Traefik reads, and in `.env` so
`portta web auth status` can report it as set.

The installer accepts a password from `PORTTA_PANEL_PASSWORD` or from a
no-echo prompt, and deliberately has no `--panel-password` flag: a flag would
put the credential in the shell history and in `ps` output.

### What is honestly not solved

`public` with a bare IP is **HTTP**. No public CA issues a certificate for an
IP address, so the credential is protected by BasicAuth and the connection is
not encrypted. The installer says exactly that, in those words, rather than
implying otherwise by showing a padlock-shaped URL. Setting a domain with
`TLS_ENABLED=true` gets a real certificate; `sslip.io`-style automatic
hostnames make that possible without owning a domain, and belong to the
per-project publishing mechanism rather than to the installer.

ADR 0012's judgement is therefore narrowed rather than reversed: BasicAuth over
plaintext is not a boundary to bet a production system on, and it is an
appropriate one for a personal development VPS whose alternative is an SSH
tunnel nobody opens. The mode is explicit, announced, verified, and one command
away from being turned off.

## Consequences

`PORTTA_PROFILE` now means only what it says: which interfaces Traefik's
application entrypoints answer on. The panel no longer rides on it, and
`remote-public` is no longer a prerequisite for looking at a dashboard.

`docker/compose/features/web.yaml` lost its `ports:` block to
`web-bind.yaml`. Anyone driving Compose by hand needs both files; the CLI and
the installer already pass them.

The `public` mode cannot be combined with the Tailscale attachment, where
Traefik shares that container's namespace and publishes no port of its own
([ADR 0007](0007-tailscale-sidecar.md)). The CLI, the shell resolver and
`portta config set` all refuse the combination with the same message rather
than letting Compose fail obscurely. Use `tailscale` mode there — it is the
same reachability with a better boundary.

`doctor` gained four checks: the access mode is known, a mode that leaves the
host has a credential, the middleware file is actually rendered, and nothing is
bound to `0.0.0.0` outside `public` mode. The last one is the regression this
decision is most likely to reintroduce, so it fails rather than warns.
