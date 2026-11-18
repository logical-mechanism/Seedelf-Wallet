# gap-g8#2: verification

From lane gap-G8, graded low by its finder.

## Trace: confirmed, low

The finding holds, and I couldn't refute it. The public Send refuses the user's own Seedelf in two places: in the worker (send.ts:179) and on the To field (Destination.tsx:72). Only CardanoSend passes `seedelfs`; Transfer has its own lookup. While a row reads as an error, Review stays off. This happens whether the own Seedelf is the only recipient or one of several.

Nothing below those two lines refuses it:
- WebAssembly's SendTo::read and recipient_register check only that the UTxO is the contract's, holds that token and carries a register.
- Core's account_send_many checks only is_payable.
- Payee::Seedelf is the same payee a move-in uses.
- Paying a script address runs no script, so the ledger takes it.

My test shows it on TREE:
- Send's own `pay`, given the destinations `build` makes, builds a payment of 10 ₳ to a friend and 50 ₳ to the user's own Seedelf. The 50 ₳ goes under a fresh, payable register that the user's own key spends.
- Send.build refuses both cases ("That Seedelf is yours…").
- In a copy with line 179 removed, the same test passes.

What it costs:
- A payment to others plus the user's own Seedelf has to be split into a Send and a Make private. In the recorded case that is 0.165633 ₳ more in fees.
- The finder's "two sends close in time" makes no new link. Both transactions are paid from the same public account, which already ties them.
- A payment to the own Seedelf alone is pointed at Make private, which does the same thing at the same cost. So that case loses nothing.

It isn't known:
- Not in the backlog, and not in any review's Not fixed, Left open or For the owner list.
- The refusal is chunk 14's own design, from 2026-09-24, before the owner's 2026-10-19 rule.
- Chunk 9's owner call allowed paying one's own Seedelf from the private side.
- The backlog's Declined list holds the sibling: "Refusing a payment between your own public accounts" (the owner, 2026-10-02).
- E5 raised it only as a note for the owner, and the critic listed it as unswept.

Grade: low. Only the user reaches it, through an ordinary multi-recipient Send. It costs about 0.17 ₳ for each such payment, and the user sees it happen. The message names the way out (Make private).

For the owner: the refusal is doing real work today. A public Send writes no Seedelf history, and activity.ts `arrived()` notes any owned UTxO from an unrecorded transaction as "received". Lifting the refusal alone would therefore class public-account money as received. That is gap-g1#2's privacy mechanism, a link made by default. The history record must ship with the change.

**Evidence:**

The trace, every cited line opened in TREE (e4c013e8; `git diff web-wallet/1.9.1 HEAD` touches only manifest.ts and READMEs in the code folders):

1. Input enters on the UI side.
   - CardanoSend.tsx:286-294 is the only DestinationInput with `seedelfs`. Withdraw.tsx:309 has none, and Transfer.tsx:444 calls seedelf-lookup itself.
   - Destination.tsx:61 reads a whole name, and :71-72 calls `seedelf-lookup`. That reaches handlers.ts:217 and TransferService.lookup (transfer.ts:71-77), which returns `own: holdsOwn(view, utxo)`.
   - Then `s.own ? { state: "error", message: OWN_SEEDELF_FROM_ACCOUNT() } : …`.
   - CardanoSend.tsx:97 sets `found` only when every read is "read" or "seedelf", and :111 sets `ready = found && …`, so Review stays off.

2. The worker refuses the same.
   - send.ts:66-75 sends any seedelf name through `seedelf()`.
   - send.ts:177-179: `const recipient = seedelfUtxo(view, name, network); if (holdsOwn(view, recipient)) throw new Error(OWN_SEEDELF_FROM_ACCOUNT());`
   - holdsOwn (transfer.ts:181-183) is `view.owned.some(outpoint match)`.
   - en.json shared.seedelf.warn.ownFromAccount = "That Seedelf is yours. To put money into your private balance, use Make private."
   - Since: blame gives c3bc3930 (chunk 14, 2026-09-24). Line 179 was last touched by 0d8ef10e on 2026-10-02, which only turned the constant into a call. It is in web-wallet/1.6.0 and every later tag; 1.0.0 to 1.5.0 aren't tagged.

