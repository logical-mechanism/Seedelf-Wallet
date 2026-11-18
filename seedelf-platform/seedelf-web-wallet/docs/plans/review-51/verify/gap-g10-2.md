# gap-g10#2: verification

From lane gap-G10, graded low by its finder.

## Trace: partly, low

The core holds. When a stranger pays the public account, their whole input address becomes the row's Who (background/activity.ts:888-896). Who cuts it with MiddleEllipsis, and the only part that is never cut is the last 6 characters (Activity.tsx:415, MiddleEllipsis.tsx:9-10). Those 6 are the bech32 checksum. A stranger matches them with their own payment key and no grinding, by solving 6 symbols of the stake part (no signature covers it).
- My own solver, written from BIP-173, confirms this, and the wallet's own pallas parser accepts the result as a payable mainnet key address.
- My test fails today on exactly that.
- The stranger also controls how much of their own row survives the cut. The amount column is auto-width and never wraps, and the sender picks the amount and how many tokens go with it. At 360 px, a payment of "+1.5 ₳ and 1 token" lists as "14:02 · ad… e35a3x".

Two parts are narrower than written.
1. The finder's harness put a day in the line before the address ("Today, 14:02 · ", "23 Mar, 18:40 · "). EntryLine never renders a day there; it shows only the time. So the user's own rows keep more of the address than the finding says. At 360 px, the user's −250 ₳ to Bob reads "addr1qx2fxv2u…e35a3x" (7 payment characters, 32 bits), not "addr1q…". Only a pending row, a large amount or a token squeezes it to 0 to 2 payment characters.
   - So for ordinary payments the two rows don't read identically. The stranger's row shows nothing that contradicts Bob's address.
   - To match Bob's visible start character for character, the stranger has to grind about 2^17 to 2^32 keys, depending on Bob's amount.
2. The Seedelf-name family member doesn't work through Who. Private entries store a 12+6 short form, 19 characters (activity.ts:220, :349), which Who shows whole, not "5eed0e1f…" plus 6. And no stranger can write a private row.

**Evidence:**

TREE HEAD is 688e074e. Only review docs differ from cd764fba. Activity.tsx, MiddleEllipsis.tsx and styles.css are identical at web-wallet/1.9.1 (Activity.tsx:415 and styles.css:3628 are the same there).

TRACE
1. **The stranger's row.** describe() in background/activity.ts:
   - :839 keeps a transaction that pays the account.
   - :880-881 names it "received" when the direction is in.
   - :888-893 takes the counterparts from `tx.inputs.filter((o) => !ours(o) && !atBox(o)).map((o) => o.payment_addr.bech32)`.
   - :896 `several(counterparts)` puts the stranger's whole bech32 address in `detail`.
2. **The user's own row to Bob.** A public Send keeps no record of its own (`sent()` returns early at :309 for any kind that isn't Seedelf's). So Bob's row also carries his whole address, from the outputs (:893; pending rows: incoming.ts:404-411).
3. **Where the address goes on screen.** In Activity.tsx, EntryLine (:388-401) builds the line before the address from `[pending ? "Pending" : "", time(e.at)]`. time() (:117) formats as en-GB (i18n/core.ts:106), giving "14:02 · ". The day is the group's h2, not part of this line. Who (:415) then renders `name.length > 24 && !/\s/.test(name) ? <MiddleEllipsis text={name} />`. MiddleEllipsis.tsx:9-10: the head is `text.slice(0,-6)` and the tail is `text.slice(-6)`.
4. **CSS.**
   - styles.css:792-800: the head has overflow: hidden and an ellipsis; the tail is flex: none.
   - :3621-3631: `.activity__sub .middle-ellipsis { overflow: hidden; flex: 1 1 9ch; min-width: 9ch; max-width: max-content }`.
   - :1777-1830: the row is a grid of `auto minmax(0,1fr) auto`, and `.token-row__amount` is nowrap. The amount text comes from ui/activity.ts:107-112, plus "{{ada}} ₳ and {{count}} token(s)", so the sender sizes the middle column.
5. **The details.** Activity.tsx:337 is a plain Row: the whole address, wrapped, labelled From or To. Only the transaction ID gets a CopyButton (:370-371). MiddleEllipsis's `title` shows the whole address on hover.

