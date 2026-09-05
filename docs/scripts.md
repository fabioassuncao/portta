# Shell scripts: what is left, and why

Portta has two entry points that must offer the same commands, and a shrinking
set of shell files behind one of them. This document is the live inventory.
[ADR 0029](adr/0029-shell-only-for-bootstrap.md) is the decision it executes;
[ADR 0015](adr/0015-node-on-the-host.md) is the constraint that keeps any of it.

## The rule

> Shell is for bootstrap and for the zero-Node contract. TypeScript is the
> default for everything else Portta automates.

A `.sh` file survives only if at least one holds:

- **(a)** it runs before Node can be assumed present;
- **(b)** it is the interface to something Node cannot reach without a
  dependency the project has refused;
- **(c)** the Node equivalent measurably increases complexity for no
  behavioural gain.

Being the interface to an *external binary* is not one of them. `execa` runs
`openssl`, `ssh`, `docker` and `cloudflared` with argument arrays and no shell.

**"Migrate" does not mean "delete the fallback."** Where ADR 0015 requires a
command to run with no Node, the shell keeps an implementation. What changes is
its standing: it stops being a source of truth, shrinks to what the fallback
actually calls, and is pinned to the TypeScript version by a test that runs both
and compares the results.

## The call graph

```text
install.sh ──> fetch PORTTA_HOME ──> bin/portta
                                        │
bin/portta ──(Node 22.12+ and dist/cli.js present)──> packages/cli/dist/cli.js
     │                                                    │
     │                                                    ├─> packages/core
     │                                                    ├─> docker / git / fs
     │                                                    └─> legacy() ──┐
     │                                                                    │
     └──(no Node, or PORTTA_FORCE_BASH=true)──> scripts/lib/*.sh <────────┘
```

`scripts/cmd/` is gone: every command that lived there is TypeScript.

One place still crosses from TypeScript back into Bash, and it stays:

| Crossing | Where | Why it stays |
|---|---|---|
| `legacy()` re-invokes `bin/portta` for `toolbox` | `packages/cli/src/commands/web.ts` | `toolbox.sh` keeps its *stays shell* verdict: it is the `docker run` wrapper the zero-Node path needs |

`packages/core/src/apply.ts` also runs `bin/portta up` inside the applier
container. That is the applier's contract, not a fallback, and it stays.

## The inventory

Measured 2026-09-02, on `develop`, after #30's diagnostic port.

### Stays shell

