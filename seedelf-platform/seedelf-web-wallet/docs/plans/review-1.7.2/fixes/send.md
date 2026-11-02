# send

## patch
/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/fix-send.patch

## files
seedelf-platform/seedelf-web-wallet/extension/src/ui/components/StakedWarning.tsx
seedelf-platform/seedelf-web-wallet/extension/src/background/destination.ts
seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json
seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json
seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json
seedelf-platform/seedelf-web-wallet/docs/i18n/es-provenance.json
seedelf-platform/seedelf-web-wallet/docs/i18n/ja-provenance.json
seedelf-platform/seedelf-web-wallet/docs/i18n/critical-keys.json
seedelf-platform/seedelf-web-wallet/extension/tests/own-account-names.test.ts
seedelf-platform/seedelf-web-wallet/extension/tests/screens-wiring-review-fixes.test.ts

## pr359#0

**Change:** StakedWarning.tsx reads `active` from useAccounts(). On side "send", when `account !== active`, it uses the new keys send.warn.stakedOther / send.warn.stakedOtherNth. Otherwise it uses send.warn.staked / stakedNth as before. Each t() gets a literal key. Make public's branch is unchanged. The header comment now says: a payment from one account to an address with another's stake key ties the two on chain, which 1.7.1's "This is your own Account 2" note said and #359's warning dropped (1.7.2's release review, pr359#0); the account on screen's own stake key ties nothing new, and with one account it's always that one. New keys: en is the lead's text exactly (U+0027 apostrophes, as the siblings use; there is no ₳ in these keys). es and ja start with send.warn.staked's / stakedNth's verified value word for word (es Nth: "La dirección del destinatario {{number}} no es de tu {{whose}}…"). The second sentence follows dappUi.ties.privacy.staked's verified second sentence. es: "Aun así, pagar a esta dirección (Nth: esa dirección) vincula tus dos cuentas entre sí en la cadena, donde cualquiera puede verlo." ja: "それでもこのアドレスに支払うと (Nth: それでも宛先 {{number}} のアドレスに支払うと)、チェーン上であなたの二つのアカウントが結び付き、誰にでも見えるようになります。" Both are recorded as "machine" in es-/ja-provenance.json, right after send.warn.stakedNth. `node scripts/i18n-critical.mjs --write` added both keys to critical-keys.json (470 to 472 keys). Neither key is in verified-critical-*.json.

**Tests:** tests/own-account-names.test.ts > an own account in a warning > "says on Send that another account's stake key ties the two accounts (1.7.2's release review, pr359#0)". It checks the full text: send with account 1, alone and nth 2 ("Account 2 · Savings" + tie sentence), with active 0. Account 0 with three accounts, alone and nth, reads exactly as before. With active 1 (the helper gained an `active = 0` parameter), account 1 has no tie and account 0 has it. Make public's account 1 nth 2 is unchanged. The existing one-account case already pins "This isn't your public account: …" as before. Also tests/screens-wiring-review-fixes.test.ts > "Send's review says which recipient has another account's stake key, and that paying it ties the two accounts": three accounts, active 0, two recipients, the 2nd {own:false, staked:1}. It expects t("send.warn.stakedOtherNth", {whose: "Account 2", number: 2}) on the review.

## pr359#1 / own#3

**Change:** Test only. tests/screens-wiring-review-fixes.test.ts imports CardanoSend beside Withdraw. A new describe block, "someone else's payment key under an account's stake key, on Send's and Make public's forms and reviews, wired (1.7.2's release review: pr359#0, pr359#1, own#3)", runs over the house seam. Destination {own:false, staked:0}, with a one-account AccountsContext unless noted, and a full Balances["cardano"] (no cast).

**Tests:** Five cases: (1) "Send's form warns once the To field reads it": seedInitial of the reads, send-staked shows, no send-own. (2) "Make public's form warns once the To field reads it": withdraw-staked, no withdraw-own. (3) "Send's review warns, and counts the payment and its token as leaving, where the account's own address leaves the fee alone": 5 ₳ + 1 token, 0.2 ₳ fee. send-staked, no send-own, and the "Total leaving your public account" row is "5.2 ₳ and 1 token" (t("format.adaAndTokens")). Then seam.reset() and the {own:true, ownAccount:0} contrast: no send-staked, send-own shows, total "0.2 ₳". (4) the stakedOtherNth case above (pr359#0). (5) "Make public's review warns, its total counting every payment already": withdraw-staked, no withdraw-own, and no total asserted (Withdraw.tsx:161 counts every payment).

## pr359#3 / own#5

**Change:** destination.ts's header comment (lines 4-11) now states #359's rule. A destination is the account's own when it's under one of its payment keys, whatever its staking part: the first 20 of each chain, those the last balance reading found (privacy review §2.17), and up to 500 on each chain when it carries the account's own stake key. One that only carries the stake key is `staked`, not the account's, since anyone can pair their own payment key with it (the 2026-11-02 bounty report). Comment only.

**Tests:** None (comment only). own-address.test.ts and api_test.rs already pin the behaviour; own-address.test.ts passes 6/6.

## evidence

All runs are in the worktree /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr359 (dd22e2b2), from its seedelf-web-wallet/extension.

Baseline before any change: `npx vitest run` on the 15 named files gave 15 files passed, 219/219 tests.

Tests written, before the fix:
- `npx vitest run tests/own-account-names.test.ts tests/screens-wiring-review-fixes.test.ts`: 2 failed, 51 passed (53).
- The own-account-names pr359#0 case failed: Received "This isn't your Account 2 · Savings: … so only they can spend this." with no tie.
- The screens stakedOtherNth case failed. The rendered review showed "Recipient 2 isn't your Account 2: … so only they can spend that payment. Confirms in about a minute." with no tie, which is the defect on screen. (The key didn't exist yet, so t() returned its name.)
- The 4 other screens cases passed. They pin #359's wiring, which is correct, so the mutants below are their proof.

After the fix, the same command: 2 files passed, 53/53.

Revert check: StakedWarning.tsx restored to HEAD, with the tests and the new keys kept.
- The same two tests failed: 2 failed, 51 passed.
- This time the screens case failed on the real reason: Expected the stakedOtherNth text, Received the review with stakedNth's text.
- Fix restored afterwards.

Mutants, each applied to CardanoSend.tsx/Withdraw.tsx, run with `npx vitest run tests/screens-wiring-review-fixes.test.ts -t "someone else's payment key"`, then `git checkout` of those two files:
- mutA.py (all four StakedWarning renders and the imports removed): all 5 cases fail.
- mutForm.py (only the forms' renders removed): the 2 form cases fail, the 3 review cases pass.
- My mutReview.py (only the reviews' renders removed; at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/fix-send/mutReview.py): the 3 review cases fail, the 2 form cases pass.
- mutB.py (the leaving sum skips `p.staked === active`): only the Total leaving case fails, on `expected '0.2 ₳' to be '5.2 ₳ and 1 token'`.

The screens files were clean after each mutant. mutA, mutB and mutForm are the verifiers' scripts in review/work/v-pr359-1/.

Final run of the 15 named files: 1 file failed and 14 passed, 223 passed and 2 failed (225). Per file:
- account-recipients-side 3
- i18n-assembly 17
- i18n-critical-helpers 69
- i18n-review-fixes 3
- i18n 22 passed, 2 failed
- i18n-values-in-place 7
- own-account-names 5
- own-address 6
- privacy-notes 10
- screens-wiring-review-fixes 48
- send 12
- shown-text 2
- spell-check 3
- withdraw 14
- words 2

Extra: `npx vitest related --run src/ui/components/StakedWarning.tsx` gave 16 files, 344/344 passed.

## checks

- `npm run typecheck` (tsc --noEmit -p .): exit 0, no output.
- The guards pass: i18n-critical-helpers, i18n-assembly, i18n-values-in-place, i18n-review-fixes, words, shown-text and privacy-notes, plus every i18n.test.ts check but one.
- The only failure is tests/i18n.test.ts > "which keys are accuracy-critical" > "es.json has no unchecked machine draft among them" and the same for ja.json. It is expected under the brief.
  - In each language it lists exactly the two new keys, "send.warn.stakedOther (machine)" and "send.warn.stakedOtherNth (machine)".
  - They pass once the lead's blind back-translation adds send.warn.stakedOther and send.warn.stakedOtherNth to verified-critical-es.json and verified-critical-ja.json.
- The rest of i18n.test.ts passes, so for the new keys these all hold: the key sets match, the {{token}} sets match (whose, number), no value is empty, there is a negation where English has one, and the checked-in critical-keys.json matches the derived set.
- No formatter was run. No scratch files are left in the worktree (none were ever made there). There were no new files, so no `git add -N` was needed. The patch reverse-applies cleanly to the worktree.

## deviations

- es and ja name the address instead of using a pronoun for "Paying it". es says "pagar a esta dirección" (Nth "esa dirección"); ja says "このアドレスに支払う" (Nth "宛先 {{number}} のアドレスに支払う"). Round one of #359's back-translation found that Make public's "vincularla"/"vincularlo" and ここ/そこ could point at the payee or the payment, and the fix there was to name the address. "pagarla" here would sit next to "otra persona" and "la clave de pago" and break the same way. This follows withdraw.warn.staked/stakedNth's verified wording.
- ja keeps あなたの before 二つのアカウント, where send.privacy.otherAccount drops it. The same sentence mentions 他人 (someone else), so "your" is what says whose, which is when the glossary keeps あなたの. "Together" is carried by 結び付き in ja and by "entre sí" in es.
- In destination.ts's header I dropped the old clause "as the wallet counts and spends the account (account.ts)". It no longer holds of the full list: the 500-key search reaches keys the balance never reads (own#1). The §2.17 cite stays after the found keys, where it was.
- own-account-names.test.ts's `shown` helper gained an `active = 0` parameter. It pins that the active account decides, not account 0 or `several`. The design didn't ask for this; it is the only change to an existing helper.

## outOfScope

- The main checkout (/home/logic/Documents/LogicalMechanism/Seedelf-Wallet) has uncommitted changes to extension/src/background/chain.ts and extension/tests/own-address.test.ts, beside the lead's docs. They aren't mine, perhaps the lead's pr359#4 work. My patch touches neither, and my runs used the worktree's unmodified own-address.test.ts (6/6).
- Transient state while the accounts load: StakedWarning compares with `useAccounts().active`, which is 0 until the accounts are read. Send's own `leaving` sum (CardanoSend.tsx:164-171) relies on the same `active`, so this is the house's existing assumption, not new risk.
- I noticed nothing else outside my scope.

## docSentences

- flows.md:227 (Send, To) now says "…one with your stake key and someone else's payment key counts as leaving, with a warning that only they can spend it (the 2026-11-02 bounty report: Send said that payment came back)." Suggested addition at the end of that sentence: ", and, when the stake key is another of your accounts' than the one paying, that paying it still ties your two accounts together on chain, where anyone can see it (1.7.2's release review, pr359#0)".
- privacy.md:98 ("Paying one of your own accounts from another is allowed, and said…"). Suggested sentence after "The Send form names the account and says so, and the user decides": "So is paying someone else's address that carries another of your accounts' stake keys: on chain it reads as that account's, so Send's warning says the payment still ties your two accounts together (1.7.2's release review, pr359#0)." This also makes privacy.md:92's promise (every screen that could make a link says what it would reveal) true again for this case.

