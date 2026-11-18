// The CLI's signing page, seedelf-cli/static/index.js, adds the CIP-30
// wallet's witnesses to the transaction that `create`, `fund` and `util
// extract` serve. Pallas writes the transaction as `84 body witnesses f5 f6`:
// the witness set is `a0` when there's no redeemer (fund), `a1 05 …` when there
// is one (create, extract). The page found it by searching the hex for the
// first "a105" (else the first "a0f5f6"), at any nibble, so a body whose hex
// held those digits (the user's address, an input's id, the fresh datum) got
// the witnesses written into it, and the node refused what the page submitted
// (chunk 51, r4#3). It now finds the witness set by walking the CBOR.
//
// It also shows the transaction's id before the wallet signs, and names it
// after a submit the wallet doesn't confirm, which may have gone through all
// the same: look it up before running the command again, the CLI's own advice
// for its own submits (chunk 51, r4#4's sibling on the page).
//
// This runs the page itself, its two injected blocks filled as web_server.rs
// fills index.html's, against a fake CIP-30 wallet, and reads what it submits.

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { nestsWithin, skip, txId } from "../src/background/cbor";

const cliStatic = (file: string) =>
  readFileSync(new URL(`../../../seedelf-cli/static/${file}`, import.meta.url), "utf8");
const pageScript = cliStatic("index.js");
const pageHtml = cliStatic("index.html");

/** A transaction's id, as web_server.rs computes it (seedelf-core's `build::tx_id`): its body's hash. */
const idOf = (tx: string) => txId(bytes(tx));

/**
 * index.html's two injected blocks, filled as web_server.rs fills them
 * (mainnet): the transaction and its id, and the network.
 */
function serve(message: string): { data: string; network: string } {
  const data = `{ "message": ${JSON.stringify(message)}, "id": ${JSON.stringify(idOf(message))} }`;
  const filled = pageHtml
    .replace('{ "message": "ACAB000000000000" }', data)
    .replace('{ "network": "FADECAFE00000000" }', '{ "network": "" }');
  const block = (id: string) => {
    const found = filled.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
    if (!found) throw new Error(`index.html has no ${id} block`);
    return found[1]!;
  };
  return { data: block("injected-data"), network: block("injected-network-data") };
}

interface FakeElement {
  textContent: string;
  href: string;
  value: string;
  children: unknown[];
  appendChild(child: unknown): void;
}

const element = (text = ""): FakeElement => ({
  textContent: text,
  href: "",
  value: "",
  children: [],
  appendChild(child) {
    this.children.push(child);
  },
});

// What the CIP-30 wallet's signTx returns: a witness set of one vkey witness, in a tagged set.
const VKEY = "cfa04a87c36a5e1cd5265e8b5561dbc3f24181e92a8ebf4d39c67277a6b21941";
const SIGNATURE =
  "fa09919d49f8338b0feedd4741cdc79f20a340ffe4f55c6e9322675bcc1a3dcf13a1c212fad4b95ba04a5fde0be7dd1868557f0c8c807b8d6f356017fd5c8bc3";
const VKEYS = `d9010281825820${VKEY}5840${SIGNATURE}`;
const WALLET_WITNESSES = `a100${VKEYS}`;

/**
 * The fake wallet: signTx returns `witnesses`, or throws `signError`; submitTx
 * throws `submitError`, or answers `answer`, by default the id of what it was
 * handed.
 */
interface FakeWallet {
  witnesses?: string;
  signError?: unknown;
  submitError?: unknown;
  answer?: unknown;
}

/** What a run of the page did and showed. */
interface PageRun {
  signed?: string;
  submitted?: string;
  status: string;
  /** Where the page's Cardanoscan button leads, and what it says. */
  link: { href: string; text: string };
  /** The id the page showed when the wallet was asked to sign, and at the end. */
  idWhenSigning?: string;
  idShown: string;
}

