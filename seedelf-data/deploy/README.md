# Deploying the data layer

How the data layer goes live: home's services reached through a WireGuard tunnel, and the API on a VPS behind Caddy. Why it's shaped this way is chunk 26's plan ([Home](../../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md#home), [Tunnel and VPS](../../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md#tunnel-and-vps)). **Mainnet only:** preprod stays on Koios, and the preprod server at home is another project's.

Every file here is a template. `<…>` marks a value to fill in on the machine. Keys, passwords, addresses and database names are never committed.

| Where | What | Files |
|---|---|---|
| Home | cardano-node, db-sync and Postgres, the Seedelf Kupo, Ogmios, cardano-submit-api. Stock software only. | `home/` |
| The tunnel | WireGuard, dialled out from home: `10.88.0.2` is home, `10.88.0.1` the VPS | `home/wg0.conf`, `edge/wg0.conf` |
| The VPS | `seedelf-data-api` behind Caddy. Every line of custom code runs here. | `edge/` |

## Before you start

- **A VPS** with 2 vCPU and 4 GB, near home. Its terms must allow blockchain workloads: Hetzner's don't. It needs DDoS filtering that never terminates TLS. Its traffic is the API's alone (§3).
- **A domain.** The API is `https://mainnet.<domain>`, and DNS names the VPS only.
- **The wallet's Web Store ID,** from the store's developer dashboard, for `DATA_ORIGINS`.
- **A build of the API** for the VPS's architecture, with the pinned toolchain: `cargo build --release -p seedelf-data-api` from `seedelf-data/`.

## 1. Home

**Postgres.** The `seedelf_reader` role exists since 2026-10-08; `home/seedelf_reader.sql` makes it again.

1. Add the tunnel's address to `listen_addresses`, and the logging settings: `home/postgresql-seedelf.conf`.
2. Add the VPS's line to `pg_hba.conf`: `home/pg_hba-seedelf.conf`.
3. Install the drop-in `home/postgresql-after-network.conf`, so Postgres binds after the network and `wg0` are up. After a reboot on 2026-10-09 it bound localhost alone.
4. `systemctl daemon-reload`, then restart Postgres.

**The Seedelf Kupo** (`home/kupo_seedelf.service`), **cardano-submit-api** (`--config home/tx-submit-mainnet-config.yaml --port 8090`) and **Ogmios** (port 1337, which serves another project too) listen on every address: the LAN for building locally, and `wg0` for the VPS. The router forwards none of their ports, and `home/nftables-seedelf.conf` lets only the VPS in through `wg0`.

**db-sync** runs the options in `home/db-sync-insert-options.json`. They've been right since 2026-10-09, when `offchain_vote_data` was turned on. Check them again after every db-sync upgrade: 13.7.0.1 added that option switched off, and vote metadata stopped with no error.

**db-sync's extra indexes** are in `home/db-sync-indexes.sql`:
- the 13 found on the server on 2026-10-09 that db-sync doesn't make (about 79 GB);
- 3 small ones the API adds for a wallet's first load.

Run it as the role db-sync writes with. It skips any index already there, and builds the rest without holding up db-sync. Its head has the command that lists every index with its size, and the one that finds a build that failed.

**The tunnel:**

1. `wg genkey | tee private | wg pubkey > public`, as root, in `/etc/wireguard/`.
2. Fill in `home/wg0.conf` as `/etc/wireguard/wg0.conf`, mode `0600`.
3. **Its firewall**, which filters `wg0` alone, so the LAN keeps its rules:
   - `home/nftables-seedelf.conf` as `/etc/nftables.d/seedelf.conf`, and `home/seedelf-nftables.service`. Then `systemctl daemon-reload` and `systemctl enable --now seedelf-nftables`.
   - **Never `nftables.service` on this box:** Ubuntu's flushes the whole ruleset when it stops, and its stock `/etc/nftables.conf` flushes it when it starts. That would take `ufw`'s rules with them, and Docker's where it runs.
   - A packet must pass `ufw` too: `ufw allow in on wg0 from 10.88.0.1 to any port 5432,1443,1337,8090 proto tcp comment 'Seedelf VPS'`.
4. `systemctl enable --now wg-quick@wg0`. It requires `seedelf-nftables`, so it never comes up unfiltered.

