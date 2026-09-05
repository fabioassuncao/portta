# DNS and TLS

The panel opens these controls directly at
[TLS settings](http://127.0.0.1:8081/settings/general/tls) and
[DNS settings](http://127.0.0.1:8081/settings/general/dns).

## Local: neither is needed

`*.localhost` resolves to loopback by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)
with no DNS record and no configuration, and plain HTTP is the right default
for local development.

Local HTTPS is available when you need a secure context: Secure cookies,
service workers, WebAuthn.

```bash
portta tls init
```

That issues a local CA and a wildcard certificate for `*.localhost` inside the
toolbox container (the host needs no `openssl`), writes them to `config/tls/`,
which is git-ignored, and hands them to Traefik through the file provider.

Trusting the CA writes to your operating system's trust store, so the gateway
**prints the command and lets you run it** rather than doing it for you:

```bash
portta tls trust      # shows the command for your platform
portta tls untrust    # and how to undo it
```

Firefox keeps its own store and needs a separate import.

## Remote: a wildcard record and DNS-01

One wildcard record covers every project and every worktree, forever:

```
A    *.dev.example.com        203.0.113.10     ; public
A    *.vpn.dev.example.com    100.x.y.z        ; private, tailnet address
```

Pointing a **public DNS name at a private tailnet address** is intentional and
safe: the name is public, the address is only routable inside your tailnet.
Keep such a record DNS-only, never proxied.

```bash
portta dns check          # does the wildcard point here?
portta dns setup          # show the record to create
portta dns setup --apply  # create it, via Cloudflare
```

`dns check` queries a name that can only match the wildcard, so a stray A
record on the apex cannot make a broken wildcard look healthy.

## Two challenges, and which one you want

`ACME_CHALLENGE` picks one. They differ in what they ask of you, not in the
certificate a browser ends up trusting.

| | `dns` (default) | `http` |
|---|---|---|
| Certificates | one wildcard, `*.example.com` | one per hostname |
| Needs | a DNS provider credential | `:80` reachable from the internet |
| Private / VPN-only gateway | works | impossible |
| A hostname nothing is serving yet | already has HTTPS | gets none until a router exists |
| First request to a new service | immediate | waits a second or two for issuance |
| Let's Encrypt limits | one certificate covers everything | each name counts against the weekly limit for the domain |

### `dns`: one wildcard

**HTTP-01 cannot issue a wildcard.** That is why this is the default: Portta
routes `<project>-<service>.<domain>`, and a wildcard means every one of those
names works over HTTPS the moment it exists.

DNS-01 has a second advantage: the ACME server never needs to reach your host,
only to see a TXT record. So a private, VPN-only gateway gets a real,
publicly-trusted certificate without exposing anything.

```env
TLS_ENABLED=true
TLS_MODE=acme
ACME_CHALLENGE=dns
ACME_EMAIL=you@example.com
ACME_DNS_PROVIDER=cloudflare
ACME_DNS_RESOLVERS=1.1.1.1:53,8.8.8.8:53
CF_DNS_API_TOKEN=...    # scoped: Zone:DNS:Edit + Zone:Zone:Read
```

### `http`: no credential

A public gateway on a public IP can skip the credential entirely. Traefik asks
for a certificate the first time a router is created for a hostname, Let's
Encrypt fetches a token from this host over `:80`, and the certificate arrives.
This is what a platform that only ever publishes on public names does, and it
is why those platforms ask you for nothing but an A record.

```env
TLS_ENABLED=true
TLS_MODE=acme
ACME_CHALLENGE=http
ACME_EMAIL=you@example.com
```

`:80` must be reachable from the internet — `portta public enable`, and nothing
in front of it that refuses `/.well-known/acme-challenge/`. `portta doctor`
checks both the challenge and its one prerequisite.

Traefik terminates TLS at the entrypoint, so a project gets HTTPS without a
single certificate label of its own:

```
entryPoints.websecure.http.tls.certResolver = letsencrypt
entryPoints.websecure.http.tls.domains[0].main = dev.example.com
entryPoints.websecure.http.tls.domains[0].sans = *.dev.example.com
```

## Use staging first

Let's Encrypt's rate limits are unforgiving and a misconfigured DNS-01 will
burn through them quickly.

```env
ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
```

Certificates will not be trusted, which is the point: you are testing
issuance. Switch to production and delete `state/traefik/acme/acme.json` to
force a fresh issuance once it works.

## Other providers

`ACME_DNS_PROVIDER` accepts any provider name lego supports (Route 53,
DigitalOcean, Gandi, deSEC and many more). Cloudflare is the reference
implementation because it is common and its scoped tokens are good, not because
the gateway depends on it.

For another provider, set the provider name and pass its credentials to Traefik
as environment variables, following that provider's lego documentation. The
`CF_DNS_API_TOKEN` line in `docker/compose/profiles/remote.yaml` is the template.

## The ACME store

`state/traefik/acme/acme.json` holds the account key and every certificate. It
is created `0600`, git-ignored, and `doctor` fails if the permissions loosen.
Back it up with `state/` and `.env`; losing it means re-issuing.

## Checking

```bash
portta tls status
portta dns check
docker logs portta-traefik-1 2>&1 | grep -i acme
```

## Troubleshooting

**No certificate is issued.** Almost always the DNS credentials. Traefik logs
the provider's error. Confirm the token has `Zone:DNS:Edit` on the right zone.

**"unable to generate a certificate for the domains".** The resolver could not
see the TXT record yet. Check `ACME_DNS_RESOLVERS`, and that the zone is not
served by a provider other than the one holding your token.

**Rate limited.** You were on production. Switch to staging, get it working,
then switch back.

**The certificate is right but browsers still complain locally.** The local CA
is not trusted yet. Run `portta tls trust`.
