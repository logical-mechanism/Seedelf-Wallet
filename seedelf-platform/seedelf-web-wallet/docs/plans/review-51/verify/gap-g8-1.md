# gap-g8#1: verification

From lane gap-G8, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. Create Seedelf's form (label.ts:10) and the WebAssembly check (check_label, lib.rs:2098) both refuse any tag character outside " " to "~". check_label runs in both mint paths (stealth :2402, account :2800). Yet the deployed policy and core both take such a tag:
- Core writes any tag's UTF-8 bytes, cut at 15, into both the token name and the redeemer.
- The deployed policy at 5b82530 takes any ByteArray and keeps its first 15 bytes.
- The project's kernel-checked policy_accepts_iff puts no condition on the tag's bytes.
- A mutant run in a copy removed only check_label's character rule. The wallet's own stealth mint then built for "José" and "さくら", and the deployed variant-1 policy and wallet contract both ran on it and accepted it. A negative control (a redeemer naming another tag) was refused by the policy, so that measuring is real.

**Severity: low.**
- Who: the user, by an ordinary action, e.g. an es or ja user typing their name.
- Cost: no money. The user just can't have that tag.
- Way out: an ASCII tag, or none, since the tag is optional. The refusal is stated plainly on the form.

**Not known.** Nothing in the backlog, any Not fixed / Left open / Disputed / For the owner list, SECURITY.md, or the owner's listed rules. One correction to the finder's owner_why, which says "Chunk 8 chose": the rule was decided with the owner. docs/archive/roadmap-v1.md:502-503 (2026-09-24) records "Decided with the user: The tag is optional, printable ASCII, at most 15 characters". The plan it came from says "On chain it's any bytes, cut to 15". So this is an owner call to revisit under the later 2026-10-19 rule, not an oversight. needs_owner stands.

**Two small slips in the finder's evidence.** Neither changes the finding.
- chain.ts seedelfLabel shows the leading printable-ASCII run, so "José" reads back as "Jos". It shows none only when the first byte is outside ASCII, as with さくら.
- wasm/tests/mint.test.mjs:56 pins only the 15-character limit. The character rule's native pin is wasm/tests/api_test.rs:1068-1069.

**Evidence:**

I opened every file myself, in TREE. `git diff --stat web-wallet/1.9.1 HEAD` over label.ts, wasm/src/lib.rs, CreateSeedelf.tsx, background/mint.ts, core transaction.rs and data_structures.rs is empty. label.ts arrived in 58aff03b (2026-09-23) and check_label in 97be888f (2026-09-23). Both are in every tagged release from web-wallet/1.6.0.

**1. The form**
- ui/screens/CreateSeedelf.tsx:75 `const problem = labelProblem(label)`.
- :83 `build()` returns early on a problem.
- :179 Review `disabled={!!problem || busy || !!blocked}`.
- :203 `maxLength={LABEL_MAX}`.
- :209-212 shows the problem as role=alert.
- shared/label.ts:10-11: `const bad = [...label].find((c) => c < " " || c > "~"); if (bad !== undefined) return t("shared.label.warn.badCharacter", { character: bad });`
- en.json:2120 "A tag can't use “{{character}}”. Use plain letters (no accents), digits, spaces and punctuation." es.json:2260 and ja.json:1980 state the same rule.

**2. The worker passes the tag through unchanged**
- handlers.ts:213-214 sends mint-build to MintService.build (mint.ts:59-68).
- buildStealth (:106-132) calls wasm.buildMint. buildFromAccount (:70-104) calls draftAccountMint.
- Those reach lib.rs mint_spend (:2402) and account_mint_plan (:2800), both `check_label(&request.label)?`.
- lib.rs:2097-2100: `if let Some(c) = label.chars().find(|c| !(' '..='~').contains(c)) { bail!("A label can use letters, digits, spaces and ASCII punctuation, not {c:?}") }`.

