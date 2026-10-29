# v-pr336-6-impact: the policy's summary lines still describe Koios as mainnet's fallback only

**Verdict:** confirmed. **Severity:** low, as filed. I don't agree with x-rel F2's medium (reasons below). **Confidence:** high. The code path is unambiguous, a scratch test showed the routing, and the text is on HEAD.

## Attribution and duplicates

- **pr336 F7** (`reports/pr336.md:120`) is this finding.
- **The same defect, filed elsewhere:** x-priv#1 (low), x-rel F2 (medium) and x-docs#3 (low, the store's host-permission text only). They should be merged. One edit pass fixes all four.
- **Not new in kind.** In 1.6.0 as shipped (`babb8e76`), the policy already had one case where Koios is asked "even while ours answers". It's at `:44`: what made the wallet's boxes in a later pool of a shown pool's box value. `:5`, `:7` and `:40` read word for word as they do now, so the summaries never named that case either. The finding's "Since #336, Koios is asked on mainnet while our server answers" is a little off: #336 adds a second case, and this one is common, not rare.

## The facts, checked

- **The confirm asks Koios while our server answers.** `refresh()` returns early unless the private index is up (`lovejoin-pools.ts:419-420`, `if (!index) return;`). Once it has the list, it runs `await this.keep(network, await this.confirmed(network, found))` (`:454`). `confirmed()` uses `const koios = this.deps.koios(network).koiosAlone();` (`:570`). On mainnet that's `DataLayerKoios`, whose `koiosAlone()` returns `this.alone`, a Koios client at `NETWORKS[network].koios` (`data-layer.ts:223-225`). `launches` and `firstRegistrations` are also pinned to `super` ("Pool discovery's, on Koios alone", `data-layer.ts:287-295`). So the only time this request goes out is while our server answers. With Koios-only on, or the private part down, the holder look runs instead.
- **It's a choice, not a fallback.** Our server serves both routes: `tx_info` (`seedelf-data/README.md:203`) and `account_update_history` (`:200`). The generic `txInfo` goes to it. The design doc gives the reason for Koios: "Our server lists the pools, so a check it answered would check nothing" (`privacy.md:200`). So "anything our server can't answer" doesn't cover it in any plain reading.
- **Who sends it.** Every mainnet device that holds a listed pool it doesn't know yet, at its first pool read, then at most every 5 minutes (`REFRESH_MS`) until Koios confirms it.
  - Pool reads run in the background too, not only when the Lovejoin page opens. For example, the alarm's due-box run calls `withdrawDueNow` → `ours()` (`lovejoin.ts:6195`) → `readSet` → `deps.pools` → `refresh`. Reviews (`split`/`splitAll`) and Bring every box back now do the same.
  - "Known" means the bundled head start plus the device's own record (`lovejoin-pools.ts:349-352`). Mainnet's head start holds **no pool** (`src/lovejoin-pools.json`: height 14110720, `pools: []`). Remove wallet deletes the device's record.
  - So a fresh install or a removed wallet asks Koios about every listed pool the head start doesn't hold. Older devices ask about each new pool once.
  - The release refresh (`npm run lovejoin-pools`) bundles whatever pools exist by then. If mainnet still has no token pool at packaging, nothing happens until someone launches one. From then on it happens on every Lovejoin user's device.
- **What Koios learns.** The IP address, and that this device reads Lovejoin's pools. The request names only public launches, the same for every device new to the same pools, and nothing of the user's. That matches the 28 October entry (`:93`).

## The scenario holds

A mainnet user leaves Koios-only off. They read the In short (`:5`, "on mainnet for anything our server can't answer") or the Koios bullet (`:40`, "on mainnet whatever ours can't answer"). They take it that Koios sees nothing of them while our server is up. Then a token pool is launched, and their next pool read sends `tx_info` to `api.koios.rest` from their IP. The detail paragraph (`:46`) and the dated entry (`:93`) say so. The summaries don't.

## Severity: low, not medium

- **Disclosed in the same document, twice:** `:46` and the dated `:93` entry. So it isn't "a leak against what the privacy policy says". It's a summary that leaves out a case its own detail states.
- **What leaks is small:** the IP address and the fact that it reads Lovejoin. No account, no box, and the same request for every device new to the same pools.
- **The summaries were already loose.** They passed 1.6.0's review with a stronger exception left out: `:44`'s case tells Koios which boxes are yours.
- **But fix it before the upload.** It's cheap. And the exception is no longer rare: every Lovejoin user meets it once a new pool appears.

## The fix

- **Right direction, but put it in the In short too, not optionally.** `:5` is the line most readers stop at, and the only one that reads as the full list of when Koios is contacted.
- **Suggested wording, for the owner to adjust:**
  - `:5`: "…and on mainnet for anything our server can't answer and to check a new Lovejoin pool it lists, or for everything if you turn our server off in Settings."
  - `:40`: "…and on mainnet whatever ours can't answer and the check of a new Lovejoin pool ours lists (below), or everything with that switch on."
  - **The owner's call:** a general pointer, such as "and some Lovejoin checks (below)", would cover `:44`'s 1.6.0 case at the same time.
- **Leave `:7` alone.** It defines *the Cardano server*. The confirm isn't a Cardano-server request: the policy names Koios for it (`:46`). Writing it into `:7` would blur every "read from the Cardano server" line. Here I disagree with x-rel's fix, which includes `:7`.
- **No new *Changes* entry.** The 28 October entry already covers this change, and 1.7.0 hasn't shipped. The Effective date stays.
- **The same claim elsewhere, which a policy-only fix leaves inconsistent:**
  - **`store/README.md:261`, the Koios host row:** it now says the wrong thing outright. It says the launch and registration requests happen "while its own server hasn't listed them".
  - **`:269`, the dashboard box:** 996 of about 1,000 characters, so swap words rather than add them. "for one Lovejoin read" → "for two Lovejoin reads" comes to 997.
  - **`:75`, the listing's description, in Spanish (`:163`) and Japanese (`:227`):** `:114` asks for both languages in the same PR, and a back-translation of what changed.
  - **The rest:** `:334` (test instructions), `:274` ("Koios is the fallback"), `privacy.md:22`, and `development.md:162`. That last one is the release check: "`api.koios.rest` only for a part the data layer couldn't answer". A fresh profile that reads a pool the head start doesn't hold would fail it on a correct build.
- **What the fix breaks: nothing.** It's text only: no guard, no change in behaviour. It adds and drops nothing (rule 3) and dates nothing (rule 7). No test or script reads `privacy-policy.md` or `store/README.md`, and `words.test.ts` doesn't scan the docs.

## Repro

`extension/tests/zz-review-v-pr336-6-impact-1.test.ts`, run alone, 3 of 3 passed:

1. The bundled mainnet head start holds 0 pools, and the preprod fixture's launch isn't among preprod's bundled pools.
2. `chainClient` on mainnet, with Koios-only off and the parts up, sent these requests: `txInfo` → `mainnet.seedelf.logicalmechanism.io/tx_info`; `koiosAlone().launches` → `api.koios.rest/tx_info`; `koiosAlone().firstRegistrations` → `api.koios.rest/account_update_history`; `launches` → `api.koios.rest/tx_info`.
3. `PoolDiscovery.refresh` with the real bundled head start, the private index answering `lovejoin/pools`, and the worker's own `chainClient` as `koios`. The only chain request was `tx_info` to the Koios host (preprod's fixture, so the WebAssembly verifies it), and the pool was kept.

The test file and my scratchpad notes are deleted. No tracked file was edited, and nothing was asked of the network.
