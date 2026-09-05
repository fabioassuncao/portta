# Installing and updating

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
```

That command installs Portta, and the same command updates it. It does not
clone the repository, does not build anything, and does not expose a single
application. Read [ADR 0020](adr/0020-installer-and-portta-home.md) for why, and
[ADR 0021](adr/0021-panel-access-modes.md) for what "expose" means here.

## What it needs

`curl`, `tar`, a POSIX shell, and Docker Engine 24+ with Compose v2. On Linux
it will offer to install Docker from `get.docker.com` if it is missing and you
are root; it never does that on macOS, and never without asking.

Node is **not** required. `npx portta` gives you the full CLI when you have
Node 22.12+, and `portta` on its own works without it.

## What it asks

Three questions, and only the ones it cannot answer itself. Pressing Enter
takes the default every time.

```
Where should Portta keep its data and configuration?
  directory [/opt/portta]:

How do you want to reach the Portta panel?
  1. Public    — this server's address and a port  [default]
  2. Tailscale — only over the VPN
  3. Local     — localhost only, reached over an SSH tunnel
  choose [1]:

  panel authentication (required/disabled) [required]:
```

The last question only appears when the panel stays on loopback. Anything that
puts it on another interface makes it `required` without asking, because a panel
that can start and stop every container on the host must know who is asking.

Everything else — your OS, architecture, hostname, local and public IP, whether
Docker is running, whether the port is free, whether Tailscale is connected — it
detects. It will not ask you for something the machine can tell it.

## Where things go

One directory. It defaults to `/opt/portta` for root and `~/.portta` otherwise.

```
<PORTTA_HOME>/
├── VERSION                  what is installed
├── .env                     configuration, 0600
├── install-manifest.json    version, ref, registry, access mode, when
├── bin/portta               the CLI
├── scripts/                 what it sources
├── docker/compose/          the compose overlays
├── docker/images/           applier and toolbox build contexts
├── config/
│   ├── traefik/dynamic/     routing and generated ForwardAuth middleware
│   └── tls/                 local certificate material
└── state/
    ├── traefik/acme/        certificates
    ├── auth/                private credential store, 0600
    ├── tailscale/           node identity
    ├── git/                 collected repository metadata
    └── github/              the GitHub App key, if you use one
```

Backing up a host is `tar -czf portta.tgz "$PORTTA_HOME"` plus
`portta db dump`. The panel's PostgreSQL data lives in the named volume
`portta-db` rather than in this tree, on purpose — the reasoning is in
[ADR 0020](adr/0020-installer-and-portta-home.md).

Removing Portta is `install.sh --uninstall`, which stops its containers and
deletes `PORTTA_HOME`. It keeps the database volume and the shared network,
because other projects may still be attached to the latter.

## Project hostnames

Every project gets `<project>-<service>.<base>`, and the base depends on where
you will be reading the panel from. The installer picks from the answer you
already gave it: a panel reachable from elsewhere means the hostnames have to be
too.

| Mode | Base | For |
|---|---|---|
| `local` | `localhost` | a machine you are sitting at |
| `auto` | `<ip-with-dashes>.sslip.io` | a server with a public address and no domain |
| `custom` | your own wildcard | a domain you control |

`auto` is the interesting one. `sslip.io` (and `nip.io`, the other supported
choice) answers for any name embedding an address, so a project on a VPS at
203.0.113.10 answers on:

```
web.203-0-113-10.sslip.io
api.203-0-113-10.sslip.io
```

with no DNS record to create, no account and nothing to buy. Change it at any
time, without reinstalling and without touching a project:

```bash
portta config set domain.mode auto
portta config set domain.mode custom     # after: portta config set gateway.domain dev.example.com
portta config set domain.mode local
```

Hostnames are derived rather than stored, so switching re-labels every project
at once. Nothing is migrated and no route is rewritten by hand.

**This chooses the name, not who can reach it.** An auto domain on a default
installation resolves to your server and reaches a Traefik that listens on
loopback only — correct, and not yet useful. `portta public enable` is the
separate, deliberate step that makes the HTTP services which opted in answer
there. `portta doctor` and the panel both say so when the two disagree:

```
[warn] project hostnames  *.203-0-113-10.sslip.io points here, but Traefik listens on 127.0.0.1 only
   -> portta public enable   exposes the HTTP services that opted in