**Power.** NUT on the UPS shuts down in this order: db-sync, Postgres, Kupo, then the node. An unclean stop costs a long ledger replay.

## 2. The VPS

1. **Packages:** `wireguard-tools`, `nftables`, `vnstat`, `postgresql-client` (for `pg_isready`), and Caddy.
   - Ubuntu's own Caddy is years old. Caddy's apt repository (Cloudsmith) answered `402 Payment Required` on 2026-10-09, so Caddy is the `.deb` from its [GitHub release](https://github.com/caddyserver/caddy/releases): check it with `grep ' caddy_<version>_linux_amd64.deb$' caddy_<version>_checksums.txt | sha512sum -c -`, then `apt install ./caddy_<version>_linux_amd64.deb`.
   - `systemctl disable --now caddy` until step 4: its default site would answer on port 80.
2. **WireGuard:**
   - make keys as at home, and fill in `edge/wg0.conf`;
   - `systemctl enable --now wg-quick@wg0`.
   - Nothing passes through the VPS, so `net.ipv4.ip_forward` stays `0`.
3. **The firewall:** `edge/nftables.conf` replaces every rule on the machine.
   - Check it first: `nft -c -f nftables.conf`.
   - Arm a way back in case SSH is cut: `systemd-run --unit=seedelf-nft-rollback --on-active=180 /bin/sh -c 'nft flush ruleset; ufw --force enable'`.
   - If `ufw` is on (DigitalOcean's droplet had it), `ufw --force disable` and `systemctl disable ufw`.
   - Install it as `/etc/nftables.conf`, then `systemctl enable nftables` and `systemctl restart nftables`.
   - Log in again from a new session, then `systemctl stop seedelf-nft-rollback.timer`.
4. **Check home from the VPS:**
   - `pg_isready -h 10.88.0.2`;
   - `curl http://10.88.0.2:1443/health`;
   - `curl http://10.88.0.2:1337/health` (Ogmios, which must listen on every address, not only the LAN's);
   - `curl -X POST http://10.88.0.2:8090/api/submit/tx` (an error, which proves it answers).
5. **The API:**
   - copy the binary to `/usr/local/bin/seedelf-data-api`;
   - fill in `edge/seedelf-data.env` as `/etc/seedelf-data/env`, mode `0600`;
   - install `edge/seedelf-data-api.service`, then `systemctl enable --now seedelf-data-api`;
   - `curl 127.0.0.1:8099/health` answers 200 with `"source":"db-sync"`.
6. **The deploy user,** for `.github/workflows/data-layer-deploy.yml`:
   - `useradd --system --create-home --home-dir /home/deploy --shell /bin/sh deploy`, with `/home/deploy/.ssh` its own, mode `0700`;
   - `edge/seedelf-data-deploy` as `/usr/local/sbin/seedelf-data-deploy`, root's, mode `0755`;
   - `edge/sudoers-seedelf-deploy` as `/etc/sudoers.d/seedelf-deploy`, mode `0440`, after `visudo -cf` passes it;
   - a key made on your own machine (`ssh-keygen -t ed25519`):
     - its public half after `edge/deploy-authorized_keys`'s prefix, as `/home/deploy/.ssh/authorized_keys` (deploy's, `0600`);
     - its private half as the `DEPLOY_SSH_KEY` secret of the repository's `data-layer` environment, then deleted;
   - the environment (Settings → Environments): the owner as required reviewer, `main` alone, and two variables. `DEPLOY_HOST` is the API's name. `DEPLOY_KNOWN_HOSTS` is `ssh-keyscan -t ed25519 <the name>`, checked against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS;
   - check it: `ssh -n -i <the key> deploy@<the name> status` answers, and any other command gets the script's usage.

**Nothing is public yet:** no DNS name leads here until step 4.

## 3. Home's own traffic stays home's

**Home's node is a stake pool's relay,** and it must keep its inbound peers: there's no money for a second mainnet node. So the node and db-sync reach the internet from the home IP, as they always have, and the tunnel carries only the API's calls to home.

**Hiding the home IP from them would gain nothing:** a registered relay publishes it already, in the pool's certificate on chain and to every peer. What a wallet's user meets is the VPS alone. Their address stops there, and DNS names only the VPS.

**What's left to see:** someone determined could tie the API to the relay, by sending a transaction through the API and watching which relay announces it first. The worst they can do with that is attack an IP that's public already, and wallets fall back to Koios.

Until 2026-10-09 this step moved the node's and db-sync's traffic into the tunnel, failing closed. It was dropped once it was clear the node is the pool's relay: a node that only reaches out through the VPS is no relay. Its files (`seedelf-tunnel-routes.service`, `nftables-seedelf-egress.conf`, the VPS's forwarding and NAT) are in git's history, should the relay ever move off this box.

## 4. Going public

1. **DNS:** an A record (and AAAA, if the VPS has IPv6) for `mainnet.<domain>`, to the VPS.
2. **Caddy:** fill in `edge/Caddyfile` as `/etc/caddy/Caddyfile`, then `systemctl reload caddy`. It gets its certificate by itself.

## 5. Checks

- **Health:** `curl https://mainnet.<domain>/health` answers 200, `private`, `public` and `egress` all `ok`.
- **CORS:** a preflight from the wallet's origin is answered with it, and any other origin gets no `Access-Control-Allow-Origin`, so a browser refuses it (the methods and max-age lines still come):

  ```bash
  curl -si -X OPTIONS https://mainnet.<domain>/api/v1/tip \
    -H 'Origin: chrome-extension://<ID>' -H 'Access-Control-Request-Method: GET' | grep -i access-control
  ```
- **Limits,** from a third machine, never the owner's:
  - about 75 `POST /api/v1/account_info` sent at once from one address end in a 429 with `Retry-After`. Send them in parallel (`xargs -P 20`): one at a time, the refill keeps up. From the VPS to its own public name is a third machine;
  - a request with `Sec-Fetch-Mode: no-cors`, or from another `Origin`, gets 403: a web page can't spend the API's traffic.
- **No address or path in any log:**
  1. stop the API and request something, so Caddy answers 502;
  2. send a request the API refuses;
  3. `journalctl -u caddy -u seedelf-data-api --since -10min` shows neither the client's address nor the path. The only addresses there are Let's Encrypt's validators (`served key authentication`), at issuance and renewal.

  On home, Postgres's log holds no statement, and Kupo's no request path.
- **DNS and certificates:** crt.sh lists `mainnet.<domain>` and nothing that leads home.
- **The drills** ([Verification](../../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md#verification)):

  | Stop | Expect |
  |---|---|
  | Kupo | nothing changes: it's the spare |
  | Postgres | within 6 s (two failed reads of its tip), `/health` says `"source":"kupo"` and the public routes answer 503; the wallet goes to Koios for the public side |
  | db-sync alone | the private index moves to Kupo once db-sync is 60 slots behind it; the public routes answer 503 once its tip is 3 minutes old |
  | the node | every part 503 within 3 minutes; the wallet goes to Koios for everything |
  | the tunnel | every part 503 within 6 s, and a submit 503 within 3 s (it can't connect); the relay carries on |
  | home's power | the same, then a clean start in NUT's order |
  | the VPS | the wallet goes to Koios |

  The wallet goes back to the API at its first reading after a 5-minute hold, and a retry that fails starts the hold again. Postgres keeps answering on `10.88.0.2` across a restart of the tunnel. The drills as run, with their times, are in chunk 26c's plan.

## Routine

- **A new API build:** GitHub's Actions → *Data layer deploy* → *Run workflow*, on `main`, and approve the run when GitHub asks.
  - `deploy` builds `main` and installs it, keeping the running binary as `.prev`. It checks `/health`, which must answer as well as before, and the store's CORS line, and puts the old binary back by itself if the new one fails.
  - `rollback` swaps the two, and a second one undoes it. `status` says what's running.
  - Every cache refills within a block, and the month's traffic is kept.
- **Caddy:** apt doesn't update it (§2, step 1). Watch its releases, and install a new one's `.deb` the same way, checked.
- **Before a node upgrade,** check Kupo's and Ogmios's compatibility with the new version: there's no preprod to try it on first.
- **After a db-sync upgrade,** compare its insert options with `home/db-sync-insert-options.json`.
- **After a db-sync resync,** once it has caught up, run `home/db-sync-indexes.sql` again: a new database has only db-sync's own indexes.
- **At every wallet release,** refresh the token decimals (`api/data/token-decimals.json`, built in) along with the wallet's own token list, then deploy.
