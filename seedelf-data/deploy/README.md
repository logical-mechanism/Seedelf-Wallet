# Deploying the data layer

How the data layer goes live: home's services reached through a WireGuard tunnel, and the API on a VPS behind Caddy. Why it's shaped this way is chunk 26's plan ([Home](../../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md#home), [Tunnel and VPS](../../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md#tunnel-and-vps)). **Mainnet only:** preprod stays on Koios, and the preprod server at home is another project's.

Every file here is a template. `<…>` marks a value to fill in on the machine. Keys, passwords, addresses and database names are never committed.

| Where | What | Files |
|---|---|---|
| Home | cardano-node, db-sync and Postgres, the Seedelf Kupo, Ogmios, cardano-submit-api. Stock software only. | `home/` |
| The tunnel | WireGuard, dialled out from home: `10.88.0.2` is home, `10.88.0.1` the VPS | `home/wg0.conf`, `edge/wg0.conf` |
| The VPS | `seedelf-data-api` behind Caddy. Every line of custom code runs here. | `edge/` |

## Before you start

- **A VPS** with 2 vCPU and 4 GB, near home. Its terms must allow blockchain workloads: Hetzner's don't. It needs DDoS filtering that never terminates TLS, and 1–2 TB of traffic a month for the node's P2P through it.
- **A domain.** The API is `https://mainnet.<domain>`, and DNS names the VPS only.
- **The wallet's Web Store ID,** from the store's developer dashboard, for `DATA_ORIGINS`.
- **The token decimals file:** `scripts/token-decimals.py` over a checkout of the token registry ([README](../README.md#reference-code)).
- **A build of the API** for the VPS's architecture, with the pinned toolchain: `cargo build --release -p seedelf-data-api` from `seedelf-data/`.

## 1. Home

**Postgres.** The `seedelf_reader` role exists since 2026-10-08; `home/seedelf_reader.sql` makes it again.

1. Add the tunnel's address to `listen_addresses`, and the logging settings: `home/postgresql-seedelf.conf`.
2. Add the VPS's line to `pg_hba.conf`: `home/pg_hba-seedelf.conf`.
3. Install the drop-in `home/postgresql-after-network.conf`, so Postgres binds after the network and `wg0` are up. After a reboot on 2026-10-09 it bound localhost alone.
4. `systemctl daemon-reload`, then restart Postgres.

**The Seedelf Kupo** (`home/kupo-seedelf.service`) runs today with `--host` on the LAN, for building locally. Once the VPS is up, move it to the tunnel's address and restart it. Its index stays as it is. From the dev machine, reach it through SSH: `ssh -L 1443:10.88.0.2:1443 <home>`.

**cardano-submit-api** takes `home/tx-submit-mainnet-config.yaml` as `--config`. Give it `--listen-address 10.88.0.2 --port 8090`.

**Ogmios** serves another project too: leave how it listens alone. `home/nftables-seedelf.conf` decides what reaches it through the tunnel.

**db-sync** runs the options in `home/db-sync-insert-options.json`. They've been right since 2026-10-09, when `offchain_vote_data` was turned on. Check them again after every db-sync upgrade: 13.7.0.1 added that option switched off, and vote metadata stopped with no error.

**The tunnel:**

1. `wg genkey | tee private | wg pubkey > public`, as root, in `/etc/wireguard/`.
2. Fill in `home/wg0.conf`, then `systemctl enable --now wg-quick@wg0`.
3. Install `home/nftables-seedelf.conf` and load it. It filters `wg0` alone; the LAN keeps its rules.

**Power.** NUT on the UPS shuts down in this order: db-sync, Postgres, Kupo, then the node. An unclean stop costs a long ledger replay.

## 2. The VPS

1. **Packages:** `wireguard-tools`, `nftables`, and Caddy from its own repository.
2. **WireGuard:**
   - make keys as at home, and fill in `edge/wg0.conf`;
   - add `edge/90-seedelf-forward.conf` to `/etc/sysctl.d/`, then run `sysctl --system`;
   - `systemctl enable --now wg-quick@wg0`.
3. **The firewall:** `edge/nftables.conf` replaces every rule on the machine. `systemctl enable --now nftables`.
4. **Check home from the VPS:**
   - `pg_isready -h 10.88.0.2`;
   - `curl http://10.88.0.2:1443/health`;
   - `curl -X POST http://10.88.0.2:8090/api/submit/tx` (an error, which proves it answers).
5. **The API:**
   - copy the binary to `/usr/local/bin/seedelf-data-api`;
   - copy the decimals file to `/etc/seedelf-data/token-decimals.json`;
   - fill in `edge/seedelf-data.env` as `/etc/seedelf-data/env`, mode `0600`;
   - install `edge/seedelf-data-api.service`, then `systemctl enable --now seedelf-data-api`;
   - `curl 127.0.0.1:8099/health` answers 200 with `"source":"db-sync"`.
6. **DNS:** an A record (and AAAA, if the VPS has IPv6) for `mainnet.<domain>`, to the VPS.
7. **Caddy:** fill in `edge/Caddyfile` as `/etc/caddy/Caddyfile`, then `systemctl reload caddy`. It gets its certificate by itself.

## 3. Home's traffic into the tunnel

The plan sends home's own traffic out through the VPS once everything is synced. Otherwise the node's peers, db-sync's metadata fetches and the first relay of every submitted transaction would show strangers the home IP.

**Only the node's and db-sync's traffic moves.** The box runs another project, and moving its default route would move that project too. Routing by user does it.

1. **Measure first.** Watch the node's traffic for a day with `vnstat`. The docs say about 1 GB an hour for a relay, and less for an outbound-only node. It all crosses the VPS twice: in from the internet, then out to home.
2. **Add the rules to `home/wg0.conf`,** so they come and go with the tunnel:

   ```ini
   PostUp = ip route add default dev wg0 table 51820
   PostUp = ip rule add to <LAN prefix> lookup main priority 90
   PostUp = ip rule add uidrange <node uid>-<node uid> lookup 51820 priority 100
   PostUp = ip rule add uidrange <db-sync uid>-<db-sync uid> lookup 51820 priority 101
   PostDown = ip rule del priority 101; ip rule del priority 100; ip rule del priority 90
   ```

   The tunnel's own packets are the kernel's, and leave by the main table.
   - **If the tunnel drops, the node loses its peers rather than reaching them directly.** That fails closed: it never shows them the home IP.
   - DNS lookups still go to the usual resolver, which sees names (pool metadata hosts), not who asked.
3. **Restart the tunnel, the node and db-sync.** Check that the node's connections leave through `wg0`: `ss -tnp | grep cardano-node` shows source `10.88.0.2`.

## 4. Checks

- **Health:** `curl https://mainnet.<domain>/health` answers 200, `private`, `public` and `egress` all `ok`.
- **CORS:** a preflight from the wallet's origin is answered with it, and any other origin gets no CORS headers:

  ```bash
  curl -si -X OPTIONS https://mainnet.<domain>/api/v1/tip \
    -H 'Origin: chrome-extension://<ID>' -H 'Access-Control-Request-Method: GET' | grep -i access-control
  ```
- **Limits:** about 75 quick `POST /api/v1/account_info` from one address end in a 429 with `Retry-After`. Run it from a third machine, never the owner's.
- **No address or path in any log:**
  1. stop the API and request something, so Caddy answers 502;
  2. send a request the API refuses;
  3. `journalctl -u caddy -u seedelf-data-api --since -10min` shows neither the client's address nor the path.

  On home, Postgres's log holds no statement.
- **DNS and certificates:** crt.sh lists `mainnet.<domain>` and nothing that leads home.
- **The drills** ([Verification](../../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md#verification)):

  | Stop | Expect |
  |---|---|
  | Kupo | nothing changes: it's the spare |
  | Postgres | within 4 s (two failed reads of its tip), `/health` says `"source":"kupo"` and the public routes answer 503; the wallet goes to Koios for the public side |
  | db-sync alone | the private index moves to Kupo once db-sync is 60 slots behind it; the public routes answer 503 once its tip is 3 minutes old |
  | the node | every part 503 within 3 minutes; the wallet goes to Koios for everything |
  | the tunnel | every part 503 within 4 s, submits too (3 s to connect); the node keeps no peers |
  | home's power | the same, then a clean start in NUT's order |
  | the VPS | the wallet goes to Koios |

## Routine

- **A new API build:** copy the binary, then `systemctl restart seedelf-data-api`. Every cache refills within a block, and the month's traffic is kept.
- **Before a node upgrade,** check Kupo's and Ogmios's compatibility with the new version: there's no preprod to try it on first.
- **After a db-sync upgrade,** compare its insert options with `home/db-sync-insert-options.json`.
- **At every wallet release,** refresh the token decimals file along with the wallet's own token list, then restart the API.
