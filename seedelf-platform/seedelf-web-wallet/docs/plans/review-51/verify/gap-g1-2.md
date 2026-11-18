# gap-g1#2: verification

From lane gap-G1, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. A site's transaction that the public account signs, paying the user's own Seedelf under a fresh re-randomization, is never written into the sealed Seedelf history. When the scan finds the output, `arrived` notes it as received, so `classes` gives it received:<tx> and the UTxOs screen tags it Received. A stealth mint then takes it ahead of a payment someone else made, which ties the new Seedelf to the public account in the open. A test drives the real connector and WebAssembly and shows all of this failing on TREE, and the same test passes under a sketch of the finder's fix.

I found no missed guard and no earlier check. Nothing in dapp.ts calls ActivityService.sent, no PendingTx kind belongs to a site, `siteSigned` keeps only outputs under the session's own key, and `remember` and `keepSent` write only session storage. The private-session half goes through the same code; I traced it but didn't run it.

Low, as the finder graded it. It needs the connector on (off by default) and a user who pays their own Seedelf through a site instead of Make private. That is unusual, but the CLI's own fund page does exactly this. The cost is a privacy link, not money, and it lands only when an unlinked UTxO would otherwise pay. Locking the UTxO by hand is the only way out, and its "Received" tag hides that it should be locked.

**Evidence:**

TREE at e36b62c5. The code is web-wallet/1.9.1 plus manifest.ts (git diff web-wallet/1.9.1 HEAD on src/wasm/core shows only manifest.ts and wasm/README.md).

Trace, from where the payment enters to the outcome:

1. **Sign** (dapp.ts:2131-2199, signTx). After approval:
   - On a session, `sessions.siteSigned` runs (sessions.ts:2646-2663). It records only `paysAccount` outputs (sessions.ts:959-969): key-hash addresses whose key is the session's own. A contract (script) output is excluded.
   - `this.remember` (dapp.ts:2434-2479) writes SESSION_DAPP_SIGNED to chrome.storage.session only.
   - Neither touches `history.<network>` in the private store.
2. **Submit** (dapp.ts:2555-2580 submitTx, then send at :2583-2619, then keepSent at :2644-2680). It keeps rememberSiteSpent, SESSION_DAPP_SIGNED and a stale mark, nothing else.
   - The only "activity" in dapp.ts is an import of SESSION_ACCOUNT_ADDRESSES_PREFIX (:156).
   - PendingTx's kinds (rpc.ts:886-908) include none for a site.
   - The callers of ActivityService.sent are in pending.ts, sessions.ts and lovejoin.ts only.
3. **Scan**: balances.ts:278 and :399 call `activity.arrived(network, view.owned)`.
   - At activity.ts:431, `ours` holds only the history's own entries, and the site's transaction isn't among them.
   - So :441-450 gives the output kind "received" with no origin, once the history is past its first reading.
4. **Class**: activity.ts:389-418 `classes` calls `classOf` (:646-657), which returns receivedIn(tx), origin "received".
   - script-spend.ts:263-268 `classesOf` passes it to WebAssembly.
   - lib.rs:2122-2147 `histories` reads it as Origin::Received.
5. **Ranks**:
   - build.rs:2394-2400, Mint: Received 0, Lovejoin 1, Unknown 2, Own 3.
   - build.rs:2401-2412, Fund: the session's own 0, Received 1, Own 4, another session 5, tier 1 at :2422.
6. **Selection**: :2564 isn't blind, so `apart` runs. `one_more` (:2709-2712) sorts by (rank, lovelace) at :2608 and takes the first single that pays.
7. **What the user is shown**:
   - The UTxOs screen's history comes from activity.classes (coin-control.ts:309-311), so `historyTags` says "Received".
   - The mint's spentHistories holds one class, so historiesNote says nothing (histories.ts: the note needs more than one class, an account, or a session).
   - The form shows the static mint.privacy.fromPrivate (en.json:1442): "Only money others paid you keeps the Seedelf apart from your public account."