3. Nothing below refuses it.
   - wasm lib.rs:1640-1656 SendTo::read calls recipient_register.
   - lib.rs:2995-3016 recipient_register checks the name, `payment_cred == wallet_contract_hash`, that the UTxO holds the token, and that the datum is a register. It has no ownership rule, and buildAccountSend has only `keys.cardano`.
   - core build.rs:785-791 account_send_many runs `Payee::Seedelf { owner, .. } => check_register(owner)?`, which is is_payable only.
   - build.rs:597-640: Payee::Seedelf's outputs are deposit_outputs under fresh re-randomizations, the same payee move_in uses (build.rs:723).

4. The design record.
   - chunk-14-style-flow-2.md:30: "Your own Seedelf is refused, pointing to Move in, which does the same thing (and a payment to yourself would show as "received" in the Seedelf history)".
   - chunk-09-transfer.md:53/:60, the owner on 2026-09-24: "Paying your own Seedelf | Allowed, with a warning (the plan suggested refusing)". That is the private side.
   - flows.md:231 documents the refusal.
   - send.test.ts:188-195 pins it.

5. Why the stated reason matters.
   - Send writes no Seedelf history (send.test.ts "…writes no Seedelf history").
   - activity.ts:427-445 `arrived()` turns every owned contract UTxO from a transaction not in the history into a `kind: "received"` entry.
   - classOf (activity.ts:657) maps that entry to receivedIn(tx).
   - Make private writes `origin: madePrivate(keys.account)` (move-in.ts:124).

6. Commands run.
   - The test below, from extension/: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-2.test.ts`. It fails on TREE, and step 1 passes; output under test_result.
   - The mutant was a copy at $HOME/.cache/seedelf-review-51/verify-gap-g8_2-trace/ (rsync without target/node_modules/dist, node_modules symlinked), with line 179 replaced by a no-op. The same test passes there. I removed the copy afterwards.
   - Logs are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-gap-g8_2-trace/run1.txt, run2-mutant.txt and run3-mutant-verbose.txt.

7. Searched for "own seedelf", "your own Seedelf", ownFromAccount, OWN_SEEDELF, "Seedelf is yours", "pointing to Move in", toSelf/to_self and "payment to yourself":
   - docs/backlog.md: only the Declined sibling at :211.
   - docs/archive/plans/*.md: chunk-09 :53/:60/:95/:130, chunk-14 :30. Chunk-34's runs to "A's own Seedelf" are private Sends signed by giveme.my. Chunk-26b :171 is Remove.
   - docs/plans/*.md: nothing.
   - review-51: E5.md:74 lists it as a guard, E5.md:113 as a note for the owner, critic.md:118 as unswept, X1a.md:99 as checked.
   - SECURITY.md's out-of-scope list: nothing relevant.

**Known:** None: this isn't settled. Nearby records, none of which settles it:
- chunk-14-style-flow-2.md:30, the rule itself: Claude's design from 2026-09-24, before the owner's 2026-10-19 rule.
- chunk-09-transfer.md:60, the owner's opposite call for the private Send: allowed, with a warning.
- backlog.md:211, Declined: "Refusing a payment between your own public accounts" (the owner, 2026-10-02), the sibling refusal the owner turned down.
- review-51 E5.md:113 (a note for the owner, not a finding) and critic.md:118 (listed as unswept).
- It isn't in any archived review's Not fixed, Left open, Disputed or For the owner list, nor in SECURITY.md's out-of-scope list.

**Fix notes:**

The owner decides. Lifting it changes what Send accepts, against chunk 14's built rule, though the 2026-10-19 rule and the chunk 9 and chunk 18 calls all point to allowing it and saying so.

- **The refusal lives in two places only:**
  - send.ts:179, in `seedelf()`;
  - Destination.tsx:72, on the To field. Only CardanoSend passes `seedelfs`.
  - Transfer already allows the user's own Seedelf, marking it to_self.
- **The history record must ship in the same change.** A public Send writes no Seedelf history, and activity.ts:427-445 `arrived()` notes any owned UTxO from an unrecorded transaction as "received". My mutant removed only line 179. That build pays correctly, but its outputs would be classed received, and the stealth mint and fundings would take that money first as money others paid. That is gap-g1#2's mechanism: a privacy link made by default, which today's refusal prevents.
  - So record the Seedelf outputs of such a Send as made private from the paying account, `madePrivate(account)`, as move-in.ts:124 does.
  - Better still, carry the class on the kept summary so submit writes the entry, as Make private's does.
- **Say it on screen:** show the row as the user's own (as Transfer's toSelf does), and say on the review that it comes back into the private balance, as Make private says.
- **Change the pin** in send.test.ts:188-195, "points your own Seedelf to Move in". Keep the second half, Withdraw's words for a Seedelf.
- The test above covers the worker side. A fix should also show, by test, the history class of the own-Seedelf outputs, and an e2e or screen test that the To field no longer says "That Seedelf is yours."

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g8-2.test.ts`

