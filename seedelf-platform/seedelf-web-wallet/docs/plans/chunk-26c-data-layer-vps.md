# Chunk 26c · The VPS, then 1.4.0

Steps 5 and 6 of [chunk 26](chunk-26-data-layer.md#order-of-work), its last. The data layer goes public on a DigitalOcean droplet, home's services are reached through a tunnel, and the drills run. Then the store build gets the API's address, and that's 1.4.0.

**Status: 🚧 started 2026-10-09.** The API (#289) and the wallet's side ([chunk 26b](chunk-26b-data-layer-wallet.md), #290) are built, reviewed and checked against a local API. Nothing a user runs reads the data layer until this chunk's last PR.

**Done so far (2026-10-09):**
- the decisions below are settled;
- on the droplet, runbook §2 but for the API's start: packages, Caddy (installed, off until §4), WireGuard, nftables in place of `ufw`, and the API's binary, unit and env. All of it came back by itself after a reboot;
- home's side (runbook §1): the tunnel, its firewall (`seedelf-nftables` and a `ufw` rule), and Postgres on `10.88.0.2` with the VPS's `pg_hba` line. From the VPS, Postgres, Ogmios, the Seedelf Kupo and submit-api all answer;
- the API, running on the droplet, its logs free of colour codes (`main.rs`);
- **public since 2026-10-09:** `https://mainnet.seedelf.logicalmechanism.io` (an A record, TTL 300), with Caddy's own certificate (Let's Encrypt);
- runbook §5's checks, run that day:
  - `/health` 200 over TLS, every part `ok`, `"source":"db-sync"`;
  - CORS answers both IDs, and another origin gets no `Access-Control-Allow-Origin`;
  - another origin's request, and a `no-cors` one, get 403;
  - from the VPS, 100 `account_info` at once: 81 answered, then 429 with `Retry-After`;
  - a Caddy 502 (API stopped), a 403 and a 413 left no client address and no path in either journal;
  - no `Server` header, HSTS on, HTTP/3 offered, HTTP redirected.

Next: crt.sh's listing (not indexed yet that night), home's logs (Postgres's and Kupo's), the drills, then the deploy workflow and CI.

**Home's traffic stays home's (owner, 2026-10-09).** The home box, `logicalmechanism-relay`, runs a stake pool's relay, which must keep its inbound peers: there's no money for a second mainnet node. So the node's and db-sync's egress through the tunnel (the old runbook §3) is dropped, and with it the VPS's forwarding and NAT, the routes unit, the kill switch and DNS over TLS. A registered relay publishes the home IP already. A user still meets only the VPS. See [runbook §3](../../../../seedelf-data/deploy/README.md#3-homes-own-traffic-stays-homes).

## Start here

1. Branch `web-wallet/data-layer-vps` from `main`, after #290 is merged.
2. Read:
   - **the runbook, [seedelf-data/deploy/README.md](../../../../seedelf-data/deploy/README.md):** every step on home and the VPS, the files they install, and the checks. This plan doesn't repeat it;
   - chunk 26's [Tunnel and VPS](chunk-26-data-layer.md#tunnel-and-vps), for why it's shaped this way;
   - 26b's [Left for the VPS chunk](chunk-26b-data-layer-wallet.md#left-for-the-vps-chunk) and [Docs: now, and at the VPS](chunk-26b-data-layer-wallet.md#docs-now-and-at-the-vps).
3. **The owner runs everything on home and in the DigitalOcean account.** Claude prepares the files and the commands, and checks the results. Never SSH into home unasked: every server change so far has been the owner's.
4. Get the [decisions](#decisions-before-anything-is-built) settled before the first droplet exists.

## The owner's calls this builds on

- **DigitalOcean** (2026-10-09), as for the owner's other projects.
- **The VPS comes last,** after the wallet's integration, with its own write-up: this file.
- **A clean, manual deploy action** for updates to the server, and hands-on help setting it up.
- **No money for cloud nodes, ever.** The VPS is only the edge; home runs the node, db-sync and Kupo.
- **Mainnet only.** Preprod stays on Koios, and home's preprod server is another project's.

## Decisions before anything is built

### 1. The address the wallet calls

It's compiled into every installed wallet and its CSP, so **it's picked once.** A new address means a new release, with every wallet on Koios until it updates: slower, never broken.

| | A domain | An IP address |
|---|---|---|
| What the wallet calls | `https://mainnet.<domain>` | `https://<reserved IP>` |
| Cost | a subdomain of one already owned is free; a new one on Namecheap is about $10 a year | nothing: DigitalOcean's reserved IPs are free while attached to a droplet |
| TLS | Caddy's automatic certificate, 90 days | Let's Encrypt's IP certificates, generally available since 2026-01-15: 6-day certificates only (`profile shortlived` in Caddy), renewed by Caddy |
| Moving the server | change DNS; no wallet release | the IP stays only inside DigitalOcean (a reserved IP moves between droplets); leaving DigitalOcean needs a release |
| What a user's network sees | a DNS lookup naming the API, and its name in the TLS handshake | only the IP |
| Certificate transparency | the name is public | the IP is public |

**The recommendation is a domain,** for the freedom to move. A subdomain of a domain the owner already has costs nothing.

**Settled (owner, 2026-10-09): `https://mainnet.seedelf.logicalmechanism.io`,** a subdomain of the owner's business domain, whose DNS is on DigitalOcean.

**No reserved IP.** The wallet calls the name, so the droplet's IP lives only in the DNS record and home's `wg0.conf` (`Endpoint`), each a minute to change. A droplet keeps its IP when it's resized or rebuilt; only destroying it loses the IP. One can still be added at any time, with no release.

### 2. DigitalOcean's terms

[The acceptable use policy](https://www.digitalocean.com/legal/acceptable-use-policy) forbids two things that come near what this is, checked 2026-10-09:
- "Mining any cryptocurrency … without explicit written permission." There's no mining here.
- "Operating open proxies, open mail relays, open recursive domain name servers, Tor exit nodes, or other similar network services." The tunnel carries the API's calls to home, closed to everyone else, and nothing passes through the droplet.

**Ask DigitalOcean's support to confirm in writing.** Describe it as it is: a Cardano node at home, with its peer traffic leaving through a private WireGuard tunnel to the droplet, and an API on it. Keep the reply with this file's record.

**Settled: DigitalOcean said it's fine** (the owner, 2026-10-09). The owner holds the reply.

### 3. The droplet

- **Basic, 2 vCPU, 4 GB: $24 a month,** with 4 TB of outbound transfer a month. Inbound is free, the allowance is pooled across the team's droplets, and more costs $0.01 a GiB ([pricing](https://docs.digitalocean.com/platform/billing/bandwidth/)).
- **In the region nearest home,** x86_64.
- **What was made (2026-10-09):** `seedelf-data-layer` in nyc1, `142.93.120.105`, no IPv6, **Ubuntu 26.04 LTS** (glibc 2.43, and `sudo` is sudo-rs). SSH as `seedelf`, keys only, no root login. It came with `ufw` on; nftables replaced it.
- **Traffic:** the API's alone, since the node keeps its own route (2026-10-09). Its ceiling, `DATA_EGRESS_GB_MONTH`, is 1,500 GB to start; `vnstat` on the droplet is the real meter. The droplet was sized for the node's traffic too (about 1.4 TB a month), so once the API's use is measured, a smaller one may do.
- **DDoS:** DigitalOcean's [free protection](https://www.digitalocean.com/products/ddos-protection) covers layers 3 and 4 inside its network and never terminates TLS, as the runbook asks. Layer 7 is the API's own buckets (`src/edge.rs`).

## The work, in order

1. **The droplet, not public yet** (runbook §2): packages, WireGuard, nftables, the API as a service, and the checks of home from the VPS. Home's side first (runbook §1): the tunnel and its firewall, then Postgres's listen address and `pg_hba`. Kupo, Ogmios and submit-api already listen on every address, so they stay as they are.
2. ~~Home's traffic into the tunnel~~ (runbook §3): dropped, since home's node is a stake pool's relay.
3. **Going public** (runbook §4): the DNS record, or the IP certificate, and Caddy.
4. **The checks** (runbook §5). The CORS check runs for both IDs `DATA_ORIGINS` holds:
   - the store's, `dkefopeefhophfkjkkdebhoklagjdmcp` (the listing's own, unchanged since 1.0.0);
   - the dev build's, `jfekiogplaamnceifeehipmomhojngcb`, so a dev build can be pointed at the VPS.

   **A wrong ID is silent:** every wallet falls back to Koios, and nothing says why. So this check is also the deploy workflow's.
5. **The deploy workflow,** `.github/workflows/data-layer-deploy.yml`, run by hand only (`workflow_dispatch`):
   - **build:** `cargo build --release -p seedelf-data-api` with the pinned toolchain (`seedelf-data/rust-toolchain.toml`) on `ubuntu-24.04`. Its glibc (2.39) is older than the droplet's (2.43), which is the safe direction; the binary needs 2.34. The token decimals are built in (`api/data/token-decimals.json`), so refreshing them is a deploy too;
   - **ship:** over SSH, as a `deploy` user. Its key in `authorized_keys` may only run one fixed script (`command=`), which takes the binary on stdin;
     - the key and the droplet's host key are secrets of a GitHub environment that asks the owner to approve each run;
   - **install, check, roll back:** the script keeps the running binary as `.prev`, puts the new one in place and restarts the service. It then checks `/health` and the store ID's CORS line, and puts `.prev` back and restarts if either fails;
   - **roll back by hand:** the same workflow with a `rollback` input swaps `.prev` back;
   - **what's on the droplet:** the script, the `deploy` user, and a sudoers line for that script alone. All three are templates in `deploy/edge/`.
6. **CI for `seedelf-data/`,** which has none today: on a PR touching it, `cargo fmt --check`, `cargo clippy --all-targets` and `cargo test` with the pinned toolchain. The live tests stay `#[ignore]`d.
7. **The drills** (runbook §5's table): Kupo, Postgres, db-sync alone, the node, the tunnel, home's power, and the VPS, each stopped while a dev build points at the VPS. Each part should move to Koios on its own and come back. Use the 26b driver's approach: a Playwright script over the worker's UI port, logging every request, as described in [26b's Verification](chunk-26b-data-layer-wallet.md#what-was-checked-2026-10-09).
8. **The 1.4.0 PR,** once the drills pass:
   - **the origin:** `networks.ts`'s mainnet `data` gets the API's `https://` address. `tests/manifest.test.ts`'s store strings gain it in `connect-src`, and still no host permission;
   - **the user-facing docs, in the same PR, before it ships** (26b's list):
     - the privacy policy: a dated *Changes* entry, the *In short*, the data table, *The services the extension talks to*;
     - `privacy.md`;
     - `store/README.md`: the descriptions, and the remote-code and data-usage answers;
     - the root README's *De-Anonymizing Via IP Tracking* and *Data Layer Reliance*;
     - the screens' words that name Koios for answers the data layer may give now ("Koios has no details for this pool", "Koios returned no tip");
   - **before recommending any change to a store declaration,** say what it publishes on the listing;
   - **the release itself:** `npm run tokens` and `npm run dreps`, the version to 1.4.0, the package, and a tag with a slash (`web-wallet/1.4.0`), as [development.md](../development.md) says.

## Gotchas known now

- **Root during setup is temporary.** `/etc/sudoers.d/90-seedelf-setup` gives `seedelf` `sudo` with no password while Claude sets the droplet up. Delete it once the `deploy` user and its one script exist.
- **Ship the binary `cargo build` makes, never one left by `cargo test`.** `cargo test --release` relinks `target/release/seedelf-data-api` with the test dependencies' features mixed in: a different binary at the same path. The deploy workflow's build job runs `cargo build` alone.
- **Caddy's apt repository (Cloudsmith) answered 402 on 2026-10-09,** from anywhere. Caddy is the GitHub release's `.deb`, checked against its checksums file, so apt never updates it (runbook, *Routine*).
- **Caddy's own errors carry no CORS headers:** its 502 while the API restarts, and its 413. The wallet reads them as a lost connection, which 26b made safe for submits.
- **An IP certificate lasts 6 days.** If Caddy can't renew one, the API goes dark and wallets fall back to Koios until it does: never broken, but watch renewals.
- **Postgres's boot race:** after a reboot it bound localhost only; the runbook's drop-in fixes it. Postgres refusing connections on 5432 while Kupo and Ogmios answer means this.
- **The real db-sync unit is `cardano-db-sync-new.service`.** Never touch the old one, or Kupo on 1442 (another project's).
- **Every POST pays a CORS preflight** (26b's [Left for later](chunk-26b-data-layer-wallet.md#left-for-later)). Over the internet that's a round trip each; measure it against the droplet before deciding anything.

## Verification

- runbook §5's checks, all of them, the CORS check for both IDs included;
- the drills, each part on its own;
- a dev build pointed at the VPS: a restore, an unlock, and the Koios-only switch, with the request log as 26b's;
- **no address or path in any log,** on the VPS and at home (runbook §5);
- **the store build:** the e2e suite on the package, as every release runs it.