/** Runs the page on `unsigned`, with the fake wallet picked in the dropdown. */
async function signOnThePage(unsigned: string, wallet: FakeWallet = {}): Promise<PageRun> {
  const served = serve(unsigned);
  const elements: Record<string, FakeElement> = {
    "injected-data": element(served.data),
    "injected-network-data": element(served.network),
    status: element(),
    tx_link: element(),
    tx_id: element(),
    tx_cbor: element(),
    wallet_dropdown: element(),
  };
  elements.wallet_dropdown!.value = "cliwallet";
  const seen: { signed?: string; submitted?: string; idWhenSigning?: string; onLoad?: () => Promise<void> } = {};
  const api = {
    getNetworkId: async () => 1,
    signTx: async (tx: string) => {
      seen.signed = tx;
      seen.idWhenSigning = elements.tx_id!.textContent;
      if (wallet.signError !== undefined) throw wallet.signError;
      return wallet.witnesses ?? WALLET_WITNESSES;
    },
    submitTx: async (tx: string) => {
      seen.submitted = tx;
      if (wallet.submitError !== undefined) throw wallet.submitError;
      if ("answer" in wallet) return wallet.answer;
      return idOf(tx);
    },
  };
  const cardano = {
    cliwallet: { name: "cliwallet", icon: "data:,", apiVersion: "0.1.0", isEnabled: async () => true, enable: async () => api },
  };
  const document = {
    getElementById: (id: string) => elements[id],
    createElement: () => element(),
    addEventListener: (type: string, listener: () => Promise<void>) => {
      if (type === "DOMContentLoaded") seen.onLoad = listener;
    },
  };
  runInContext(pageScript, createContext({ window: { cardano }, document, setInterval, clearInterval }), {
    filename: "seedelf-cli/static/index.js",
  });
  if (!seen.onLoad) throw new Error("index.js didn't wait for DOMContentLoaded");
  await seen.onLoad();
  return {
    signed: seen.signed,
    submitted: seen.submitted,
    status: elements.status!.textContent,
    link: { href: elements.tx_link!.href, text: elements.tx_link!.textContent },
    idWhenSigning: seen.idWhenSigning,
    idShown: elements.tx_id!.textContent,
  };
}

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** A transaction's id, body, witness-set entries (key → value) and what follows them; or that it can't be read. */
function read(hex: string) {
  try {
    const b = bytes(hex);
    if (!/^(?:[0-9a-f]{2})+$/.test(hex) || b[0] !== 0x84 || !nestsWithin(b)) return { readable: false };
    const bodyEnd = skip(b, 1, 1);
    const head = b[bodyEnd]!;
    if (head >> 5 !== 5 || (head & 0x1f) >= 24) return { readable: false };
    const witnesses: Record<number, string> = {};
    let at = bodyEnd + 1;
    for (let i = 0; i < (head & 0x1f); i++) {
      const end = skip(b, at + 1, 2);
      witnesses[b[at]!] = hex.slice((at + 1) * 2, end * 2);
      at = end;
    }
    return { readable: true, id: txId(b), body: hex.slice(2, bodyEnd * 2), witnesses, after: hex.slice(at * 2) };
  } catch {
    return { readable: false };
  }
}

/** A CBOR unsigned integer, as minicbor writes it (under 2^32). */
const uint = (n: number) =>
  n < 24
    ? n.toString(16).padStart(2, "0")
    : n < 0x100
      ? `18${n.toString(16).padStart(2, "0")}`
      : n < 0x10000
        ? `19${n.toString(16).padStart(4, "0")}`
        : `1a${n.toString(16).padStart(8, "0")}`;
/** Writes `patch` over `hex` at byte `offset`, keeping its length. */
const put = (hex: string, offset: number, patch: string) =>
  hex.slice(0, offset * 2) + patch + hex.slice(offset * 2 + patch.length);
const input = (id: string, index: number) => `825820${id}${uint(index)}`;

// Variant 1's wallet contract and mainnet reference UTxO (seedelf-core/src/constants.rs).
const WALLET_HASH = "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469";
const WALLET_REFERENCE = "51f12c1a5c2b0558a284628d81b06dee50b27693242fe35618c5f921730c0527";
// The user's base address (payment key, stake key).
const PAY = "de863692790053e4c055b4a9b644d49611ed14dc8235790013a7f58e";
const STAKE = "1ec705de1f103925058580ef47cdabdc34315668df7f578aa2b94e8c";
// A re-randomized register: two compressed G1 points.
const GENERATOR =
  "b3cad0448fe43cf8d611d4d9522d22fdff15f53c48f6d1f3bd9fec92a4c09430256f70ae610ab15b40bef4971765dbb1";
