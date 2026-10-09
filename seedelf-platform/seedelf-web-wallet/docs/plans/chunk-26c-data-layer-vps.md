# Chunk 26c · The VPS, then 1.4.0

Steps 5 and 6 of [chunk 26](chunk-26-data-layer.md#order-of-work), its last. The data layer goes public on a DigitalOcean droplet, home's node and db-sync reach the internet only through it, and the drills run. Then the store build gets the API's address, and that's 1.4.0.

**Status: 📝 planned (2026-10-09), not started.** The API (#289) and the wallet's side ([chunk 26b](chunk-26b-data-layer-wallet.md), #290) are built, reviewed and checked against a local API. Nothing a user runs reads the data layer until this chunk's last PR.

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

**The recommendation is a domain,** for the freedom to move. A subdomain of a domain the owner already has costs nothing. **Take a reserved IP either way,** so a rebuilt droplet keeps its address.

### 2. DigitalOcean's terms

[The acceptable use policy](https://www.digitalocean.com/legal/acceptable-use-policy) forbids two things that come near what this is, checked 2026-10-09:
- "Mining any cryptocurrency … without explicit written permission." There's no mining here.
- "Operating open proxies, open mail relays, open recursive domain name servers, Tor exit nodes, or other similar network services." The tunnel carries one node's own traffic, closed to everyone else.

**Ask DigitalOcean's support to confirm in writing,** before home's traffic moves into the tunnel (runbook §3). Describe it as it is: a Cardano node at home, with its peer traffic leaving through a private WireGuard tunnel to the droplet, and an API on it. Keep the reply with this file's record.

### 3. The droplet

- **Basic, 2 vCPU, 4 GB: $24 a month,** with 4 TB of outbound transfer a month. Inbound is free, the allowance is pooled across the team's droplets, and more costs $0.01 a GiB ([pricing](https://docs.digitalocean.com/platform/billing/bandwidth/)).
- **In the region nearest home,** on Ubuntu 24.04 LTS, x86_64.
- **Traffic:** the runbook's estimate for the node is about 1 GB an hour each way. Through the tunnel, both directions leave the droplet: out to peers, and out to home. That's about 1.4 TB a month, plus the API, inside 4 TB. Measure with `vnstat` for a day first (runbook §3, step 1); the API's own egress ceiling (`DATA_EGRESS_GB_MONTH`) caps its share.
- **DDoS:** DigitalOcean's [free protection](https://www.digitalocean.com/products/ddos-protection) covers layers 3 and 4 inside its network and never terminates TLS, as the runbook asks. Layer 7 is the API's own buckets (`src/edge.rs`).

## The work, in order

1. **The droplet, not public yet** (runbook §2): packages, WireGuard, nftables, the API as a service, and the checks of home from the VPS. Home's side first (runbook §1): Postgres's listen address and `pg_hba`, the tunnel, Kupo and submit-api moved to the tunnel's address.
2. **Home's traffic into the tunnel** (runbook §3), once DigitalOcean has answered: measure, DNS over TLS, the routes unit and the kill switch, then check that the node leaves through `wg0` and reaches nothing with the tunnel down.
3. **Going public** (runbook §4): the DNS record, or the IP certificate, and Caddy.
4. **The checks** (runbook §5). The CORS check runs for both IDs `DATA_ORIGINS` holds:
   - the store's, `dkefopeefhophfkjkkdebhoklagjdmcp` (the listing's own, unchanged since 1.0.0);
   - the dev build's, `jfekiogplaamnceifeehipmomhojngcb`, so a dev build can be pointed at the VPS.

   **A wrong ID is silent:** every wallet falls back to Koios, and nothing says why. So this check is also the deploy workflow's.
5. **The deploy workflow,** `.github/workflows/data-layer-deploy.yml`, run by hand only (`workflow_dispatch`):
   - **build:** `cargo build --release -p seedelf-data-api` with the pinned toolchain (`seedelf-data/rust-toolchain.toml`) on `ubuntu-24.04`, the droplet's own release, so glibc matches. The token decimals are built in (`api/data/token-decimals.json`), so refreshing them is a deploy too;
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