8. **The wallet does know**: tx-view.ts:277-282 marks an output under its own register as `yours: private` ("Yours, in your private balance", flows.md:261).

Real path: the CLI's fund page.
- fund.rs:161 re-randomizes the named Seedelf's datum.
- static/index.js:44-55 calls signTx then submitTx on a wallet picked from window.cardano.
- The connector is offered there: shared/dapp.ts:15 lists `http://127.0.0.1/*`, and connector.ts:66 accepts it.

Session half: the same `arrived` and `classOf`. buildFunding (sessions.ts:3060-3065) gets `own` only from collateralTopUp (s.txs and recovered.own), never from a site's transaction. So the next funding of another session ranks the output 1 instead of last.

Run on TREE (`timeout 10m npx vitest run tests/r51-gap-g1-2.test.ts`, MemoryMax=8G). The transaction hash changes per run because the re-randomization is random:
```
[r51 gap-g1#2] the site's output 02a2b7e7c0d42512…#0 is classed {"id":"received:02a2b7e7c0d425129e415168d39573e7b088e6a0a52e6f7b1dddab34bf5ac8ae","origin":"received"}
[r51 gap-g1#2] the UTxOs screen tags it ["Received"]
[r51 gap-g1#2] the stealth mint spends ["02a2b7e7…#0"]; its review's histories [{"id":"received:02a2b7e7…","origin":"received"}]
```
Four soft failures, then "Tests 1 failed (1)".

Fix sketch, run in a copy (`$HOME/.cache/seedelf-review-51/verify-gap-g1_2-trace`, removed afterwards): dapp.ts `send()` calls `activity.sent` after keepSent with a move-in entry, origin public:<account> (session:<index> on a session). The same test gives "Test Files 1 passed (1) · Tests 1 passed (1)".