const PUBLIC_VALUE =
  "999f8e374b862cfe9e5a91b64a788733ca794a94b45686c79d539bf3bbee469f0587d6e41c1bbbeec8352ce72ef16ec8";
const INPUT_ID = "6ca9a20adc308a22b91b77e32efa39747d5bd85929857a353f753ded8fe2f228";
const CONTRACT_UTXO = "226196b1f48f717bd6c649449260fe647c03cc37ee840550809699fe9438f176";
const USER_UTXO = "6f203ecd5078ad49c56523204326bb2c4669a420f031d7f60ecacd0974b59859";
const COLLATERAL_UTXO = "ba5ed1601d1154e027a65dc119ff78741a242f8aac30e2cb7e40f66e9250f425";
const SCRIPT_DATA_HASH = "1a87fa5a2ae1103555645f0777bd74f29cb8bc8ba02d1ada0bd81bdf1c2b09f1";
// extract's one spend redeemer, as Pallas lists it: [spend, input 0, Constr 0 [#, #, #], [mem, steps]].
const REDEEMERS = `81840000d8799f404040ff82${uint(1_052_916)}${uint(301_877_342)}`;

/**
 * `fund -a <address> -s <seedelf> -l 50000000`, as fund.rs builds it: one input,
 * 50 ₳ to the contract under a fresh register, the change back to the address,
 * the fee; no redeemer, so the witness set is empty (`a0`).
 */
function fundTx({ pay = PAY, inputId = INPUT_ID, publicValue = PUBLIC_VALUE } = {}) {
  const datum = `d8799f5830${GENERATOR}5830${publicValue}ff`;
  const toSeedelf = `a300581d71${WALLET_HASH}01${uint(50_000_000)}028201d8185868${datum}`;
  const change = `a2005839${`01${pay}${STAKE}`}01${uint(147_302_511)}`;
  const body = `a300d9010281${input(inputId, 0)}0182${toSeedelf}${change}02${uint(170_605)}`;
  return { unsigned: `84${body}a0f5f6`, body, ours: {} as Record<number, string> };
}

/**
 * `util extract -u <utxo> -a <address>`, as extract.rs builds it: the contract
 * UTxO and one of the address's, everything to the address, collateral and its
 * return, the wallet contract by reference; one spend redeemer (`a1 05 …`).
 */
function extractTx({ pay = PAY } = {}) {
  const to = `5839${`01${pay}${STAKE}`}`;
  const body =
    "a7" +
    `00d9010282${input(CONTRACT_UTXO, 0)}${input(USER_UTXO, 1)}` +
    `0181a200${to}01${uint(9_412_337)}` +
    `02${uint(287_442)}` +
    `0b5820${SCRIPT_DATA_HASH}` +
    `0dd9010281${input(COLLATERAL_UTXO, 0)}` +
    `10a200${to}01${uint(4_568_837)}` +
    `12d9010281${input(WALLET_REFERENCE, 1)}`;
  return { unsigned: `84${body}a105${REDEEMERS}f5f6`, body, ours: { 5: REDEEMERS } as Record<number, string> };
}

/**
 * The page should submit the transaction the CLI built and the wallet signed,
 * with the wallet's witnesses (`witnesses`, its signTx answer) added.
 */
async function expectSignedAsBuilt(
  tx: { unsigned: string; body: string; ours: Record<number, string> },
  witnesses = WALLET_WITNESSES,
) {
  // The fixture is one whole transaction, its body ending where the witness set starts.
  expect(read(tx.unsigned)).toEqual({
    readable: true,
    id: txId(bytes(tx.unsigned)),
    body: tx.body,
    witnesses: tx.ours,
    after: "f5f6",
  });
  const run = await signOnThePage(tx.unsigned, { witnesses });
  expect(run.signed, run.status).toBe(tx.unsigned);
  expect(run.submitted, run.status).toBeDefined();
  expect(read(run.submitted!), `submitted ${run.submitted}`).toEqual({
    readable: true,
    id: txId(bytes(tx.unsigned)), // the body the wallet signed
    body: tx.body,
    witnesses: { 0: VKEYS, ...tx.ours },
    after: "f5f6",
  });
}

