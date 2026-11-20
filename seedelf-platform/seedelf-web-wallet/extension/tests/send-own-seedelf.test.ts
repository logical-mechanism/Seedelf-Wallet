// The public Send and the user's own Seedelf (chunk 51, gap-g8#2; its trace verifier's test, moved here and carried
// on). Send refused the user's own Seedelf, alone or beside other recipients: send.ts threw "That Seedelf is yours…"
// before anything was built, and the To field said the same. Yet the builder pays it as a move-in is paid: an output
// at the wallet contract under a fresh re-randomization of a register the user's own Seedelf key spends. Paying a
// script address runs no script, so the ledger takes it, and the way round (a Send to the others, then Make private)
// cost a second fee.
//
// The refusal did one real job. A public Send writes nothing in the Seedelf history, and the scan notes an owned UTxO
// from a transaction the history doesn't have as money received, which the stealth mint and the fundings take first:
// gap-g1#2's link, made by default. So Send pays it now, says so on the To field and the review, and its submit notes
// what went in as made private from the account that paid, as Make private's does. Public activity reads the Send
// itself from the chain: a payment, whoever else it paid.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountAddresses } from "../src/background/activity";
import type { KoiosTxInfo, KoiosUtxo } from "../src/background/koios";
import type { PaymentAsk, SendSummary, TxDetail } from "../src/shared/rpc";

const seam = vi.hoisted(() => {
  /** Whether a useState's initial value is `want`: an empty object for `{}`, or the same value. */
  const matches = (initial: unknown, want: unknown) =>
    want && typeof want === "object" && !Object.keys(want).length
      ? !!initial && typeof initial === "object" && !Array.isArray(initial) && !Object.keys(initial).length
      : Object.is(initial, want);
  const state = {
    /** A seed lands on a state that starts empty, or one that starts as `initial` where it says one. */
    seeds: [] as Array<{ after: unknown[]; initial?: unknown; value: unknown; used?: true }>,
    initials: [] as unknown[],
    /** What useState starts with: `initial`, or the seed whose run of initial values precedes this call. */
    seeded(initial: unknown): unknown {
      const before = state.initials;
      state.initials = [...before, initial];
      for (const seed of state.seeds) {
        if (seed.used || before.length < seed.after.length) continue;
        if ("initial" in seed ? !matches(initial, seed.initial) : initial !== undefined) continue;
        const run = before.slice(before.length - seed.after.length);
        if (!seed.after.every((want, i) => matches(run[i], want))) continue;
        seed.used = true;
        return seed.value;
      }
      return initial;
    },
    reset() {
      state.seeds = [];
      state.initials = [];
    },
  };
  return state;
});

// The screens are rendered over the house's useState seed (stake-elsewhere-screens.test.ts's seam): a form's reads and
// a review's state are ones only an awaited answer reaches. Nothing else here renders React.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial?: unknown) => react.useState(seam.seeded(initial)) };
});
// Nothing a screen shows is asked of the worker while it renders: any request stays unanswered.
vi.mock("../src/ui/background", async (original) => {
  const pending = { then: () => pending, catch: () => pending, finally: () => pending };
  return { ...(await original<typeof import("../src/ui/background")>()), call: () => pending };
});

const { SESSION_ACCOUNT_ADDRESSES_PREFIX } = await import("../src/background/activity");
const { registerOf } = await import("../src/background/chain");
const { txInputs } = await import("../src/background/cbor");
const { readContractView } = await import("../src/background/contract-scan");
const { SESSION_SEND } = await import("../src/background/send");
const { outpoint } = await import("../src/background/spent");
const { holdsOwn } = await import("../src/background/transfer");
const { madePrivate } = await import("../src/shared/histories");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { AccountsContext } = await import("../src/ui/accounts");
const { activityTitle } = await import("../src/ui/activity");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { CardanoSend } = await import("../src/ui/screens/CardanoSend");
const { activityPreprod, koiosPreprod, ownedUtxos, testBalances, transferPreprod, vectors } = await import("./fakes");

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: a friend's. */
const FRIEND = account(15).preprod.receive_0 as string;
/** The 12-word phrase's own Seedelf, "web-wallet" (owned-utxos.json). */
const MINE = ownedUtxos[2]!.asset_list![0]!.asset_name;
const toFriend: PaymentAsk = { to: FRIEND, lovelace: "10000000", tokens: [] };
const toMine: PaymentAsk = { to: MINE, lovelace: "50000000", tokens: [] };