BECH32
My solver (scratch v_bech32_solve.mjs, and again inside the test) starts from Bob's stake part and solves symbols 60 to 65 over GF(2), at rank 30, for Bob = CIP-19's addr1qx2fxv2um…gse35a3x. With a chosen payment hash it gives a valid address:

addr1qyrpruuwrwdwhrd3ecn7s7350wwkddgkcrqqf8rmgkapcqfn0d3vllmyqwsx04m0dp8cc3sq835lu7drv2xwl2wywfgse35a3x

- Same header (01), a different payment part, 103 characters.
- It shares Bob's last 31 characters, not just the last 6.
- Three random keys gave the same result.

LAYOUT
How I measured:
- Headless Chrome 157, offline (`--host-resolver-rules="MAP * ~NOTFOUND"`, a dead proxy), under systemd-run MemoryMax=4G.
- The real styles.css with the bundled Inter embedded.
- Markup copied from Activity.tsx:269-283 and :388-425, nested the way App and Screen nest it.
- The root pinned at 345, 360 and 400 px. Headless clamps the window to 500 px, and styles.css has no width media queries, so pinning the root reproduces the panel.
- Scripts: scratch v_make_page.mjs. Results: v-r-*.json. Screenshots I viewed: v-crop-360.png and v-crop-360b.png, which match.

