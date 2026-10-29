# v-pr333-5-trace: pr333#5, the form counts 1.5 ₳ for the way back until the worker answers

**Verdict: confirmed. Severity: nit.**

I tried to refute it four ways:

- the form waits for the bounds before Bootstrap can be pressed;
- the worker's Review builds at a balance the stand-in passes;
- the window before the answer is too short to reach;
- the failure path can't happen.

None of these holds as the scenario states it. A scratch test with the real WebAssembly and worker reproduces the scenario exactly. Two things in the claim are looser than the code, and neither changes the verdict:

- the failure branch;
- the size of the optimism at 6,465, most of which is pr333#0's.

## The path, on HEAD (`6bca8bec`)

1. **The bounds start undefined.** `Lovejoin.tsx:2676` is `const [privateBack, setPrivateBack] = useState<string>();`. The effect at `Lovejoin.tsx:2680-2696` sends `call("lovejoin-bootstrap-most", …)` (2683) once the form shows with the private side chosen. On success it sets `privateMost` and `privateBack`. On failure it sets both to `undefined` (2690-2693). Its deps are `[bootstrapShown, source, pool.id]`, so nothing asks again after a failure.
2. **The stand-in.** `Lovejoin.tsx:3662` is `const reserves = DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back));`, with both constants at 1.5 ₳ (3611-3612). `costs` adds the boxes and `FEE_ROOM` (2 ₳, line 211), and `short` is `costs > seedelf.lovelace`.
3. **Nothing gates on the answer.** The Bootstrap button is `disabled={busy || bootstrapShort || !!unusable}` (3404). Before the answer it is pressable at any balance the stand-in passes.
4. **Review builds with the priced figure.** `bootstrap()` (2941-2946) calls `lovejoin-mix-private-build` with `bootstrap: true`. `mixOutBuild` reads the parameters (sessions.ts:2022). `mixFunding` prices `back` from them (sessions.ts:2096: `BigInt(this.deps.wasm.lovejoinBootstrapReserve(JSON.stringify(params)))`) and pays `mix.lovelace + reserve + back` (2107).
5. **The refusal is in words.** Core refuses change below the Seedelf least unless it is exactly zero (`seedelf-core/src/build.rs:2152-2153`, `SEEDELF_SHORT`). `buildFunding` maps that to `NotEnoughPrivate` (sessions.ts:2918, `t("sess.notEnoughPrivate")`). `act()` puts it on the page with `setError` (Lovejoin.tsx:2801-2813).
6. **The window is real but brief.** `lovejoinBootstrapMost`'s bisection, about 8 trial builds, took 1.3 to 1.4 s in node on an epoch's first ask. Later asks reuse the cached most, keyed by network, pool and epoch (lovejoin.ts:2950-2952). They still read `epoch_params` with no cache (lovejoin.ts:2967), so the window after the first ask is one round trip.

## Repro (scratch test, run alone, then deleted)

`extension/tests/zz-review-v-pr333-5-trace-1.test.ts` used `testBalances({ owned: false })`, so the private balance was one UTxO of exactly B. It drove `SessionService.mixOutBuild("preprod", n, { bootstrap: true })` with the real WebAssembly and checked it against `bootstrapLimits`. The 6,465 runs set `t.koios.params = { coins_per_utxo_size: "6465" }`.

A copy of the test and its output is in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr333-5-trace/` (`out.txt`).

Results:

- **The way back's reserve:** `lovejoinBootstrapReserve` gives `1500000` today and `1800000` at 6,465.
- **One classic box:**

| Price | Balance | What the form says | Review |
|---|---|---|---|
| today | 15.0 ₳ | enough, before and after the bounds | **builds** (fee 0.230260 ₳) |
| 6,465 | 15.0 ₳ | enough before the bounds, short after | **refused**: "Not enough ADA in your private balance for this, its fee and the change." |
| 6,465 | 15.299999 ₳ | as above | refused, same words |
| 6,465 | 15.3 ₳ | enough after the bounds too | refused, same words |
| 6,465 | 15.6 ₳ | enough | refused, same words |
| 6,465 | 15.9 ₳ | enough | builds |

- **The least balance that builds one box,** found by bisection: 14.696508 ₳ today and 15.724898 ₳ at 6,465. Both are 13.0 or 13.3 ₳ paid, plus the 0.230260 ₳ fee, plus the change's least: about 1.466 ₳ today and 2.195 ₳ at 6,465.
- **30 classic boxes** give the same picture. 305.0 ₳ builds today. At 6,465, 305.0, 305.3 and 305.6 ₳ are refused in the same words, and 305.9 ₳ builds.

The assertions "6,465: what the form passes before the bounds arrive builds" and "6,465: what the form passes once the bounds are in builds" both **fail on HEAD**. "Today: the form's least builds" passes.

## Where the claim is looser than the code

- **"Nothing changes at today's price": exact.** Today's back is the stand-in's 1.5 ₳, and the form's 15.0 ₳ sits about 0.3 ₳ above what Review needs.
- **The scenario: exact.** At 6,465, a balance between the stand-in's figure and the priced one (P + 5.0 to P + 5.3 ₳) passes the form before the answer and is refused at Review, in words. Once the answer is in, the same balance is told no under the button (`lovejoin.bootstrap.cantAfford`). The stand-in decides only *where* that 0.3 ₳ band hears no.
- **The failure branch is narrower than "(Koios or the data layer down)".**
  - On mainnet, `epochParams()` falls back from the data layer to Koios on any error (data-layer.ts:233-242, 349-350). The data layer down alone doesn't fail the request.
  - It fails when Koios can't answer either, or where Koios is read alone (preprod, or Koios-only on). Review's own first step is that same read (sessions.ts:2022), so it usually fails on the read, not with the not-enough words.
  - The not-enough words come only when the read recovers between the failed ask and the press. Since the effect never asks again, the form keeps the stand-in until the side is toggled or the page reopens.
- **"Briefly optimistic" understates it at 6,465, but that's pr333#0, not this finding.** The form is about 0.725 ₳ optimistic before the answer and about 0.425 ₳ after. The 0.425 ₳ that stays is the fixed 2 ₳ `FEE_ROOM` (Lovejoin.tsx:205-211, "with room for a dearer byte"). It no longer covers the fee (0.23 ₳) plus the change's least (2.19 ₳ at 6,465). The stand-in adds only its 0.3 ₳ on top. pr333's report already carries this as its finding 1 (pr333#0, low). My table agrees with its figures: 305.3 ₳ is refused at 6,465, and that is the balance `lovejoin-release-rules.test.ts:506` asserts as enough.

## Severity

**Nit, as stated.**

- No money moves. Review refuses before anything is signed, in the user's language.
- Nothing is stuck: fewer boxes, or more ADA, goes through.
- Nothing changes at today's price.
- It fits the owner's rule 1: the form never refuses more than core does. Disabling Bootstrap until the bounds arrive would be a new guard, so it is an owner's call at most.

## Fix advice

None for this finding on its own.

If pr333#0's fix is taken (the bounds also return the funding's change least, priced from the same parameters, in `FEE_ROOM`'s place), its stand-in should be today's figure too. That way, before the answer, the form still matches today's price exactly, and this nit stays the only pre-answer gap. Optionally, ask again on the next render after a failure (or on Refresh), so a recovered read replaces the stand-in. That isn't needed: Review decides.

## Tree hygiene

The scratch test is deleted, and my label is on no other file. The other `zz-review-*` files in `extension/tests/` and `seedelf-core/tests/` belong to other agents. No tracked file was edited, and no network write was made: the scratch test used the fakes only.