/** A wallet on the 12-word phrase, on a chain tip like preprod's and the device's real clock, by which a send is kept. */
async function onPreprod() {
  const t = testBalances();
  t.koios.tip = 106_000_000;
  t.clock.now = Date.now();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

describe("the public Send and the user's own Seedelf (chunk 51, gap-g8#2)", () => {
  it("pays the user's own Seedelf from the public account, beside a friend or alone, and marks it the user's", async () => {
    const t = await onPreprod();
    const { wasm } = t.deps;
    // Send's own lookup: the contract view it reads, where this Seedelf is the wallet's own.
    const view = await readContractView(t.send["deps"], "preprod");
    const recipient = view.seedelfs[MINE]!;
    expect(holdsOwn(view, recipient)).toBe(true);
    const held = registerOf(recipient)!;

    // What a built transaction pays: the friend, and each output at the wallet contract, with whether the user's own
    // Seedelf key spends its register and whether that register is a fresh one (not the Seedelf UTxO's own copied).
    const paid = async (txCbor: string) => {
      const tx = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, txCbor)) as TxDetail;
      const friend = tx.outputs.filter((o) => o.address.bech32 === FRIEND).map((o) => o.lovelace);
      const into = tx.outputs.filter((o) => o.address.seedelf);
      const contract = await t.wallet.withKeys((keys) =>
        into.map((o) => {
          const r = new wasm.Register(o.register!.generator, o.register!.publicValue);
          try {
            return {
              lovelace: o.lovelace,
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
    const intoMine = [{ lovelace: "50000000", ours: true, fresh: true }];
    const kept = async () => (await t.session.get<{ txCbor: string; origin?: unknown }>(SESSION_SEND))!;

    // Alone, and beside the friend: each the payment asked, the user's own marked so the review can say it.
    const alone = await t.send.build("preprod", [toMine]);
    expect(alone.payments).toMatchObject([{ seedelf: { name: MINE, label: "web-wallet", own: true }, own: false, lovelace: "50000000" }]);
    expect(await paid((await kept()).txCbor)).toEqual({ friend: [], contract: intoMine });
    const both = await t.send.build("preprod", [toFriend, toMine]);
    expect(both.payments).toMatchObject([
      { address: FRIEND, own: false, lovelace: "10000000" },
      { seedelf: { name: MINE, label: "web-wallet", own: true }, own: false, lovelace: "50000000" },
    ]);
    expect(both.payments[0]).not.toHaveProperty("seedelf");
    expect(await paid((await kept()).txCbor)).toEqual({ friend: ["10000000"], contract: intoMine });
    // Kept with it, for its submit to write: money made private from the account that pays, account 1 (index 0).
    expect((await kept()).origin).toEqual(madePrivate(0));

    // Someone else's Seedelf is no own one, and leaves nothing in the private balance to keep a history for.
    const theirs = await t.send.build("preprod", [{ to: transferPreprod.to, lovelace: "5000000", tokens: [] }]);
    expect(theirs.payments[0]!.seedelf).toEqual({ name: transferPreprod.to, label: "This is a test." });
    expect(await kept()).not.toHaveProperty("origin");
  });

  it("notes what it paid into the user's own Seedelf as made private, so it's never read as received when it lands", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [toFriend, toMine]);
    const { txCbor } = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!;
    await t.send.submit("preprod", summary.txHash);

    // In the Seedelf history at once: what went into the private balance, made private from account 1 (index 0), as
    // Make private's own entry is; the friend's 10 ₳ isn't the private balance's.
    const written = (await t.activity.seedelf("preprod")).filter((e) => e.txHash === summary.txHash);
    expect(written).toEqual([
      expect.objectContaining({
        kind: "move-in",
        direction: "in",
        lovelace: "50000000",
        tokens: 0,
        fee: summary.fee,
        origin: madePrivate(0),
        bySend: true,
      }),
    ]);
    expect(activityTitle(written[0]!)).toBe("Made private");

    // It lands: the scan finds the output under the user's register. The history has it already, so no arrival is
    // noted, and its class is the account's money made private, never money someone paid.
    const { wasm } = t.deps;
    const tx = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, txCbor)) as TxDetail;
    const out = tx.outputs.find((o) => o.address.seedelf)!;
    const landed: KoiosUtxo = {
      ...ownedUtxos[0]!,
      tx_hash: summary.txHash,
      tx_index: out.index,
      address: out.address.bech32,
      value: out.lovelace,
      inline_datum: { bytes: out.inlineDatum!, value: null },
      asset_list: [],
      block_height: 5_300_000,
    };
    t.koios.added.push(landed);
    t.clock.now += 60_000;
    const read = await t.balances.get("preprod", true);
    expect(BigInt(read.seedelf.lovelace)).toBeGreaterThanOrEqual(50_000_000n);
    const after = (await t.activity.seedelf("preprod")).filter((e) => e.txHash === summary.txHash);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ kind: "move-in", origin: madePrivate(0) });
    const classes = await t.activity.classes("preprod", [landed]);
    expect(classes.get(outpoint(landed))).toEqual(madePrivate(0));
  });

  it("names the account that built it as the one the money came from, whichever is on screen by Send", async () => {
    const t = await onPreprod();
    const summary = await t.send.build("preprod", [toMine]);
    // Another window switches to account 2 (index 1) before Send is pressed: the Send still spends account 1's coins.
    const stake = await t.wallet.withAccount(1, ({ cardano }) => cardano.stakeAddress(t.deps.wasm.Network.Preprod));
    t.koios.usedStakes.add(stake);
    await t.accounts.recordFirst();
    await t.accounts.discover("preprod");
    expect(await t.accounts.use(1, ["preprod"])).toBe(1);
    await t.send.submit("preprod", summary.txHash);
    const written = (await t.activity.seedelf("preprod")).find((e) => e.txHash === summary.txHash);
    expect(written).toMatchObject({ kind: "move-in", origin: madePrivate(0), bySend: true });
  });

  it("is listed in Public activity as the chain reads it, a payment, on its way and in a block", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [toFriend, toMine]);
    await t.send.submit("preprod", summary.txHash);

    // On its way: what the device keeps says it's the account's payment, never "Made private" from the private history.
    const pending = (await t.activity.cardano("preprod")).entries.find((e) => e.txHash === summary.txHash);
    expect(pending).toMatchObject({ pending: true, kind: "sent", direction: "out", lovelace: "60000000" });

    // In a block: the account's coins in; the friend, the user's own Seedelf at the contract and the change out.
    const accountOf = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const inputs = txInputs(t.koios.submitted[0]!);
    const spent = koiosPreprod.accounts[activityPreprod.stake]!.account_utxos.filter((u) => inputs.includes(`${u.tx_hash}#${u.tx_index}`));
    expect(spent).toHaveLength(inputs.length);
    const contract = { bech32: koiosPreprod.contract_utxos[0]!.address, cred: koiosPreprod.wallet_contract };
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: summary.txHash, block_height: top.block_height + 1, block_time: top.block_time + 60 };
    t.koios.credentialTxs.set(accountOf.keys[0]!, [row]);
    // Where each sits, as tx_info writes it: `cred` is its payment key or script hash.
    const friend = { bech32: FRIEND, cred: "44".repeat(28) };
    const change = { bech32: accountOf.addresses[0]!, cred: accountOf.keys[0]! };
    t.koios.txRows.set(summary.txHash, {
      tx_hash: summary.txHash,
      block_height: row.block_height,
      tx_timestamp: row.block_time,
      fee: summary.fee,
      inputs: spent.map((u) => ({ payment_addr: { bech32: u.address, cred: u.payment_cred }, value: u.value, asset_list: u.asset_list ?? [] })),
      outputs: [
        { payment_addr: friend, value: "10000000", asset_list: [] },
        { payment_addr: contract, value: "50000000", asset_list: [] },
        { payment_addr: change, value: summary.changeLovelace, asset_list: spent.flatMap((u) => u.asset_list ?? []) },
      ],
      withdrawals: summary.withdrawal ? [{ amount: summary.withdrawal, stake_addr: activityPreprod.stake }] : [],
    } as KoiosTxInfo);
    const listed = (await t.activity.cardano("preprod")).entries.filter((e) => e.txHash === summary.txHash);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: "sent", direction: "out", lovelace: "60000000", fee: summary.fee, detail: FRIEND, more: 1 });
    expect(listed[0]!.pending).toBeUndefined();
    expect(activityTitle(listed[0]!)).toBe("Sent");
  });
});

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
const noop = () => undefined;
const none = { lovelace: "0", tokens: [], utxos: 0 };
const cardano = {
  lovelace: "100000000",
  tokens: [],
  utxos: 3,
  addressesUsed: 1,
  locked: none,
  staking: { registered: true, pool: null, drep: null, rewards: "0", deposit: "2000000" },
};

