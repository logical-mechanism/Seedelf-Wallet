# v-x-priv-0-impact: the summaries still call Koios mainnet's fallback only

**Verdict: confirmed. Severity: low** (as filed). Confidence: high.

- **The defect is real, and the shipped build reaches it.** On mainnet's default path (data layer up, Koios-only off), a pool read asks Koios to confirm a listed pool the device hasn't seen. The policy's *In short* (`:5`), its Koios bullet (`:40`) and the store texts still say Koios is asked on mainnet only for what our server can't answer.
- **It's low, not x-rel's medium.** The same policy discloses the confirm in full. The *In short* already names Koios as a mainnet recipient of the user's IP. The confirm sends less than the fallback the summary already discloses, and no setting a reader could pick would avoid it.
- **The fix is right in direction, with five corrections:**
  - the dashboard box's wording;
  - a UI line the finding missed: Settings' critical key `settings.koiosOnly.privacy.off`, "Koios only when it can't";
  - the release check at `development.md:162`;
  - the character counts at `store/README.md:266`;
  - drop the proposed test.

## Duplicates

- This is the same defect as pr336#6 (F7, the policy only), x-rel F2 (filed medium) and x-docs#3 (the store's host text only).
- `v-pr336-6-impact` and `v-pr336-6-trace` already confirmed it, at low.
- One edit pass fixes all four.

## Reachable with the shipped build?

Yes, on mainnet's default path. Every link was checked on HEAD (`6bca8bec`):

- **The store build reads our server on mainnet.**
  - `networks.ts:77`: mainnet's `data` is `https://mainnet.seedelf.logicalmechanism.io`.
  - `vite.config.ts:100` refuses a store build that overrides it.
  - `privateIndexClient` returns an index while Koios-only is off and the private part is up (`private-index.ts:368`).
- **A pool read our server answers goes on to Koios.**
  - `refresh()` reads `lovejoin/pools`, then runs `await this.keep(network, await this.confirmed(network, found))` (`lovejoin-pools.ts:454`).
  - `confirmed()` takes the listed pools the device doesn't hold (`:566-569`) and asks `this.deps.koios(network).koiosAlone()` (`:570`).
  - On mainnet that's `DataLayerKoios.alone`, a plain Koios at `api.koios.rest` (`data-layer.ts:214`, `:223-225`). `launches` and `firstRegistrations` are pinned to Koios (`:287-295`).
- **It's a choice, not a fallback.**
  - The method's comment says so: "Koios rather than the data layer, which listed it: the check is one no single operator answers" (`lovejoin-pools.ts:562-563`).
  - #336 changed the tree's own test from "Koios wasn't asked anything" to `["tx_info"]` (`lovejoin-discovery.test.ts`, "is verified here, kept, …").
- **Preprod is unaffected.** It has no data origin, so `refresh()` returns at `:420`, and the *In short* already says "on preprod for everything".
- **Who meets it.** Any mainnet device that reads pools non-quietly once a token pool our server lists is new to it:
  - the Lovejoin page;
  - a mix;
  - a private session's return, which goes through Lovejoin by default;
  - the due-box alarm.
- **When.** `src/lovejoin-pools.json` holds no mainnet pool (height 14110720). The release refresh bundles any pool that exists at packaging, so the confirm fires for pools launched after 1.7.0's head start.
  - Starting a pool is offered to every user, for about 23 ₳, so this is an expected event, not a contrived one.
  - From then on, each Lovejoin device asks Koios once per new pool, and again at every list while Koios can't confirm it.
  - A device that has used Remove wallet asks about every listed pool the head start doesn't hold.

## Severity: low

- **Disclosed in the same document, three times:**
  - the pools paragraph (`:46`): "it confirms with **Koios** first";
  - the 28 October entry (`:93`);
  - the *Effective* line's list: "a new Lovejoin pool confirmed with Koios".
  - So it isn't "a leak against what the privacy policy says". It's a summary that leaves out a case its own detail states.
