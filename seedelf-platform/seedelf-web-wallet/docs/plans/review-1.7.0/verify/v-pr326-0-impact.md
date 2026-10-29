# v-pr326-0-impact: pr326#0, the cheaper Tor routes' "who sees what" claims miss what today's parts send for the private side

**Verdict: confirmed. Severity: low**, as filed. Confidence is high on every fact: each was read at HEAD (`6bca8bec`) and the routing was run in a scratch test. The severity is a judgement. This is docs only: nothing in the shipped build changes, and it doesn't block 1.7.0. The proposed fix is right in substance but needs three corrections (see *The fix*).

## The facts hold

- **The text.** post-release-roadmap.md has the three claims at :333 (the shape), :343 (Bring your own Tor) and :344 (Split who sees what), exactly as quoted. #326 wrote :343 and :344, and moved the shape from 2026-10-22's bullet into the parked paragraph. No later PR touched any of them.
- **The parts split by request, not by side.**
  - data-layer.ts:40: `export type Part = "public" | "private" | "submit";`.
  - `submitTx` (:393–394) and `evaluate` (:374–375) use `submit`.
  - Every Koios-shaped read goes through `read()` (:233–234), which uses `public`: `credentialUtxos` (:244), `utxoInfo` (:251), `addressUtxos` (:259) and `txStatus` (:365) among them.
- **Every submit goes through that one part.**
  - pending.ts:476 `submitted = await koios.submitTx(bytes);` (`submitWatched`). It's reached by the public Send and the collateral (send.ts:81 and :101, then script-spend.ts:377 `send`, then :441), by staking (staking.ts:572), by Make private (move-in.ts:148) and by every private spend.
  - The other submits use the same client: dapp.ts:2494 and :2600, sessions.ts:5337, lovejoin.ts:4760 and :7023.
  - The account-paid mint's Ogmios draft (script-spend.ts:351, privacy.md:127) goes there too, through `evaluate`.
- **Much of the private side is read on the public part:**
  - a one-time account's UTxOs: sessions.ts:2390, :5360 and :5666, `koios.credentialUtxos(...)`;
  - a session's transactions' status: sessions.ts:3026, `txStatus`;
  - its orders: :3787 and :3803, `utxoInfo`;
  - any watched transaction that no feed settles: feed.ts:254, `txStatus`;
  - a maybe-sent payment's inputs, a private payment's included: pending.ts:919, `utxoInfo`.
- **Each part falls back to Koios on its own.** See privacy.md:113, and data-layer.ts:117 (`readFallback`) and :136 (`submitFallback`).
  - With the private index down, the contract scan reads `credentialUtxos([contract])` on the public part (contract-scan.ts:116–125 and :148).
  - Lovejoin then asks Koios which boxes are its own: lovejoin.ts:5679 and :5702 (`koiosAlone()`), with a `tx_info` that includes inputs (koios.ts:901–905).
- **The hosts.**
  - Koios is one host per network for both sides (networks.ts:51 and :64).
  - Preprod has no data origin (data-layer.ts:431 `chainClient`).
  - giveme.my is one host for both networks (networks.ts:52 and :65).
- **The scratch test**, `tests/zz-review-v-pr326-0-impact-1.test.ts`, run alone and then deleted, passed 3 of 3:
  - With `public` held down, which is Split's premise, a submit still went to the data layer, and a one-time account's `credential_utxos` and a `tx_status` went to Koios.
  - With `submit` held down, a submit went to Koios while a read stayed on the data layer.
  - With Koios-only on, the read went to Koios.
  - On preprod, the submit went to Koios.

One imprecision in the scenario: an outage of the private part moves the private reads, and submits move only when the submit part is down. Each holds on its own, so the conclusion stands.

## Impact

- **No user, site or attacker can reach it.**
  - None of the routes is built: :342 says "Cheaper ways, none built".
  - The roadmap isn't in the extension.
  - privacy.md and the privacy policy describe today's routing correctly. privacy.md:113–114 is itself the finding's evidence.
