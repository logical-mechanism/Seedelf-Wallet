# window

## patch
/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/fix-window.patch

## files
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/docs/i18n/critical-keys.json
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/docs/i18n/es-provenance.json
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/docs/i18n/ja-provenance.json
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/tests/dapp-prompt.test.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/tests/dapp.test.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic/seedelf-platform/seedelf-web-wallet/extension/tests/dapp-ties.test.ts

## critic#0

**Change:** New critical key dappUi.proposal.warn.session.
- en, exactly as given: "Proposes {{what}}. Its {{amount}} ₳ deposit goes to the stake key of {{name}} when the action ends, and the wallet never brings it back."
- es: "Propone {{what}}. El depósito de {{amount}} ₳ de la propuesta va a la clave de stake de {{name}} cuando termine la acción de gobernanza, y la billetera nunca lo trae de vuelta."
- ja: "{{what}}を提案します。その {{amount}} ₳ のデポジットは、ガバナンスアクションが終わると{{name}}のステーク鍵へ渡り、ウォレットが取り戻すことはありません。"
- The es and ja frames are character for character those of the verified .own/.wallet (checked by common prefix). "goes to" is .notYours's va a / へ渡ります. "Bring back" is the house's traer de vuelta / 取り戻す. "The wallet never X" follows ja's 〜ことはありません (drep.privacy.profile, collateral.warn.reclaiming).
- The key sits after .notYours in all three locales and in both provenance files, recorded as "machine". critical-keys.json was regenerated with `node scripts/i18n-critical.mjs --write` (470 to 471 keys).

