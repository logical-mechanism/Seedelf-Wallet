# v-x-rel-1-impact: #336's Koios confirm, against the summaries that still call Koios mainnet's fallback only

**Verdict: confirmed. Severity: low, not the filed medium.** Confidence: high.

- **The defect is real, and the store build reaches it.** On mainnet's default path, a pool read asks `api.koios.rest` to confirm a listed pool the device hasn't kept. Every summary the finding names still says Koios is asked on mainnet only for what ours can't answer. I checked each quoted line on HEAD, and my scratch test confirmed the routing.
- **It's low.** The same policy states the request in full: the pools paragraph (`:46`), the 28 October entry (`:93`) and the *Effective* line's list (`:3`). The summaries have left out 1.6.0's own Koios-while-ours-answers case since 1.6.0, and that case tells Koios more. 1.6.0's review rated this exact class low (x-privacy#2). No setting would let a reader act differently.
- **The fix is right in direction, with corrections:**
  - leave the policy's `:7` as it is;
  - the finding's example clause for the dashboard box comes to 1,004 characters, over the box;
  - recount `:266`;
  - add Settings' own line, a critical key the finding misses;
  - the listing's description is the owner's call;
  - no new *Changes* entry.

## Duplicates

- x-rel#1 is x-rel's F2 (`reports/x-rel.md:32`).
- **The same defect:**
  - x-priv's #1, verified low in `v-x-priv-0-impact`;
  - pr336's F7, verified low in `v-pr336-6-impact`;
  - x-docs#3, the store's host texts only.
- I reached the same conclusions on my own checks, below. One edit pass fixes all four.

## Reachable with the shipped build?

Yes. Every link checked on HEAD (`6bca8bec`):

- **The worker wires discovery to the data layer's client.** `sw.ts:181` has `const koios = chainClient(dataDeps);`, and `:236` has `new PoolDiscovery({ local, wasm, koios, index, now: Date.now })`. On mainnet, `chainClient` gives a `DataLayerKoios`, whose `koiosAlone()` is a plain Koios at `NETWORKS.mainnet.koios` (`data-layer.ts:214`, `:223-225`).
- **The confirm runs only while our server answers.**
  - `refresh()` returns at `lovejoin-pools.ts:420` (`if (!index) return;`) unless the private index is up.
  - Once the list is in, it runs `await this.keep(network, await this.confirmed(network, found));` (`:454`).
  - `confirmed()` takes the listed pools the device doesn't hold (`:566-569`) and uses `const koios = this.deps.koios(network).koiosAlone();` (`:570`). Then `launched()` sends `koios.launches` (`:527`), plus `koios.firstRegistrations` (`:551`) where the launch didn't register L.
- **It goes to Koios even without `koiosAlone()`.** `launches` and `firstRegistrations` are overridden to call `super`, that is Koios ("Pool discovery's, on Koios alone", `data-layer.ts:287-295`).
- **It's a choice, not a fallback.**
  - The method's comment: "Koios rather than the data layer, which listed it: the check is one no single operator answers" (`lovejoin-pools.ts:562-563`).
  - The design doc: "Our server lists the pools, so a check it answered would check nothing" (`privacy.md:200`).
  - #336's own test now expects exactly `["tx_info"]` of Koios while the index answers `lovejoin/pools` (`tests/lovejoin-discovery.test.ts:271-291`).
- **Preprod is unaffected.** The store build has no data origin there, so `refresh()` stops at `:420`.
- **Who sends it.** Any mainnet device that does a non-quiet pool read while our server lists a pool the device's record doesn't hold. The reads that ask `deps.pools` are:
  - the Lovejoin page (`status` → `ours`);
  - a mix or Bootstrap (`poolNamed`);
  - a session return's or swap's review (`split`/`splitAll`, `:6814`, `:6831`);
  - Bring every box back now;
  - the due-box alarm (`withdrawDueNow` → `ours`, `lovejoin.ts:6195`). At unlock that runs only with something open in Lovejoin (`:6188`, privacy review §2.18).
  - So Koios learns that this IP address reads Lovejoin's pools, which a private session's default return through Lovejoin also does.
- **When.**
  - The bundled mainnet head start holds no pool (`src/lovejoin-pools.json`: height 14110720, 0 pools).
  - Each release refreshes it (`development.md:276`, `npm run lovejoin-pools`), so it fires for a token pool launched after that release's refresh.
  - From then on, each such device asks once per new pool, and again at later lists (every five minutes or more) while Koios can't confirm it.
  - A fresh install, or a device after Remove wallet, asks about every listed pool the head start doesn't hold, in one batched `tx_info`.
  - Starting a pool is offered to every user, for about 23 ₳, so this is an expected event, not a contrived one. It can happen in practice, so the finding isn't refuted.

## Severity: low

The brief's medium needs "a misleading money or privacy statement" **with real harm**. The harm here is small:

1. **The policy itself states it, three times:**
   - `:46`: "a pool on that list this device hasn't seen before it confirms with **Koios** first";
   - the 28 October entry (`:93`), which says Koios "can tell you use Lovejoin";
   - the *Effective* line's list (`:3`).

   So it isn't "a leak against what the privacy policy says". It's a summary that leaves out a case its own detail states.
2. **The *In short* already names Koios as a mainnet party that sees the IP address.** It says "on mainnet for anything our server can't answer". The confirm changes when Koios sees a user, not who sees them.
3. **It sends little.** It carries public launch hashes, and at times L's stake address, the same for every device new to that pool. That's less than the fallback the summary discloses, which sends the public account and every read. The one exception, a pool this device launched, is x-priv#2.
4. **No decision is distorted.** No setting turns the confirm off, and Koios-only on sends Koios strictly more. A reader who knew couldn't choose otherwise in the wallet, short of not using Lovejoin.
5. **The summaries were already loose.** The 1.6.0 copies case (`privacy-policy.md:44`: "Koios is asked even while ours answers") tells Koios which boxes are yours, and it was already absent from `:5` and `:40`. Both read word for word the same at `babb8e76`, and that passed 1.6.0's review.
6. **There's precedent.** 1.6.0's x-privacy#2 was confirmed low: summary lists left out giveme.my's view of the collateral mix, which names a session's one-time account, while the policy's row 28 and its dated entry disclosed it. The reviewers wrote, "a reader of the services section alone is told less than the policy's own data table says."
7. **The scenario overreads the summaries.** "Keeps Koios-only off so that Koios never sees them on mainnet, as … the policy's In short promise": the *In short* never promised that, and Koios takes over whenever ours can't answer, which the user doesn't control.
8. **"Can't answer" has a narrow literal defence.** The confirm's exact requests (`tx_info` with `select=…`, and `account_update_history` with `select=…&action_type=eq.registration`) aren't shapes our server's route filter accepts (`seedelf-data/README.md:220`, "Only the wallet's requests"). But a plain reader takes "can't answer" as the fallback of `privacy-policy.md:39`, so the summaries do mislead, a little.
9. **Store review risk is negligible.** The host is declared already (manifest.ts is unchanged in the range), so the update adds no permission. An incompletely listed use doesn't make it unjustified, and the policy discloses the sharing.

**Fix it before the upload anyway.** It's cheap, and the *In short* is where most readers stop. The Koios row at `store/README.md:261` is now outright wrong: it says the launch and registration requests happen "while its own server hasn't listed them".

## The fix, place by place

| Place | Verdict | Suggested text (the owner's to adjust) |
|---|---|---|
| Policy `:5`, *In short* | **Needed** | "…and on mainnet for anything our server can't answer and to check a new Lovejoin pool it lists, or for everything if you turn our server off in Settings." Covering 1.6.0's copies case too, for example with "and some Lovejoin checks (below)", is the owner's call. |
| Policy `:40`, the Koios bullet | **Needed** | "…and on mainnet whatever ours can't answer and the check of a new Lovejoin pool ours lists (below), or everything with that switch on." |
| Policy `:7` | **Leave it**: the finding is wrong to include it | It defines *the Cardano server*, the term every "Sent to the Cardano server" row uses. The policy names Koios, not the Cardano server, for the confirm (`:46`). Writing the confirm into `:7` would make every such row claim Koios gets it too. |
| Store README `:261`, the Koios row | **Needed** | Drop ", while its own server hasn't listed them". Extend the next sentence, for example: "…which that server doesn't cover, and, to confirm a pool that server lists that the wallet hasn't seen, the transaction that started it and its script's registration." |
| Store README `:269`, the dashboard box | **Needed, with other words** | It's at 996 characters. The finding's example, "and for two Lovejoin reads its server doesn't answer alone.", comes to **1,004**, over the box, and "doesn't answer alone" is vague. Use "and for two Lovejoin reads even while it answers." (**994**). "and for two Lovejoin checks its server doesn't answer." is 999 but misdescribes the confirm. |
| Store README `:266` | **Needed, missing from the finding** | Its counts follow the rows and the box: "2,636" and "This text, at 996 characters". Recount after any change. |
| Store README `:75`, `:163`, `:227`, the description | **The owner's call** | en: "…and on mainnet for anything ours can't answer and to check a new Lovejoin pool ours lists, or for everything…". `:114` then requires Spanish and Japanese in the same PR and a blind back-translation of what changed. 1.6.0 left its copies case out of this summary. |
| Store README `:334`, the test instructions | Optional, low value | "…api.koios.rest on mainnet when that server can't answer or to check a new Lovejoin pool it lists…". The instructions send reviewers to preprod, where nothing differs. |
| `privacy.md:22` | Optional | The design doc's IP line; `:200` already has the detail. |
| `development.md:162`, release check 9 | **Needed** | Add: "or a `tx_info` (at times an `account_update_history`) confirming a Lovejoin pool the data layer lists that the head start doesn't hold". A fresh profile would otherwise read a correct build as a fault, if a pool launched between the refresh and the check. |

## Not in the finding

1. **Settings' own line, a critical key.**
   - The key is `settings.koiosOnly.privacy.off` (`en.json:2036`): "Seedelf Wallet's own server answers first, and Koios only when it can't." The Spanish (`es.json:2171`) says "solo cuando este no puede", and the Japanese (`ja.json:1901`) says "応答できないときだけ".
   - It shows under the Koios-only switch on mainnet alone (`Settings.tsx:1124`), exactly where the confirm happens. It's unchanged since 1.6.0.
   - This is the wallet's own UI making the claim the finding is about.
   - **Minimal fix (the owner's call):** drop "only" ("solo", "だけ"). It stays one line (rule 4), keeps the note (rule 3), and `e2e/data-layer.spec.ts:71`'s check of "Seedelf Wallet's own server answers first" still passes.
   - The changed Spanish and Japanese need a blind back-translation (rule 6). `docs/i18n/verified-critical-{es,ja}.json` list keys, not values, so no test would catch a skipped one.
2. **`store/README.md:274`**, the owner's own note ("Koios is the fallback, which is why the Koios host stays"). A nit: it isn't pasted anywhere.
3. **`store/README.md:289`, *Financial and payment information*, stays.** The confirm sends nothing of the user's, except for a pool this device launched (x-priv#2). If the owner takes x-priv#2's fix, `:289` stays exactly right.

## What the fix changes or breaks

- **It's text only.**
  - No guard (rule 1) and no change in behaviour.
  - Nothing new is sent, and no privacy note is dropped (rule 3).
  - No date is added (rule 7).
- **Tests.**
  - No test or script reads `privacy-policy.md` or `store/README.md`. In `tests/` and `scripts/`, only `e2e/store-images.spec.ts` names the store folder, for its images.
  - `words.test.ts` scans `src/` only.
- **No new *Changes* entry, and the *Effective* date stays.** The 28 October entry covers this data-handling change, which hasn't shipped, so this is wording inside it. x-priv#7 is the date question.
- **The policy and the listing point at `main`.** The policy's fix goes live when it merges. The listing's texts go in at upload, by the owner's hand.

## Repro

`extension/tests/zz-review-v-x-rel-1-impact-1.test.ts`, run alone: 1 of 1 passed. It's deleted.

- I wired the store build's own origin function (`dataOrigin(n)`, no override) through `chainClient`, with Koios-only off and every part up.
- The calls `mainnet.koiosAlone().launches`, `.koiosAlone().firstRegistrations`, plain `.launches` and a routed `.txInfo` requested, in order:
  - `api.koios.rest/api/v1/tx_info?select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`;
  - `api.koios.rest/api/v1/account_update_history?select=stake_address,block_time`;
  - `api.koios.rest/api/v1/tx_info?select=…` (the same as the first);
  - `mainnet.seedelf.logicalmechanism.io/api/v1/tx_info`.
- `dataOrigin("preprod")` was undefined.
- Together with #336's own test (`lovejoin-discovery.test.ts:271-291`: `refresh()` with the index answering asks Koios exactly `["tx_info"]`), that covers the whole chain on mainnet.

**Also checked:**
- Character counts with Python against HEAD: the box is 996 characters, the finding's example comes to 1,004, and "…two Lovejoin reads even while it answers." comes to 994.
- With `git show babb8e76:…`, the policy's `:5`, `:40` and `:44` read the same at 1.6.0.
- `store/README.md`, the Koios-only i18n values and `manifest.ts` are unchanged in the range.
- 1.6.0's x-privacy#2, from `7e2d89ed:…/review-1.6.0/FINDINGS.md`.

No tracked file was edited, and nothing was sent to a network.