TREE has no tracked changes; the only file added is this test. I didn't check the sign window's own words for a re-randomized own register (that is x1a#2's subject).

**Known:** None: it isn't settled or known.

Searched:
- backlog.md in full (every ⬜, ❓ and Declined line) for histor, class, received, selection, stealth, made private, and site near history.
- Every docs/archive/plans/*.md for received near site, dapp, connector or cip30; for "own Seedelf", "pays your private", "into your private balance" and "ownRegister"; and the history and activity lines in chunk-15, chunk-15c, chunk-24, chunk-28 and independent-review.
- privacy.md's Co-spending, Connecting a site and A site connected to a private session; flows.md; SECURITY.md's scope; the chunk 46 and chunk 49 plans.

Nearest hits, none of which covers this:
- independent-review M7 and F3: the same class (the wallet's own direct return, or one cut by a lock, read as received and taken first by fundings), fixed by writing its history entry. A site's transaction was never covered.
- L38: a restore's finds are Unknown.
- D1: the mint's documented order.
- review-51 x1a#2: the window's words, not the class afterwards.
- review-51 gap-g1#1 and e1a#1: a stranger's or a pool's shapes.

The owner's rules don't apply. The fix adds no refusal, and it makes the default more private.

**Fix notes:**

**Proven in a copy.** In dapp.ts `send()`, after keepSent, a crude call to `activity.sent` writes a move-in entry with origin public:<account>, or session:<index> on a session. With it, `arrived` skips the output, `classes` gives public:0, the tag reads "Made private", and the stealth mint takes Bob's payment. The test passes.

**What a real fix must also cover:**
- **A site's own submit.** CIP-30 lets a site submit the transaction itself, so recording only at the wallet's submitTx misses those. Record at signTx instead: a sealed note by transaction hash and class, read by `arrived`/`classes`. It shouldn't be an Activity entry until the output lands, or a signed transaction that never went out would show in Activity.
- **The right store.** SESSION_DAPP_SIGNED lives in chrome.storage.session and is gone when the browser closes, so it can't be the record.
- **Only the wallet's own outputs.** Mark only outputs under the wallet's own register; tx-view.ts:277-282 `ownRegister` already finds them. Use madePrivate(signing account) for the public account and sessionClass(index) for a session, so ownClassed and Purpose::Fund treat them as the session's own.
- **What can't be fixed.** A restore can't know where such money came from. Money another browser with the same phrase makes private also reads as received (the finder's note, a wording matter for privacy.md:173).

**Needs the owner.** It's a new sealed record of a site's transactions: a data-handling change with a dated privacy-policy Changes entry in the same PR. It also changes the UTxOs screen's tags.

**Same class:** independent review M7 and F3 (fixed for the wallet's own returns), gap-g1#1, e1a#1.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g1-2.test.ts`

Result: Command: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g1-2.test.ts`, run from `extension/`.

**On TREE: fails**, as intended, with all four soft assertions failing:

```
[r51 gap-g1#2] the site's output 02a2b7e7c0d42512…#0 is classed {"id":"received:02a2b7e7c0d425129e415168d39573e7b088e6a0a52e6f7b1dddab34bf5ac8ae","origin":"received"}
[r51 gap-g1#2] the UTxOs screen tags it ["Received"]
[r51 gap-g1#2] the stealth mint spends ["02a2b7e7c0d425129e415168d39573e7b088e6a0a52e6f7b1dddab34bf5ac8ae#0"]; its review's histories [{"id":"received:02a2b7e7c0d425129e415168d39573e7b088e6a0a52e6f7b1dddab34bf5ac8ae","origin":"received"}]
 FAIL  tests/r51-gap-g1-2.test.ts > … > keeps the public account's history, and a stealth mint takes money others paid before it
AssertionError: the site's output keeps public account 0's history: expected { …(2) } to deeply equal { id: 'public:0', origin: 'own' }
AssertionError: the UTxOs screen tags it as made private: expected [ 'Received' ] to deeply equal [ 'Made private' ]
AssertionError: the stealth mint doesn't spend the public account's own output: expected [ Array(1) ] to not include '02a2b7e7c0d425129e415168d39573e7b088e…'
AssertionError: it spends Bob's payment: expected [ Array(1) ] to deeply equal [ Array(1) ]  (- "b0b0…b0#0"  + "02a2b7e7…#0")
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

Every sanity assertion before them passed:
- the window opened for 20 ₳ into the contract under an inline datum;
- it is signed by 0/0, the witness set starts `a100`, and submitTx returned the reviewed hash;
- both outputs are in the private balance, and Bob's is `received:b0…`.

The transaction hash differs per run (an earlier run gave `5705c350…`) because the re-randomization is random.

**With the fix sketch, in a copy** (not TREE): the same file gives `Test Files 1 passed (1) · Tests 1 passed (1)`. The class is public:0, the tag is "Made private", and the mint spends Bob's `b0…#0`.

```
// Chunk 51, finding gap-g1#2 (its trace verifier's test). The user connects a site on the public account and signs its
// transaction, which pays 20 ₳ of public account 0's into the user's own Seedelf under a fresh re-randomization of its
// register, as any site that pays a Seedelf by name builds it (the CLI's own fund page does: fund.rs:161). The
// connector signs it and sends it (dapp.ts signTx, then submitTx → send → keepSent), and writes nothing into the
// sealed Seedelf history: no PendingTx kind is a site's, and nothing in dapp.ts calls ActivityService.sent. When the
// contract scan finds the output, `arrived` notes it as a payment received (activity.ts:427-457), so `classes` gives
// it `received:<tx>` (activity.ts:656-657) and the UTxOs screen tags it Received. It's money made private from public
// account 0 (privacy.md, Co-spending: "made private from a public account: one history per account"), tied to that
// account on chain by its transaction's own inputs. A stealth mint then ranks it with money others paid (core
// build.rs:2394, Purpose::Mint: Received 0, Own 3) and, smallest first (build.rs:2608), takes it ahead of a payment
// someone else made: the new Seedelf is tied to the public account in the open. This asserts the right behaviour, so
// it fails while the bug is there.
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { registerOf } from "../src/background/chain";
import type { DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { historyTags, madePrivate } from "../src/shared/histories";
import type { DappApproval } from "../src/shared/rpc";
import { koiosPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const ACCOUNT = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** Public account 0's receive address 0/0. */
const OWN = ACCOUNT.preprod.receive_0 as string;
/** A pure 100 ₳ UTxO of the account's at 0/0, which the site's transaction spends. */
const FUNDS = { tx_hash: "c1".repeat(32), tx_index: 0, lovelace: 100_000_000n };
const PAID = 20_000_000n;
const FEE = 170_000n;

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** A CBOR byte string of 24 to 255 bytes. */
const bytesOf = (hex: string) => `58${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;
const coin = (n: bigint) => (n < 0x100000000n ? `1a${n.toString(16).padStart(8, "0")}` : `1b${n.toString(16).padStart(16, "0")}`);
const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** Seedelf Wallet's contract on preprod, as seedelf-core's `wallet_contract` builds it: its script hash, no staking part. */
const CONTRACT = `70${CONTRACT_V1.walletContractHash}`;

/**
 * The site's transaction body: it spends FUNDS, pays 20 ₳ into the contract under the inline datum `datum` (CBOR,
 * hex), and the rest less its 0.17 ₳ fee back to `change` (CIP-30 hex).
 */
function body(datum: string, change: string) {
  const inputs = `81825820${FUNDS.tx_hash}00`;
  const toContract = `a300${bytesOf(CONTRACT)}01${coin(PAID)}028201d818${bytesOf(datum)}`;
  const back = `82${bytesOf(change)}${coin(FUNDS.lovelace - PAID - FEE)}`;
  return `a300${inputs}0182${toContract}${back}02${coin(FEE)}`;
}

/** The Seedelf token a contract row holds, if it holds one. */
const seedelfOf = (u: KoiosUtxo) => (u.asset_list ?? []).find((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId)?.asset_name;

describe("a payment the user's public account makes into their own Seedelf through a site (chunk 51, gap-g1#2)", () => {
  it("keeps the public account's history, and a stealth mint takes money others paid before it", { timeout: 120_000 }, async () => {
    const t = testBalances();
    await t.wallet.create(ACCOUNT.phrase as string, PASSWORD);
    await t.preferences.set({ dappConnector: true, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({
      ...template,
      tx_hash: FUNDS.tx_hash,
      tx_index: FUNDS.tx_index,
      value: FUNDS.lovelace.toString(),
      asset_list: [],
      block_height: 1,
    });
    const s: DappSession = { id: "r51-gap-g1-2", origin: "https://pay.example", title: "Pay a Seedelf" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    // Home's first reading: the private history begins, and what's already there is Unknown (independent review L38).
    await t.balances.get("preprod");
    expect((await t.coins.lists("preprod")).cardano.some((u) => u.txHash === FUNDS.tx_hash)).toBe(true);
    const { wasm } = t.deps;

    // The user's own Seedelf, as anyone reads it on chain, re-randomized for each payment as a correct payer does.
    const seedelf = ownedUtxos.find((u) => seedelfOf(u) && u.inline_datum)!;
    const found = registerOf(seedelf)!;
    const fresh = () => hexOf(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(found.generator, found.publicValue))));
    const ours = fresh();
    const bobs = fresh();
    expect(ours).not.toBe(bobs);

    // The site asks the public account to sign its payment into that Seedelf; the user approves it.
    const unsigned = body(ours, wasm.cip30Address(OWN));
    const signing = t.dapp.call(s, "signTx", [`84${unsigned}a0f5f6`, false]);
    await until(() => t.dapp.approvals().length === 1);
    const approval = t.dapp.approvals()[0]! as Extract<DappApproval, { kind: "sign-tx" }>;
    expect(approval.summary.paid.map((p) => [p.lovelace, p.datum, p.script])).toEqual([["20000000", "inline", true]]);
    expect(approval.summary.signs).toEqual(["0/0"]);
    expect(await t.dapp.answer(approval.id, true, PASSWORD)).toEqual({});
    const witnesses = (await signing) as string;
    expect(witnesses.slice(0, 4)).toBe("a100");
    // And sends it through the wallet, as the CLI's fund page does (index.js: signTx, then submitTx).
    const id = (await t.dapp.call(s, "submitTx", [`84${unsigned}${witnesses}f5f6`])) as string;
    expect(id).toBe(approval.summary.txHash);
    expect(t.koios.submitted).toHaveLength(1);

    // On chain: the site's output in the contract, and a payment Bob made to the same Seedelf, both after the history
    // began. Home reads again.
    const after = Math.floor(t.clock.now / 1000) + 120;
    const siteOut: KoiosUtxo = {
      ...ownedUtxos[0]!,
      tx_hash: id,
      tx_index: 0,
      value: PAID.toString(),
      asset_list: [],
      inline_datum: { bytes: ours, value: null },
      block_height: 9_000_002,
      block_time: after + 20,
    };
    const bob: KoiosUtxo = {
      ...ownedUtxos[0]!,
      tx_hash: "b0".repeat(32),
      tx_index: 0,
      value: "40000000",
      asset_list: [],
      inline_datum: { bytes: bobs, value: null },
      block_height: 9_000_001,
      block_time: after,
    };
    t.koios.added.push(bob, siteOut);
    t.clock.now += 3 * 60_000;
    await t.wallet.touch();
    await t.balances.get("preprod", true);
    const { seedelf: rows } = await t.coins.lists("preprod");
    const siteRow = rows.find((u) => u.txHash === id && u.index === 0);
    const bobRow = rows.find((u) => u.txHash === bob.tx_hash && u.index === 0);
    // Both are the wallet's: in the private balance.
    expect(siteRow).toBeDefined();
    expect(bobRow).toBeDefined();

    const classes = await t.activity.classes("preprod", [siteOut, bob]);
    const siteClass = classes.get(`${id}#0`);
    // Bob's is a payment received, as it should be.
    expect(classes.get(`${bob.tx_hash}#0`)).toEqual({ id: `received:${bob.tx_hash}`, origin: "received" });
    console.log(`[r51 gap-g1#2] the site's output ${id.slice(0, 16)}…#0 is classed ${JSON.stringify(siteClass)}`);
    console.log(`[r51 gap-g1#2] the UTxOs screen tags it ${JSON.stringify(siteRow?.history ? historyTags(siteRow.history) : undefined)}`);

    // A stealth mint from the private balance: the default when the public account is empty.
    const summary = await t.mint.build("preprod", "", "seedelf");
    const kept = (await t.session.get<{ txCbor: string }>(SESSION_MINT))!;
    const inputs = txInputs(Uint8Array.from(Buffer.from(kept.txCbor, "hex")));
    console.log(`[r51 gap-g1#2] the stealth mint spends ${JSON.stringify(inputs)}; its review's histories ${JSON.stringify(summary.histories)}`);

    // The site's output is money made private from public account 0, its transaction the account's in the open.
    expect.soft(siteClass, "the site's output keeps public account 0's history").toEqual(madePrivate(0));
    expect.soft(siteRow?.history && historyTags(siteRow.history), "the UTxOs screen tags it as made private").toEqual(["Made private"]);
    // So a stealth mint, which hides the payer only with money others paid, takes Bob's payment, which pays alone.
    expect.soft(inputs, "the stealth mint doesn't spend the public account's own output").not.toContain(`${id}#0`);
    expect.soft(inputs, "it spends Bob's payment").toEqual([`${bob.tx_hash}#0`]);
  });
});
```