**3. Core has no character rule**
- build.rs:3058 and :3898 call seedelf_token_name(label). :3073 and :3888 call create_mint_redeemer(label).
- transaction.rs:115-116 and data_structures.rs:27-29: `hex::encode(label); label_hex.truncate(30)`. That is the tag's UTF-8 bytes, cut at 15.
- The CLI's create puts no rule on the tag either (seedelf-cli/src/commands/create.rs:57, :95, :99).

**4. The deployed policy**
- `git show 5b82530`: seedelf.ak:19 `mint(personal_tag: ByteArray, …)`. :57-60 names the token from the first input with `generate(id, idx, seedelf, personal_tag)`.
- token_name.ak:27 `bytearray.slice(personal, 0, 14)` (inclusive, so 15 bytes), then :29-32 concatenate and cut to 32.
- There is no rule on the bytes.
- seedelf-verification/Seedelf/Every/PolicyTyped.lean:72-84 policyAccepts takes a `.B tag` redeemer with any ByteString. :222-224 `policy_accepts_iff` proves that the deployed bytes halt exactly when policyAccepts holds.
- seedelfName (Seedelf/Policy.lean:40-45) is `sliceByteString 0 32 (prefix ‖ sliceByteString 0 15 tag ‖ cons idx txid)`, with idx in 0..255.

**5. My test in TREE fails today on both refusals**
- The form: labelProblem refuses "José" and "さくら".
- The worker, with the real WebAssembly: buildMint throws check_label's words.
- The ASCII control "Jose" builds first and matches the policy's name, so only the character differs.