```

HTTPS on an auto domain is not automatic: a wildcard certificate needs a DNS-01
challenge, and neither service offers an API for one. Auto domains serve HTTP.
Use a custom domain for TLS. The reasoning is in
[ADR 0022](adr/0022-project-domain-modes.md).

With a custom domain on a public IP, `--tls` is the whole of it:

```
curl -fsSL .../install.sh | bash -s -- --yes \
  --domain dev.example.com --domain-mode custom --tls you@example.com
```

That issues a certificate per hostname over `:80` — no DNS credential, because
HTTP-01 needs none. `*.dev.example.com` must resolve here and `:80` must be
reachable from the internet. For one wildcard instead, configure DNS-01
afterwards; [DNS and TLS](dns-and-tls.md) compares the two.

## Panel access

This is the one decision with security consequences, so it is worth being clear
about what each option means. **None of them exposes an application.** Panel
access and application exposure are separate settings, and they stay separate.

### Public — the default

The panel answers on every interface, on port 8081, behind Portta ForwardAuth,
enforced by Traefik before the request reaches the panel container.
The panel publishes no host port of its own in this mode, so there is no way in
that skips the credential. The installer verifies this by asking for
`/api/health` with no credentials and requiring a 401 before it reports success.

```
http://203.0.113.10:8081
```

It is plain HTTP. No public certificate authority issues certificates for bare
IP addresses, so authentication does not make the connection encrypted. Set a
domain and `TLS_ENABLED=true` for a real certificate before using this across
an untrusted network.

### Tailscale

The panel binds your node's tailnet address and nothing else. Nothing is
published on the public interface, and your Tailscale ACLs are the boundary.

```
http://100.101.102.103:8081
```

The installer detects whether Tailscale is installed and connected. It never
runs `tailscale up`, never authenticates a node, and never touches an existing
configuration — if it is not connected, that option is simply reported as
unavailable and the installation continues.

### Local

The panel binds `127.0.0.1` only. Reach it with an SSH tunnel:

```bash
ssh -L 8081:127.0.0.1:8081 user@server
```

then open <http://localhost:8081>.

### Changing your mind

The choice is not permanent:

```bash
portta config set panel.access public
portta config set panel.access tailscale
portta config set panel.access local
```

Each of these writes `.env`, renders the middleware, and recreates what needs
recreating. Moving to `public` while the panel answers everybody as the local
operator is refused; run `portta config set panel.auth required` first, then open
`/setup` to create the owner.

`config` is part of the full CLI, so it needs Node 22.12+. On a host without
it — which is what the installer produces by default — the installer is the way
to change the mode, and it is the same command that installed it:

```bash
curl -fsSL .../install.sh | bash -s -- --panel-access local
```

It finds the existing installation, changes only that setting, and recreates
what needs recreating. Everything else is left exactly as it was.

## Updating

Run the installer again.

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
```

It finds the existing installation, keeps every answer already recorded, pulls
the new images, and recreates. It never regenerates the panel database
password, the session signing secret, the ACME material or the Tailscale
identity, and it never overwrites `.env`, `state/`, `config/tls/`, or a file
that already exists in `config/traefik/dynamic/`. Panel accounts live in the
database, which an update never touches.

To see what would change without changing it:

```bash
curl -fsSL .../install.sh | bash -s -- --pull-only
```

## Non-interactive

For automation, and for re-provisioning a host from a script:

```bash
curl -fsSL .../install.sh | bash -s -- \
  --non-interactive \
  --install-dir /opt/portta \
  --panel-access public \
  --panel-port 8081 \
  --panel-auth required
```