describe("the CLI's signing page adds the wallet's witnesses to the transaction it serves", () => {
  it("does, for a fund and an extract whose bytes hold neither pattern (the page works)", async () => {
    const fund = fundTx();
    const extract = extractTx();
    expect(fund.unsigned).not.toContain("a105");
    expect(fund.unsigned.indexOf("a0f5f6")).toBe(fund.unsigned.length - 6);
    expect(extract.unsigned.indexOf("a105")).toBe(2 + extract.body.length);
    await expectSignedAsBuilt(fund);
    await expectSignedAsBuilt(extract);
  });

  it("does for a fund from an address whose payment hash holds the bytes a1 05", async () => {
    const fund = fundTx({ pay: put(PAY, 14, "a105") });
    expect(fund.body).toContain(`5839${`01${put(PAY, 14, "a105")}${STAKE}`}`);
    await expectSignedAsBuilt(fund);
  });

  it("does for a fund spending an input whose id holds the bytes 0a 10 5f (a105 at an odd nibble)", async () => {
    const fund = fundTx({ inputId: put(INPUT_ID, 16, "0a105f") });
    expect(fund.body.indexOf("a105") % 2).toBe(1);
    await expectSignedAsBuilt(fund);
  });

  it("does for a fund whose fresh datum holds the bytes a0 f5 f6", async () => {
    const fund = fundTx({ publicValue: put(PUBLIC_VALUE, 20, "a0f5f6") });
    expect(fund.unsigned).not.toContain("a105");
    await expectSignedAsBuilt(fund);
  });

  it("does for an extract to an address whose payment hash holds the bytes a1 05", async () => {
    await expectSignedAsBuilt(extractTx({ pay: put(PAY, 14, "a105") }));
  });

  it("keeps the transaction's own redeemers when the wallet's answer repeats a set of its own", async () => {
    // A wallet that answers with a whole witness set: its vkeys, and redeemers of its own.
    const theirs = `81840000d8799f404040ff82${uint(1)}${uint(1)}`;
    await expectSignedAsBuilt(extractTx(), `a200${VKEYS}05${theirs}`);
  });

  it("reads a wallet's witness set written at indefinite length", async () => {
    await expectSignedAsBuilt(fundTx(), `bf00${VKEYS}ff`);
    await expectSignedAsBuilt(extractTx(), `bf00${VKEYS}ff`);
  });
});

describe("the CLI's signing page names the transaction it serves", () => {
  it("shows the transaction's id before the wallet signs, and links it once the wallet confirms the submit", async () => {
    for (const tx of [fundTx(), extractTx()]) {
      const id = idOf(tx.unsigned);
      const run = await signOnThePage(tx.unsigned);
      expect(run.idWhenSigning).toBe(id);
      expect(run.idShown).toBe(id);
      expect(run.status).toContain("successfully submitted");
      expect(run.link).toEqual({ href: `https://cardanoscan.io/transaction/${id}`, text: "View Transaction On Cardanoscan" });
    }
  });

  it("names the transaction to look up first after a submit the wallet doesn't confirm", async () => {
    const tx = extractTx();
    const id = idOf(tx.unsigned);
    const unconfirmed: FakeWallet[] = [
      // A CIP-30 TxSendError, as wallets throw them: an object, not an Error.
      { submitError: { code: 2, info: "the network didn't answer in time" } },
      { submitError: new Error("Failed to fetch") },
      // An answer that isn't the transaction's id confirms nothing.
      { answer: "ab".repeat(32) },
      { answer: undefined },
    ];
    for (const wallet of unconfirmed) {
      const run = await signOnThePage(tx.unsigned, wallet);
      expect(run.submitted, run.status).toBeDefined();
      expect(run.status).toContain(`Transaction ${id} may have gone through`);
      expect(run.status).toContain("before you run the command again");
      expect(run.status).not.toContain("successfully");
      expect(run.link.href).toBe(`https://cardanoscan.io/transaction/${id}`);
    }
    const run = await signOnThePage(tx.unsigned, unconfirmed[0]);
    expect(run.status).toContain("the network didn't answer in time");
  });

  it("says what the wallet said when it doesn't sign, where nothing went out", async () => {
    const run = await signOnThePage(fundTx().unsigned, { signError: { code: 2, info: "user declined to sign" } });
    expect(run.submitted).toBeUndefined();
    expect(run.status).toContain("user declined to sign");
    expect(run.status).not.toContain("may have gone through");
    expect(run.link.href).toBe("");
  });
});
