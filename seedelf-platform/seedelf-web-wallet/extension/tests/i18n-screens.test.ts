// English the translation review (2026-10-03) found still on the screens in
// Spanish and Japanese, each rendered or called as its screen does it, in the
// language that showed it: the Settings heading, a vote's "yes", a Plutus
// map's "0 key", a credential's "key", the delete phrase only English could
// type, a retiring pool's "epoch soon", copy buttons named from a lowercased
// label, and a "Keep it" whose Spanish was written for a box. English stays
// as it was, apart from what was broken in it too.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { LanguageCode } from "../src/i18n";
import { i18n } from "../src/i18n/core";
import type { PoolDetails, SessionView, Status, TokenAmount, TxDetail, UtxoInfo } from "../src/shared/rpc";
import { useAccounts } from "../src/ui/accounts";
import { RecipientCard } from "../src/ui/components/Recipients";
import { TokenDetails } from "../src/ui/components/TokenList";
import { TxDetailBody } from "../src/ui/components/TxDetail";
import { confirmsDelete, deletePhrase } from "../src/ui/delete-phrase";
import { NetworkContext } from "../src/ui/network";
import { Receive } from "../src/ui/screens/Receive";
import { DisconnectSession } from "../src/ui/screens/SiteSessions";
import { poolWarnings } from "../src/ui/screens/Staking";
import { ForgetSwap } from "../src/ui/screens/Swaps";
import { UtxoDetails } from "../src/ui/screens/Utxos";
import { viewToken } from "../src/ui/tokens";
import { loadTestWasm } from "./fakes";

let Settings: typeof import("../src/ui/screens/Settings");
let Unlock: typeof import("../src/ui/screens/Unlock");