| Flag | Meaning |
|---|---|
| `--install-dir <path>` | where Portta keeps its data |
| `--panel-access <mode>` | `public`, `tailscale` or `local` |
| `--panel-port <port>` | host port for the panel |
| `--panel-auth <mode>` | `required` or `disabled`; `disabled` only on loopback |
| `--domain <domain>` | base domain, recorded but not activated |
| `--domain-mode <mode>` | project hostnames: `local`, `auto` or `custom` |
| `--version <ref>` | tag, branch or commit to install |
| `--registry <ns>` | image namespace |
| `--skip-deps` | never offer to install Docker |
| `--pull-only` | pull images and change nothing else |
| `--uninstall` | stop Portta and remove `PORTTA_HOME` |
| `-y, --yes` | assume yes; still takes defaults for unset values |
| `--non-interactive` | never prompt at all |

There is deliberately **no panel password here**. The panel signs people in
itself, and its first account is created once — in a browser at `/setup`, or
from the host with no browser at all:

```bash
portta auth bootstrap --email you@example.com
```

Sign-up closes the moment that account exists; it creates everyone else. The
installer prints the address at the end. `--panel-user` is refused rather than
ignored, so a script that still passes one is told what replaced it.

`PORTTA_HOME`, `PORTTA_REF` and `PORTTA_REGISTRY` are also read from the
environment, matching `--install-dir`, `--version` and `--registry`.

## After installing

```bash
portta status          # what is running
portta doctor          # deep diagnostics, including the host's own tooling
portta urls            # the hostnames being served
npx portta doctor      # the same, from anywhere, with Node 22.12+
```

`npx portta` finds an installation without being told where it is: it checks
`PORTTA_HOME`, then `/opt/portta`, `~/.portta` and `/var/lib/portta`, after
walking up from the working directory. A custom `--install-dir` is not in that
list, so export `PORTTA_HOME` for it — the `portta` the installer links onto
PATH always addresses its own installation and needs nothing.

A CLI installed from npm outlives the installation it is pointed at in both
directions, so it says which one it found and whether the two agree:

```console
$ portta version
portta 0.8.0
  gateway  0.8.0  (/opt/portta)
  panel    0.8.0
```

`portta version --json` carries the same as `cli`, `gateway`, `panel`,
`apiSeries` and a `compatible` boolean. When the major and minor disagree it
says so and names the two ways to fix it: re-run the installer, or install the
matching CLI.

`doctor` also reports the host's development environment — Git and its global
identity, GitHub CLI and whether it is authenticated, Node, npm, npx, Tailscale
— and which AI agent CLIs are present (Claude Code, Codex, Cursor Agent,
Gemini, Antigravity). That part is diagnostic only. Portta never installs,
authenticates or reconfigures any of them.

`portta doctor` and `npx portta doctor` give the same answer: the deep checks
live in one script that every installation carries, and the TypeScript CLI runs
it rather than keeping a second, thinner copy. A missing optional tool is a
warning, never a failure.

## Installing a specific version

```bash
curl -fsSL .../install.sh | bash -s -- --version v0.8.0
```

Any tag, branch or commit works. The panel image tag follows the `VERSION` file
in that ref, so the configuration and the image always match.

## Troubleshooting

**The image cannot be pulled.** The GHCR package is private until somebody
makes it public once, in the repository's package settings. The installer says
so and stops rather than falling back to building on the host.

**The port is already in use.** The installer checks before it starts and
offers another port. Pass `--panel-port` in non-interactive runs.

**The panel answers 401 and you have lost the password.** Only a hash is stored,
so it cannot be recovered. Reset it from the host that owns the panel:
`portta auth reset-password <email>`.

**Something is unhealthy.** `portta doctor` names the check that failed and the
command that addresses it. `portta logs web` and `portta logs traefik` are the
next step.
