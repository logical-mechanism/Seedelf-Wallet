// What the transaction view shows (ui/components/TxDetail.tsx), rendered from
// real transactions read by the real WebAssembly: the wallet's own preprod
// transfer, Minswap's swap, and a certificate transaction cardano-cli built
// (wasm/tests/fixtures/decode-txs.json). Bytes in, words out, with nothing
// stubbed between them.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TxDetail, TxPlutus } from "../src/shared/rpc";
import { plutusJson } from "../src/ui/components/PlutusTree";
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

  it("shortens every id beside the button that copies it, and leaves an address whole", () => {
    const detail = read(transferPreprod.final.txCbor);
    const html = markup(transferPreprod.final.txCbor);
    // An address is read rather than carried, so all of it is on the page — and
    // copyable too, as everything else here is.
    for (const out of detail.outputs) {
      expect(html).toContain(`>${out.address.bech32}<`);
    }
    expect(html).toContain('aria-label="Copy the address"');
    // A redeemer's budget is a line of its own, under the script it belongs to,
    // so a ten-digit one can't squeeze which script it was.
    expect(html).toMatch(/tx-detail__stack[\s\S]*?Runs a spending script[\s\S]*?tx-detail__budget/);
  });

  it("shortens a script's hash and a datum's, each with its own copy button", () => {
    const detail: TxDetail = {
      ...read(cborOf("payment")),
      scripts: [{ kind: "plutusV3", hash: "cd".repeat(28), size: 2384, source: "witnesses" }],
      datums: [{ hash: "ab".repeat(32), hex: "d87980", data: { type: "constr", constructorIndex: "0", fields: [] } }],
    };
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }),
      ),
    ).replace(/&#x27;/g, "'");
    for (const hash of ["cd".repeat(28), "ab".repeat(32)]) {
      // Shortened where it's read, whole where it's taken from.
      expect(html).not.toContain(`>${hash}<`);
      expect(html).toContain(`data-value="${hash}"`);
    }
    expect(html).toContain("Copy the script's hash");
    expect(html).toContain("Copy the datum's hash");
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
    // One that has been signed says how many have signed it, and that it hasn't gone: the sheet is only ever
    // shown for a transaction the wallet holds, before Send (chunk 23's second review, PY-7).
    const detail = { ...read(cborOf("payment")), signatures: [{ publicKey: "ab".repeat(32), keyHash: "cd".repeat(28) }] };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("Signed 1 signature, not sent yet");
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
      redeemers: [
        { tag: "spend", index: "0", data: "d87980", argument: { type: "constr", constructorIndex: "0", fields: [] }, mem: "9007199254740993", steps: "1" },
      ],
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

describe("a datum, whatever contract it is for", () => {
  it("shows an output's datum as its tree, with the bytes to copy", () => {
    const page = shown(transferPreprod.final.txCbor);
    expect(page).toContain("Its datum, 104 bytes");
    expect(page).toContain("Constructor 0");
    // Each field is there, shortened, with the whole value on the element.
    const detail = read(transferPreprod.final.txCbor);
    const register = detail.outputs[0]!.register!;
    const html = markup(transferPreprod.final.txCbor);
    expect(html).toContain(`data-value="${register.generator}"`);
    expect(html).toContain(`data-value="${register.publicValue}"`);
    // And the register note stays: it says the payment can be spent, which the
    // shape alone doesn't.
    expect(page).toContain("under a register");
  });

  it("shows a redeemer's argument as its tree", () => {
    const page = shown(transferPreprod.final.txCbor);
    expect(page).toContain("Its argument, 118 bytes");
    // The wallet's proof is a constructor of three byte strings.
    expect(page.match(/Constructor 0/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("shows another contract's datum nested, knowing nothing about it", () => {
    // Minswap's order: the wallet has no schema for it, so the shape is shown.
    const page = shown(cborOf("minswap-swap"));
    expect(page).toContain("The datum, 224 bytes");
    expect(page.match(/Constructor \d/g)!.length).toBeGreaterThan(5);
    expect(page).not.toContain("register");
  });

  it("names every shape data can take", () => {
    const detail: TxDetail = {
      ...read(cborOf("payment")),
      datums: [
        {
          hash: "ab".repeat(32),
          hex: "d87980",
          data: {
            type: "constr",
            constructorIndex: "7",
            fields: [
              { type: "int", value: "-18446744073709551617" },
              { type: "bytes", hex: "53656564656c66", text: "Seedelf" },
              { type: "list", items: [{ type: "int", value: "1" }] },
              {
                type: "map",
                entries: [{ key: { type: "bytes", hex: "6b", text: "k" }, value: { type: "int", value: "2" } }],
              },
            ],
          },
        },
      ],
    };
    const page = text(createElement(TxDetailBody, { detail, network: "preprod" as const, testId: "tx" }));
    expect(page).toContain("Constructor 7 · 4 fields");
    expect(page).toContain("-18446744073709551617");
    expect(page).toContain("Seedelf");
    expect(page).toContain("1 item");
    expect(page).toContain("1 pair");
  });
});

describe("a datum's tree opens, and holds all of it", () => {
  /** A datum of `fields` byte strings under one constructor. */
  const wide = (fields: number): TxPlutus => ({
    type: "constr",
    constructorIndex: "0",
    fields: Array.from({ length: fields }, (_, i) => ({
      type: "bytes" as const,
      hex: i.toString(16).padStart(2, "0").repeat(4),
      text: null,
    })),
  });
  /** A number no other part of the page shows, to find the bottom of a tree by. */
  const BOTTOM = "987654321";
  /** A datum `levels` constructors deep, with that number at the bottom. */
  const deep = (levels: number): TxPlutus =>
    levels === 0
      ? { type: "int", value: BOTTOM }
      : { type: "constr", constructorIndex: "0", fields: [deep(levels - 1)] };

  const withDatum = (data: TxPlutus): TxDetail => ({
    ...read(cborOf("payment")),
    datums: [{ hash: "ab".repeat(32), hex: "d87980", data }],
  });
  const page = (data: TxPlutus) =>
    text(createElement(TxDetailBody, { detail: withDatum(data), network: "preprod" as const, testId: "tx" }));

  it("says how big a datum is, whatever it shows of it", () => {
    expect(page(wide(2_000))).toContain("2,001 nodes");
    expect(page(deep(100))).toContain("101 nodes");
  });

  it("leaves a big branch closed, and doesn't draw what's closed", () => {
    const shown = page(wide(2_000));
    expect(shown).toContain("Constructor 0 · 2,000 fields");
    // Closed: none of the two thousand is on the page, which is what lets a
    // datum of any size through.
    expect(shown).not.toContain("00000000");
    expect(shown.length).toBeLessThan(3_000);
  });

  it("opens the first couple of levels of a small one, so it reads at a glance", () => {
    const shown = page(deep(4));
    // Two levels open, so three of the four constructors have a row: the two
    // open ones and the closed one they reach. The number at the bottom doesn't.
    expect(shown.match(/Constructor 0 · 1 field/g)!.length).toBe(3);
    expect(shown).not.toContain(BOTTOM);
    // The rest is a click away, or all of it at once.
    expect(shown).toContain("Expand all");
  });

  it("offers the bytes and the JSON, and nothing is counted off", () => {
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(TxDetailBody, { detail: withDatum(wide(2_000)), network: "preprod", testId: "tx" }),
      ),
    );
    expect(html).toContain(">CBOR<");
    expect(html).toContain(">JSON<");
    // The JSON a reader copies holds every one of the two thousand.
    const json = plutusJson(wide(2_000)) as { fields: unknown[] };
    expect(json.fields).toHaveLength(2_000);
  });

  it("writes the JSON in Plutus data's detailed schema, as cardano-cli does", () => {
    expect(
      plutusJson({
        type: "constr",
        constructorIndex: "7",
        fields: [
          { type: "int", value: "-18446744073709551617" },
          { type: "bytes", hex: "53656564656c66", text: "Seedelf" },
          { type: "list", items: [{ type: "int", value: "1" }] },
          { type: "map", entries: [{ key: { type: "bytes", hex: "6b", text: "k" }, value: { type: "int", value: "2" } }] },
        ],
      }),
    ).toEqual({
      constructor: 7,
      fields: [
        { int: "-18446744073709551617" },
        { bytes: "53656564656c66" },
        { list: [{ int: "1" }] },
        { map: [{ k: { bytes: "6b" }, v: { int: "2" } }] },
      ],
    });
  });

  it("counts a map's pairs and a list's items, and names which is which", () => {
    const shown = page({
      type: "map",
      entries: [
        { key: { type: "bytes", hex: "6b", text: "k" }, value: { type: "list", items: [{ type: "int", value: "1" }] } },
      ],
    });
    expect(shown).toContain("1 pair");
    expect(shown).toContain("0 key");
    expect(shown).toContain("0 value");
  });
});

describe("whose datum it is", () => {
  it("reads a register only where the address says the contract is ours", () => {
    // The same transaction read as preprod's and as mainnet's: the datum is the
    // same shape either way, and only the one at our own contract is a register.
    const ours = read(transferPreprod.final.txCbor, "preprod");
    const theirs = read(transferPreprod.final.txCbor, "mainnet");
    expect(ours.outputs.every((o) => o.register !== null)).toBe(true);
    expect(theirs.outputs.every((o) => o.register === null)).toBe(true);
    expect(theirs.outputs[0]!.datum).toEqual(ours.outputs[0]!.datum);

    expect(shown(transferPreprod.final.txCbor, "preprod")).toContain("under a register");
    const elsewhere = shown(transferPreprod.final.txCbor, "mainnet");
    expect(elsewhere).not.toContain("register");
    // And the datum is still there, as the shape it is.
    expect(elsewhere).toContain("Constructor 0 · 2 fields");
  });

  it("says nothing about whose a witness-set datum is", () => {
    // It belongs to whichever output names its hash, which could be any contract.
    const page = shown(cborOf("minswap-swap"));
    expect(page).toContain("A datum");
    expect(page).not.toContain("register");
  });
});
