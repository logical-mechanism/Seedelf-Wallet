# v-x-priv-0-trace: `x-priv#0`, traced on HEAD (`6bca8bec`)

**Verdict: confirmed. Severity: low.** #336's confirm asks Koios on mainnet while our server is up and answering. Nine summary lines in the policy and the store listing still say Koios on mainnet is only for what our server can't answer, and none of them mentions the confirm. A scratch test shows both on HEAD.

Two points of precision:

- **The Koios host row (`store/README.md:261`) doesn't describe "the opposite case".** Its "while its own server hasn't listed them" still describes the holder look, which still runs when our server can't answer. The row leaves out the confirm, and its "Even while its own server answers" sentence names only the later pool's box origins.
- **The reach is wider than "a new token pool is listed".** The bundled head start, `src/lovejoin-pools.json`, has **0 mainnet pools** (height 14110720). So on a mainnet device, every token pool our server lists is new to it at its first refreshing pool read. That device asks Koios about all of them, and asks again after Remove wallet and a restore, since the pools record is deleted with the wallet. Before #336, a device whose data layer was up asked Koios nothing on mainnet, except what made its boxes in a later pool. Once a token pool exists on mainnet, every device that reads Lovejoin's pools will ask Koios.

## The path on HEAD

1. **The wiring (`sw.ts:180-183`, `:236`, `:246`).**
   - `koios = chainClient(dataDeps)` gives a `DataLayerKoios` on mainnet (`data-layer.ts:431-439`).
   - `index = privateIndexClient(dataDeps)` gives an index only while the network has a data layer, Koios-only is off and the private part is up (`private-index.ts:361-370`).
   - Both go into `new PoolDiscovery({ … koios, index … })`, and `serviceDeps(discovery)` hands its `pools` to the Lovejoin service.
2. **A refreshing pool read.** `serviceDeps.pools` awaits `discovery.refresh` (`lovejoin-pools.ts:597-601`).
   - `refresh` asks our server's `lovejoin/pools` (`:423`), marks it answered (`:432`), verifies each pool offline (`:434-452`).
   - It then runs `await this.keep(network, await this.confirmed(network, found))` (`:454`).
   - Before #336 this line was `await this.keep(network, found)`, with no request (`git diff 473b7f1a^1 473b7f1a`).
3. **`confirmed` asks Koios alone (`:565-584`).**
   - Every listed pool the device doesn't hold counts as fresh (`:566-568`), and `kept()` merges the head start's pools with the stored ones (`:349-352`).
   - `this.deps.koios(network).koiosAlone()` (`:570`) returns `this.alone`, a plain `Koios` at `NETWORKS[network].koios` (`data-layer.ts:214`, `:223-225`). On mainnet that is `https://api.koios.rest/api/v1` (`networks.ts:64`).
   - `launched()` calls `koios.launches` (`:527`), which is a `tx_info` POST naming the launch hashes, 20 a request (`koios.ts:926-950`). Where a launch didn't register L, it also calls `firstRegistrations`, an `account_update_history` POST (`:551`).
   - Even on the routed client, `launches` and `firstRegistrations` always go to Koios (`data-layer.ts:287-295`).
4. **Nothing else on mainnet reaches Koios while our server is up.**
   - Every other `Koios` method is overridden to read the data layer first (`data-layer.ts:244-393`).
   - No source file outside `networks.ts` names a Koios host.
   - `koiosAlone()` has three callers. The holder look (`lovejoin-pools.ts:485`) runs only when our server hasn't answered within REFRESH_MS (`:391-397`). `inputsOf` (`lovejoin.ts:5702`) covers boxes our server's listing doesn't. The third is the confirm.

## The docs on HEAD

- **Disclosed in the policy's body:**
  - The pools paragraph, `privacy-policy.md:46`: "a pool on that list this device hasn't seen before it confirms with **Koios** first".
  - The 28 October entry, `:93`: "is confirmed with Koios before the wallet uses it … Koios sees it from your IP address, so it can tell you use Lovejoin".
  - `privacy.md:200` says the same.
