# v-x-docs-2-impact: x-docs#2, impact and fix

**Finding:** the store's host-permission text doesn't cover #336's new mainnet Koios requests.

**Verdict: confirmed. Severity: low** (unchanged). Confidence: high.

## Is it real on the shipped build?

Yes. On the store build (mainnet), whenever the data layer's private part answers and Koios-only is off, every pool read reaches `confirmed()`. For each listed pool new to the device, it asks api.koios.rest for `tx_info`, and for `account_update_history` too where the launch didn't register L.

- `src/background/lovejoin-pools.ts:454`: `await this.keep(network, await this.confirmed(network, found));`, in `refresh()`, after the data layer's `index.pools()` answered.
- `:570`: `const koios = this.deps.koios(network).koiosAlone();`, then `launched()` (`koios.launches`, `koios.firstRegistrations`).
- `koios.ts:926`/`:954` post `tx_info` and `account_update_history`. `data-layer.ts:287-295` overrides both to `super` ("Pool discovery's, on Koios alone"), so they reach Koios whichever client calls them.
- `private-index.ts:368`: the index exists only with a data origin (mainnet), Koios-only off and the private part up. So this is mainnet-only, while the server answers: the case the store text says Koios isn't used for.
- `lovejoin-pools.ts:592-600`: `serviceDeps().pools` calls `discovery.refresh` at every Lovejoin pool read.

**How often:** the bundled head start is merged into `known` (`kept()`, `:349`), and mainnet's head start has 0 pools (`src/lovejoin-pools.json`; roadmap: "mainnet's is still empty"). So any mainnet token pool that the data layer lists and that is missing from the device's store and from the release's head start triggers it once per device. If Koios can't confirm a pool yet, the device asks again at each list. That is rare traffic, but real for every mainnet Lovejoin user once a pool launches.

**Is "two" complete?** Yes. Every public `Koios` method is overridden in `DataLayerKoios`; a script over both classes found none left on Koios. So while the data layer answers, the only Koios-alone reads are:
1. lovejoin.ts:5702 `inputsOf`: what made the wallet's boxes in a copy. This is the existing "one Lovejoin read".
2. #336's confirm.

The holder scan (`:485`) runs only when the data layer didn't answer (`look()`).

**The store text on HEAD:**
- `docs/store/README.md:261` limits the launch and registration reads to "while its own server hasn't listed them".
- `:269` (996 characters) says "and for one Lovejoin read its server doesn't cover".
- `git diff --stat babb8e76 6bca8bec -- docs/store/` shows only `privacy-policy.md` changed. #336 updated the policy (`:46`, `:93`) and privacy.md, not the listing.

**The scenario, slightly corrected.** development.md step 11 has the owner copy store text only "if the listing's text or images changed". Unfixed, nothing is re-pasted, and the dashboard keeps 1.6.0's text, which is identical to HEAD's. The outcome is the one the finding gives: 1.7.0 ships with a Koios justification that undercounts the reads made while the server answers.

## Severity: low

- **Audience:** the permission justification goes to Google's reviewers; the public listing doesn't show it. The user-facing privacy policy is correct and complete: its `:46` paragraph and the dated `:93` Changes entry, as rule 3 requires.
- **No store risk:** the Koios host permission is justified by its fallback role whatever the count. The confirm reads pool data the same for every wallet. Nothing in the Data usage declarations changes: IP address under Location already names Koios as a third party that sees it.
- **Still a false statement in a declaration**, not style: "one", and a limit ("hasn't listed them") that no longer holds. So it's "a misleading doc" by the brief's scale: low, not nit. It isn't medium, because no user is misled about money or privacy.

## The fix: right, with corrections

**1. `:269`: "and for two Lovejoin reads its server doesn't cover".**
- It's correct: 997 characters, all ASCII, so it fits under the box's ~1,000 however the box counts.
- It is minimal and within the rules.
- Optional, more literal: the server could answer the confirm but by design isn't asked. "and for two Lovejoin reads never asked of its server" is 998 characters.

**2. `:261`: put the addition in the row's second sentence, not its first.**
- The first sentence is framed "whenever its own server can't answer". Inserting "as its own server lists a pool…" into its list contradicts that frame.
- The sentence "Even while its own server answers, …" exists for this class. Suggested: "Even while its own server answers, Koios is asked to confirm each pool that server lists which is new to the device (the transaction that started it and its script's registration), and what made the user's boxes in a later pool of the same box value as one shown, which that server doesn't cover."
- The first sentence's "while its own server hasn't listed them" then stays true, since it describes the holder look.

**3. Missing from the proposed fix: `:266`'s two counts.**
- "This text, at 996 characters" becomes 997, or 998 with the alternative wording.
- "The rows above come to 2,636 characters together" is the exact sum of the five host rows' justifications, so it changes with any `:261` edit: 2,771 with the suggested sentence.

**4. Leave the optional summaries alone:**
- the listing description `:75`;
- the policy's service list `:40` ("on mainnet whatever ours can't answer");
- the test instructions `:334` ("api.koios.rest on mainnet when that server can't answer").

They already simplify away the copies' read, and the policy's `:46`/`:93` carry the detail, so no privacy note is lost. `:75` also has Spanish and Japanese copies, so an edit there means re-doing both listing descriptions, at a cost the gain doesn't justify. The Privacy tab's text has no es/ja copies, so fixes 1 to 3 are English-only.

**5. What else the fix touches:**
- No test reads `docs/store/README.md`: `words.test.ts` walks `src/` only, and nothing in `tests/` or `scripts/` opens it. Nothing breaks.
- It's docs-only: no behaviour, no new guard, no new Changes entry needed, since #336's dated entry covers the data change. Nothing in it dates a release or states the store's status.
- It reaches Google only if the owner re-pastes the Privacy tab's host-permission box at 1.7.0's upload (step 11 copies only what changed). The release PR's description, or the handoff note, should say that box changed.

## Repro

Read-only. Checked:
- the `473b7f1a^1..473b7f1a` diff, and `gh pr view 336`;
- HEAD's `lovejoin-pools.ts` (`refresh`, `kept`, `confirmed`, `serviceDeps`), `data-layer.ts` (overrides), `koios.ts` (`launches`, `firstRegistrations`), `private-index.ts:362-372`, `sw.ts:183/236`, `lovejoin.ts:5690-5712`;
- character counts by Python over `docs/store/README.md`: line 269 is 996, the fix 997, the alternative 998; the host rows are exactly 2,636, and 2,771 after the suggested `:261` sentence;
- the bundled head start's contents.

No scratch tests were written, so there was nothing to delete.