| File | Lines | Which test it passes | Bound |
|---|---:|---|---|
| `install.sh` | 1426 | (a) `curl … \| bash` on a host with nothing | Shrinks to: detect, install requirements, fetch Portta, prepare the minimum, `exec` the CLI (#30) |
| `bin/portta` | 684 | (a) the ADR 0015 dispatcher | Its Bash fallback set stays exactly the commands ADR 0015 names |
| `scripts/doctor.sh` | 205 | (a) a bare host is diagnosed before anything is installed | Was 1119. Seven checks, held to the diagnostic's ids by `tests/unit/doctor.test.sh` |
| `scripts/bootstrap.sh` | 177 | (a) ADR 0015 | Shrinks to the zero-Node fallback (#30) |
| `scripts/lib/docker.sh` | 471 | (a) `up`, `down`, `status` and `doctor` reach the daemon through it | Shrinks to what those four call (#30) |
| `scripts/lib/common.sh` | 466 | (a) the same four need `.env`, defaults and the output helpers | Shrinks to the same set (#30) |
| `scripts/lib/apply.sh` | 147 | (a) preparing the applier is part of `up` | Pinned to `packages/core/src/apply.ts` by `tests/unit/apply.test.sh` |
| `scripts/lib/runner.sh` | — | (a) preparing the project runner is part of `up` | Pinned to `packages/core/src/runner.ts` by `tests/unit/runner.test.sh` |
| `scripts/lib/runner-exec.sh` | — | (a) the command the runner container is created with | Closed verb set; no argument from the panel |
| `scripts/lib/toolbox.sh` | 73 | (b) the `docker run` wrapper the zero-Node path needs | — |
| `scripts/lib/discovery.sh` | 37 | (a) the container lookups `doctor` calls | Was 193; the kind, port, routing and hostname tables moved to core |
| `scripts/lib/auth.sh` | 25 | (a) renders the middleware file `bootstrap.sh` needs before the panel exists | — |

### Still to migrate

| File | Lines | Destination | Issue |
|---|---:|---|---|
| `install.sh` | 1426 | everything past "Node and the CLI are available" moves behind `portta setup` — **blocked**: the installer cannot hand over to a CLI that is not published (#9) | #30 |
| `scripts/lib/common.sh`, `docker.sh` | 937 | the pure halves to `packages/core`, the effects to `packages/cli` | #30 |

### Deleted

| File | Lines | Why |
|---|---:|---|
| `scripts/lib/capabilities.sh` | 256 | Sourced by nothing but its own test. The probes are now `packages/cli/src/detect.ts` and `packages/cli/src/host.ts`; nothing in the zero-Node command set reads a capability |
| `scripts/cmd/tls.sh` | 215 | → `packages/cli/src/commands/tls.ts`. The toolbox container is still the `openssl` runner; `trust`/`untrust` still print the privileged command instead of running it |
| `scripts/cmd/tunnel.sh` | 387 | → `packages/cli/src/commands/tunnel.ts`, over `packages/core/src/tunnel.ts` |
| `scripts/cmd/remote.sh`, `remote-access.sh` | 425 | → `packages/cli/src/commands/remote.ts`. `ssh` through `runProcess`, host key verification untouched |
| `scripts/cmd/maintenance.sh` | 324 | → `packages/cli/src/commands/maintenance.ts`. `PORTTA_BACKUP_VERSION` stays 1 and the archive layout does not change |
| 914 lines of `scripts/doctor.sh` | 914 | → `packages/cli/src/doctor.ts` over the verdicts in `packages/core/src/diagnostics.ts`. The shell keeps seven checks; the ids and the JSON shape are unchanged |

## Behaviour that lives in two places, and what holds it

Each of these exists twice because ADR 0015 requires a Bash implementation of
the same contract. None of them is held by a comment: every row names the test
that runs both and compares.

| Contract | Source of truth | Fallback | Pinned by |
|---|---|---|---|
| Which Compose overlays a profile selects | `composeFiles` in `packages/core/src/config.ts` | `portta_compose_files` | `tests/unit/profiles.test.sh` |
| How the base domain resolves | `loadGatewayConfig` | `portta_resolve_domain` | `tests/unit/profiles.test.sh` |
| The applier's `docker create` arguments | `applyCreateArguments` | `portta_apply_create` | `tests/unit/apply.test.sh` |
| Hostname slugging | `slug` in `packages/core` | `portta_slug` | `tests/unit/common.test.sh` |

There used to be a third copy of `slug` in the panel, because the browser bundle
must not import `portta-core`, whose index reaches the password module and
through it `node:fs`. `portta-core/browser` is the answer now: a second entry
point holding only the modules with no `node:*` in them, so the UI, the panel
and the gateway all call the one implementation. A hostname the panel prints
has to be the one Traefik serves, and that is now true by construction rather
than by a corpus keeping two copies honest.

`packages/contracts/src/enums.test.ts` pins the wire schema's `ServiceKind` and
`TcpRouting` to the tables in `packages/core/src/discovery.ts`, which cannot be
one declaration without pulling zod into core.

## The two surfaces must agree

`bin/portta` hands over to the TypeScript CLI whenever Node is present, so a
command the dispatcher names and Commander does not is unreachable on every
host the installer touched. `tunnel`, `backup`, `restore` and `repair` were
exactly that for one release: intact implementations behind `unknown command`
and exit 2.

`tests/unit/cli.test.sh` now fails when a name in `bin/portta`'s dispatch block
is missing from the Commander tree, in either of the block's two halves — the
arms that run a shell implementation, and the arms that report that the full
CLI is required.

`host collect`, `host watch` and `host status` are in that second half, with
`git`: they have to run on the host (the panel's container would report its
own numbers) and they need Node, so there is no shell implementation. The
names still exist in both entry points.

A passthrough is also transparent, and tested as such: it forwards `--help` to
the implementation rather than answering with Commander's stub, and it adopts
the child's exit code instead of rewriting every failure as a precondition.

## Adding a script

Don't, unless it passes (a), (b) or (c) above. A new automation belongs in
`packages/cli`, with anything derivable in `packages/core`. If you believe a
new `.sh` is justified, add it here with the test it passes, in the same change
that adds the file.

## Environment preparation

`scripts/lib/env.sh` and `env.awk` are the zero-Node document adapter (rule a).
The installer sources the downloaded adapter before its first environment write;
bootstrap and the Bash lifecycle path use the same code. No dotenv text is sourced.
The TypeScript implementation is `packages/core/src/env.ts`; document preservation,
normalization, secret persistence and cross-process writes are exercised by
`packages/core/src/env-contract.test.ts`. The template owns structure and static
defaults; the adapters own parsing, safe writes and generation policy.