- **Who it misleads:** the owner, choosing among the routes (Split's default is "the owner's call"), and whoever writes the plan when Tor is picked up again. Each route's stated privacy result is the reason to pick it:
  - **Split, as written,** moves only "the public account's reads". The data layer then still gets every public Send, staking transaction, Make private and account-paid mint draft, from the same IP address as the private submits and giveme.my. That is the tie the route exists to remove.
    - If it were instead built by moving today's `public` part whole, it would send one-time accounts and private transactions' `tx_status` and `utxo_info` to Koios, beside the public reads.
    - Either way, it holds only while every part of the data layer answers.
  - **Bring your own Tor's** PAC script routes by host, and Koios is one host for both sides. So the private side's Koios traffic leaves directly from the user's IP address: in every fallback window, under Koios-only, and on all of preprod (giveme.my aside).
  - **The shape** records 2026-10-22's proposal. Its list leaves out the one-time accounts, which are read on the public part, and whose fundings tie them on chain to the private UTxOs that paid them (privacy.md:110). tor-js routes by call, not by host, so this is the easiest of the three to get right at build time, and the weakest part of the finding.
- **Severity: low**, the brief's "a misleading doc".
  - Not medium: no user-facing statement is wrong.
  - Not a nit: each route's privacy result is its substance, not its wording.

## The fix

The proposed fix is right in substance and within the owner's rules: it's docs only, it adds rather than drops a privacy note, and it dates nothing. Three corrections:

1. **Split's "status checks" is aimed the wrong way.**
   - The public account's `tx_status` is already a public-part read, so it moves with the public reads anyway.
   - What Split misses is the reverse: the private side's requests on the public routes have to stay with the private side. Those are one-time accounts, and a private transaction's `tx_status` and `utxo_info`.
   - The finding names this gap only for the shape, but it applies to Split as well.
2. **"waits or is off" settles a product question:** whether the private side stalls while the data layer is down. State the limit instead ("holds only while the data layer answers"), and leave the remedy as the owner's call, as the bullet already does for the default.
3. **The shape's clause is narrower than the gap.** Name "the private side's reads on the public routes, one-time accounts first", not one-time accounts alone.

**A more minimal edit** states the shared cause once, then adds one clause each for Split and Bring your own Tor. The new sub-bullet goes at the head of *Cheaper ways*, inside the Tor bullet, so that bullet stays *Kept in mind*'s first line, which :249 points to:

> - **Today's parts split by request, not by side**, so each route moves more than it names: every submit and Ogmios draft shares the `submit` part, the public account's too; a private session's one-time account, and a private transaction's `tx_status` and `utxo_info`, are read on the `public` part; and each part falls back to Koios on its own, where both sides meet, as they do under Koios-only and on preprod.

- **Split (:344):** "…so neither operator alone ties the two **while the data layer answers**, once the public account's sends go to Koios too."
- **Bring your own Tor (:343):** keep the finding's clause, "Koios can't be split by host: the private side's Koios fallback, Koios-only and preprod leave direct". Don't add "Koios refuses Tor": the root README:162 says so, but privacy.md:119 calls it unchecked, and that conflict is pr326's finding 2.

**What else the edit would change or break:** nothing built and nothing tested.
- `words.test.ts` walks `src/` only (:12).
- `activity.test.ts` names the roadmap only in comments (:693 and :1191).
- No heading or anchor changes, as long as the Tor bullet stays first.
- :343 is also the line that pr326's finding 2 (Koios and Tor exits) and finding 3 (`proxy` can't be optional) edit. One edit of that line should carry all three fixes.

**Noticed in passing, not this finding (nit):** Split's cost line names Koios's speed, but not the public tier's per-IP budget, which the whole public side would then spend. The owner's rule 8 asks every feature to state its Koios cost.
