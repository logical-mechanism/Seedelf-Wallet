// What the screens say where a click or a file tells someone what's the
// user's: the private Activity's CSV (privacy review §2.21), and a link to
// Cardanoscan on the private side (§3.4), which opens in the browser's own
// profile and lands in its history.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { accountMatcher, describe as describeTxs, SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "../src/background/activity";
import { txInputs } from "../src/background/cbor";
import type { KoiosTxInfo } from "../src/background/koios";
import type { PendingTx, SessionView } from "../src/shared/rpc";
import { activityCsv, activityTitle } from "../src/ui/activity";
import { ExplorerLink } from "../src/ui/components/ExplorerLink";
import { PendingBanner, privateBanner, PRIVATE_KINDS } from "../src/ui/components/PendingBanner";
import { NetworkContext } from "../src/ui/network";
import { ExportNote } from "../src/ui/screens/Activity";
import { SiteSession } from "../src/ui/screens/SiteSessions";
import { activityPreprod, koiosPreprod, testBalances, vectors } from "./fakes";

/** What a person reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));

const WARNING = "Opening this tells Cardanoscan and your browser history that this transaction is yours.";
const HASH = "ab".repeat(32);

describe("the Activity CSV's note", () => {
  it("says, on the private side, what the file ties together for whoever has it", () => {
    const shown = text(markup(createElement(ExportNote, { of: "seedelf", listed: 3, more: false })));
    expect(shown).toContain("The file isn't encrypted.");
    expect(shown).toContain(
      "Whoever has it can tie your private payments, sessions and Lovejoin boxes to each other, to your public account",
    );
    expect(shown).toContain("and to the Seedelf each payment went to.");
  });

  it("says what the public side's Made private and Made public rows show, and what Load more adds", () => {
    const shown = text(markup(createElement(ExportNote, { of: "cardano", listed: 20, more: true })));
    expect(shown).toContain("It has the 20 transactions read so far: Load more first to include older ones.");
    expect(shown).toContain(
      "The file isn't encrypted. Its Made private and Made public rows show those payments went to or came from your private balance.",
    );
    expect(shown).not.toContain("Lovejoin");
  });

  // Chunk 51, e9a#4 (its trace verifier's test, carried on). On the device that made them, Public activity's file names
  // the user's own Make private and Make public from the sealed private history ("Made private", "Made public"), where
  // the chain alone reads a payment into the wallet contract ("Sent") and one out of it ("Received"): from outside, a
  // Make private looks the same as paying someone else's Seedelf. The note said "everything in it is on the chain
  // anyway". The names stay in the file, which is for accounting, where a self-transfer written as paying someone reads
  // wrong (the owner's call, B6 = (a)); the note says what those rows show instead. Whatever it says must hold of the
  // file: every row the file names unlike the chain is one the note names.
  it("names the rows the public side's file says more of than the chain, which keep their names (chunk 51, e9a#4)", async () => {
    // On a chain tip like preprod's, and the device's real clock (activity.test.ts's onPreprod).
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testBalances();
    t.koios.tip = 106_000_000;
    t.clock.now = Date.now();
    await t.wallet.create(v.phrase, "correct horse battery");
    await t.balances.get("preprod");
    const account = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const own = { bech32: account.addresses[0]!, cred: account.keys[0]! };
    const contract = { bech32: koiosPreprod.contract_utxos[0]!.address, cred: koiosPreprod.wallet_contract };
    const top = activityPreprod.account_txs[0]!;

    // Make private, 20 ₳, sent from this device: its submit notes it in the sealed private history.
    const moveIn = await t.moveIn.build("preprod", "20000000", []);
    await t.moveIn.submit("preprod", moveIn.txHash);
    // In a block: the account's coins in; the deposit at the wallet contract, the change back, the rewards collected.
    const inputs = txInputs(t.koios.submitted[0]!);
    const spent = koiosPreprod.accounts[activityPreprod.stake]!.account_utxos.filter((u) => inputs.includes(`${u.tx_hash}#${u.tx_index}`));
    expect(spent).toHaveLength(inputs.length);
    const madePrivate = {
      tx_hash: moveIn.txHash,
      block_height: top.block_height + 1,
      tx_timestamp: top.block_time + 60,
      fee: moveIn.fee,
      inputs: spent.map((u) => ({ payment_addr: { bech32: u.address, cred: u.payment_cred }, value: u.value, asset_list: u.asset_list ?? [] })),
      outputs: [
        { payment_addr: contract, value: "20000000", asset_list: [] },
        { payment_addr: own, value: moveIn.changeLovelace, asset_list: spent.flatMap((u) => u.asset_list ?? []) },
      ],
      withdrawals: moveIn.withdrawal ? [{ amount: moveIn.withdrawal, stake_addr: activityPreprod.stake }] : [],
    } as KoiosTxInfo;

    // Make public, 10 ₳ to the account's own address, noted as its submit notes it (pending.ts submitWatched →
    // ActivityService.sent, with WithdrawSummary's payments and fee).
    const withdrawHash = "cd".repeat(32);
    await t.activity.sent(
      "preprod",
      { kind: "withdraw", network: "preprod", txHash: withdrawHash, submittedAt: t.clock.now, confirmations: null },
      { payments: [{ address: own.bech32, lovelace: "10000000", tokens: [] }], fee: { total: "250000" } },
    );
    // On chain: a contract UTxO spent, 10 ₳ to the account, the change back into the contract.
    const madePublic = {
      tx_hash: withdrawHash,
      block_height: top.block_height + 2,
      tx_timestamp: top.block_time + 120,
      fee: "250000",
      inputs: [{ payment_addr: contract, value: "30000000", asset_list: [] }],
      outputs: [
        { payment_addr: own, value: "10000000", asset_list: [] },
        { payment_addr: contract, value: "19750000", asset_list: [] },
      ],
    } as KoiosTxInfo;

    // Koios lists both under the account's key, as credential_txs does.
    t.koios.credentialTxs.set(own.cred, [
      { tx_hash: withdrawHash, block_height: madePublic.block_height, block_time: madePublic.tx_timestamp },
      { tx_hash: moveIn.txHash, block_height: madePrivate.block_height, block_time: madePrivate.tx_timestamp },
    ]);
    t.koios.txRows.set(moveIn.txHash, madePrivate);
    t.koios.txRows.set(withdrawHash, madePublic);

    // Public activity on this device, and its Save as CSV: both in a block, so both in the file.
    const { entries, more } = await t.activity.cardano("preprod");
    expect(entries.filter((e) => (e.txHash === moveIn.txHash || e.txHash === withdrawHash) && !e.pending)).toHaveLength(2);
    const csv = activityCsv("preprod", entries);
    const note = text(markup(createElement(ExportNote, { of: "cardano", listed: entries.length, more })));
    /** A row's Type, the CSV's second column: none of these rows quotes a cell before it. */
    const typeIn = (txHash: string) => csv.split("\r\n").find((row) => row.endsWith(txHash))?.split(",")[1];

    // What the chain alone says of the same transactions: what any device without this one's records writes.
    const chain = describeTxs([madePrivate, madePublic], accountMatcher(account), new Map(), account.stake);
    expect(chain.map((e) => [activityTitle(e), e.detail])).toEqual([
      ["Sent", contract.bech32],
      ["Received", contract.bech32],
    ]);
    // The file keeps the device's names: it's for accounting, and a self-transfer reads as one.
    const fileSays = [typeIn(moveIn.txHash), typeIn(withdrawHash)];
    expect(fileSays).toEqual(["Made private", "Made public"]);
    // Every row named unlike the chain is one the note names, and the note no longer says the chain has it all.
    const beyond = fileSays.filter((title, i) => title !== activityTitle(chain[i]!));
    expect(beyond.filter((title) => !note.includes(title!)), `the note: "${note}"`).toEqual([]);
    expect(note).not.toContain("on the chain anyway");
  });
});

