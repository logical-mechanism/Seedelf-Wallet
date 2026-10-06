// What a site hears is English, whatever language the wallet is in (the
// release review): CIP-30's `info` is for the dApp's developer, and in the
// user's language it told any https page, connected or not, which one the
// wallet is set to, against the switch's note that a site learns nothing more
// until it's connected. bridge.ts's own words were English already. The
// connector's window still says the same in the user's language.
import { afterEach, describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { SESSION_SEND } from "../src/background/send";
import { i18n } from "../src/i18n/core";
import type { I18nKey } from "../src/i18n/translations";
import { APIError, TxSendError, TxSignError } from "../src/shared/dapp";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const OWN = account(12).preprod.receive_0 as string;
const THEIRS = account(15).preprod.receive_0 as string;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `english${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** `key` in English, and checked to read otherwise in Japanese, so a test of it means something. */
function english(key: I18nKey, values: Record<string, unknown> = {}): string {
  const words = i18n.t(key as never, { ...values, lng: "en" }) as unknown as string;
  expect(i18n.t(key as never, { ...values, lng: "ja" })).not.toBe(words);
  return words;
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

/** The 12-word account with a pure 5 ₳ UTxO, the connector on, and the wallet in Japanese. */
async function on() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  t.koios.addedToAccounts.push({ ...template, tx_hash: "c0".repeat(32), tx_index: 0, value: "5000000", asset_list: [], block_height: 1 });
  await i18n.changeLanguage("ja");
  return t;
}

async function connected(t: Awaited<ReturnType<typeof on>>, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

/** A site's transaction spending `inputs` and paying someone else 4 ₳. Nothing balances it: the wallet only reads it. */
function siteTx(inputs: string[]) {
  return `84a300${outpoints(inputs)}0181825839${loadTestWasm().cip30Address(THEIRS)}1a003d0900021a00029810a0f5f6`;
}

const refusal = (code: number, info: string) => ({ failure: { code, info } });

describe("a site's refusals, with the wallet in Japanese", () => {
  it("are English for a site that isn't connected, locked or not, and with the connector off", async () => {
    const t = await on();
    const stranger = site("https://stranger.example");
    await expect(t.dapp.call(stranger, "getBalance", [])).rejects.toMatchObject(refusal(APIError.Refused, english("dapp.notConnected")));
    await t.wallet.lock();
    await expect(t.dapp.call(stranger, "getUtxos", [])).rejects.toMatchObject(refusal(APIError.Refused, english("dapp.notConnected")));
    await t.preferences.set({ dappConnector: false });
    await expect(t.dapp.call(stranger, "getBalance", [])).rejects.toMatchObject(refusal(APIError.Refused, english("dapp.connectorOff")));
  });

  it("are English for a connected site's own mistakes, and for a send the network refused", async () => {
    const t = await on();
    const s = await connected(t);
    await expect(t.dapp.call(s, "getUtxos", [undefined, { page: -1, limit: 2 }])).rejects.toMatchObject(
      refusal(APIError.InvalidRequest, english("dapp.paginate")),
    );
    await expect(t.dapp.call(s, "signTx", ["not hex", false])).rejects.toMatchObject(refusal(APIError.InvalidRequest, english("dapp.txNotHex")));

    // Koios's own words are in the user's language: the site hears the kind of refusal, in English.
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    t.koios.rejectSubmit = '{"contents":"ValueNotConservedUTxO"}';
    const notSent = i18n.t("dapp.notSent", { lng: "en" });
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject(refusal(TxSendError.Failure, notSent));
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? new Response("slow down", { status: 429 }) : real(url, init));
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject(refusal(TxSendError.Failure, english("koios.rateLimited")));
  });

  it("are English when the user declines, while the window says it in their language", async () => {
    const t = await on();
    const s = site("https://declined.example");
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(enabling).rejects.toMatchObject(refusal(APIError.Refused, english("dapp.userDeclined")));
    // Asked again at once: turned away unasked, saying when it can ask, in English.
    await expect(t.dapp.call(s, "enable", [])).rejects.toMatchObject(refusal(APIError.Refused, english("dapp.declinedWait", { seconds: 10 })));

    // A UTxO the user locked: refused as the transaction is read, and again once approved, when it was locked
    // while the prompt waited. The window hears why in Japanese; the site, in English.
    const connectedSite = await connected(t);
    await t.balances.get("preprod");
    const [locked, free] = (await t.coins.lists("preprod")).cardano.filter((u) => !u.collateral).map((u) => `${u.txHash}#${u.index}`);
    await t.coins.setLocked("preprod", "cardano", locked!, true);
    const usesLocked = (utxo: string, lng: "en" | "ja") =>
      i18n.t("dapp.usesLocked", { what: i18n.t("dapp.lockedOne", { first: utxo, lng }), them: i18n.t("dapp.it", { lng }), lng });
    await expect(t.dapp.call(connectedSite, "signTx", [siteTx([locked!]), false])).rejects.toMatchObject(
      refusal(TxSignError.ProofGeneration, usesLocked(locked!, "en")),
    );
    const signing = t.dapp.call(connectedSite, "signTx", [siteTx([free!]), false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.coins.setLocked("preprod", "cardano", free!, true);
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true)).toEqual({ error: usesLocked(free!, "ja") });
    await expect(signing).rejects.toMatchObject(refusal(TxSignError.ProofGeneration, usesLocked(free!, "en")));
    expect(usesLocked(free!, "ja")).not.toBe(usesLocked(free!, "en"));
  });
});