At 360 px (e2e/support.ts:663 calls it Chrome's default), the user's own rows, with "18:40 · " before the address:

| Row | Shows | Payment bits kept |
|---|---|---|
| −25 ₳ | addr1qx2fxv2umy…e35a3x | 42 |
| −250 ₳ | addr1qx2fxv2u…e35a3x | 32 |
| −250 ₳, pending | addr1…e35a3x | 0 |
| −1,000 ₳ | addr1qx2fxv2… | 27 |
| −1,234.5 ₳ | addr1qx2fx… | 17 |
| −12,345.678901 ₳ | addr1qx2… | 7 |
| −250 ₳ and 1 token | addr1qx… | 2 |

At 360 px, the stranger's rows, with "14:02 · " before the address:

| Row | Shows |
|---|---|
| +1 ₳ | addr1qyrpruuwrwd… |
| +1.234567 ₳ | addr1qyr… |
| +1 ₳ and 1 token | addr…e35a3x |
| +1.5 ₳ and 1 token | ad…e35a3x |
| +1.234567 ₳ and 1, 3 or 12 tokens | ad…e35a3 (a 68 px box in a 48 to 64 px line clips the tail itself) |

At 400 px: the user's −250 ₳ keeps 20 characters. The stranger's "+1.234567 ₳ and 12 tokens" reads addr1…e35a3x.

At 345 px (360 less a classic scrollbar): the user's −250 ₳ reads addr1qx2fxv2…, and the stranger's +1.234567 ₳ reads addr1…e35a3x.

The finder's g10_make_page.py:183-187 used the lines "Today, 14:02 · ", "23 Mar, 18:40 · " and "Yesterday, 09:12 · ". That's why they measured "addr1q…" for −250 ₳.

FAMILY
- **Private entries.** The worker stores `p.label ?? shortHex(p.to)` (activity.ts:349), and for Make public a $handle or `shortHex(address)` (:355). Its own shortHex (:220) is 12+6, 19 characters, so Who shows it whole.
- **Seedelf names.** token_name.ak at 5b82530 builds a name as "5eed0e1f", then the tag (up to 15 bytes), then the index byte, then the txid, cut to 32 bytes. So 12+6 is the prefix, 2 bytes the minter picks and 3 txid bytes: about 2^24 tries. That holds for Transfer.tsx:509, Destination.tsx:216 and Contacts.tsx:30, but no stranger can put a row in Activity with it.

TEST
On TREE it fails today at the intended line: `expected 'e35a3x' not to be 'e35a3x'`. The setup checks before it pass: `checkPayableAddress(poisoner, Mainnet)` doesn't throw, the bytes start 01, the payment hash is the stranger's and differs from Bob's, and the last 6 characters are the same.

In a copy under ~/.cache (removed afterwards):
- Who cut in JS to `shortHex(name, 14, 8)`: passes.
- A fixed 14-character lead span outside the head that gives way: passes.
- A 30-character tail instead: still fails, with 'c3sq835lu7drv2xwl2wywfgse35a3x' for both.

Since (correct): d423b79a (the middle cut) and 8645072e (the 9ch minimum), both 2026-10-05 and first tagged in web-wallet/1.6.0.

**Known:** None: not settled or known. I searched seedelf-platform/seedelf-web-wallet/docs/backlog.md (all of it, including Activity, Declined and the open calls), docs/archive/plans/*.md, plans/chunk-46-verification-on-upstream.md and chunk-49-no-locked-funds.md, review-51's INDEX, lanes, data and verify, flows.md and SECURITY.md. Terms: poison, checksum, lookalike, ground address, vanity, MiddleEllipsis, middle-ellipsis, 9ch, "tail people", "same checksum", "last six" / "last 6", "cut in the middle", and Activity with address, cut, tail or counterpart.

Related records, none of which weighs that Activity's kept tail is the checksum:
- **Launch review #19 (Medium, fixed).** The sign window's Pays address shrank to its 6-character checksum: "A ground address with the same checksum then reads as the real one."
- **Usability review S-4 (fixed).** Send's review truncated the recipient, "exactly what address poisoning exploits". Reviews now show it whole: ReviewRows.tsx Row `whole`, flows.md:236.
- **AC-1 and V-6 (fixed).** Activity's end cut became a middle cut, "keeping the tail people compare".

SECURITY.md puts "social engineering against users" out of scope, and a bounty needs a loss "not solely attributable to user error". A bounty report of this would probably fail there. But the project itself treated #19 and S-4 as wallet bugs, so it isn't settled.

**Fix notes:**

The class: what an address shows whatever the width must include a fixed run of the payment part. Neither the checksum nor anything else the sender chooses can be the kept part.

1. **Activity's Who (Activity.tsx:415).** Either cut in JS to a fixed short form (`shortHex(address, 14, 8)`, as Destination.tsx:222 does), or keep MiddleEllipsis with a fixed lead span of about 14 characters outside the head that gives way. Then let the line wrap. My test passes with either shape.
2. **A longer tail doesn't help.** On a base address, everything after the payment part (the stake part and the checksum, about 51 characters) is the sender's to choose. My lookalike shares Bob's last 31 characters, and the test still fails with a 30-character tail.
3. **Raising the CSS min-width alone doesn't hold either.**
   - The amount column (`.token-row__amount`, auto and nowrap) is sized by the sender's amount and token count. At 360 px, "+1.234567 ₳ and 12 tokens" leaves the address line 48 px.
   - A box wider than its line overflows it, and `.token-row__sub`'s overflow: hidden then clips the tail. That already happens today at 9ch: "ad…e35a3".
   - So also cap the amount column (as #19 capped the sign window's at 55%) or put the address on a line of its own.
4. **Other members of the family:**
   - the private side's 12+6 detail (activity.ts:220, used at :349, :355 and :362), for Make public's addresses ("addr1q" plus 6 characters, about 27 bits) and Seedelf names;
   - Contacts.tsx:30's shortValue, 12+6 for address contacts;
   - Transfer.tsx:509 and Destination.tsx:216, `shortHex(name, 12, 6)` for Seedelf names. There, skip the fixed prefix and the minter's tag and show more of the txid part.

   None of these is reachable by a stranger through Activity.

Severity stays low.
- **Who can reach it:** any stranger. It costs them about 1.5 ₳, one worthless token they mint themselves, and a fee per victim, plus a solve that takes milliseconds.
- **What it costs:** the user's next payment to Bob, in full. But only if the user takes Bob's address from a row titled Received, with a teal + amount and labelled From in its details, and then doesn't compare the start of the address in Send's 14+8 note, which differs at the 7th character.
- **Way out:** none once it's sent. Before that, the hover title shows the whole address, and a saved contact's "Your contact" line would be missing.

The fix changes only what a screen shows: no refusal and no privacy default. It's the owner's call how the line wraps.

Scratch, kept on tmpfs: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-gap-g10_2-trace/ (v_bech32_solve.mjs, v_make_page.mjs, v-r-345/360/400.json, v-crop-360.png, v-crop-360b.png).

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g10-2.test.ts`

Result: Run from extension/ with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g10-2.test.ts`. It fails on TREE as intended:

```
 FAIL  tests/r51-gap-g10-2.test.ts > public Activity's counterparty (chunk 51, gap-g10#2) > keeps, at any width, a part of the address that a stranger's lookalike can't match for free
AssertionError: expected 'e35a3x' not to be 'e35a3x' // Object.is equality
 ❯ tests/r51-gap-g10-2.test.ts:164:39
    164|     expect(kept(shown(poisoner))).not.toBe(kept(shown(BOB)));
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

Every setup check before line 164 passes. The wallet's checkPayableAddress (pallas) accepts the stranger's address as a mainnet key address. Its bytes start 01 and carry the stranger's payment hash, which isn't Bob's, and it ends in Bob's last 6 characters.

In a copy of seedelf-platform under ~/.cache/seedelf-review-51/ (removed afterwards), I changed Activity.tsx:415:
- Who cut in JS to `shortHex(name, 14, 8)`: "Tests 1 passed (1)".
- MiddleEllipsis with a fixed 14-character lead span outside the head that gives way: "Tests 1 passed (1)".
- A 30-character tail instead (a wrong fix): still fails, with `expected 'c3sq835lu7drv2xwl2wywfgse35a3x' not to be 'c3sq835lu7drv2xwl2wywfgse35a3x'`.

The test needs the built wasm/pkg, as fakes.ts and r51-gap-g7-2 do.

The widths themselves are layout, which Vitest's node environment can't measure. They come from my headless-Chrome run, in the evidence.

```
// Chunk 51, gap-g10#2: public Activity names who paid the account by their address, cut in the middle by
// MiddleEllipsis (screens/Activity.tsx `Who`): its head gives way to the row's width, and only its last six
// characters never do. Those six are the bech32 checksum, and a stranger matches them for free: they keep their own
// payment key and choose six symbols of their address's stake part, which nothing signs for, by solving the
// checksum's linear equations. Their 1 ₳ then lists as "ad… e35a3x" beside the user's payment to "addr1qx2fxv2u…
// e35a3x". What a row keeps whatever its width must tell two payment keys apart.
//
// The cut is the stylesheet's: `.middle-ellipsis__head` gives way, `.middle-ellipsis__tail` never does, and
// `.activity__sub .middle-ellipsis` shrinks to 9ch beside an amount the sender chooses. So this reads what the markup
// leaves outside the part that gives way. The verifier's record has a headless-Chrome measure of the real rows.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { blake2b } from "@noble/hashes/blake2.js";
import * as wasm from "@seedelf/wasm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { Who } from "../src/ui/screens/Activity";

/** CIP-19's mainnet base address (key payment, key stake): the address the user paid, Bob's. */
const BOB = "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";

// BIP-173 bech32, as Cardano's addresses use it (no 90-character cap).
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk = (chk ^ GEN[i]!) >>> 0;
  }
  return chk;
}