describe("a link to Cardanoscan", () => {
  const link = (props: Partial<Parameters<typeof ExplorerLink>[0]>) =>
    markup(createElement(ExplorerLink, { network: "preprod", tx: HASH, children: "View on Cardanoscan", ...props }));

  it("says, on the private side, what opening it tells, and describes the link with it", () => {
    const html = link({ private: true });
    expect(html).toContain(`href="https://preprod.cardanoscan.io/transaction/${HASH}"`);
    expect(html).toContain('rel="noreferrer"');
    expect(text(html)).toContain(WARNING);
    const described = html.match(/aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${described}"`);
  });

  it("stays plain on the public side", () => {
    const html = link({});
    expect(text(html)).toBe("View on Cardanoscan");
    expect(html).not.toContain("aria-describedby");
  });

  it("for a whole account, says so", () => {
    const html = link({ private: true, tx: undefined, address: "addr_test1xyz" });
    expect(html).toContain('href="https://preprod.cardanoscan.io/address/addr_test1xyz"');
    expect(text(html)).toContain("that this account is yours");
  });

  it("in a group, leaves the note to the group, and keeps it as the link's title", () => {
    const html = link({ private: true, note: false });
    expect(html).not.toContain("explorer-note");
    expect(html).toContain(`title="${WARNING.replaceAll("'", "&#x27;")}"`);
  });
});

describe("Home's banner for a sent transaction", () => {
  // What the public account signs carries its slot (account.ts validUntil); a Seedelf spend carries none.
  const IN_THE_OPEN = new Set<PendingTx["kind"]>(["move-in", "mint", "send", "collateral", "stake", "vote"]);
  const sent = (kind: PendingTx["kind"], slot = IN_THE_OPEN.has(kind)): PendingTx => ({
    kind,
    network: "preprod",
    txHash: HASH,
    submittedAt: 0,
    confirmations: 1,
    ...(slot ? { invalidHereafter: 90_000_000 } : {}),
  });
  const banner = (pending: PendingTx) =>
    text(markup(createElement(PendingBanner, { pending, watching: false, onDismiss: () => undefined })));

  it("warns on a private payment, a session's step and a Lovejoin box", () => {
    for (const kind of ["transfer", "withdraw", "remove", "session-out", "session-back", "lovejoin-withdraw", "lovejoin-mix"] as const) {
      expect(banner(sent(kind)), kind).toContain(WARNING);
    }
  });

  it("warns on a stealth mint, paid from the private balance: a mint of the same kind, with no slot", () => {
    // The very mint meant to hide who paid: its banner linked to Cardanoscan without the note, while its Activity
    // entry had it.
    const stealth = sent("mint", false);
    expect(privateBanner(stealth)).toBe(true);
    expect(banner(stealth)).toContain(WARNING);
    // On its way, and maybe sent, it says so too.
    expect(banner({ ...stealth, confirmations: null })).toContain(WARNING);
    expect(banner({ ...stealth, confirmations: null, maybeSent: true })).toContain(WARNING);
  });

  it("stays plain for what the public account signs in the open, an account-paid mint included", () => {
    for (const kind of IN_THE_OPEN) {
      expect(PRIVATE_KINDS.has(kind)).toBe(false);
      expect(privateBanner(sent(kind)), kind).toBe(false);
      expect(banner(sent(kind)), kind).not.toContain("tells Cardanoscan");
    }
  });
});

describe("a site's private session", () => {
  it("says what opening its account on Cardanoscan tells", () => {
    const session: SessionView = {
      index: 4,
      network: "preprod",
      address: "addr_test1" + "s".repeat(50),
      createdAt: 0,
      stage: "open",
      txs: [{ kind: "out", txHash: "ef".repeat(32), at: 0, confirmed: true }],
      holding: { lovelace: "0", tokens: [], utxos: 0 },
      site: { origin: "https://app.example" },
    };
    const seedelf = { lovelace: "0", tokens: [], utxos: 0, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
    const html = markup(
      createElement(SiteSession, {
        session,
        attached: true,
        seedelf,
        reading: false,
        onRefresh: () => undefined,
        onBack: () => undefined,
        onPending: () => undefined,
        onDisconnected: () => undefined,
      }),
    );
    expect(html).toContain(`href="https://preprod.cardanoscan.io/address/${session.address}"`);
    expect(text(html)).toContain("that this account is yours");
  });
});
