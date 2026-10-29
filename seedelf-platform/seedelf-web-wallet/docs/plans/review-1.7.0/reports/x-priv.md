# x-priv: privacy, the network and the data layer across #325-#338

Tree: `web-wallet/release-1.7.0` at `6bca8bec`. Lens: every request the range adds or moves, what each operator learns, the privacy policy, privacy.md, the store listing's privacy answers and architecture.md against the code, and the privacy lines on the new screens.

## Verdict

No high or medium findings. Nothing in the range leaks against what the policy says outright, and only one PR changes what is sent: #336's Koios confirm. It has its dated entry, and its pools paragraph is right. What's off:

- the policy's and the listing's summary lines still call Koios a mainnet fallback (low);
- a launcher's device is likely the first to ask Koios about its own new pool, which the new entry's "naming nothing of yours" doesn't cover (low);
- a pool read on the data layer's path now waits on Koios for a new pool, up to about 91 s when Koios hangs (low);
- #337's critical line blames giveme.my in states where the page says the 5 ₳ pool is the wait (low);
- architecture.md and some code comments are stale about the confirm (low);
- privacy.md and flows.md trail #333 and #337 (low);
- the *Effective* date is the owner's call.

#337's "tied to this session" is true and matches the policy. #335 and #333 send nothing new.

## What each PR sends (checked)

| PR | New or moved requests | Verdict |
|---|---|---|
| #336 | Mainnet with the data layer's private part up and Koios-only off: at the first pool read after `lovejoin/pools` lists a pool this device doesn't hold, `confirmed()` (`lovejoin-pools.ts:565`) asks **Koios** (`koiosAlone()`, `data-layer.ts:214/223`, under `KOIOS_LIMIT`, with the host check). It asks `tx_info` for the launch hashes, 20 a request, selecting only `tx_hash, block_height, tx_block_index, tx_timestamp, inputs, certificates`. Where the launch didn't register L, it also asks `account_update_history` for L's stake address (`registration` rows), 75 a request. Again at each refresh (every 5 min or more, and a restarted worker's first pool read) until Koios answers. No path reaches it on preprod, with Koios-only on, or while the private part is down (`private-index.ts:368` returns no index, so `refresh` returns at :419). The data layer learns nothing new. | Entry present and right; see findings 1-3, 5 |
| #337 | None new. The press marks the tail over (device), pumps a chain still being sent, which stops in `witnessTail` before giveme.my is asked again, then `advance(…, true)`. That reads the session's account, as Refresh does, and builds the rest's return: a sweep from the one-time account, sent through the Cardano server as at the day's end. No storage key is added. | "Nothing new is sent": true |
| #335 | None. `tx-view.ts` reads session storage only, through `partHashes` → `partKey`. Its deps are local, `markYours` derives keys on the device, and `TxDetail` links out nowhere. | "No new request": true |
| #333 | None new. `privateBootstrapBounds` reads `epoch_params` once and hands it to `privateBootstrapMost`, which read it itself before. The funding and the legacy check use parameters already read. | True |
| #330 | None (`unawaited` locks on a trap) | n/a |
| #325-329, #331, #332, #334, #338 | docs, deps, CI, build profile | n/a |

## Findings

### x-priv#1: low · privacy/docs: the summary lines still say Koios is only a mainnet fallback
#336 asks Koios on mainnet, by design, while our server answers. The policy's pools paragraph (:46) and its 28 October entry (:93) say so. These don't:
- the policy's *In short*, `privacy-policy.md:5`: "on mainnet for anything our server can't answer";
- the policy's Koios bullet, `:40`: "on mainnet whatever ours can't answer";
- the listing's description in en/es/ja, `store/README.md:75`, `:163` and `:227`;
- the Koios host row, `:261`. It says the holder's new pools are read from Koios "while its own server hasn't listed them", now the opposite case. Its "Even while its own server answers" list names only the later pool's box origins.
- the merged host box, `:269`: "for one Lovejoin read its server doesn't cover";
- `:274`: "Koios is the fallback";
- the test instructions, `:334`: "api.koios.rest on mainnet when that server can't answer".

**Scenario:** a mainnet user with the data layer up reads the *In short* or the listing, and is told Koios only stands in for our server. When a new token pool is listed, their first pool read sends Koios `tx_info` from their IP.

**Fix:** name the confirm in each place, in all three languages for the description. The merged box is at 996 of about 1,000 characters, so trim elsewhere.

`:289`, the financial-information answer, stays right: the confirm sends nothing of the user's.

### x-priv#2: low · privacy: a launcher's device is likely the first to ask Koios about its own new pool
- **Why the launcher asks.** The launch service never takes the device's own pool sooner (`lovejoin-launch.ts:1-9`: "None is read sooner from the launcher's own record, which would single out the launcher's IP"). So the launcher's device finds its pool on the data layer's list like any device. Since #336 it then asks Koios `tx_info` naming that launch (`lovejoin-pools.ts:454`, `:565-584`).
- **Why it asks first.** The hub tells the launcher "A pool you started (…) shows here once a look finds it, about 10 minutes after its block" (`en.json:1277`), so the launcher reads pools right then. Other devices ask whenever they next read pools.
- **What Koios can infer.** With few Lovejoin users, Koios likely gets the first pool-named request from the launcher's IP, minutes after the block. For a launch from the private balance, whose payer the chain hides, that ties the IP to the launch, and so to its Seedelf inputs and change.
- **What's new.** Before #336, on mainnet with ours up, no third party got a pool-named request from the launcher. The same timing already existed on the Koios holder look (preprod, Koios-only), where Koios had sent the launch itself.
- **The docs.** The 28 October entry (`:93`) says "The same request for every wallet, … naming nothing of yours". privacy.md:200 says "never one of the wallet's", and the token-pools plan's §3 "No read names your pool". The "same for every wallet" is also really "every device that hasn't seen that pool", since the bundled head start differs by release.