const expand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

/** The six checksum symbols of `data` under `hrp`, as one 30-bit number. */
const checksum = (hrp: string, data: number[]) => (polymod([...expand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1) >>> 0;

function encode(hrp: string, data: number[]): string {
  const sum = checksum(hrp, data);
  const tail = Array.from({ length: 6 }, (_, i) => (sum >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...tail].map((v) => CHARSET[v]).join("")}`;
}

/** Bytes as 5-bit symbols, the last padded with zeros. */
function words(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits) out.push((acc << (5 - bits)) & 31);
  return out;
}

/** A mask of `columns` whose XOR is `target`, over GF(2), if there is one. */
function solve(columns: number[], target: number): number | undefined {
  const basis: Array<{ v: number; m: number } | undefined> = new Array(30);
  columns.forEach((column, j) => {
    let v = column;
    let m = 2 ** j;
    for (let bit = 29; bit >= 0 && v; bit--) {
      if (!((v >>> bit) & 1)) continue;
      const b = basis[bit];
      if (!b) {
        basis[bit] = { v, m };
        return;
      }
      v = (v ^ b.v) >>> 0;
      m = (m ^ b.m) >>> 0;
    }
  });
  let v = target;
  let m = 0;
  for (let bit = 29; bit >= 0 && v; bit--) {
    if (!((v >>> bit) & 1)) continue;
    const b = basis[bit];
    if (!b) return undefined;
    v = (v ^ b.v) >>> 0;
    m = (m ^ b.m) >>> 0;
  }
  return m;
}

/**
 * A mainnet base address under `payment`, the stranger's own key hash, ending in `target`'s last six characters: its
 * stake part starts as `target`'s, and six of its symbols are solved for. No grinding, no one else's key.
 */
function lookalike(target: string, payment: Uint8Array): string {
  const bytes = new Uint8Array(57);
  bytes[0] = 0x01; // a base address, key payment and key stake, on mainnet
  bytes.set(payment, 1);
  bytes.set(Buffer.from(wasm.cip30Address(target), "hex").subarray(29), 29);
  const data = words(bytes);
  const want = [...target.slice(-6)].reduce((n, c) => n * 32 + CHARSET.indexOf(c), 0);
  // Symbols 60 to 65 hold bits 300 to 329: inside the stake hash (bits 232 to 455).
  const free = [60, 61, 62, 63, 64, 65];
  const base = checksum("addr", data);
  const columns = free.flatMap((p) =>
    [0, 1, 2, 3, 4].map((bit) => {
      const flipped = [...data];
      flipped[p] = flipped[p]! ^ (1 << bit);
      return (checksum("addr", flipped) ^ base) >>> 0;
    }),
  );
  const mask = solve(columns, (base ^ want) >>> 0);
  if (mask === undefined) throw new Error("no solution for these six symbols");
  for (let j = 0; j < 30; j++) if ((mask >>> j) & 1) data[free[Math.floor(j / 5)]!] = data[free[Math.floor(j / 5)]!]! ^ (1 << (j % 5));
  return encode("addr", data);
}

/** The stranger's payment key hash: Blake2b-224 of an Ed25519 key of their own. */
function strangersKeyHash(): Uint8Array {
  const seed = createHash("sha256").update("r51 gap-g10#2: the stranger's own key").digest();
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const vkey = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }))
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  return blake2b(vkey, { dkLen: 28 });
}

/** Who's markup for `name`, as Activity's list renders it. */
const shown = (name: string) => renderToStaticMarkup(createElement(Who, { name }));

/** What the row shows whatever its width: its text, but for the head MiddleEllipsis lets give way. */
const kept = (html: string) =>
  html
    .replace(/<span class="middle-ellipsis__head">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&");

beforeAll(() => {
  wasm.initSync({ module: readFileSync(new URL("../../wasm/pkg/seedelf_wasm_bg.wasm", import.meta.url)) });
});

describe("public Activity's counterparty (chunk 51, gap-g10#2)", () => {
  it("keeps, at any width, a part of the address that a stranger's lookalike can't match for free", () => {
    const payment = strangersKeyHash();
    const poisoner = lookalike(BOB, payment);

    // The stranger's address is a valid mainnet key address the wallet pays (the wallet's own parser, pallas), under
    // their own payment key, not Bob's, and it ends in Bob's six characters.
    expect(() => wasm.checkPayableAddress(poisoner, wasm.Network.Mainnet)).not.toThrow();
    const theirs = wasm.cip30Address(poisoner);
    const bobs = wasm.cip30Address(BOB);
    expect(theirs.slice(0, 2)).toBe("01");
    expect(theirs.slice(2, 58)).toBe(Buffer.from(payment).toString("hex"));
    expect(theirs.slice(2, 58)).not.toBe(bobs.slice(2, 58));
    expect(poisoner).toHaveLength(BOB.length);
    expect(poisoner.slice(-6)).toBe(BOB.slice(-6));

    // What the row keeps when the head gives way. Today that's "e35a3x" for both: the stranger's 1 ₳ reads as Bob's.
    expect(kept(shown(poisoner))).not.toBe(kept(shown(BOB)));
    // A fixed run of the payment part, as Send's note keeps it (shortHex(address, 14, 8)): "addr1q" and 8 more.
    expect(kept(shown(BOB))).toContain(BOB.slice(0, 14));
  });
});
```
