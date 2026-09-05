# 0027. Protected HTTP access is checked by a separate ForwardAuth service

**Status:** Accepted, amended by [0035](0035-authentication-lives-in-the-panel.md) — it still protects project hostnames and shares, and no longer protects the panel

## Context

The panel and protected shares use Traefik BasicAuth. That keeps credential
checks in front of the protected process, but hands browsers an unbranded
native dialog, has no session or logout, exposes hashes to Traefik's dynamic
directory, and cannot rate-limit attempts. Consumer projects receive only an
example that points at an auth service Portta does not provide.

The properties worth preserving are stronger than the mechanism: a protected
application must never authenticate itself, a panel route handler must not be
able to bypass its own front door, an unavailable auth component must fail
closed, and authentication must not depend on the chosen exposure strategy.

## Decision

Portta runs `portta-auth` as a separate Hono process on the shared HTTP network.
It has no published port, Docker socket, database access, or write access to
Traefik configuration. Traefik calls its `/verify` endpoint through
`forwardAuth` before forwarding a protected request.

The service accepts either today's HTTP Basic credential or a signed,
host-scoped session. A browser navigation without either is redirected to
`/__portta/auth/login` on the requested host; other request shapes receive 401
without `WWW-Authenticate`. WebSocket upgrades and event streams are never
redirected. The reserved prefix is routed directly to `portta-auth` at a higher
priority and must never carry the authentication middleware itself.

Sessions are stateless HMAC cookies, `HttpOnly`, `SameSite=Lax`, host-only and
secure when the effective request is HTTPS. Their scope and epoch bind them to
one protection. Setting or clearing a credential increments that protection's
epoch. A normal logout removes the browser's cookie. The default lifetime is
twelve hours.

Credentials and display metadata live in a versioned
`state/auth/protections.json`, written atomically with mode 0600 and mounted
read-only into the service. New credentials use Node's scrypt. Verification
continues to accept apr1, bcrypt and `{SHA}` so every value accepted before this
decision survives an upgrade; legacy values are replaced only when the user
sets the credential again.

`PORTTA_AUTH_SECRET` is generated during installation, stays in `.env`, is
treated as a secret, and is passed only to `portta-auth`. Login failures are
limited per protection and client address: progressive delay followed by a
fifteen-minute lock after five failures in ten minutes. Logs carry the scope,
address and outcome, never credentials, authorization headers, hashes or
cookies.

The file-provider write boundary grows from three files to four:
`portta-auth.yaml` contains the shared service, middleware and reserved-path
routers. Panel and share files stop carrying hashes. A one-shot migrator reads
the legacy panel settings and share marker and writes the store before any
router changes to ForwardAuth. Failure leaves the old BasicAuth configuration
in place and reports the record it could not migrate.

The panel still does not rewrite a consumer project's router. A project opts in
with the `portta-forward-auth@file` middleware and provisions its host record
through `portta protect host`; removing the record fails that router closed
until the project removes the label.

## Consequences

The browser receives a Portta page that can name the project and service,
return to the original local path, log out, and explain a failed credential.
Basic clients remain compatible. Hashes leave Traefik's directory and human
passwords receive a modern KDF.

The default topology gains one security-critical process and one reserved path
on protected hosts. Host-only cookies intentionally require a separate login
per hostname. The in-memory limiter resets when the auth process restarts; it
is abuse resistance for a single-developer gateway, not a distributed identity
platform. Multi-user identity, OIDC and domain-wide sessions remain out of
scope.

This decision supersedes ADR 0012's statement that there is no login form,
session or cookie, amends ADR 0011's generated-file boundary, and preserves ADR
0021's independent panel entrypoint and exposure modes.
