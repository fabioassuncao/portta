# Documentation

The README explains the idea and the shortest path to a running gateway. This
is the complete operator and contributor index: everything a person needs to
run Portta, or to change it, is reachable from here.

## Getting started

- [Installing and updating](install.md) — the one-command installer, PORTTA_HOME, panel access, and non-interactive use.
- [Local development](local-development.md) — workstation setup, local DNS, and daily use.
- [Configuration](configuration.md) — every managed environment setting and its default.
- [Adopting projects](adopting-projects.md) — analyse a Compose project and add the integration overlay.

## How it works

- [Architecture](architecture.md) — components, networks, profiles, and lifecycle boundaries.
- [Host metrics](host-metrics.md) — the CLI collects on the host; the panel only reads the files.
- [Monorepo layout](monorepo.md) — where new code goes, and how to add a command.
- [Shell scripts](scripts.md) — what is still Bash, why, and where each remaining file is going.
- [Networking](networking.md) — ports, Docker networks, hostname derivation, and reachability.
- [Persistence](persistence.md) — panel PostgreSQL, migrations, backup, restore, and degraded operation.
- [Architecture decision records](adr/) — decisions that are expensive to reverse.

## Operating the gateway

- [Command reference](commands.md) — the CLI surface grouped by purpose.
- [TypeScript CLI contract](cli.md) — npm installation, flags, JSON shapes and exit codes.
- [Security](security.md) — threat model, defaults, isolation, secrets, and residual risks.
- [Authentication](authentication.md) — login sessions, project protection, credentials, and recovery.
- [Troubleshooting](troubleshooting.md) — diagnose routes, DNS, TLS, ports, and containers.
- [Compatibility](compatibility.md) — verified platforms and measured overhead.

## Running remotely

- [Remote development](remote-development.md) — choosing private or public remote access.
- [Remote bootstrap](remote-bootstrap.md) — prepare a host safely over SSH.
- [Tailscale](tailscale.md) — VPN-only gateway attachment.
- [Persistent Tailscale services](tailscale-services.md) — stable private addresses for selected services.
- [DNS and TLS](dns-and-tls.md) — wildcard records and certificates.
- [Cloudflare](cloudflare.md) — optional scoped DNS automation.
- [Cloudflare Tunnel](cloudflare-tunnel.md) — publish over HTTPS with no open port, from anywhere
- [Public access](public-access.md) — deliberate internet exposure and its limits.
- [Firewall](firewall.md) — minimal rules and why Docker bypasses UFW.
- [Remote tunnels](remote-tunnels.md) — reach loopback-only services on a VPS.

## Databases and TCP services

- [Database access](database-access.md) — choose a client, bridge, hostname, or private address.
- [TCP access](tcp-access.md) — temporary loopback bridges into project networks.
- [TCP routing](tcp-routing.md) — hostname routing, TLS requirements, and supported protocols.
- [Redis access](redis-access.md) — private Redis clients and bridges.

## Web panel

- [Addresses and access](addresses-and-access.md) — project hostnames, public access, the panel URL, Traefik, TLS, VPN, and the DNS each scenario needs.
- [Web UI](web-ui.md) — installation, pages, API, actions, authentication, the documentation site it serves, and screenshots.
- [Design system](design-system.md) — the panel's tokens, type scale, states, components and layout, and the rules for adding to them.
- [Tasks](tasks.md) — the workspace, kick-create drafts, import/export, GitHub binding, and how commits will attach.
- [GitHub](github.md) — creating and installing the App step by step, then how issues become tasks bound to Projects, and the board that writes back.
- [MCP](mcp.md) — the task verbs an agent drives through `portta mcp`, and what it deliberately cannot reach.
- [Sharing](sharing.md) — temporary public or protected hostnames with mandatory expiry.

## Working day to day

- [Monorepos and worktrees](monorepos.md) — independent namespaces and parallel environments.
- [Agent guidelines](agent-guidelines.md) — safe operating rules for autonomous coding agents.
- [Testing](testing.md) — what to run while working, what to run before merging, and what deserves a test.
- [Overlay templates](../templates/) — reference integrations for common project shapes.

## Project reference

- [Changelog](../CHANGELOG.md) — released behaviour and upgrade notes.
- [Template copied into consumer projects](../templates/project/PORTTA.md) — a short project-local runbook.

- [Configuration and startup audit](configuration-audit.md)