- **Not in the summary lines.** #336 touched only the policy's `:3`, `:46` and `:93`, and privacy.md's `:200` (`git diff 473b7f1a^1 473b7f1a --stat`). It left out:
  - the policy's *In short* (`:5`) and its Koios bullet (`:40`);
  - all of `store/README.md`: the description in en, es and ja (`:75`, `:163`, `:227`), the Koios host row (`:261`), the merged host box (`:269`, "and for one Lovejoin read its server doesn't cover"), `:274` ("Koios is the fallback") and the test instructions (`:334`).
- **The *In short* was last edited for 1.4.0** (`3b5aabd4`).
- **Lines that need no change:**
  - `:7` and `:39` define "the Cardano server" and its failover, and the confirm names Koios explicitly.
  - `:41` is the "whichever answers" list.
  - `README.md:289` (the financial-information answer) is right, as the finding says: the confirm sends nothing of the user's.
- **Optional, not cited by the finding:** `privacy.md:22` has the same shape ("Koios for a part it can't answer"), but it's the design doc, and its `:200` details the confirm.

## Scratch test (run on HEAD, then deleted)

`extension/tests/zz-review-v-x-priv-0-trace-1.test.ts` used real WebAssembly, the preprod token-pool fixture and `fakeIndex`, wired as `sw.ts` wires them. It had one fetch for both servers: ours at an injected origin, Koios at its own host.

| Case | Result on HEAD |
|---|---|
| Pool read through `serviceDeps(discovery).pools`, ours up and answering | **passes:** our server got `lovejoin/pools` only, both parts stay up (no fallback), and Koios got exactly one request, `preprod.koios.rest/api/v1/tx_info` with `_tx_hashes: [LAUNCH]`. A second read asked nobody. |
| The confirm's client on mainnet (`chainClient(…)("mainnet").koiosAlone().launches`) | **passes:** `api.koios.rest/api/v1/tx_info` |
| The policy's body discloses it (`:46`, `:93`) | **passes** |
| Each summary line that puts Koios on mainnet where ours can't answer (or calls it "the fallback") also names the confirm | **fails**, as expected if the finding is real. All nine lines scope Koios to a fallback, and none names the confirm: `privacy-policy.md:5`, `:40`; `store/README.md:75`, `:163`, `:227`, `:261`, `:269`, `:274`, `:334`. |

Run: `npx vitest run tests/zz-review-v-x-priv-0-trace-1.test.ts`. 1 failed, 3 passed. The file was deleted afterwards.

## Why low

This is the same class as 1.6.0's x-privacy#2 and x-release#3: a summary line that reads as complete leaves out a practice the policy's body discloses (`git show 7e2d89ed:…/review-1.6.0/FINDINGS.md`). Both were confirmed low and fixed.

- **Disclosure:** the body and the dated entry disclose it, so rule 3's entry is there.
- **What's sent:** public chain data, the same for every device that hasn't seen the pool. Koios learns that this IP address uses Lovejoin.
- **Weigh the description:** of the nine, the store description (`:75`, `:163`, `:227`) is the one text a user reads before installing, with no body under it. The host row, the merged box and the test instructions are for the Web Store's reviewers. `:274` is a note to the owner.

## On the fix

The fix as filed is right. Some details:

- **The merged box:** it is exactly 996 characters (counted). "one Lovejoin read" → "two Lovejoin reads" adds one character. The confirm isn't really a read "its server doesn't cover", so the wording needs care, and something else must be cut.
- **The *In short*:** for example, "…and on mainnet for anything our server can't answer, and to confirm each Lovejoin pool it lists that this device hasn't seen…". The Koios bullet (`:40`) gets the same.
- **The host row (`:261`):** add the confirm to its "Even while its own server answers" sentence: the transaction that started each listed pool new to the device and, where that didn't register its script, the registration. Keep the holder-look clause, which is still right for when ours can't answer.
- **The es/ja description:** store text, not i18n keys, so no back-translation rule applies. The README's own rule is to change all three languages.
- **The finding's proposed docs check** is the fourth case above.