- **The *In short* already names Koios as a mainnet party.** It says "on mainnet for anything our server can't answer". A reader already knows Koios can see their IP on mainnet. The confirm changes when that happens, not who sees it.
- **It sends less than the disclosed fallback.**
  - The request carries public launch hashes only (and, rarely, L's stake address), the same for every device new to that pool. My scratch test checked the body: `_tx_hashes` held the launch alone.
  - Koios learns the IP and that it reads Lovejoin's pools. The fallback, by contrast, sends the public account and every read.
  - The one exception is a pool this device launched (x-priv#2), a separate finding.
- **No decision the summaries support is distorted.** Koios-only on sends strictly more to Koios than off, and no switch turns the confirm off. A reader who knew couldn't choose differently in the wallet, short of not using Lovejoin.
- **x-rel's scenario overreads the summary.** A user "keeps Koios-only off so that Koios never sees them on mainnet". The *In short* never promised that.
- **There's precedent.** 1.6.0's copies case (`:44`: Koios is asked what made the user's boxes in a later pool "even while ours answers") tells Koios more, which boxes are yours. It was already missing from `:5` and `:40`, which read word for word as now at `babb8e76`, and it passed 1.6.0's review.
- **Store review risk is negligible.**
  - The host is declared already, so the update adds no permission.
  - An incomplete list doesn't make the permission unjustified.
  - Google's user-data rules want the policy to disclose the sharing, which `:46` and `:93` do.

Fix it before the upload anyway: it's cheap, and it's the line most readers stop at.

## The fix, place by place

| Place | Verdict | Proposed text (for the owner to adjust) |
|---|---|---|
| Policy `:5`, *In short* | **Needed** | "…on preprod for everything, and on mainnet for anything our server can't answer and to confirm a new Lovejoin pool it lists, or for everything if you turn our server off in Settings." Naming the 1.6.0 copies case here as well is the owner's call. |
| Policy `:40`, the Koios bullet | **Needed** | "…everything on preprod, and on mainnet whatever ours can't answer and the check of a new Lovejoin pool ours lists, or everything with that switch on." |
| Policy `:7` | **Leave it**, as the finding does | It defines *the Cardano server*. `:46` names Koios for the confirm, not the Cardano server. |
| README `:261`, the Koios host row | **Needed** | Drop ", while its own server hasn't listed them": the row's lead already conditions the list. Extend the next sentence: "…which that server doesn't cover, and, for a pool that server lists that the device hasn't seen, the transaction that started it and, where that didn't register its script, the registration, to confirm the pool." That makes the row 1,276 characters, up from 1,138. |
| README `:266` | **Needed, not in the finding** | Its counts move with the text: "2,636" becomes 2,774 with the row above, and "996" becomes 994 with the box below. Recount if the wording changes. |
| README `:269`, the box pasted to the dashboard | **Needed, wording corrected** | "; and for one Lovejoin read its server doesn't cover." becomes "; and for two Lovejoin reads even while it answers." That's **994** characters, so nothing else needs trimming. The finding's "two Lovejoin reads" (997, "its server doesn't cover") also fits, but it misdescribes the confirm: our server lists the pool, and the wallet sends the check to Koios on purpose. |
| README `:75`, `:163`, `:227`, the description | **Recommended; the owner's call** | en: "…and on mainnet for anything ours can't answer and to confirm a new Lovejoin pool ours lists, or for everything…". `:114` requires es and ja in the same PR and a blind back-translation of what changed. 1.6.0 left the copies case out of this summary. |
| README `:334`, the test instructions | Low, optional | "Koios (api.koios.rest on mainnet when that server can't answer and to confirm a new Lovejoin pool it lists, preprod.koios.rest on preprod)". The reviewer is sent to preprod, where nothing differs. |
| README `:274` | Nit | It's the owner's note, not pasted anywhere: "Koios is the fallback, and confirms a new Lovejoin pool that server lists, which is why the Koios host stays." |
| README `:289`, *Financial and payment information* | **Stays**, with one caveat | "Sends nothing of the user's" holds except for a pool this device launched (x-priv#2). The confirm then names the user's own launch transaction to Koios while ours answers. If the owner takes x-priv#2's skip, `:289` stays exactly right. If they disclose instead, it may need the same caveat. |

**No new *Changes* entry, and the *Effective* line stays.** The 28 October entry already covers the data-handling change, which hasn't shipped. This is wording inside that change (x-priv#7 is the date question).

## Not in the finding

1. **Settings' own line, a critical key.** `en.json:2036`, `settings.koiosOnly.privacy.off`, says: "Seedelf Wallet's own server answers first, and Koios only when it can't."
   - It appears under the Koios-only switch on mainnet alone (`Settings.tsx:1124`), exactly where the confirm happens.
   - The es and ja say the same: "solo cuando este no puede"; "応答できないときだけ".
   - This is the wallet's own UI making the claim. No review report names it.
   - **Minimal fix:** drop "only" (es "solo", ja "だけ"). It still fits on one line (rule 4), and the second sentence ("tells neither of them which Seedelfs are yours") stays true.
   - **Or** name the confirm, which makes the line longer.
   - Either way, the changed es and ja values need a blind back-translation (rule 6). `i18n.test.ts:197-208` checks keys, not values, so it won't catch a skipped one.
   - Keep the opening words: `e2e/data-layer.spec.ts:71` expects "Seedelf Wallet's own server answers first".
2. **`development.md:162`, release check 9.** It says "`api.koios.rest` only for a part the data layer couldn't answer".
   - The check runs in a fresh profile. If a pool is launched between the head-start refresh and the check, a correct build shows `api.koios.rest/tx_info`.
   - Add: "or a `tx_info` (at times an `account_update_history`) confirming a Lovejoin pool the data layer lists that the head start doesn't hold".
3. **`privacy.md:22`** (the design doc's IP line) uses the same summary wording. Optional. Its `:200` already describes the confirm.

## What the fix changes or breaks

- It's text only: no guard (rule 1), nothing new sent, nothing dropped (rule 3), no date (rule 7).
- No test or script reads `privacy-policy.md` or `store/README.md` (grep of `tests/` and `scripts/`).
- The policy and the listing point at `main`, so the fix goes live when it merges.
- If the Settings key changes, follow the e2e and back-translation notes in item 1.

## The proposed test: skip it

- `tests/privacy-notes.test.ts` renders screens and reads their text. No test reads the privacy policy or the store README.
- A test that looks for a phrase in the policy would pin wording, not behaviour, and break at the owner's next rewording.
- It also wouldn't catch the next case of this kind. "The summary names every Koios ask made while ours answers" can't be checked mechanically.
- **If the owner wants a check anyway,** the one that pays is the dashboard box: at most 1,000 characters, with `:266`'s counts matching. That text has a hard limit and is edited every release.

## Repro

`extension/tests/zz-review-v-x-priv-0-impact-1.test.ts`, run alone: 2 of 2 pass. Deleted.

1. **Mainnet routing.** With the store's own origin (`dataOrigin`):
   - `chainClient(...)("mainnet").koiosAlone().launches([launch])` requested `api.koios.rest tx_info`.
   - `privateIndexClient` returned an index on mainnet, none on preprod, and none with Koios-only on.
2. **The pool read, wired as `sw.ts` wires it.** `chainClient` and `privateIndexClient` shared one recording fetch, with the data origin forced for preprod (mainnet's head start holds no pool, and the preprod fixture is the one that verifies).
   - `refresh()` requested `data.test pools`, then `preprod.koios.rest tx_info`. The body's `_tx_hashes` was `[launch]` alone, and the pool was kept.
   - Five minutes later, the next list asked Koios nothing.

Also checked:
- Character counts with Python, against the file on HEAD: box 996; host rows 2,636, which matches `:266`.
- `git show babb8e76:…/privacy-policy.md`: `:5` and `:40` unchanged since 1.6.0, and `:44`'s copies case already there.
- The store README is unchanged in the range.

No tracked file was edited, and nothing was sent to a network.
