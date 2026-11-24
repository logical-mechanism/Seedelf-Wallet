# Deploying the data layer

How the data layer goes live: home's services reached through a WireGuard tunnel, and the API on a VPS behind Caddy. Why it's built this way is explained in the data layer's archived plan ([Home](../../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-26-data-layer.md#home), [Tunnel and VPS](../../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-26-data-layer.md#tunnel-and-vps)). **Mainnet only:** preprod stays on Koios, and the preprod server at home is another project's.

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

**Postgres.** `home/seedelf_reader.sql` makes the `seedelf_reader` role. The role's TCP keepalives matter: without them, a session the tunnel cuts off keeps its connection slot for about 2 hours, and Postgres refuses the rest of the API's connection pool.

1. Add the tunnel's address to `listen_addresses`, and the logging settings: `home/postgresql-seedelf.conf`.
2. Add the VPS's line to `pg_hba.conf`: `home/pg_hba-seedelf.conf`.
3. Install the drop-in `home/postgresql-after-network.conf`, so Postgres binds after the network and `wg0` are up. Without it, Postgres can bind localhost alone after a reboot.
4. `systemctl daemon-reload`, then restart Postgres.

**The Seedelf Kupo, cardano-submit-api and Ogmios** listen on every address: the LAN for building locally, and `wg0` for the VPS. The router forwards none of their ports, and `home/nftables-seedelf.conf` lets only the VPS in through `wg0`.

- **Kupo:** `home/kupo_seedelf.service`. On the server, `--log-level-http-server Warning` is set in a drop-in, `kupo_seedelf.service.d/http-log.conf`.
- **cardano-submit-api:** `--config home/tx-submit-mainnet-config.yaml --port 8090`.
- **Ogmios:** port 1337. It serves another project too.

**db-sync** runs with the options in `home/db-sync-insert-options.json`, which include `offchain_vote_data` turned on. Check them again after every db-sync upgrade: 13.7.0.1 added that option switched off, and vote metadata stopped with no error.

**db-sync's extra indexes** are in `home/db-sync-indexes.sql`:
- the 13 found on the server on 2026-10-09 that db-sync doesn't make (about 79 GB);
- 3 small ones the API adds for a wallet's first load.

Run it as the role db-sync writes with. It skips any index already there, and builds the rest without holding up db-sync. The top of the file has the command that lists every index with its size, and the one that finds a failed build.

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
   - `systemctl disable --now caddy` until §4, *Going public*: its default site would answer on port 80.
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
   - the environment (Settings → Environments): the maintainer as required reviewer, `main` alone, and two variables. `DEPLOY_HOST` is the API's name. `DEPLOY_KNOWN_HOSTS` is `ssh-keyscan -t ed25519 <the name>`, checked against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS;
   - check it: `ssh -n -i <the key> deploy@<the name> status` answers, and any other command gets the script's usage.

**Nothing is public yet:** no DNS name leads here until §4, *Going public*.

## 3. Home's own traffic stays home's

**Home's node is a stake pool's relay,** and it must keep its inbound peers: there's no money for a second mainnet node. So the node and db-sync reach the internet from the home IP, as they always have, and the tunnel carries only the API's calls to home.

**Hiding the home IP from the node's peers would gain nothing:** a registered relay publishes it already, in the pool's certificate on chain and to every peer. A wallet only ever connects to the VPS, so a user's IP address goes no further, and DNS names only the VPS.

**What's left to see:** someone determined could tie the API to the relay, by sending a transaction through the API and watching which relay announces it first. The worst they can do with that is attack an IP that's public already, and wallets fall back to Koios.

