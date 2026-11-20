// Chunk 51, round four's last look, l4still#3: the stuck pool's private-payer note (lovejoin.stuck.privacy.private and
// privateNamed, shown by PaidQuestion, AnywayQuestion and HeldQuestion) says "Where it can, the wallet takes one that
// came back from Lovejoin". Round four's knownBox (shared/histories.ts) has withdrawOne's private payer pass over a way
// back the UTxOs screen tags Back from Lovejoin and Unknown (unplacedBox), which goes with the rest, by size. With 3 ₳
// made private from account 0 beside it, that 3 ₳ pays and ties account 0 to the box, though the way back could pay.
//
// Driven end to end through the worker's services with the real WebAssembly, as escape-hatch-unplaced-box.test.ts is:
// Mallory's box planted under S1's register and brought back anyway, then the token pool's box paid from the private
// balance. The note is then read as the question renders it, in each language.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { t as say } from "../src/i18n";
import { i18n } from "../src/i18n/core";
import {
  boxFrom,
  historyTags,
  knownBox,
  madePrivate,
  merged,
  mixedBox,
  receivedIn,
  sessionClass,
  UNKNOWN,
  unplacedBox,
  leftBy,
  type HistoryClass,
} from "../src/shared/histories";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { PendingTx } from "../src/shared/rpc";
import { AccountsContext } from "../src/ui/accounts";
import { PreferencesContext } from "../src/ui/preferences";
import { PaidQuestion } from "../src/ui/screens/Lovejoin";
import { CHAINS, POOL, withSession, type Tested } from "./chain-fixtures";
import { bech32, preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos } from "./fakes";
import { ADA, ADA_POOL, adaBox, ownDatum } from "./v2-pools";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
const unplaced = (w: string): HistoryClass => ({ id: `box:${w}+unknown:${w}`, origin: "lovejoin" });

const FOUND_V2 = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND_V2.reference, seed: FOUND_V2.seed, scripts: FOUND_V2.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));
const ljtest = { policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity };

type Entry = { txHash: string; kind: string; lovelace: string; origin?: HistoryClass };
const entryOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Entry[] }>("history.preprod"))!.entries.find((e) => e.txHash === txHash);

async function privateRow(t: Tested, txHash: string, lovelace: string): Promise<KoiosUtxo> {
  return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: 0, value: lovelace, asset_list: [], inline_datum: { bytes: await ownDatum(t.wallet), value: null }, block_height: 9_000_001 };
}

async function tokenBox(t: Tested, tx: string, datum: string, hours = 7): Promise<KoiosUtxo> {
  t.koios.txSpends.set(hash(tx), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: hash(tx),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: datum, value: {} },
    asset_list: [{ ...ljtest, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

function lovejoin(t: Tested) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL, TOKEN_POOL],
    sessionIndices: async () => [0],
  });
}

/**
 * The finder's step 1: Mallory's 5 ₳ box under S1's register as found, brought back anyway, its way back W landed
 * (Back from Lovejoin and Unknown); with `madePrivateToo`, 3 ₳ made private from public account 0 beside it. No box
 * the wallet knows. Then the wallet's box in the token pool, stuck under the fees.
 */
async function plantedWayBackThenStuck(madePrivateToo: boolean) {
  const { t } = await withSession("40000000");
  await t.balances.get("preprod");
  const s1 = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
  const C = hash("c9");
  t.koios.addedToAccounts.push(adaBox(C, s1.inline_datum!.bytes, t.clock.now));
  t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
  const lj = lovejoin(t);
  const pool = (await lj.status("preprod")).pools!.find((p) => p.id === ADA)!;
  expect((pool.someoneElse ?? []).map(ref)).toEqual([ref(inAda(C))]);
  const w1 = await lj.withdrawNow("preprod", inAda(C), true);
  const e1 = (await entryOf(t, w1.txHash))!;
  expect(e1.origin, "Mallory's box's way back").toEqual(unplaced(w1.txHash));
  const r1 = await privateRow(t, w1.txHash, e1.lovelace);
  const rows = [r1];
  let m0: KoiosUtxo | undefined;
  if (madePrivateToo) {
    const M0 = hash("d0");
    const moved: PendingTx = { kind: "move-in", network: "preprod", txHash: M0, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", moved, { lovelace: "3000000", origin: madePrivate(0) });
    m0 = await privateRow(t, M0, "3000000");
    rows.push(m0);
  }
  t.koios.added.push(...rows);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  const classes = await t.activity.classes("preprod", rows);
  const wayBack = classes.get(`${r1.tx_hash}#0`)!;
  expect(wayBack).toEqual(unplaced(w1.txHash));
  if (m0) expect(classes.get(`${m0.tx_hash}#0`), "the 3 ₳ made private from account 0").toEqual(madePrivate(0));
  const B2 = await tokenBox(t, "f1", await ownDatum(t.wallet));
  t.koios.addedToAccounts.push(B2);
  t.koios.params = { coins_per_utxo_size: "4800" };
  return { t, lj: lovejoin(t), r1, m0, B2, wayBack };
}

/** `element`'s markup, with one public account or three (on account 2). */
function markup(element: ReactElement, several: boolean): string {
  const accounts = several ? [{ index: 0 }, { index: 1 }, { index: 2 }] : [{ index: 0 }];
  return renderToStaticMarkup(
    createElement(
      AccountsContext.Provider,
      { value: { accounts, active: 1, loaded: true, name: "", several, reload: async () => undefined } },
      createElement(PreferencesContext.Provider, { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } }, element),
    ),
  );
}
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();
/** The question's first note, the private payer's, as a person reads it. */
const privateNote = (element: ReactElement, several: boolean) => words([...markup(element, several).matchAll(/<p class="note">(.*?)<\/p>/g)][0]![1]!);

