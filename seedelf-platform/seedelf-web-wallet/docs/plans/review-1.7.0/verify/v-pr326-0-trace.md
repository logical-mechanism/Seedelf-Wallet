# v-pr326-0-trace: pr326#0, the parked Tor routes' "who sees what"

**Verdict: confirmed. Severity: low** (a misleading doc, in a parked idea's sketch; nothing ships from it).

I tried to refute it by tracing HEAD (`6bca8bec`). It holds, and it is a little broader than the finding says. Its scenario and its fix each put one thing on the wrong part (below).

The three passages are #326's own: `git blame` gives `a7abf9615` (2026-10-27) for post-release-roadmap.md :333, :337, :343 and :344. No later PR touched them.

## The scratch test

`extension/tests/zz-review-v-pr326-0-trace-1.test.ts`, run alone, then deleted. It used the real `chainClient`, `privateIndexClient`, `DataParts` and `chainStatus`, with a fake fetch that records each request's host and path.

The Split ("the public account's reads go to Koios") was modelled by the only lever the code has for it: the `public` part held on Koios (`DataParts.down("public")`).

Each case asserts one of the doc's promises, so it fails on HEAD if the finding is real. **All 5 failed:**

| # | Promise asserted | What HEAD did |
|---|---|---|
| 1 | Split (:344): with the public account's reads on Koios, the data layer hears nothing of the public account | `[koios credential_utxos, data.test submittx]`: the public account's submit still goes to the data layer |
| 2 | Split: a private spend's submit never reaches Koios, where the public account is read | When the data layer's submit answers 503, the spend goes to `api.koios.rest submittx`, beside the public read |
| 3 | Split / the shape: a private spend's status check never goes where the public account is read | With the private part down, the check goes to `api.koios.rest tx_status`. **A path the finding didn't cite** |
| 4 | The shape (:333): a session's one-time account is routed apart from the public account's reads | It moves with them: both go to `data.test` when the part is up, both to `api.koios.rest` when it's held |
| 5 | Bring your own Tor (:343): no private-side request goes to a host the public reads use | Each went to a Koios host: the contract read and a Seedelf spend under Koios-only, `koiosAlone().txSpends`, and a preprod submit |

## Tracing each claim

**(1) Split, :344.** "The public account's reads go to Koios, and the private side to the data layer and giveme.my, so neither operator alone ties the two."

- **Submits share one part.**
  - `data-layer.ts:40`: `export type Part = "public" | "private" | "submit";`
  - `:393–394`: `override async submitTx(...) { if (!(await this.uses("submit"))) return super.submitTx(txCbor);`
  - The public Send's path is `send.ts:81` → `script-spend.ts:441` (`submitWatched`) → `pending.ts:476` `koios.submitTx(bytes)`.
  - The worker's `koios` is `chainClient(dataDeps)` (`sw.ts:181`), which is DataLayerKoios on mainnet.
  - The existing test `data-layer.test.ts:267` ("keeps each part apart") already shows it: with the public part on Koios, `submittx` still goes to the data layer.
  - The finding's "every send the wallet watches goes through submitWatched" is narrower than the truth. dapp.ts:2494 and :2600, lovejoin.ts:4760, :7023 and :7195, sessions.ts:5337 and pending.ts:851 call `koios.submitTx` directly, and they reach the same `submit` part.
- **The per-part fallback.**
  - `parts.down(part)` is kept per part (`data-layer.ts:160–164`).
  - `submitFallback` sends a 403, 413, 415, 429 or 503 to Koios at once (`:127`, `:136–141`, `:403–408`).
  - So under the Split, a submit-part outage puts private spends at Koios beside the public reads (case 2).
  - **Imprecise in the scenario:** "During any 5-minute outage of the private part, the private reads and submits go to Koios". Submits move with the `submit` part's outage, not the private part's.
  - A private-part outage moves its reads onto the chain client's **public** part:
    - `private-index.ts:367–368` returns no index;
    - the contract is then read through `koios.credentialUtxos([contract])` (`contract-scan.ts:148`), and the pools through `this.deps.koios(network).credentialUtxos(...)` (`lovejoin.ts` `poolRows`).
  - So those reads reach Koios under a part-based Split. But a whole-contract or pool read is the same for every wallet. It tells Koios only that the account's owner uses Seedelf (privacy.md:123), not which spend is theirs.
  - The spend-level ties are the submits, the status checks below, a maybe-sent spend's mempool `utxo_info` (pending.ts:919, roadmap :364), and Lovejoin's box-origin asks: `lovejoin.ts:5679` and `:5702` (`koiosAlone()`), used only for boxes whose pool came from Koios (`:5602–5603`).
- **Status checks ride the public part**, not `submit`:
  - `txStatus` is a `read()` (`data-layer.ts:365–367`);
  - `chainStatus` asks it for a private spend whenever its feed can't answer (`feed.ts:229–256`; the call is at `:254`, `deps.koios(network).txStatus(...)`).

**(2) Bring your own Tor, :343:** "a `chrome.proxy` PAC script that routes our hosts alone".

- Koios is one host for public and private traffic: `networks.ts:51` and `:64`.
- `privateIndexClient` returns nothing under Koios-only and on preprod (`private-index.ts:367–368`; preprod has no `data` origin, `networks.ts:48–60`).
- `koiosAlone()` always asks Koios (`data-layer.ts:223–225`).
- The doc's own :337 already says the private side falls back to Koios ("would hide users from Koios (when the wallet falls back to it)"). :343's host-only PAC leaves that traffic going direct (case 5).

**(3) The shape, :333:** "(submits, giveme.my, the private index's reads), the public account's reads direct".

- A session's one-time account is read on the public part:
  - `sessions.ts:2390`, `:2648`, `:5360` and `:5666` (`credentialUtxos`); `:2633` (`usedStakeAddresses`); `:2720` (`accountTxs`);
  - all go through `read()` → `uses("public")` (`data-layer.ts:233–249`).
- A session's funding ties that account on chain to the private UTxOs that paid it (privacy.md:110). So reading the account from the IP that reads the public account ties the two (case 4).
- The same holds for a private spend's `tx_status` when its feed can't answer, and for the mempool `utxo_info` (case 3).

**Nothing on HEAD already handles it.**
- The only per-request exception is `koiosAlone`, and it sends to Koios.
- No passage in the roadmap or privacy.md qualifies the three routes' claims.
- Roadmap :364 lists the rare public-side `tx_status` and `utxo_info` paths, but under the data layer's leftovers, not against these routes.

## Corrections to the fix

The fix's direction is right. Two of its details are wrong.

- **Split:** "the public account's submits and status checks go to Koios too (the `submit` part split in two)" misplaces the status checks. They're already on the `public` part, together with private-side calls. A Split has to go **by caller, not by part**:
  - the public account's reads, submits and status checks to Koios;
  - one-time accounts, a private spend's `tx_status` when its feed can't answer, the mempool `utxo_info`, and the contract and pool reads when the private index is down, all kept off Koios;
  - and the private side's own fallback to Koios waits or is off. Otherwise the split holds only while every part answers.
- **Bring your own Tor:** as proposed: Koios can't be split by host, so the private side's Koios traffic leaves direct. That's the fallback windows, `koiosAlone`, Koios-only and all of preprod. The route needs the Koios fallback off for the private side while the switch is on.
- **The shape:** as proposed, adding "and a private spend's status check when its feed can't answer". Both are read on the public part.
- **Or one sentence after the three routes:** "Each must also cover what the code sends on the private side's behalf outside its parts: `submit` is shared with the public account; the public part carries one-time accounts, a private spend's `tx_status` when its feed can't answer, and a maybe-sent spend's `utxo_info`; and each part falls back to Koios on its own, which a host-level PAC can't route apart."

## Not checked

- No network use.
- Whether the owner would build the Split by part or by caller: the doc doesn't say, and either way its claim fails as written. By part: (3) and the status checks. By caller: the shared `submit` part.
