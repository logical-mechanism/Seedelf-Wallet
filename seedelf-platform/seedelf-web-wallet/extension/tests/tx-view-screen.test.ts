// What the transaction view shows (ui/components/TxDetail.tsx), rendered from
// real transactions read by the real WebAssembly: the wallet's own preprod
// transfer, Minswap's swap, and a certificate transaction cardano-cli built
// (wasm/tests/fixtures/decode-txs.json). Bytes in, words out, with nothing
// stubbed between them.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TxDetail } from "../src/shared/rpc";
import { TxDetailBody, addressWords, certificateWords, proposalWords, redeemerWords } from "../src/ui/components/TxDetail";
import { NetworkContext } from "../src/ui/network";
import { loadTestWasm, transferPreprod } from "./fakes";

/** The transactions the Rust tests read, with cardano-cli's reading of each. */
const recorded = JSON.parse(
  readFileSync(new URL("../../wasm/tests/fixtures/decode-txs.json", import.meta.url), "utf8"),
) as { txs: Array<{ name: string; cbor: string }> };

const cborOf = (name: string) => recorded.txs.find((tx) => tx.name === name)!.cbor;

function read(cbor: string, network: "preprod" | "mainnet" = "preprod"): TxDetail {
  const wasm = loadTestWasm();
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  return JSON.parse(wasm.decodeTx(net, cbor)) as TxDetail;
}

/** A page's text, as a person reads it. */
function text(element: ReactElement, network: "preprod" | "mainnet" = "preprod"): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: network }, element))
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

const shown = (cbor: string, network: "preprod" | "mainnet" = "preprod") =>
  text(createElement(TxDetailBody, { detail: read(cbor, network), network, testId: "tx" }), network);

describe("the transaction view's page", () => {
  it("leads with what the transaction spends and what it pays", async () => {
    const page = shown(transferPreprod.final.txCbor);
    expect(page).toContain("Spends 2 UTxOs");
    expect(page).toContain("Pays 2 outputs");
    // Each output's own address is there in full, with what goes to it.
    const detail = read(transferPreprod.final.txCbor);
    for (const out of detail.outputs) {
      expect(page).toContain(out.address.bech32);
    }
    // Where the value goes comes before the fee.
    expect(page.indexOf("Pays 2 outputs")).toBeLessThan(page.indexOf("Network fee"));
    // An input is named, and the view says why it holds nothing more about it.
    expect(page).toContain(`${detail.inputs[0]!.txHash.slice(0, 12)}`);
    expect(page).toContain("looking them up would tell whoever was asked");
  });

  it("says a Seedelf output is one, and that its register could be spent", () => {
    const page = shown(transferPreprod.final.txCbor);
    expect(page).toContain("Seedelf Wallet's contract");
    expect(page).toContain("under a register");
    // On the other network the contract isn't ours, so nothing claims it is.
    expect(shown(transferPreprod.final.txCbor, "mainnet")).not.toContain("Seedelf Wallet's contract");
  });

  it("shows the contracts it runs, by budget and by hash, and takes none apart", () => {
    const page = shown(transferPreprod.final.txCbor);
    expect(page).toContain("Runs a spending script, number 0");
    expect(page).toContain("mem");
    expect(page).toContain("steps");
    expect(page).toContain("Reads 1 UTxO");
    expect(page).toContain("Collateral: 1 UTxO");
    expect(page).toContain("It doesn't take one apart");
  });

  it("shows a certificate transaction's certificates, its withdrawal and its note", () => {
    const page = shown(cborOf("certificates"));
    expect(page).toContain("Registers a stake key");
    expect(page).toContain("Stakes with a pool");
    expect(page).toContain("Delegates the vote");
    expect(page).toContain("pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy");
    expect(page).toContain("drep_always_abstain");
    expect(page).toContain("Withdraws rewards");
    expect(page).toContain("Valid from slot 100");
    expect(page).toContain("Valid until slot 99999999");
    expect(page).toContain("Its note");
    expect(page).toContain("a note anyone can read");
    // Metadata is the tree it is, numbers and bytes and all.
    expect(page).toContain("Label 1");
    expect(page).toContain("42");
    expect(page).toContain("deadbeef");
  });

  it("shows a mint and a burn with their signs, and a name only where it reads as one", () => {
    const page = shown(cborOf("mint"));
    expect(page).toContain("Mints and burns");
    expect(page).toContain("+5");
    expect(page).toContain("−3");
    expect(page).toContain("native script");
  });

  it("shows governance in words, with what it points at", () => {
    const page = shown(cborOf("governance"));
    expect(page).toContain("Votes yes as a DRep");
    expect(page).toContain("Proposes information, which changes nothing");
    expect(page).toContain("https://example.com/info");
    expect(page).toContain("To the treasury");
  });

  it("says a transaction isn't signed yet where it isn't, whatever else its witness set holds", () => {
    expect(shown(cborOf("payment"))).toContain("Signed Not yet");
    // The wallet's transfer carries its redeemers and no signature yet: still unsigned.
    expect(shown(transferPreprod.final.txCbor)).toContain("Signed Not yet");
    // One that has been signed says how many have signed it.
    const detail = { ...read(cborOf("payment")), signatures: [{ publicKey: "ab".repeat(32), keyHash: "cd".repeat(28) }] };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("Signed 1 signature so far");
  });

  it("reports a field it has no name for rather than leaving it out", () => {
    // What the decoder reports for a field no Cardano has yet
    // (wasm/tests/decode_test.rs pins the reading itself).
    const detail = { ...read(cborOf("payment")), unknown: [{ at: "body", field: "23", hex: "820102" }] };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("has no name for");
    expect(page).toContain("The body's field 23");
    expect(page).toContain("820102");
  });

  it("warns about a transaction meant to fail its contracts", () => {
    const detail = { ...read(cborOf("payment")), valid: false };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("marked to fail its contracts");
  });

  it("names every certificate, action, redeemer and address kind, and never invents one", () => {
    expect(certificateWords("stakeVoteRegistrationDelegation")).toContain("Registers a stake key");
    expect(certificateWords("somethingNew")).toBe("somethingNew");
    expect(proposalWords("hardFork")).toBe("a hard fork");
    expect(proposalWords("somethingNew")).toBe("somethingNew");
    expect(redeemerWords("mint")).toBe("minting");
    expect(redeemerWords("9")).toBe("tag 9");
    expect(addressWords("base", "script")).toBe("a contract that stakes");
    expect(addressWords("enterprise", "key")).toBe("a key");
    expect(addressWords("reward", null)).toBe("a reward address");
    expect(addressWords("byron", null)).toBe("a Byron address");
  });
});