const nothing = () => undefined;

describe("the stuck pool's private-payer note and a way back of unknown making (chunk 51, l4still#3)", CHAINS, () => {
  it("the code: account 0's 3 ₳ pays the stuck box's way back, the way back tagged Back from Lovejoin passed over", async () => {
    const { t, lj, r1, m0, B2, wayBack } = await plantedWayBackThenStuck(true);
    // What the UTxOs screen shows of W: Back from Lovejoin, and Unknown.
    expect(historyTags(wayBack)).toEqual([say("histories.tag.lovejoin"), say("histories.tag.unknown")]);
    const stuck = (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
    expect(stuck.cantComeBack, "the token pool's boxes can't pay their own way back").toBeTruthy();
    const pending = await lj.withdrawNow("preprod", { txHash: B2.tx_hash, txIndex: 0, pool: TOKEN }, false, "private");
    const inputs = txInputs(t.koios.submitted.find((b) => txIdOf(b) === pending.txHash)!);
    expect(inputs).toContain(`${B2.tx_hash}#0`);
    expect(inputs, `spent ${JSON.stringify(inputs)}`).toContain(`${m0!.tx_hash}#0`);
    expect(inputs).not.toContain(`${r1.tx_hash}#0`);
    // The wallet's own record of the way back: account 0 is tied to the box now.
    const back = (await entryOf(t, pending.txHash))!;
    expect(back.origin?.id.split("+")).toContain("public:0");
  });

  it("the code: that way back pays it where nothing smaller does, so the wallet can take it", async () => {
    const { t, lj, r1, B2 } = await plantedWayBackThenStuck(false);
    const pending = await lj.withdrawNow("preprod", { txHash: B2.tx_hash, txIndex: 0, pool: TOKEN }, false, "private");
    const inputs = txInputs(t.koios.submitted.find((b) => txIdOf(b) === pending.txHash)!);
    expect(inputs, `spent ${JSON.stringify(inputs)}`).toContain(`${r1.tx_hash}#0`);
  });

  it("the code: knownBox takes exactly the ways back the UTxOs screen tags Back from Lovejoin alone", () => {
    const [w, x, r] = [hash("31"), hash("32"), hash("33")];
    const lovejoinAlone = (c: HistoryClass) => {
      const tags = historyTags(c);
      return tags.length === 1 && tags[0] === say("histories.tag.lovejoin");
    };
    const cases: HistoryClass[] = [
      mixedBox(x),
      boxFrom(w),
      merged([boxFrom(w), mixedBox(x)]),
      unplacedBox(w),
      merged([boxFrom(w), UNKNOWN]),
      merged([mixedBox(x), unplacedBox(w)]),
      merged([boxFrom(w), receivedIn(r)]),
      merged([boxFrom(w), sessionClass(4)]),
      merged([boxFrom(w), madePrivate(0)]),
      merged([boxFrom(w), leftBy(r)]),
    ];
    for (const c of cases) expect(knownBox(c), `${c.id} (${c.origin}): ${historyTags(c).join(", ")}`).toBe(lovejoinAlone(c));
  });

  // The words. The note says the wallet takes one that came back from Lovejoin where it can; the code passes over one
  // the UTxOs screen tags Back from Lovejoin and Unknown, which can pay. The note must say which way back goes first
  // in the screen's own tags: the Unknown it passes over, or Back from Lovejoin alone.
  it("the note says which way back goes first in the UTxOs screen's tags, in each language, with one account and several", async () => {
    const alone = { en: /\b(alone|only)\b/, es: /\bsolo\b|\bsólo\b|únicamente/, ja: /だけ|のみ/ } as const;
    const wrong: string[] = [];
    for (const language of ["en", "es", "ja"] as const) {
      await i18n.changeLanguage(language);
      const [lovejoinTag, unknownTag] = [say("histories.tag.lovejoin"), say("histories.tag.unknown")];
      for (const [label, element, several] of [
        ["one account", createElement(PaidQuestion, { account: undefined, onKeep: nothing, onConfirm: nothing }), false],
        ["several, a public account's box", createElement(PaidQuestion, { account: 0, onKeep: nothing, onConfirm: nothing }), true],
      ] as const) {
        const note = privateNote(element, several);
        const at = note.indexOf(lovejoinTag);
        const says = note.includes(unknownTag) || (at >= 0 && alone[language].test(note.slice(Math.max(0, at - 40))));
        if (!says) wrong.push(`${language}, ${label}: "${note}"`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