Result: On TREE it FAILS, as intended. Step 1 passes: through Send's own `pay`, the builder pays the friend 10 ₳ and the user's own Seedelf 50 ₳ under a fresh, payable register the user's key owns. Then Send.build refuses both cases.

```
 RUN  v5.0.3 …/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension
[r51 gap-g8#2] one payment's fee 0.187237 ₳; the way round: Send 0.174609 ₳ + Make private 0.178261 ₳, 0.165633 ₳ more
[r51 gap-g8#2] Send to the user's own Seedelf alone: "refused: That Seedelf is yours. To put money into your private balance, use Make private."
[r51 gap-g8#2] Send to a friend and the user's own Seedelf: "refused: That Seedelf is yours. To put money into your private balance, use Make private."
 ❯ tests/r51-gap-g8-2.test.ts (1 test | 1 failed) 1014ms
     × pays the user's own Seedelf from the public account, beside a friend or alone, as the builder already does 1012ms
 FAIL … AssertionError: the user's own Seedelf alone: expected 'refused: That Seedelf is yours. To pu…' to deeply equal [ { …(2) } ]
 ❯ tests/r51-gap-g8-2.test.ts:103:56
 FAIL … AssertionError: a friend and the user's own Seedelf, in one payment: expected 'refused: That Seedelf is yours. To pu…' to deeply equal [ { …(2) }, { …(2) } ]
 ❯ tests/r51-gap-g8-2.test.ts:106:73
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

In a copy with line 179's refusal replaced by a no-op, the same file PASSES, including the last check that the kept transaction pays the friend and a fresh register of the user's:

```
[r51 gap-g8#2] Send to the user's own Seedelf alone: [{"to":"5eed0e1f7765622d77616c6c657400ababababababababababababababababab","lovelace":"50000000"}]
[r51 gap-g8#2] Send to a friend and the user's own Seedelf: [{"to":"addr_test1qzusjxwp8efe5hrwv47exayz69hl6hmceq08m4qy7zsh4ursn8tuec5rn73hspp8jhpz778rzqc20wksf8guk3z23asqwgfs5k","lovelace":"10000000"},{"to":"5eed0e1f7765622d77616c6c657400ababababababababababababababababab","lovelace":"50000000"}]
 ✓ … pays the user's own Seedelf from the public account, beside a friend or alone, as the builder already does 1175ms
 Test Files  1 passed (1)
```

The copy is removed. Full logs: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-gap-g8_2-trace/run1.txt (TREE), run2-mutant.txt and run3-mutant-verbose.txt (the copy).

```
// Chunk 51, finding gap-g8#2 (its trace verifier's test). The public Send refuses the user's own Seedelf, alone or
// beside another recipient: send.ts:179 throws OWN_SEEDELF_FROM_ACCOUNT before anything is built, and the To field
// says the same (Destination.tsx:72). Yet WebAssembly's buildAccountSend and core's account_send_many build exactly
// that payment, as a move-in is built: an output at the wallet contract under a fresh re-randomization of a register
// the user's own Seedelf key spends. Paying a script address runs no script, so the ledger takes it.
//
// Step 1 shows the builder takes it, through Send's own `pay` (what `build` runs once each destination is read), and
// what the way round costs: a Send to the friend and a Make private, two fees. Step 2 asks Send itself, which refuses
// today, so this fails on TREE and passes once the refusal is lifted.
import { describe, expect, it } from "vitest";

import { registerOf, seedelfLabel } from "../src/background/chain";
import { readContractView } from "../src/background/contract-scan";
import { destinationResolver } from "../src/background/destination";
import { SESSION_SEND } from "../src/background/send";
import { holdsOwn } from "../src/background/transfer";
import type { PaymentAsk, SendSummary } from "../src/shared/rpc";
import { ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: a friend's. */
const FRIEND = account(15).preprod.receive_0 as string;
/** The 12-word phrase's own Seedelf, "web-wallet" (owned-utxos.json). */
const MINE = ownedUtxos[2]!.asset_list![0]!.asset_name;

interface DecodedOutput {
  address: { bech32: string; seedelf: boolean };
  lovelace: string;
  register?: { generator: string; publicValue: string; payable: boolean };
}

const ada = (lovelace: string | bigint) => (Number(lovelace) / 1e6).toFixed(6);

describe("the public Send and the user's own Seedelf (chunk 51, gap-g8#2)", () => {
  it("pays the user's own Seedelf from the public account, beside a friend or alone, as the builder already does", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const { wasm } = t.deps;
    const deps = t.send["deps"];
    const toFriend: PaymentAsk = { to: FRIEND, lovelace: "10000000", tokens: [] };
    const toMine: PaymentAsk = { to: MINE, lovelace: "50000000", tokens: [] };

    // Send's own lookup: the contract view it reads, where this Seedelf is the wallet's own.
    const view = await readContractView(deps, "preprod");
    const recipient = view.seedelfs[MINE]!;
    expect(holdsOwn(view, recipient)).toBe(true);
    const held = registerOf(recipient)!;

    // What a built transaction pays: the friend, and each output at the wallet contract, with whether the user's own
    // Seedelf key spends its register and whether that register is a fresh one (not the Seedelf UTxO's own copied).
    const paid = async (txCbor: string) => {
      const tx = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, txCbor)) as { outputs: DecodedOutput[] };
      const friend = tx.outputs.filter((o) => o.address.bech32 === FRIEND).map((o) => o.lovelace);
      const into = tx.outputs.filter((o) => o.address.seedelf);
      const contract = await t.wallet.withKeys((keys) =>
        into.map((o) => {
          const r = new wasm.Register(o.register!.generator, o.register!.publicValue);
          try {
            return {
              lovelace: o.lovelace,
              payable: o.register!.payable,
              ours: keys.seedelf.isOwned(r),
              fresh: o.register!.generator !== held.generator && o.register!.publicValue !== held.publicValue,
            };
          } finally {
            r.free();
          }
        }),
      );
      return { friend, contract };
    };
    const intoMine = [{ lovelace: "50000000", payable: true, ours: true, fresh: true }];

    // 1. The builder takes it: Send's `pay` with the destinations `build` reads, the own Seedelf as `seedelf()` makes
    //    it but for the refusal on send.ts:179.
    const friend = await destinationResolver(deps, "preprod")(FRIEND);
    const own = { address: recipient.address, own: false, seedelf: { name: MINE, label: seedelfLabel(MINE) }, recipient };
    const built = (await t.send["pay"]("preprod", [friend, own], [toFriend, toMine], SESSION_SEND)) as SendSummary;
    const builtTx = (await t.session.get<{ txCbor: string; txHash: string }>(SESSION_SEND))!;
    expect(builtTx.txHash).toBe(built.txHash);
    expect(await paid(builtTx.txCbor)).toEqual({ friend: ["10000000"], contract: intoMine });

    // The way round Send's words point to: the friend alone, then Make private. Two fees for one.
    const friendOnly = await t.send.build("preprod", [toFriend]);
    const madePrivate = await t.moveIn.build("preprod", "50000000", []);
    const extra = BigInt(friendOnly.fee) + BigInt(madePrivate.fee) - BigInt(built.fee);
    console.log(
      `[r51 gap-g8#2] one payment's fee ${ada(built.fee)} ₳; the way round: Send ${ada(friendOnly.fee)} ₳ + Make private ` +
        `${ada(madePrivate.fee)} ₳, ${ada(extra)} ₳ more`,
    );
    expect(extra).toBeGreaterThan(0n);

    // 2. Send itself, which refuses both before anything is built: the user's own Seedelf alone, and beside the friend.
    const outcome = (p: Promise<SendSummary>) =>
      p.then(
        (s) => s.payments.map((x) => ({ to: x.seedelf?.name ?? x.address, lovelace: x.lovelace })),
        (e: Error) => `refused: ${e.message}`,
      );
    const alone = await outcome(t.send.build("preprod", [toMine]));
    console.log(`[r51 gap-g8#2] Send to the user's own Seedelf alone: ${JSON.stringify(alone)}`);
    expect.soft(alone, "the user's own Seedelf alone").toEqual([{ to: MINE, lovelace: "50000000" }]);
    const both = await outcome(t.send.build("preprod", [toFriend, toMine]));
    console.log(`[r51 gap-g8#2] Send to a friend and the user's own Seedelf: ${JSON.stringify(both)}`);
    expect(both, "a friend and the user's own Seedelf, in one payment").toEqual([
      { to: FRIEND, lovelace: "10000000" },
      { to: MINE, lovelace: "50000000" },
    ]);
    // Once it builds, it pays as the builder does: the friend, and the user's own Seedelf under a fresh register of theirs.
    const kept = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!;
    expect(await paid(kept.txCbor)).toEqual({ friend: ["10000000"], contract: intoMine });
  });
});
```