**6. Mutant run, in a copy**
- Copy: $HOME/.cache/seedelf-review-51/verify-gap-g8_1-trace, its own CARGO_TARGET_DIR. Both were removed afterwards.
- The mutant: check_label's character rule removed, its 15-byte rule kept.
- The test called api::build_mint for "Jose", "José" and "さくら". That path measures with core's measure_locally, running the deployed variant-1 scripts under Aiken's uplc.
- The negative control used core's public API: build::mint for "José", then `.mint(name, 1, create_mint_redeemer("Josf"))`.
- Command: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m cargo test -j 4 --locked --offline -p seedelf-wasm --test mutant_gap_g8_1 -- --nocapture`. Output:
```
Jose: built and measured with the deployed scripts; name 5eed0e1f4a6f736500a1a1…, fee 255846
José: built and measured with the deployed scripts; name 5eed0e1f4a6f73c3a900a1a1…, fee 255590
さくら: built and measured with the deployed scripts; name 5eed0e1fe38195e3818fe3828900a1a1…, fee 256066
negative control (redeemer Josf, name from José): The Seedelf contract refused this transaction (the Seedelf policy: the validator crashed / exited prematurely)
test result: ok. 1 passed
```
- Each name equals seedelfName. Each tx_cbor holds the redeemer, e.g. `454a6f73c3a9`.

**7. Read-back**
- chain.ts:214-223 reads the window after the prefix while bytes are 0x20-0x7e. So "José" shows as "Jos", and "さくら" shows as none. The whole name is shown beside it.
- label.ts:18 tokenNamePrefix uses charCodeAt, so it would preview "José" as 5eed0e1f4a6f73e9, not the minted 5eed0e1f4a6f73c3a9. This is latent today, because the preview is hidden while the tag is refused.

**8. Pins of today's rule**
- e2e/extension.spec.ts:2508-2509 (`tag.fill("héllo")`, expecting "A tag can't use “é”").
- wasm/tests/api_test.rs:1068-1069 ("héllo" expected to fail with "not 'é'", "tab\there" with "ASCII").

**9. Known check**
I searched backlog.md for ascii, accent, utf-8, unicode, emoji, kana, personal tag, check_label, labelProblem, badCharacter and printable. The only hit is the password's Unicode normalisation, which is unrelated. I searched archive/ for the same terms plus tagRules and "plain characters":
- chunk-08-create-seedelf.md:56: a "Decisions to confirm first" suggestion, with the note "On chain it's any bytes, cut to 15". Also :108.
- roadmap-v1.md:502-503: "Decided with the user: The tag is optional, printable ASCII, at most 15 characters" (chunk 8, 2026-09-24). Also :589.
- No Not fixed, Left open, Disputed, For the owner or leftover entry.

In review-51, INDEX.md:401 is this finding. critic.json:107 lists check_label's rule among refusals never swept against the 2026-10-19 rule. W1b, E5 and X1b list it only as checked.

**Known:** Not on the brief's settled lists: the backlog, any Not fixed / Left open / Disputed / For the owner entry, SECURITY.md, or the owner's listed rules. For the owner: the rule was decided with the owner in chunk 8. docs/archive/roadmap-v1.md:502-503 (2026-09-24): "Decided with the user: The tag is optional, printable ASCII, at most 15 characters". It came from chunk-08-create-seedelf.md:56's suggestion, which noted "On chain it's any bytes, cut to 15". That decision predates the owner's 2026-10-19 rule (refuse only what the ledger or the contracts refuse). review-51's critic.json:107 lists this rule among refusals never swept against that rule.

**Fix notes:**

This is the owner's call: chunk 8's own decision against the later 2026-10-19 rule.

**If tags outside ASCII are accepted, change these together:**
- **shared/label.ts labelProblem:** drop the printable-ASCII test, or refuse only C0/C1 control characters. Measure the 15 in UTF-8 bytes (`new TextEncoder().encode(label).length`), not `label.length`, so the policy's 15-byte cut never splits a character. The input's maxLength counts UTF-16 units, so it needs a byte-aware cut or a message instead.
- **shared/label.ts:18 tokenNamePrefix:** encode UTF-8 (TextEncoder), not charCodeAt. Otherwise the preview shows 5eed0e1f4a6f73e9 for a name minted as 5eed0e1f4a6f73c3a9.
- **wasm/src/lib.rs:2097-2100 check_label:** drop the character rule. Its `label.len() > 15` already counts bytes.
- **background/chain.ts:214-223 seedelfLabel:** decode the 15-byte window as UTF-8 (a fatal decoder, stopping at the first control or invalid byte). Clean the result as format.ts plainName does (bidi and invisible characters), since anyone can mint any tag.
- **Pins:** e2e/extension.spec.ts:2508-2509 and wasm/tests/api_test.rs:1068-1069.
- **Words:** en/es/ja `mint.tagRules` and `shared.label.warn.badCharacter`, and flows.md:336.
- **Whatever is chosen:** a short line saying other wallets may show such a tag differently.

**If the rule stays:** reword `mint.tagRules` and `badCharacter` so they don't imply the chain can't hold the tag ("Seedelf Wallet reads tags back as plain characters"), and back-translate.

**For the record, the same class outside the wallet:** the CLI's create and util mint take any text and cut at 15 bytes, possibly mid-character (transaction.rs:115-116, data_structures.rs:27-29).

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g8-1.test.ts`

Result: Run from extension/ with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-1.test.ts`. It failed on TREE today, for the bug:
```
 ❯ tests/r51-gap-g8-1.test.ts (2 tests | 2 failed) 797ms
     × the form lets Review on for a tag outside printable ASCII 10ms
     × the worker builds it, named and redeemed as the policy names it 785ms
 FAIL  … > the form lets Review on for a tag outside printable ASCII
AssertionError: José, 5 bytes of UTF-8: expected 'A tag can\'t use “é”. Use plain lette…' to be undefined
+ Received: "A tag can't use “é”. Use plain letters (no accents), digits, spaces and punctuation."
 FAIL  … > the form lets Review on for a tag outside printable ASCII
AssertionError: さくら, 9 bytes of UTF-8: expected 'A tag can\'t use “さ”. Use plain lette…' to be undefined
+ Received: "A tag can't use “さ”. Use plain letters (no accents), digits, spaces and punctuation."
 FAIL  … > the worker builds it, named and redeemed as the policy names it
Error: A label can use letters, digits, spaces and ASCII punctuation, not 'é'
 ❯ Module.buildMint ../wasm/pkg/seedelf_wasm.js:1582:14
 ❯ src/background/mint.ts:126:93
 ❯ src/background/script-spend.ts:331:52
 ❯ src/background/wallet.ts:508:14
 Test Files  1 failed (1)
      Tests  2 failed (2)
