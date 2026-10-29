# v-pr326-1-trace: pr326#1, the owed Tor check leaves out Koios

**Verdict: partly. Severity: low** (the Koios omission; part (c) on its own would be a nit). Confidence: high on the facts. The text is checked on HEAD `6bca8bec` (#338 touched only item 8's text).

## What holds

### (a) The owed check leaves out Koios, and the text relies on Koios serving Tor users

- `post-release-roadmap.md:346`: "**Still unchecked: whether the data layer and giveme.my answer Tor exits today.** Every route above needs them to."
- Two sentences on HEAD hold only if Koios answers a request that leaves Tor:
  - **:337 (new in #326):** a gateway of ours "would hide users from Koios (when the wallet falls back to it)". A gateway hides users from Koios only if the fallback goes through Tor and Koios answers it.
  - **:347:** "past it the wallet reads Koios, as it does whenever a part is busy, so Tor users get slower, never banned".
    - Past the shared bucket, the private side's fallback has two paths, and either one breaks something the doc says.
    - **Through Tor:** if Koios refuses Tor exits, the read fails. "Never banned" is false.
    - **Direct:** submits name the UTxOs they spend (privacy.md:120), so a direct submit hands Koios the private spend from the user's own IP address. That undoes what the Tor route was for.
- **Today's code does what :347 assumes.** `background/data-layer.ts:16-17`: "A part that fails stays on Koios for 5 minutes (or a 429's Retry-After, if longer)". `:43` defines `DOWN_MS = 5 * 60_000`, and `:123` holds a 429's `retryAfterMs`.
- **The design doc says this is unchecked.** `privacy.md:119`: "Koios has no onion service, and whether it takes Tor exits is unchecked". The archived privacy review says the same (`archive/plans/privacy-review.md:792`).
- **Koios matters beyond the fallback.** This is my addition, not the finding's.
  - Preprod and *Read Cardano through Koios only* read Koios alone (`data-layer.ts:3-5`).
  - Any Tor route for the private side therefore depends wholly on Koios answering Tor exits on preprod, where the live test runs happen, and for Koios-only users.
- **Most of the omission is older than #326.** Before the PR (`5abd5470^1`), the doc's :325 already held the DoS sentence, and :326's spike list already read "whether the data layer and giveme.my answer Tor exits today".
  - #326 promoted that list to "Still unchecked … Every route above needs them to".
  - #326 also added the :337 reliance.
  - So the finding's "two of the PR's own claims" is half right. It changes nothing, since the review is of HEAD.

### (c) "Every route above" is too broad

- **:344, *Split who sees what*:** "The public account's reads go to Koios, and the private side to the data layer and giveme.my". It involves no Tor at all, so it doesn't need anyone to answer Tor exits.
- **:345, Nym's mixFetch:** it leaves through Nym's exits, not Tor's. :345 already lists "Unchecked: Nym's exit rules", so for Nym the problem is only "Tor exits" being imprecise.

## Not as stated

### (b) The PR doesn't contradict the README on giveme.my

- `README.md:162`: "`koios.rest` does not support Tor access. `giveme.my` does support Tor access but is not implemented at the CLI level."
- **Where the sentence comes from:** 8cba7a2f, 2025-04-30 00:25. 4a868c17 rephrased it the same day. Chunk 22's 83880dd6 (2026-10-04) carried it over untouched.
- **The roadmap asks a different question:** whether giveme.my answers Tor exits *today*. A check of an 18-month-old statement doesn't contradict it, and "support Tor access" may not mean answering exits.
  - "not implemented at the CLI level" reads more like an access mode the CLI would have to use, such as an onion address.
  - The code calls only `https://www.giveme.my/{network}/collateral/` (`networks.ts:52,65`; `seedelf-koios/src/koios.rs:81`).
- **The scenario's only harm is a redundant check:** "a few read-only requests". That is no defect. Citing the README would be a nicety.

### The README doesn't establish that Koios refuses Tor exits

- The scenario's "a Koios that, per the README, refuses Tor" reads "does not support Tor access" as a refusal of exits.
- The design docs read the same sentence as "no onion service" and kept exits as an open question (privacy-review §5.1, privacy.md:119).
- **So the fix's "noting … Koios no, giveme.my yes" would itself mislead.** It would record an ambiguous 2025 statement as the answer to the check that is owed.

## Repro

`extension/tests/zz-review-v-pr326-1-trace-1.test.ts` read `docs/post-release-roadmap.md`, `docs/privacy.md` and the root `README.md` from the tree, and cut out the Tor entry under *Kept in mind*.

**Result on HEAD: 4 passed, 2 failed, as expected if (a) and (c) are real.**

- **Facts (pass):**
  - the owed line names the data layer and giveme.my only;
  - :337 and :347 contain the Koios-reliant sentences;
  - privacy.md has "whether it takes Tor exits is unchecked";
  - the README has both Tor sentences.
- **Claims (fail):**
  - `expect(line("**Still unchecked:")).toMatch(/Koios/)` fails. Received "…whether the data layer and giveme.my answer Tor exits today.** Every route above needs them to.…"
  - The split, a route above the owed line, `toMatch(/Tor/)` fails. Received "**Split who sees what.** The public account's reads go to Koios, and the private side to the data layer and giveme.my…"

The file was deleted after the run. No tracked file was touched.

## Fix advice

- **:346:** "**Still unchecked: whether the data layer, giveme.my and Koios answer Tor exits today.**"
- **Say why Koios is there:** the wallet reads Koios alone on preprod and with Koios-only on, and :337 and :347's fallback reads it.
- **Point to the README's 2025 lines as prior statements, not results.** Its "does not support Tor access" is read in privacy.md as no onion service.
- **Narrow "Every route above needs them to"** to "Every Tor route above needs them to (Nym's, its own exits instead); the split needs none."
- **Leave the README and privacy.md alone.** They agree under the "no onion service" reading. Whether giveme.my still supports Tor is what the owed check settles.
