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

/**
 * The page's markup, with the entities read back, for what a person sees only on
 * hover: a hint's `title`, which never shows as text.
 */
const markup = (cbor: string, network: "preprod" | "mainnet" = "preprod") =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: network },
      createElement(TxDetailBody, { detail: read(cbor, network), network, testId: "tx" }),
    ),
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

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
    // An input is named, and nothing else takes up the room.
    expect(page).toContain(`${detail.inputs[0]!.txHash.slice(0, 12)}`);
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

describe("what the page can't take at face value", () => {
  // The same hand-built bodies the Rust tests use (wasm/tests/decode_test.rs):
  // a four-item transaction whose body is exactly these entries.
  const INPUT = `81825820${"11".repeat(32)}00`;
  const OUTPUT = "8182581d60a3d6d926176be50d7d03ecaf007932b670592111602201ae9c20d4381a001e8480";
  const body = (entries: Array<[string, string]>) =>
    `84a${entries.length.toString(16)}${entries.map(([k, v]) => k + v).join("")}a0f5f6`;
  const plain = (extra: Array<[string, string]> = []) =>
    body([["00", INPUT], ["01", OUTPUT], ["02", "1a00030d40"], ...extra]);

  it("shows a slot too big for a JavaScript number exactly", () => {
    // ttl = 2^60 + 1, which `JSON.parse` would round to …800 if it were a number.
    const page = shown(plain([["03", "1b1000000000000001"]]));
    expect(page).toContain("Valid until slot 1152921504606846977");
    expect(page).not.toContain("1152921504606846800");
  });

  it("says when an output's bytes aren't an address, and still shows the rest", () => {
    // The CDDL types the field as plain `bytes`: these three aren't an address.
    const page = shown(body([["00", INPUT], ["01", "818243aabbcc1a001e8480"], ["02", "1a00030d40"]]));
    expect(page).toContain("bytes that aren't an address");
    expect(page).toContain("aabbcc");
    expect(page).toContain("2 ₳");
    expect(page).toContain("Network fee 0.2 ₳");
  });

  it("writes out a right-to-left override in a note rather than letting it reorder the line", () => {
    const detail: TxDetail = {
      ...read(cborOf("payment")),
      note: [String.raw`\u{202E}drowssap`],
      metadata: [{ label: "674", value: { type: "text", text: String.raw`a\u{200B}b` } }],
    };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain(String.raw`\u{202E}drowssap`);
    expect(page).toContain(String.raw`a\u{200B}b`);
    // And the text it is isolated, so a right-to-left script can't reorder its row.
    const html = renderToStaticMarkup(
      createElement(NetworkContext.Provider, { value: "preprod" }, createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" })),
    );
    expect(html).toContain('class="tx-detail__tree"');
  });

  it("groups a redeemer's budget through bigint, so a huge one isn't rounded", () => {
    const detail: TxDetail = {
      ...read(transferPreprod.final.txCbor),
      redeemers: [{ tag: "spend", index: "0", data: "d87980", mem: "9007199254740993", steps: "1" }],
    };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("9,007,199,254,740,993 mem");
  });
});

describe("nothing the decoder found is left off the page", () => {
  it("shows every field a stake pool's certificate carries", () => {
    const page = shown(cborOf("pool"));
    expect(page).toContain("Registers a stake pool");
    expect(page).toContain("Pledge (lovelace) 1000000000");
    expect(page).toContain("Cost (lovelace) 340000000");
    expect(page).toContain("Margin 3/100");
    expect(page).toContain("Rewards to stake_test1");
    expect(page).toContain("Relays relay.example.com:3001");
    expect(page).toContain("https://example.com/pool.json");
    expect(page).toContain("VRF key hash");
    expect(page).toContain("Retires a stake pool");
    expect(page).toContain("Epoch 500");
  });

  it("shows a proposal's own fields, treasury withdrawals and all", () => {
    const detail: TxDetail = {
      ...read(cborOf("governance")),
      proposals: [
        {
          deposit: "100000000000",
          rewardAccount: "stake_test1uzf20srl7uvcknahpn4wq7q4xs8e0xdcgyf28a6mwv7jcrqq987ua",
          action: "treasuryWithdrawals",
          follows: { txHash: "ab".repeat(32), index: 2 },
          parameters: [],
          withdrawals: [{ address: "stake_test1uzf20srl7uvcknahpn4wq7q4xs8e0xdcgyf28a6mwv7jcrqq987ua", lovelace: "5000000" }],
          script: "cd".repeat(28),
          version: null,
          anchor: { url: "https://example.com/withdraw", contentHash: "00".repeat(32) },
        },
      ],
    };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("Proposes withdrawals from the treasury");
    expect(page).toContain("Withdraws stake_test1uzf20srl7uvcknahpn4wq7q4xs8e0xdcgyf28a6mwv7jcrqq987ua 5 ₳");
    expect(page).toContain("Follows abababab");
    expect(page).toContain("Script cdcdcd");
    expect(page).toContain("https://example.com/withdraw");
  });

  it("shows a collateral return and a total even with no collateral inputs", () => {
    const detail: TxDetail = {
      ...read(cborOf("payment")),
      collateral: [],
      totalCollateral: "5000000",
    };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("Collateral");
    expect(page).toContain("The most taken 5 ₳");
    expect(page).toContain("Comes back");
  });

  it("says when metadata isn't what the body commits to", () => {
    const detail: TxDetail = { ...read(cborOf("certificates")), metadataHashMatches: false };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("isn't the hash of the metadata it carries");
    // And it still shows the metadata, as it shows everything else.
    expect(page).toContain("Label 674");
  });

  it("counts Byron witnesses rather than dropping them", () => {
    const detail: TxDetail = { ...read(cborOf("payment")), bootstrapWitnesses: 2 };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("Byron witnesses 2 witnesses");
  });

  it("doesn't label which of the two output forms was written", () => {
    // The CDDL calls them "equally valid and interchangeable", and cardano-cli
    // writes a list for any output needing neither an inline datum nor a script:
    // two of this payment's three are lists. Saying so on each row would read as
    // a warning about nothing, and the Raw CBOR tab has the bytes.
    const detail = read(cborOf("payment"));
    expect(detail.outputs.map((o) => o.form)).toEqual(["legacy", "legacy", "postAlonzo"]);
    const page = shown(cborOf("payment"));
    expect(page).not.toContain("older");
    expect(page).not.toContain("legacy");
  });
});

describe("the explanations behind their icons", () => {
  // Each paragraph the page used to carry under its rows (the owner, 2026-10-01):
  // it's a hint now, shown on hover and put on the page by a click.
  const HINTS = [
    "looking them up would tell whoever was asked which transaction you are reading",
    "Read, not spent: a contract's script or its settings usually sit in one.",
    "It doesn't take one apart",
    "Metadata is in the open",
  ];

  it("keeps every explanation, but off the page until it's asked for", () => {
    const page = shown(transferPreprod.final.txCbor);
    const html = markup(transferPreprod.final.txCbor);
    for (const hint of HINTS.slice(0, 3)) {
      expect(html, hint).toContain(hint);
      expect(page, hint).not.toContain(hint);
    }
    // Each is the icon's title, which is what shows on hover, and its button
    // says what it does for anyone not using a mouse.
    expect(html).toContain('title="What each one holds');
    expect(html).toContain('aria-label="What this means"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("explains the metadata and the note where there are any", () => {
    const html = markup(cborOf("certificates"));
    expect(html).toContain("Metadata is in the open");
    expect(html).toContain("A message written on the transaction");
    expect(text(createElement(TxDetailBody, { detail: read(cborOf("certificates")), network: "preprod" as const, testId: "tx" }))).not.toContain(
      "Metadata is in the open",
    );
  });

  it("leaves a warning where everyone reads it, hint or no hint", () => {
    // A callout is a decision, not an explanation: it never hides behind an icon.
    const detail: TxDetail = { ...read(cborOf("payment")), valid: false, unknown: [{ at: "body", field: "23", hex: "00" }] };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("marked to fail its contracts");
    expect(page).toContain("has no name for");
  });
});