**Fix (owner's call):** one of these.
- (a) Say it in the entry and privacy.md, and reword "naming nothing of yours".
- (b) Skip the confirm for a pool the sealed launch record shows this device started. Only the Koios ask is skipped: the pool still joins only once the data layer lists it.
- (c) Wait a random while before a first confirm.

### x-priv#3: low · perf/network: a new pool's Koios confirm holds the data layer path's pool reads
- **The await.** `refresh` awaits `confirmed` (`:454`), and every non-quiet pool read awaits `refresh` (`serviceDeps.pools`, `:596-602`). That includes the hub's first read (`status` → `ours` → `readSet`, `lovejoin.ts:3130`), a swap's review, a mix and a session's return.
- **How long.** A hung Koios costs the read timeout plus one retry: 45 s, then 1 s, then 45 s (`koios.ts:421`, `:429`, `:1345`, `:1373`), about 91 s. 429 holds can stretch it to about 2 minutes.
- **How often.** It hits the first pool read of each 5-minute window while a listed pool is new to the device and Koios isn't answering. Before #336, this path never waited on Koios for the list.
- **Shown.** A scratch test (`zz-review-x-priv-1`, deleted) held Koios's `tx_info`. `serviceDeps(found).pools()` stayed pending after the data layer answered and Koios was asked, and resolved only once Koios answered.

**Fix:** don't await the confirm in the read (keep what it confirms for the next read), or give it a short timeout and no retries.

### x-priv#4: low · ux/words (critical key): #337's line blames giveme.my where the 5 ₳ pool is the wait
`tailHeld` offers the way out under `tailWaits` and also under `tailBuildable` (`lovejoin.ts:4131`). In the latter, the return throws `tailWaiting("fewBoxes"|"noPool")` (`sessions.ts:4390`; `lovejoin.ts:4041`, `:4082`). So the same page shows "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free…" (or "can't be read right now"). An hour after the deposit landed it also shows "The collateral's mix is still waiting for giveme.my."

The line's privacy half is right. The box at its deposit is tied to the session's one-time account, as the policy's "can be tied to the session until it's mixed, as any box at its deposit can" says, in the wording other critical keys use. Through the session it's tied to what the session already is: its funding's private UTxOs and the rest's sweep.

**Fix:** drop or vary the cause. It's a critical key, so it needs a fresh blind back-translation.

### x-priv#5: low · docs: architecture.md and code comments predate the confirm
- `architecture.md:732` still says a listed pool's being finished is "the server's word", and "Whether a pool is on chain at all is the ledger's to judge, not the server's".
- The network section's token pools bullet (`:287`) doesn't mention the confirm or its Koios cost (rule 8).
- `lovejoin-pools.ts:31-35` and `:436-438` say the ledger is the judge.

#336 updated privacy.md and the policy only.

**Fix:** add the confirm to :732 and :287, with its cost: one `tx_info` per 20 new launches and one `account_update_history` per 75 Ls, at the first refresh after a listing and each after until Koios answers. Keep "where its launch sits" as the server's word, since `confirmed` keeps the list's own `launch`. Update both comments.

### x-priv#6: low · docs: privacy.md and flows.md trail #337 and #333
- **#337's way out.** `privacy.md:217` ends the collateral mix's wait only "a day after the deposit landed", with no word of *Bring the rest back now* from an hour in. Its outcome is the same as the day's end.
- **#333's priced reserve.**
  - `privacy.md:198` keeps "1.5 ₳ for its way back", now priced: at least 1.5 ₳, and 1.8 ₳ at 6,465 lovelace a byte.
  - `flows.md:523` still says "(68 in the classic pool at 6,465 lovelace a byte…)" and "(1.5 ₳ …)". #333 made that cap 96.
- The review row itself shows the computed `bootstrapReserve` (`Lovejoin.tsx:3798`), so only the docs are off.

### x-priv#7: owner-call: the policy's *Effective* date
#336 set "Effective 28 October 2026" and dated its entry the same day, #336's merge day. 1.6.0 was dated its release PR's merge day: ef6af2bc, the owner's "make the merge day today", and #324 merged 2026-10-26 19:44 PDT.

1.7.0 ships as small PRs on `main`. The store and Settings link `main`'s policy, so it has described the Koios confirm since #336 merged while the store still serves 1.6.0. That is over-disclosure, and harmless.

**The call:** keep 28 October, or re-date the line and the entry to the release-prep merge.

## CLI notes
- #328 (rustls 0.23.46) and #327 (certifi pins for the contracts' happy path) aren't in the wallet's network path. `seedelf-koios`'s reqwest uses the browser's fetch on wasm32, and the worker's Koios client is TypeScript.

## Not checked
- **Conway registrations.** Whether Koios's `tx_info` labels a Conway registration certificate (cert 7) `stake_registration`. If it doesn't, a pool launched with one would never confirm on the data layer's path, and would be re-asked every refresh. The wallet's own launches use cert 0, and db-sync's table, which the data layer reads, holds both. Checking needed a cert-7 launch on chain and a Koios read the brief limits.
- **How often Koios hangs, and how many devices read pools near a launch.** These set the real weight of #2 and #3. Needs live data, which the brief's no-network rule rules out.
- **i18n.** The es/ja back-translations of `lj.tail.privacy.wayOut`, beyond reading the English.
- **The skip racing the alarm's pump.** `tailOver` is written outside `serial`. Its effect is on money and state, not privacy; that's the per-PR lens's.