beforeAll(async () => {
  // Settings and the lock screen read the page's URL when they load (ui/view.ts).
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
  Unlock = await import("../src/ui/screens/Unlock");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const speak = (code: LanguageCode) => i18n.changeLanguage(code);

/** The page's markup, with the entities a test compares read back. */
const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

/** What a person reads: the markup gone, and nothing put in its place, so Japanese runs on as it shows. */
const words = (element: ReactElement) => markup(element).replace(/<[^>]+>/g, "");

const noop = () => undefined;

describe("Settings' own heading", () => {
  const status: Status = { state: "unlocked", version: "1.0.0", network: "preprod", networks: ["preprod"], retryAfterMs: 0 };
  const heading = () =>
    markup(createElement(Settings.Settings, { status, onBack: noop, onRemoved: noop, onNetwork: noop })).match(
      /<h1 id="settings-title"[^>]*>([^<]*)<\/h1>/,
    )?.[1];

  it("is the language's, as the button that opens it is", async () => {
    expect(heading()).toBe("Settings");
    await speak("es");
    expect(heading()).toBe("Ajustes");
    await speak("ja");
    expect(heading()).toBe("設定");
  });
});

describe("a transaction's view", () => {
  const recorded = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/decode-txs.json", import.meta.url), "utf8")) as {
    txs: Array<{ name: string; cbor: string }>;
  };
  /** A real transaction read by the real WebAssembly, with the parts a test needs put in. */
  const detail = (over: Partial<TxDetail>): TxDetail => {
    const wasm = loadTestWasm();
    const payment = recorded.txs.find((tx) => tx.name === "payment")!.cbor;
    return { ...(JSON.parse(wasm.decodeTx(wasm.Network.Preprod, payment)) as TxDetail), ...over };
  };
  const view = (over: Partial<TxDetail>) => createElement(TxDetailBody, { detail: detail(over), network: "preprod" as const, testId: "tx" });

  const action = { txHash: "cd".repeat(32), index: 0 };
  const credential = { kind: "key" as const, hash: "ab".repeat(28) };
  const votes: TxDetail["votes"] = [
    { voter: "drep", credential, action, vote: "yes", anchor: null },
    { voter: "pool", credential, action, vote: "no", anchor: null },
    { voter: "committee", credential, action, vote: "abstain", anchor: null },
  ];

  it("says each vote as a sentence of its own, never with the vote's raw word in it", async () => {
    const english = words(view({ votes }));
    expect(english).toContain("Votes yes as a DRep");
    expect(english).toContain("Votes no as a stake pool");
    expect(english).toContain("Votes abstain as a committee member");
    await speak("es");
    const spanish = words(view({ votes }));
    expect(spanish).toContain("Vota sí como DRep");
    expect(spanish).toContain("Vota no como stake pool");
    // Abstaining changes the verb in Spanish.
    expect(spanish).toContain("Se abstiene como miembro del comité");
    expect(spanish).not.toMatch(/\b(yes|abstain)\b/);
    await speak("ja");
    const japanese = words(view({ votes }));
    expect(japanese).toContain("DRepとして賛成票を投じます");
    expect(japanese).toContain("ステークプールとして反対票を投じます");
    expect(japanese).toContain("委員会メンバーとして棄権します");
    expect(japanese).not.toMatch(/\b(yes|no|abstain)\b/);
  });

  const map = { type: "map" as const, entries: [{ key: { type: "bytes" as const, hex: "6b", text: "k" }, value: { type: "int" as const, value: "2" } }] };
  const datums: TxDetail["datums"] = [{ hash: "ef".repeat(32), hex: "a1416b02", data: map }];

  it("names a datum's map entries in the language", async () => {
    expect(words(view({ datums }))).toContain("0 key");
    expect(words(view({ datums }))).toContain("0 value");
    await speak("es");
    expect(words(view({ datums }))).toContain("0 clave");
    expect(words(view({ datums }))).toContain("0 valor");
    await speak("ja");
    expect(words(view({ datums }))).toContain("0 キー");
    expect(words(view({ datums }))).toContain("0 値");
  });

  it("names a datum's copy buttons in sentences of their own, where the lowercased label read “Copy the the datum”", async () => {
    const english = markup(view({ datums }));
    expect(english).toContain('aria-label="Copy the datum as CBOR"');
    expect(english).toContain('aria-label="Copy the datum as JSON"');
    expect(english).not.toContain("Copy the the");
    await speak("es");
    expect(markup(view({ datums }))).toContain('aria-label="Copiar el datum como CBOR"');
    await speak("ja");
    expect(markup(view({ datums }))).toContain('aria-label="datum を JSON としてコピー"');
  });

  const keyHash = "ab".repeat(28);
  const scriptHash = "12".repeat(28);
  const certificates: TxDetail["certificates"] = [
    { kind: "committeeHotAuth", cold: { kind: "script", hash: scriptHash }, hot: { kind: "key", hash: keyHash } },
    { kind: "poolRegistration", pool: "pool1abc", owners: ["aa".repeat(28), "bb".repeat(28)] },
  ];
  const proposals: TxDetail["proposals"] = [
    {
      deposit: "100000000000",
      rewardAccount: "stake_test1abc",
      action: "parameterChange",
      follows: null,
      parameters: [{ at: "proposal", field: "7", hex: "1903e8" }],
      withdrawals: [],
      script: null,
      version: null,
      anchor: { url: "https://example.com/p", contentHash: "00".repeat(32) },
    },
  ];

  it("says what a credential is, and an unnamed parameter's field, in the language", async () => {
    const english = words(view({ certificates, proposals }));
    expect(english).toContain(`key ${keyHash}`);
    expect(english).toContain(`script ${scriptHash}`);
    expect(english).toContain("field 7: 1903e8");
    expect(english).toContain(`${"aa".repeat(28)}, ${"bb".repeat(28)}`);
    await speak("es");
    const spanish = words(view({ certificates, proposals }));
    expect(spanish).toContain(`clave ${keyHash}`);
    expect(spanish).toContain("campo 7: 1903e8");
    await speak("ja");
    const japanese = words(view({ certificates, proposals }));
    expect(japanese).toContain(`鍵 ${keyHash}`);
    expect(japanese).toContain(`スクリプト ${scriptHash}`);
    expect(japanese).toContain("フィールド 7: 1903e8");
    // A list of owners, with Japanese's own comma.
    expect(japanese).toContain(`${"aa".repeat(28)}、${"bb".repeat(28)}`);
  });
});

describe("the phrase that deletes the wallet", () => {
  it("is the language's own, and English's is taken in every language", async () => {
    expect(deletePhrase()).toBe("delete wallet");
    expect(confirmsDelete("delete wallet")).toBe(true);
    expect(confirmsDelete("  Delete  Wallet ")).toBe(true);
    expect(confirmsDelete("delete")).toBe(false);
    expect(confirmsDelete("")).toBe(false);
    await speak("es");
    expect(deletePhrase()).toBe("eliminar billetera");
    expect(confirmsDelete("Eliminar billetera")).toBe(true);
    expect(confirmsDelete("delete wallet")).toBe(true);
    expect(confirmsDelete("eliminar")).toBe(false);
    await speak("ja");
    expect(deletePhrase()).toBe("ウォレットを削除");
    expect(confirmsDelete("ウォレットを削除")).toBe(true);
    expect(confirmsDelete("delete wallet")).toBe(true);
    expect(confirmsDelete("ウォレット")).toBe(false);
  });

  it("matches what a Japanese IME types: full-width letters and space, half-width katakana", async () => {
    // Compared as typed, these left the button disabled with nothing saying why.
    expect(confirmsDelete("ｄｅｌｅｔｅ　ｗａｌｌｅｔ")).toBe(true);
    await speak("ja");
    expect(confirmsDelete("ｄｅｌｅｔｅ　ｗａｌｌｅｔ")).toBe(true);
    expect(confirmsDelete("ｳｫﾚｯﾄを削除")).toBe(true);
  });

  it("is shown in the language on both screens that ask for it", async () => {
    const remove = () => markup(createElement(Settings.RemoveWallet, { onBack: noop, onRemoved: noop }));
    const reset = () => markup(createElement(Unlock.Reset, { onCancel: noop, onReset: noop }));
    expect(remove()).toContain("Type <strong>delete wallet</strong> to confirm");
    expect(reset()).toContain("Type <strong>delete wallet</strong> to confirm");
    await speak("es");
    expect(remove()).toContain("Escribe <strong>eliminar billetera</strong> para confirmar");
    await speak("ja");
    expect(reset()).toContain("<strong>ウォレットを削除</strong> と入力して確認してください");
  });
});

describe("a pool that retires", () => {
  const pool = (retiringEpoch: number | null): PoolDetails => ({
    id: "pool1abc",
    margin: 0.01,
    cost: "340000000",
    pledge: "0",
    livePledge: "0",
    stake: "1",
    saturation: 10,
    delegators: 1,
    blocks: 1,
    status: "retiring",
    retiringEpoch,
  });

  it("says soon in a sentence of its own when its epoch isn't known, not “retires in epoch soon”", async () => {
    expect(poolWarnings(pool(null))).toEqual(["This pool retires soon: choose another before then."]);
    expect(poolWarnings(pool(612))).toEqual(["This pool retires in epoch 612: choose another before then."]);
    await speak("ja");
    expect(poolWarnings(pool(null))).toEqual(["このプールはまもなく引退します。それまでに別のプールを選んでください。"]);
  });
});

describe("a copy button's name", () => {
  const seedelfUtxo: UtxoInfo = {
    txHash: "34".repeat(32),
    index: 0,
    lovelace: "2000000",
    tokens: [],
    locked: false,
    seedelf: { name: "5eed0e1f".padEnd(64, "0"), label: "web-wallet" },
  };
  const utxo = () => markup(createElement(UtxoDetails, { of: "seedelf", utxo: seedelfUtxo, busy: false, onLock: noop, onClose: noop }));
  const foo: TokenAmount = { policyId: "ab".repeat(28), assetName: "464f4f", quantity: "5", decimals: 0, fingerprint: "asset1foo" };
  const token = () => markup(createElement(TokenDetails, { view: viewToken("preprod", foo), onClose: noop }));
  const account = { receiveAddress: "addr_test1receive", stakeAddress: "stake_test1stake", seedelfPublicValue: "00", account: 0 };
  const receive = () => markup(createElement(Receive, { account, handles: [], onBack: noop }));

  it("is a sentence of its own, and says Seedelf as Seedelf", async () => {
    // From the field's label, lowercased, it was "Copy the seedelf name".
    expect(utxo()).toContain('aria-label="Copy the Seedelf name"');
    expect(utxo()).toContain('aria-label="Copy the transaction"');
    expect(token()).toContain('aria-label="Copy the policy id"');
    expect(token()).toContain('aria-label="Copy the asset name (hex)"');
    expect(receive()).toContain('aria-label="Copy the receive address"');
    expect(receive()).toContain('aria-label="Copy the stake address"');
    await speak("es");
    expect(utxo()).toContain('aria-label="Copiar el nombre del Seedelf"');
    expect(token()).toContain('aria-label="Copiar el ID de política"');
    expect(receive()).toContain('aria-label="Copiar la dirección de staking"');
    await speak("ja");
    expect(utxo()).toContain('aria-label="Seedelf の名前をコピー"');
    expect(token()).toContain('aria-label="ポリシー ID をコピー"');
  });

  it("takes a recipient off by its number, not by its heading lowercased", async () => {
    const card = () => markup(createElement(RecipientCard, { index: 1, count: 2, onRemove: noop, children: null }));
    expect(card()).toContain('aria-label="Take recipient 2 off"');
    await speak("es");
    expect(card()).toContain('aria-label="Quitar el destinatario 2"');
    await speak("ja");
    expect(card()).toContain('aria-label="宛先 2 を削除"');
  });
});

describe("a modal's Keep it", () => {
  const session: SessionView = {
    index: 2,
    network: "preprod",
    address: "addr_test1session",
    createdAt: 0,
    stage: "open",
    txs: [],
    holding: { lovelace: "0", tokens: [], utxos: 0 },
    site: { origin: "https://app.example" },
  };
  const disconnect = () => words(createElement(DisconnectSession, { session, busy: false, onKeep: noop, onDisconnect: noop }));
  const forget = () => words(createElement(ForgetSwap, { busy: false, onKeep: noop, onForget: noop }));

  it("agrees with what the modal is about: the site, or the swap, not Lovejoin's box", async () => {
    expect(disconnect()).toContain("Keep it");
    expect(forget()).toContain("Keep it");
    await speak("es");
    // "Dejarla" was written for la caja; beside "Desconectar el sitio" and "Olvidarlo" it disagreed.
    expect(disconnect()).toContain("Mantenerlo");
    expect(disconnect()).toContain("Desconectar el sitio");
    expect(forget()).toContain("Mantenerlo");
    expect(forget()).toContain("Olvidarlo");
    expect(`${disconnect()}${forget()}`).not.toContain("Dejarla");
  });
});

describe("the account's name with no provider around it", () => {
  function Name() {
    return useAccounts().name;
  }

  it("is in the language on now, not the one on when the module loaded", async () => {
    expect(renderToStaticMarkup(createElement(Name))).toBe("Account 1");
    await speak("ja");
    expect(renderToStaticMarkup(createElement(Name))).toBe("アカウント 1");
  });
});