/** `element` on preprod, in a wallet of one account, account 0 on screen. */
function render(element: ReactElement): string {
  const accounts = { accounts: [{ index: 0 }], active: 0, loaded: true, name: "Account 1", several: false, reload: async () => undefined };
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(AccountsContext.Provider, { value: accounts }, element),
      ),
    ),
  );
}

const SHOWN = { name: MINE, label: "web-wallet", own: true as const };
const ownLine = "This Seedelf is yours: the payment goes into your private balance.";

beforeEach(() => seam.reset());

describe("Send's form and review for the user's own Seedelf (chunk 51, gap-g8#2)", () => {
  it("says on the To field that it goes into the private balance, and lets it be reviewed", () => {
    // The To field has read the user's own Seedelf: its first recipient's read, as the field reports it.
    seam.seeds.push({ after: [], initial: {}, value: { 0: { to: MINE, read: { state: "seedelf", seedelf: SHOWN } } } });
    const html = render(createElement(CardanoSend, { cardano, total: cardano.lovelace, to: MINE, amount: "50", onCancel: noop, onSent: noop }));
    const read = words(html);
    expect(read).toContain("Found: web-wallet");
    expect(read).toContain(ownLine);
    expect(html).toContain('data-testid="send-own-seedelf"');
    expect(read).not.toContain("That Seedelf is yours. To put money into your private balance, use Make private.");
    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/<button type="submit" class="primary">/);
  });

  it("says on the review which payment goes into the private balance, by its number with several", () => {
    const review = (payments: SendSummary["payments"]) => {
      seam.reset();
      // Its state starts after the form's reads', its Max's, its note's and the note's cut's.
      seam.seeds.push({
        after: [{}, false, "", false],
        value: {
          network: "preprod",
          txHash: "ab".repeat(32),
          max: false,
          fee: "190000",
          changeLovelace: "39810000",
          changeTokens: 0,
          inputs: 2,
          payments,
        } satisfies SendSummary,
      });
      return render(createElement(CardanoSend, { cardano, total: cardano.lovelace, onCancel: noop, onSent: noop }));
    };
    const contract = koiosPreprod.contract_utxos[0]!.address;
    const own = { address: contract, own: false, seedelf: SHOWN, lovelace: "50000000", minimum: null, tokens: [] };
    const friend = { address: FRIEND, own: false, lovelace: "10000000", minimum: null, tokens: [] };

    const alone = words(review([own]));
    expect(alone).toContain(ownLine);
    // It leaves the public account, fee and all: the total says so.
    expect(alone).toContain("Total leaving your public account");

    const both = review([friend, own]);
    expect(words(both)).toContain("Recipient 2's Seedelf is yours: that payment goes into your private balance.");
    expect(words(both)).not.toContain(ownLine);
    expect(both.match(/data-testid="send-own-seedelf"/g)).toHaveLength(1);
  });
});