ui/dapp.ts: the signature is now proposalLine(p, whose, session, named?).
- p.own && session gives the new key, with name = t("dappUi.ties.privacy.thisSession").
- typeof p.yours === "number" gives the new key, with name = tiedName(p.yours, named).
- Every other branch is unchanged.
- The doc comment now says why: the wallet never reads or withdraws a session's rewards, and its return and Disconnect read UTxOs only, as the worker says where it refuses a session's own registration (cites 1.7.2's release review, critic#0).

DappApprovals.tsx:
- passes session to proposalLine;
- the staking callout's tone is now `... || s.proposals.some((p) => !p.own || session)`, wrapped to stay near 120 columns;
- the JSX comment above it says why.

No new refusal.

**Tests:** - tests/dapp-prompt.test.ts, new: "warns that a proposal's deposit to a private session's stake key never comes back (1.7.2's release review, critic#0)". With session: true and own: true, the callout is callout--warn, reads the new sentence with "this private session", and has no "deposit comes back". With session: false it stays callout--info and reads "comes back to your public account". A public prompt with yours: 1 is warn-toned and reads the new sentence with "your private session 2". The render helper got an optional props argument for this.
- tests/dapp.test.ts, the existing "says whose stake key a proposal's deposit goes back to ... (chunk 39)", now passes session. The treasury own case in a session reads the new sentence. yours: 1 (public) and yours: 0 (in a session) read it too. Added: { account: 0 } from a session still "comes back to the stake key of your public account"; a stranger's from a session is unchanged.
- tests/dapp-ties.test.ts, only the existing chunk 39 case "names a private session a proposal's deposit goes back to ...": its line now expects "...goes to the stake key of your private session 1 when the action ends, and the wallet never brings it back."

## critic#1

**Change:** Comments only, in the three places named:
- certifiedLine's doc (ui/dapp.ts ~80);
- SignTx's `certified` prop doc (DappApprovals.tsx ~974);
- the privacy callout's JSX comment (DappApprovals.tsx ~1222).

Each now says `certified` holds the stake keys a certificate, a withdrawal or a proposal names: a proposal's by the reward address its deposit goes back to, or one a treasury withdrawal pays. That second part is the other fixer's worker change, per the lead's design.

**Tests:** None, as the finding says: comments only. Typecheck and every test listed below still pass.

## i18n#0

**Change:** Test only: an exact-value pin of the dapp-unknown callout, as the trace's fix note asks.
- dapp-prompt.test.ts imports i18n from ../src/i18n/core and gets a file-level afterEach that sets the language back to en.
- It renders SignTx with summary({ signs: ["stake"], ownInputs: 0, unknownInputs: new Array(n).fill(cd…#0), complete: false }) and partial: true.
- It takes the callout body with the fix note's regex, &#x27; read back as '.

**Tests:** tests/dapp-prompt.test.ts, new: "says what it can't show of inputs it couldn't find, and that only the stake key signs, word for word (1.7.2's release review, i18n#0)". It asserts:
- no dapp-unknown callout with unknownInputs [];
- toBe the exact value for en n=1 and n=2;
- es n=1, n=2 and 1_000_000 (Spanish's many, printed 1000000);
- ja n=2.
It fails on both of the verifier's mutants, and on each language's part alone (see evidence).

## i18n#1 / pr358#4

**Change:** en dappUi.warn.unknownInputs_one is now "It spends {{count}} UTxO the wallet couldn't find, so what it holds can't be shown. Only your stake key signs here." (ASCII apostrophes, as before). es and ja are unchanged, and need no new back-translation: es _one already says "lo que contiene", and ja has only _other.

**Tests:** The i18n#0 test's en n=1 assertion pins it. It is that test's only assertion that fails before the fix and on the revert.

## evidence

All runs were in the worktree's extension/ folder.

1. **Tests first, unfixed code.**
   - Command: `npx vitest run tests/dapp-prompt.test.ts tests/dapp.test.ts tests/dapp-ties.test.ts`
   - Result: Test Files 3 failed (3); Tests 4 failed | 84 passed (88).
   - critic#0 (dapp-prompt): got `callout--info` with "...comes back to your private session when the action ends."
   - i18n#0 (dapp-prompt): en n=1 got "...so what they hold can't be shown..."
   - dapp-ties chunk 39 case: got "...comes back to the stake key of your private session 1 when the action ends."
   - dapp.test.ts proposal case: treasury own in a session got "...comes back to your private session when the action ends."

2. **After the fix.** Same command: 3 passed (3); 88 passed (88).

3. **Revert check.**
   - I saved the fix's diff, src/ plus docs/i18n (not the tests), to /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/window-fix-src.patch and ran `git apply -R` on it.
   - Same command: 3 failed (3); 4 failed | 84 passed (88), the same four tests.
   - `git apply` put it back, and `cmp` with a fresh diff showed it identical. The only later change was one doc-comment line in proposalLine; the full runs below came after it.

4. **The i18n#0 pin against the mutants.**
   - Before each mutant I copied en/es/ja.json to review/work/window-locales-backup/, and restored them after, with cmp clean.
   - Mutant A: `node .../review/work/i18n0-mutant.mjs <worktree> <worktree>` replaced en 2, es 3 and ja 1 lines. `npx vitest run tests/dapp-prompt.test.ts -t "i18n#0"` gave 1 failed | 20 skipped. It got "...Only your stake key signs here, and it spends none of them." at en n=1.
   - Mutant B: `node .../review/work/i18n0-mutant-b.mjs <worktree>/.../src/i18n/translations` swapped en 1 and es 3. Result: 1 failed. It got "..., and it spends none of them." at en n=2.
   - A test stops at its first failed assertion, so I also ran each language's part alone, with my scratch /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/window-lang-mutants.mjs. Each gave 1 failed:
     - es's old order alone ("Aquí solo firma tu clave de stake.") fails at es n=1;
     - es _many's 1.7.1 value alone fails at es n=1000000;
     - ja _other's 1.7.1 value alone fails at ja n=2.

5. **Grammar render.** A scratch test, tests/zz-r172-fix-window-render.test.ts (deleted; no zz- file is left), printed the new key with both {{name}} values:
   - en: "...goes to the stake key of this private session when the action ends, and the wallet never brings it back." and "...of your private session 2 when...".
   - es: "...va a la clave de stake de esta sesión privada cuando termine la acción de gobernanza, y la billetera nunca lo trae de vuelta." and "...de tu sesión privada 2 cuando...". The "lo" agrees with el depósito.
   - ja: "...ガバナンスアクションが終わるとこのプライベートセッションのステーク鍵へ渡り、ウォレットが取り戻すことはありません。" and "...終わるとあなたのプライベートセッション 2のステーク鍵へ渡り、...". This is the same shape as the verified .wallet.

6. **Patch.** `git diff --binary` to fix-window.patch: 11 files, 347 lines. `git apply --cached --check` passes against the clean dd22e2b2 index. There are no new files, so no `add -N` was needed.

## checks

**Typecheck:** `npm run typecheck` (tsc --noEmit -p .) exits 0. I ran it twice; the second run came after the last edit.

**The prompt's list:** `npx vitest run` on dapp-prompt, dapp, dapp-ties, dapp-ties-accounts, approvals-review-fixes (present), i18n, i18n-critical-helpers, i18n-assembly, i18n-values-in-place, i18n-review-fixes, words and shown-text.
- Result: Test Files 1 failed | 11 passed (12); Tests 2 failed | 249 passed (251).
- Both failures are the expected ones in tests/i18n.test.ts: "which keys are accuracy-critical > es.json has no unchecked machine draft among them", and the same for ja.json.
- Each lists exactly ["dappUi.proposal.warn.session (machine)"]. Per the brief, the new key isn't in verified-critical-{es,ja}.json, and waits for the lead's blind back-translation.
- No other key is listed. The en change to unknownInputs_one touches no es or ja value.

**A wider run, after the final edit:** every tests/dapp-*.test.ts, dapp.test.ts, every tests/i18n-*.test.ts, i18n.test.ts, live-runs-copy, own-account-names, store-images-copy, swap-page-words, tx-view-screen, worker-language, worker-words, words, shown-text and approvals-review-fixes.
- Result: 1 failed | 37 passed (38) files; 2 failed | 485 passed (487) tests. The two failures are the same two.

**The other guards pass with the new key:**
- es and ja keep the negation (nunca, ません);
- the {{tokens}} match;
- the provenance is recorded;
- i18n-critical-helpers reaches no unnamed key.

**critical-keys.json:** `node scripts/i18n-critical.mjs --write` gives 471 keys, with dappUi.proposal.warn.session added.

## deviations

- **One key, not two.** The critic's fix note suggested two keys (sessionOwn and sessionKey). I followed the lead's design: one key, dappUi.proposal.warn.session, filled through {{name}}.
- **The i18n#0 pin before the fix.** It fails then only through its en n=1 assertion, which is the i18n#1 wording fix. Its other assertions pin the wording #358 already shipped, so they pass before and after by design. What they're worth is shown by the mutants: A, B and each language's part alone.
- **Extra cases in dapp.test.ts.** Besides the lead's minimum, I added:
  - another session's key from a session (yours: 0, session true): the new sentence;
  - the public account's key from a session (yours { account: 0 }): still "comes back to the stake key of your public account";
  - a stranger's from a session: unchanged.
  These pin the new branch order.
- **The render helper.** In dapp-prompt.test.ts I gave the shared `render` helper an optional third props argument instead of writing a second helper.
- **Tone line wrapped.** The tone expression is wrapped onto three lines (? "warn" : "info"), since the longer condition would pass the house's ~120 columns.
- **Comment wording (critic#1).** The lead's "its deposit's, or a treasury withdrawal's recipient's" is written as "a proposal's by the reward address its deposit goes back to, or one a treasury withdrawal pays". The meaning is the same.
- **No それを in the ja.** The ja leaves out the object of 取り戻す: the topic デポジットは carries it. それを there could read as the stake key just before it.

## outOfScope

- **rpc.ts:1510**, DappAsk.certified's doc, still says "a certificate or a withdrawal". It's critic#1's fourth place, and wasn't in my list (presumably the worker fixer's). The same holds for the header comment of tests/dapp-ties.test.ts (lines 10-14): "So does a certificate or a withdrawal that names one of their stake keys". I left it alone, since I was told to touch only the one case in that file.
- **The comments I updated run ahead of the worker change.** They say `certified` holds the reward addresses a treasury withdrawal pays. That is true only once the other fixer's worker change is in, not at dd22e2b2 alone.
- **For the back-translation round:**
  - es: "lo" is el depósito (masculine), while la clave and la sesión are feminine.
  - ja: 取り戻す is the house's word for bringing a session's money back.
- **A pre-existing ja spacing nit.** "{{name}}のステーク鍵", with a session's number in {{name}}, renders "あなたのプライベートセッション 2のステーク鍵" with no space after the digit. Elsewhere the house writes "プライベートセッション {{number}} への". The same is in the verified .wallet and the ties lines ("{{list}}のステーク鍵"); the new key reuses it word for word, as I was told.
- **Left as the trace says:**
  - Extending dapp.sessionStakeKey's refusal to such proposals stays the owner's call: not done, and no new refusal was added.
  - Transaction details' "Yours, in private session N" tag is untouched.
- **i18n#2** (.notYours calls a script's reward account "a stake key") is untouched: not in my scope.

## docSentences

- **flows.md:430**, the sign window's proposal clause ("the account's, another of the wallet's by name, or \"a stake key that isn't yours\" with the whole address, a warning; ..."). Add: "a private session's, this one's or another's, as going there for good, \"...goes to the stake key of this private session when the action ends, and the wallet never brings it back\", a warning too, since the wallet never reads or withdraws a session's rewards (1.7.2's release review, critic#0)".
- **privacy.md:106 (L2)**, after "...the session's return and Disconnect read its UTxOs only (L2).". Add: "So does a governance proposal's deposit that a site sends back to a session's stake key, from that session or from another account: the sign window says, as a warning, that it goes to that key when the action ends and that the wallet never brings it back (1.7.2's release review, critic#0)."
- **backlog.md:87**, possibly widened to: "⬜ **A session's stake key keeps a deposit a site sends to it** (X05, L2; 1.7.2's release review, critic#0): a registration's, which nothing in the wallet deregisters, or a proposal's, which the wallet never reads or withdraws; the sign window warns of the proposal's."
- **No doc needed for i18n#1:** no doc quotes the callout's wording.