```
In the second test, the ASCII control "Jose" built and matched the policy's name. The failure is the "José" build, from WebAssembly's check_label.

Would it pass once fixed? The mutant run in a copy, with only check_label's character rule removed, built the same fixture's "José" mint. The deployed scripts measured it, its name was 5eed0e1f4a6f73c3a900a1…, and its CBOR held the redeemer 454a6f73c3a9. Those are exactly this test's expectations: "1 passed" there, output in evidence. The last assertion also needs tokenNamePrefix to encode UTF-8, which the fix includes.

Nothing else in TREE changed: `git status` shows only `?? …/extension/tests/r51-gap-g8-1.test.ts` among my files. The mutant copy and its target were removed.

```
// Chunk 51, gap-g8#1: Create Seedelf refuses a tag outside printable ASCII, which the deployed policy takes.
//
// The deployed policy (5b82530: validators/seedelf.ak, lib/token_name.ak) reads its redeemer as any ByteArray and
// names the token prefix ‖ the tag's first 15 bytes ‖ the first input's index ‖ its tx id, cut to 32 bytes. The
// kernel-checked Seedelf.Every.policy_accepts_iff (seedelf-verification/Seedelf/Every/PolicyTyped.lean) says the
// deployed bytes accept exactly that: a `.B tag` redeemer, named by seedelfName, with no rule on the tag's bytes.
// Core writes a tag's UTF-8 bytes, cut at 15, into both the name and the redeemer (seedelf_token_name,
// create_mint_redeemer), and the CLI's create takes any text. The web wallet refuses any character outside " ".."~",
// in the form (shared/label.ts labelProblem) and in WebAssembly (check_label, which buildMint runs first), so "José"
// or "さくら" can't be a tag here.
//
// The right behaviour: the form lets Review on for such a tag, and the worker builds the mint, named and redeemed as
// the policy names it. A stealth mint is measured in the wallet with the deployed scripts (core's measure_locally),
// so once the rule is gone this build is itself a run of the deployed policy on that tag. An ASCII tag builds today,
// as the control: the harness and the name are right, and only the character differs.
import { describe, expect, it } from "vitest";

import { SESSION_MINT } from "../src/background/mint";
import { labelProblem, tokenNamePrefix } from "../src/shared/label";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const utf8 = (s: string) => Buffer.from(s, "utf8").toString("hex");

/** The name the deployed policy gives a Seedelf minted with `tag`, its first input `txid#idx` (seedelfName). */
function policyName(txid: string, idx: number, tag: string): string {
  return `5eed0e1f${utf8(tag).slice(0, 30)}${idx.toString(16).padStart(2, "0")}${txid}`.slice(0, 64);
}

async function unlocked() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

describe("gap-g8#1: a tag the deployed policy takes", () => {
  it("the form lets Review on for a tag outside printable ASCII", () => {
    expect.soft(labelProblem("José"), "José, 5 bytes of UTF-8").toBeUndefined();
    expect.soft(labelProblem("さくら"), "さくら, 9 bytes of UTF-8").toBeUndefined();
  });

  it("the worker builds it, named and redeemed as the policy names it", async () => {
    const t = await unlocked();
    // The control: named after the 25 ₳ UTxO that pays (a1… #0), as mint.test.ts has it.
    const control = await t.mint.build("preprod", "Jose", "seedelf");
    expect(control.tokenName).toBe(policyName("a1".repeat(32), 0, "Jose"));

    const summary = await t.mint.build("preprod", "José", "seedelf");
    expect(summary.tokenName).toBe(policyName("a1".repeat(32), 0, "José"));
    // The mint redeemer holds the tag's bytes: CBOR bytes of length 5.
    const built = (await t.session.get<{ txCbor: string }>(SESSION_MINT))!;
    expect(built.txCbor).toContain(`45${utf8("José")}`);
    // The form's preview is how that name starts.
    expect(summary.tokenName.startsWith(tokenNamePrefix("José"))).toBe(true);
  });
});
```