An earlier form of this step moved the node's and db-sync's traffic into the tunnel, failing closed. A node that only reaches out through the VPS is no relay, so that form was dropped. Its files (`seedelf-tunnel-routes.service`, `nftables-seedelf-egress.conf`, the VPS's forwarding and NAT) are in git's history, should the relay ever move off this box.

## 4. Going public

1. **DNS:** an A record (and AAAA, if the VPS has IPv6) for `mainnet.<domain>`, to the VPS.
2. **Caddy:** fill in `edge/Caddyfile` as `/etc/caddy/Caddyfile`, then `systemctl reload caddy`. It gets its certificate by itself.

## 5. Checks

- **Health:** `curl https://mainnet.seedelf.logicalmechanism.io/health` answers 200, with `private`, `public`, `submit` and `egress` all `ok`, and `node` `connected` with an `age` under 3 minutes (the time since the last block, usually under one).
- **CORS:** a preflight from the wallet's origin is answered with it, and any other origin gets no `Access-Control-Allow-Origin`, so a browser refuses it (the methods and max-age lines still come):

  ```bash
  curl -si -X OPTIONS https://mainnet.seedelf.logicalmechanism.io/api/v1/tip \
    -H 'Origin: chrome-extension://<ID>' -H 'Access-Control-Request-Method: GET' | grep -i access-control
  ```
- **The relay:** `/health`'s `messaging` says `"relay":"on"`, `"egress":"ok"`, `"ceiling":true`, `"reserve":false` and each pool's size, and a page answers 200 with the page's 16-byte header (`01`, then flags, a cursor and four prices) and no `Content-Encoding`. `"ceiling":false` means `DATA_MESSAGING_GB_MONTH` isn't set, and the relay spends the API's own allowance; `day_left` is the percent of today's share still unspent:

  ```bash
  curl -s https://mainnet.seedelf.logicalmechanism.io/messaging/v1/mainnet/envelopes | head -c 16 | od -An -tx1
  ```
- **The edge's limits at start:** `journalctl -u seedelf-data-api -b | grep "the edge's limits"` names each cap: in flight per address (`in_flight_messaging_address`, `in_flight_data_address`), in flight in all (`in_flight_messaging`, `in_flight_data`), the data answers held (`answers_mib`), the answers compressed at once (`compressing`) and the connections (`connections`). Unset, they're 16, 64, 512, 2048, 256, 64 and 8192 ([the edge](../README.md#the-edge)).
- **HTTP/1.1 and HTTP/2 alone:** `curl -sI https://mainnet.seedelf.logicalmechanism.io/health | grep -i alt-svc` prints nothing: Caddy offers no HTTP/3.
- **Limits,** from a third machine, never the maintainer's:
  - about 75 `POST /api/v1/account_info` sent at once from one address end in a 429 with `Retry-After`. Send them in parallel (`xargs -P 20`): one at a time, the refill keeps up. Sending from the VPS to its own public name counts as a third machine;
  - a request with `Sec-Fetch-Mode: no-cors`, or from another `Origin`, gets 403: a web page can't spend the API's traffic.
- **No address or path in any log:**
  1. stop the API and request something, so Caddy answers 502;
  2. send a request the API refuses;
  3. `journalctl -u caddy -u seedelf-data-api --since -10min` shows neither the client's address nor the path. The only addresses there are Let's Encrypt's validators (`served key authentication`), at issuance and renewal.

  On home, Postgres's log holds no statement, and Kupo's no request path.
- **DNS and certificates:** crt.sh lists `mainnet.<domain>` and nothing that leads home.
- **The drills** (the data layer's archived plan, [Verification](../../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-26-data-layer.md#verification)):

  | Stop | Expect |
  |---|---|
  | Kupo | nothing changes: it's the spare |
  | Postgres | within 6 s (two failed reads of its tip), `/health` says `"source":"kupo"` and the public routes answer 503; the wallet goes to Koios for the public side |
  | db-sync alone | the private index moves to Kupo once db-sync is 60 slots behind it; the public routes answer 503 once its tip is 3 minutes old |
  | Ogmios | the submit part 503 within 4 s (two failed reads of its `/health`); the wallet sends and evaluates through Koios. The reads don't change |
  | the node | the submit part 503 at the next read of Ogmios's `/health` once it says `disconnected` (2 s), every part within 3 minutes; the wallet goes to Koios for everything. Started again, the submit part stays 503 until the node has caught up (`/health`'s `node` age under 3 minutes), so a spend of a newer UTxO isn't refused as spent |
  | the tunnel | every part 503 within 6 s, and a submit 503 within 3 s (it can't connect); the relay carries on |
  | home's power | the same, then a clean start in NUT's order |
  | the VPS | the wallet goes to Koios |

  The wallet goes back to the API at its first read after a 5-minute hold, and a retry that fails starts the hold again. Postgres keeps answering on `10.88.0.2` across a restart of the tunnel. The drills as run, with their times, are in [the archived plan for the VPS's set-up](../../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-26c-data-layer-vps.md#the-drills-2026-10-09).

## Routine

- **A new API build:** GitHub's Actions → *Data layer deploy* → *Run workflow*, on `main`, and approve the run when GitHub asks.
  - `deploy` builds `main` and installs it, keeping the running binary as `.prev`. It checks `/health`, which must answer as well as before, and the store's CORS line, and puts the old binary back by itself if the new one fails.
  - `rollback` swaps the two, and a second one undoes it. `status` says what's running.
  - **After a deploy, check by hand the routes `/health` doesn't read:** the token pools', two public ones, and a relay's page (§5's command). The commands are [the release procedure's](../../seedelf-platform/seedelf-web-wallet/docs/development.md#2-on-main-after-the-merge-build-and-test-the-store-package), after its `status` run. A restarted server works out its first pool list in the background, for up to a minute, so the token pools' routes can answer 503 meanwhile: ask again before you take it for a failed deploy.
  - **A `rollback` can take a route, or a request's shape, away from a released wallet,** against [the release rule](../../seedelf-platform/seedelf-web-wallet/docs/development.md#2-on-main-after-the-merge-build-and-test-the-store-package) that a wallet the store ships never meets an older API. Its checks pass all the same: they read `/health` and CORS alone. So roll back only as a stopgap, and fix forward. A route the old build lacks answers 404, and a request it takes in another shape answers 400:
    - on a public route (`/api/v1/…`) or the private index's, either holds that whole part of the wallet on Koios for 5 minutes, and again at its first such request after each hold;
    - on the token pools' routes (`lovejoin/pools`, `lovejoin/tokens` and `lovejoin/tokens/since`), neither holds any part. The wallet reads the token pools' boxes from Koios instead and asks it what made its own ([privacy.md](../../seedelf-platform/seedelf-web-wallet/docs/privacy.md#known-links), *Lovejoin*), looks for new pools at Koios's holder, shows no crowd counts on the Lovejoin hub, and watches a token pool's chain through `tx_status`.
    - on the relay's routes (`/messaging/…`), Messages has nothing to fall back to: every wallet with Messages on can neither send nor read until a deploy brings the routes back. The pools' files wait on disk meanwhile, and each envelope still expires 36 hours after it came. A build with an older relay answers without whatever limits came after it.
    - **Before the 1.10.0 gate's build,** that's every route's: no totals over every address, no cap on connections, no kernel deadline on a connection that takes nothing, no small send buffers, a body read on any route, and no share of messaging's reserve per address. Caddy's timeouts (block 1 below) then end what it holds.
  - **What `.prev` holds,** and so what a rollback takes away. `status` prints the sha256 of the running binary and of `.prev`. The deploy run that installed a binary printed the same sha256, in its *build* job's *Checksum* step and in `DEPLOYED <sha256> (<the one before> kept as .prev)`, so that run's commit is the binary's: `gh run list --workflow data-layer-deploy.yml` lists the runs with their commits. A deploy that fails its check leaves `.prev` as it was, and a `rollback` swaps the two. Then `git diff <.prev's commit> <the running one's> -- seedelf-data/api/src` is what a rollback takes away: the routes are in `public/mod.rs`, `private.rs`, `lovejoin/routes.rs` and `messaging/mod.rs`, and every fix since goes with them. A slow answer costs more than a refusal: a read that takes longer than the wallet's 10 s holds its whole part on Koios for 5 minutes, and a token route's part is the private index's.
  - Every cache refills within a block, and the month's traffic is kept.
- **Watch the VPS's own meter** (`vnstat`) against the provider's allowance: `DATA_EGRESS_GB_MONTH` counts the API's response bodies alone, and TLS, headers and the tunnel come on top.
- **The relay's share,** `DATA_MESSAGING_GB_MONTH` in `/etc/seedelf-data/env`: what messaging may spend of the month's traffic. Every reader downloads every envelope, so messaging's traffic grows with the square of its users. Raise it as they come, and the droplet with it. The pools are saved beside `egress.json` (`messaging-<pool>.pool`), so a deploy keeps what's waiting; deleting them drops every waiting message. Never `0`: the API refuses it at start and doesn't run, so every route goes down, not Messages alone. To stop Messages, see [Stopping Messages](#stopping-messages).
- **Caddy:** apt doesn't update it (§2, step 1). Watch its releases, and install a new one's `.deb` the same way, checked.
- **Caddy's timeouts, and the API's stop deadline, memory cap and start after time sync,** are in `edge/Caddyfile` and `edge/seedelf-data-api.service`, which a deploy doesn't install: [below](#timeouts-and-limits-a-deploy-doesnt-install).
- **Before a node upgrade,** check Kupo's and Ogmios's compatibility with the new version: there's no preprod to try it on first.
- **After a db-sync upgrade,** compare its insert options with `home/db-sync-insert-options.json`.
- **After a db-sync resync,** once it has caught up, run `home/db-sync-indexes.sql` again: a new database has only db-sync's own indexes. Resync from an empty database, with `home/db-sync-insert-options.json`'s options. The crowds, and the token pools' incremental reads of the holder, rely on `tx_out`'s `consumed` mode: it keeps every output and writes each block's outputs in chain order, so each read can start above the output and transaction IDs already read. Neither `prune` nor `bootstrap` does.
- **At every wallet release,** refresh the token decimals (`api/data/token-decimals.json`, built in) along with the wallet's own token list, then deploy.

### Stopping Messages

Seedelf Messaging stops for every wallet at once, and the rest of the data layer goes on. The lever is `DATA_MESSAGING_OFF=true` in the API's environment, set by a drop-in beside the unit so the environment file isn't touched, and a restart. Never put it in the environment file: systemd lets that file's value override the drop-in's, so the lever would then do nothing. Both blocks below say `STOP` if it's there:

- **Every route under `/messaging/` answers 410 Gone,** `{"error":"messaging is stopped"}`, with CORS, before any other limit. A post's body isn't read, so nothing is kept. Every other route answers as before, and `/health` says `"relay":"off"`.
- **The pools wait on disk,** and what they hold still expires 36 hours after it came. A deploy keeps the drop-in, so Messages stays stopped across deploys until it's undone.
- **What wallets do:** a wallet with Messages on reads the 410 as Messages stopped, and shows them as paused. It solves and posts nothing there, keeps what's queued, and asks one page an hour, and one at each unlock, until a page gets an answer other than the 410. A stopped relay still sees those pages, and now and then a post a wallet made as it unlocked.
- **The restart** takes every part away for a moment, and a wallet that reads then goes to Koios for 5 minutes. Its stop saves the pools clean.
- **Never `DATA_MESSAGING_GB_MONTH=0`:** the API refuses `0` at start and doesn't run, however often systemd starts it again. Every route is down, and every wallet's reads go to Koios on 5-minute holds.

**To stop it,** on the VPS, as `seedelf`. It prints the machine's name, then `"relay":"off"` from `/health` and a page's status, `410`, or `FAILED` and why. Run again, it says `STOP` and changes nothing:

```bash
# seedelf-data-layer (the VPS)
hostname && sudo bash -euo pipefail <<'SCRIPT'
f=/etc/systemd/system/seedelf-data-api.service.d/messaging-off.conf
e=/etc/seedelf-data/env
if grep -qsE '^[[:space:]]*DATA_MESSAGING_OFF=' "$e"; then
  echo "STOP: $e sets DATA_MESSAGING_OFF, which overrides this lever: take that line out of it first"
elif [ -e "$f" ]; then
  echo "STOP: Messages is stopped already ($f)"
else
  mkdir -p "$(dirname "$f")"
  printf '[Service]\nEnvironment=DATA_MESSAGING_OFF=true\n' > "$f"
  systemctl daemon-reload
  systemctl restart seedelf-data-api
  for i in $(seq 30); do curl -s -m 2 -o /dev/null 127.0.0.1:8099/health && break; sleep 1; done
  echo "the relay: $(curl -s -m 5 127.0.0.1:8099/health | grep -o '"relay":"[a-z]*"' || echo 'no answer: journalctl -u seedelf-data-api -n 20')"
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' 127.0.0.1:8099/messaging/v1/mainnet/envelopes || true)
  echo "a page: $code"
  [ "$code" = 410 ] || echo "FAILED: a page answers $code, not 410: journalctl -u seedelf-data-api -n 20"
fi
SCRIPT
```

**To undo it,** the same way. It prints `"relay":"on"` and `200`, or `FAILED` and why. Undo it only once what stopped it is safe to let back: every wallet then posts what it queued meanwhile, at its next ask, whatever its version.

```bash
# seedelf-data-layer (the VPS)
hostname && sudo bash -euo pipefail <<'SCRIPT'
f=/etc/systemd/system/seedelf-data-api.service.d/messaging-off.conf
e=/etc/seedelf-data/env
if grep -qsE '^[[:space:]]*DATA_MESSAGING_OFF=' "$e"; then
  echo "STOP: $e sets DATA_MESSAGING_OFF, which overrides this lever: take that line out of it first"
elif [ ! -e "$f" ]; then
  echo "STOP: Messages isn't stopped by this lever (there's no $f)"
else
  rm -f "$f"
  systemctl daemon-reload
  systemctl restart seedelf-data-api
  for i in $(seq 30); do curl -s -m 2 -o /dev/null 127.0.0.1:8099/health && break; sleep 1; done
  echo "the relay: $(curl -s -m 5 127.0.0.1:8099/health | grep -o '"relay":"[a-z]*"' || echo 'no answer: journalctl -u seedelf-data-api -n 20')"
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' 127.0.0.1:8099/messaging/v1/mainnet/envelopes || true)
  echo "a page: $code"
  [ "$code" = 200 ] || echo "FAILED: a page answers $code, not 200: journalctl -u seedelf-data-api -n 20"
fi
SCRIPT
```

## Timeouts and limits a deploy doesn't install

`edge/Caddyfile` gives every request an end: its head within 10 s, the whole request within 10 s of its start, the answer within 60 s, and an idle connection 2 minutes. It serves HTTP/1.1 and HTTP/2 alone: its `write` timeout isn't shown to end a stalled HTTP/3 answer, and Chrome falls back to HTTP/2 with nothing lost. `edge/seedelf-data-api.service` gives the API's stop 30 s, which its own 10 s for what's open and the saving of the pools fit, holds the API under 3 GB of the droplet's 4, writes no core file and no swap (the API's tables of addresses live in memory alone, the database URL with them), and starts it after the clock is synchronized. A deploy installs neither file. **A VPS set up before these blocks has no deadline on Caddy's side until block 1 runs:** the API ends its own (a body within 10 s, a peer that stops acknowledging within 60 s, at most 8,192 connections), but one address can still hold Caddy's connections to it open, and what they buffer. To bring a running VPS in line with them, run each block once, on the VPS, as `seedelf`, in any order. Each prints the machine's name first; paste back what it prints after that. Run again, the first says `STOP` and changes nothing, and the others write the same files again.

`edge/nftables.conf` keeps UDP 443 open, for HTTP/3 should it come back: with Caddy on HTTP/1.1 and HTTP/2, nothing listens there.

**1. Caddy's timeouts, and HTTP/1.1 and HTTP/2 alone.** It adds them to the global options (to a file with the timeouts already, from this block before the 1.10.0 gate, the protocols alone), keeps the file before as `Caddyfile.before-timeouts`, and puts that back if Caddy refuses the new one. It should print five timeouts, in nanoseconds: the four it adds, and the proxy's `response_header_timeout` of 40 s, from the site's own block. Then `"protocols":["h1","h2"]`, `/health through Caddy: 200` and `HTTP/3 offered: no`:

```bash
# seedelf-data-layer (the VPS)
hostname && sudo bash -euo pipefail <<'SCRIPT'
f=/etc/caddy/Caddyfile
if grep -q 'read_body' "$f" && grep -q 'protocols h1 h2' "$f"; then
  echo "STOP: $f has its timeouts and protocols already"
else
  if grep -q 'read_body' "$f"; then
    awk '!done && $0 == "\tservers {" { print; print "\t\tprotocols h1 h2"; done = 1; next }
      { print }' "$f" > "$f.new"
  else
    awk '!done && $0 == "{" {
        print
        print "\tservers {"
        print "\t\tprotocols h1 h2"
        print "\t\ttimeouts {"
        print "\t\t\tread_header 10s"
        print "\t\t\tread_body 10s"
        print "\t\t\twrite 60s"
        print "\t\t\tidle 2m"
        print "\t\t}"
        print "\t}"
        done = 1
        next
      }
      { print }' "$f" > "$f.new"
  fi
  if ! grep -q 'read_body' "$f.new" || ! grep -q 'protocols h1 h2' "$f.new"; then
    rm -f "$f.new"
    echo "STOP: no line in $f is just {, the global options' start, or a tab and servers {: nothing changed"
  else
    cp -a "$f" "$f.before-timeouts"
    chmod --reference="$f" "$f.new"
    chown --reference="$f" "$f.new"
    mv -f "$f.new" "$f"
    if systemctl reload caddy; then
      site=$(awk '$2 == "{" && $1 ~ /\./ { print $1; exit }' "$f")
      echo "Caddy's timeouts: $(curl -s localhost:2019/config/apps/http/servers | grep -o '"[a-z_]*timeout":[^,}]*' | sort -u | tr '\n' ' ')"
      echo "Caddy's protocols: $(curl -s localhost:2019/config/apps/http/servers | grep -o '"protocols":\[[^]]*]' | sort -u | tr '\n' ' ')"
      echo "/health through Caddy: $(curl -s -o /dev/null -w '%{http_code}' "https://$site/health")"
      echo "HTTP/3 offered: $(curl -s -o /dev/null -D - "https://$site/health" | tr -d '\r' | grep -i '^alt-svc' || echo no)"
    else
      cp -a "$f.before-timeouts" "$f"
      systemctl reload caddy || true
      echo "STOP: Caddy refused the new file, and the one before is back: journalctl -u caddy -n 20"
    fi
  fi
fi
SCRIPT
```

**2. The API's stop deadline, memory cap, and no core or swap:** the unit's four lines, as a drop-in beside the installed unit. It should print `TimeoutStopUSec=30s`, `MemoryMax=3221225472`, `MemorySwapMax=0` and `LimitCORE=0`, and the cgroup's memory.max as `3221225472`, or `max` until the API next starts, which the next deploy does; the swap and core limits also take effect then:

```bash
# seedelf-data-layer (the VPS)
hostname && sudo bash -euo pipefail <<'SCRIPT'
d=/etc/systemd/system/seedelf-data-api.service.d
mkdir -p "$d"
printf '[Service]\nTimeoutStopSec=30\nMemoryMax=3G\nLimitCORE=0\nMemorySwapMax=0\n' > "$d/stop-and-memory.conf"
systemctl daemon-reload
systemctl show seedelf-data-api -p TimeoutStopUSec -p MemoryMax -p MemorySwapMax -p LimitCORE
echo "its cgroup's memory.max: $(cat /sys/fs/cgroup/system.slice/seedelf-data-api.service/memory.max)"
SCRIPT
```

**3. Start after time sync.** The relay keeps each envelope 36 hours by the server's clock. A start on a clock that's behind counts the waiting envelopes' times as its own now, so once the clock is put right each is that much older, and goes that much early. So the API starts after `time-sync.target`, and a service holds that target until the clock is synchronized: `chrony-wait` where chrony keeps the time, `systemd-time-wait-sync` otherwise (systemd-timesyncd's). The block bounds that wait at 3 minutes, after which the API starts anyway: unbounded, `systemd-time-wait-sync` waits for good on a clock that never syncs, and its man page says it can miss chrony's sync. It acts only at a boot, so a deploy's restart doesn't wait. If the clock isn't synchronized now, it stops and changes nothing. It should print `time-sync.target`, then the wait's name, `enabled` and `TimeoutStartUSec=3min`:

```bash
# seedelf-data-layer (the VPS)
hostname && sudo bash -euo pipefail <<'SCRIPT'
wait=systemd-time-wait-sync.service
if systemctl is-active --quiet chrony && systemctl cat chrony-wait.service > /dev/null 2>&1; then
  wait=chrony-wait.service
fi
if [ "$(timedatectl show -p NTPSynchronized --value)" != yes ]; then
  echo "STOP: the clock isn't synchronized now (timedatectl status says more): nothing changed"
elif ! systemctl cat "$wait" > /dev/null 2>&1; then
  echo "STOP: there's no $wait here: nothing changed"
else
  d=/etc/systemd/system/seedelf-data-api.service.d
  w=/etc/systemd/system/$wait.d
  mkdir -p "$d" "$w"
  printf '[Unit]\nAfter=time-sync.target\n' > "$d/after-time-sync.conf"
  printf '[Service]\nTimeoutStartSec=3min\n' > "$w/at-most-3min.conf"
  systemctl daemon-reload
  systemctl enable "$wait"
  echo "the API starts after: $(systemctl show seedelf-data-api -p After | grep -o 'time-sync\.target' || echo 'not time-sync.target')"
  echo "which waits for: $wait, $(systemctl is-enabled "$wait"), $(systemctl show "$wait" -p TimeoutStartUSec)"
fi
SCRIPT
```
