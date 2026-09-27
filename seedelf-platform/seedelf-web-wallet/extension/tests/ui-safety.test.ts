// Smaller safety points on the wallet's screens, rendered as the page shows
// them: a banner's detail line has a style of its own, the To field asks for
// the network's own addresses, Max and the UTxOs screen say what no payment
// takes, and DReps and pools that share a name are flagged, with their IDs.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DestinationField } from "../src/ui/components/Destination";
import { LeftOutNote } from "../src/ui/components/LeftOut";
import { TxBanner } from "../src/ui/components/TxBanner";
import { NetworkContext } from "../src/ui/network";
import { MixHolding, UtxoDetails, utxoTag } from "../src/ui/screens/Utxos";
import { PoolListRow, SharedTicker } from "../src/ui/screens/Pools";
import { DrepCard, DrepRow } from "../src/ui/screens/Voting";
import { poolLabel, sharedNames, sharing, shortId, voteLabel } from "../src/ui/format";

describe("a transaction's banner", () => {
  it("gives what it means a line of its own, quieter than the title", () => {
    const html = renderToStaticMarkup(
      createElement(TxBanner, {
        state: "waiting",
        title: "Payment may have gone through",
        detail: "Koios didn't answer.",
        network: "preprod",
        txHash: "ab".repeat(32),
        testId: "pending-tx",
      }),
    );
    expect(html).toContain('<span class="tx-banner__detail" data-testid="pending-tx-detail">Koios didn&#x27;t answer.</span>');
  });
});

describe("the To field", () => {
  it("asks for the network's own addresses: addr1… on mainnet, addr_test1… on preprod (launch review #58)", () => {
    const field = (network: "mainnet" | "preprod", seedelfs: boolean) =>
      renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: network },
          createElement(DestinationField, { id: "to", value: "", onChange: () => undefined, read: { state: "idle" }, seedelfs }),
        ),
      ).match(/placeholder="([^"]*)"/)![1];
    expect(field("mainnet", false)).toBe("addr1… or $handle");
    expect(field("mainnet", true)).toBe("addr1…, $handle or 5eed0e1f…");
    expect(field("preprod", false)).toBe("addr_test1… or $handle");
  });
});

describe("Max's review", () => {
  it("lists each UTxO it left out, and why (launch review H6, #12)", () => {
    const html = renderToStaticMarkup(
      createElement(LeftOutNote, {
        testId: "send-left-out",
        leftOut: [
          { txHash: "a1".repeat(32), txIndex: 0, reason: "tokens" },
          { txHash: "b2".repeat(32), txIndex: 3, reason: "script" },
        ],
      }),
    );
    const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(text).toContain("Max leaves 2 UTxOs where they are:");
    expect(text).toContain(`${"a1".repeat(4)}…a1a1#0 comes with a later payment`);
    expect(text).toContain(`${"b2".repeat(4)}…b2b2#3 holds a reference script the wallet can't spend`);
    expect(text).toContain("would add up to more with the rest than one output can hold");
    expect(renderToStaticMarkup(createElement(LeftOutNote, { testId: "x", leftOut: [] }))).toBe("");
  });

  it("says a UTxO a return through Lovejoin still spends waits for it (final review lovejoin-3)", () => {
    const html = renderToStaticMarkup(
      createElement(LeftOutNote, { testId: "withdraw-left-out", leftOut: [{ txHash: "c3".repeat(32), txIndex: 1, reason: "returning" }] }),
    );
    const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(text).toContain(`${"c3".repeat(4)}…c3c3#1 waits for a return through Lovejoin that's still being sent, which adds to it`);
    expect(text).not.toContain("reference script");
  });
});

describe("the UTxOs screen", () => {
  const utxo = { txHash: "c3".repeat(32), index: 1, lovelace: "3000000", tokens: [], locked: false };
  it("marks a UTxO no payment can take, and says why on each side", () => {
    expect(utxoTag({ ...utxo, unspendable: "script" })).toBe("Can't spend");
    expect(utxoTag({ ...utxo, locked: true })).toBe("Locked");
    const details = (of: "seedelf" | "cardano") =>
      renderToStaticMarkup(
        createElement(UtxoDetails, { of, utxo: { ...utxo, unspendable: "script" }, busy: false, onLock: () => undefined, onClose: () => undefined }),
      );
    const priv = details("seedelf");
    expect(priv).toContain('data-testid="utxo-unspendable"');
    expect(priv).toContain("it isn&#x27;t counted in your private balance");
    // No Lock for it: there's nothing to keep it out of.
    expect(priv).not.toContain(">Lock<");
    expect(details("cardano")).toContain("Koios doesn&#x27;t give the wallet");
  });
});

describe("DReps and pools that share a name (launch review #59)", () => {
  const drep = (id: string, name: string) => ({ id, name });
  const EIGHT_A = "drep1y296z8tm7y7elwsmsewn4q2tdr5gu0fqztq97yttlpv7zycvsl554";
  const EIGHT_B = "drep1y296zyw2r8rcsy7slkd7l687hh88xc0m6ac2y3h2r3mvsdgc9q6yy";

  it("counts names as they look, so 8Ball and 8 BALL are one name", () => {
    const counts = sharedNames([drep(EIGHT_A, "8Ball"), drep(EIGHT_B, "8 BALL"), drep("drep1x", "Other")], (d) => d.name);
    expect(sharing(counts, "8ball")).toBe(2);
    expect(sharing(counts, "Other")).toBe(1);
    expect(sharing(counts, undefined)).toBe(0);
  });

  it("shows enough of an ID for its hash to tell two apart, where 10 characters didn't", () => {
    expect(EIGHT_A.slice(0, 10)).toBe(EIGHT_B.slice(0, 10));
    expect(shortId(EIGHT_A).split("…")[0]).not.toBe(shortId(EIGHT_B).split("…")[0]);
    expect(voteLabel(EIGHT_A)).toBe(shortId(EIGHT_A));
    expect(poolLabel({ id: "pool1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" })).toBe(shortId("pool1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"));
  });

  it("flags a shared name in the list, and shows the ID", () => {
    const row = (shared: boolean) =>
      renderToStaticMarkup(createElement(DrepRow, { drep: drep(EIGHT_A, "8Ball"), shared, disabled: false, onPick: () => undefined }));
    expect(row(true)).toContain("Shared name");
    expect(row(true)).toContain(shortId(EIGHT_A));
    expect(row(false)).not.toContain("Shared name");
    // Invisible characters that could reorder a name are dropped from what's shown.
    const hidden = renderToStaticMarkup(
      createElement(DrepRow, { drep: drep(EIGHT_A, "‮LLAB8"), shared: false, disabled: false, onPick: () => undefined }),
    );
    expect(hidden).not.toContain("‮");
  });

  it("warns on the card of a DRep whose name others use, and shows its whole ID", () => {
    const details = { id: EIGHT_A, name: "8Ball", status: "registered", active: true, expiresEpoch: null, votingPower: "1", delegators: 1 };
    const card = renderToStaticMarkup(createElement(DrepCard, { drep: details as never, shared: 2 }));
    expect(card).toContain('data-testid="drep-shared-name"');
    expect(card).toContain(EIGHT_A);
    expect(renderToStaticMarkup(createElement(DrepCard, { drep: details as never, shared: 1 }))).not.toContain("drep-shared-name");
  });

  it("flags a pool's shared ticker in the list and on its page", () => {
    const pool = { id: "pool1abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklm", ticker: "LOGIC", margin: 0.01, cost: "340000000", pledge: "0", saturation: 10 };
    const row = renderToStaticMarkup(createElement(PoolListRow, { pool: pool as never, current: false, shared: true, onOpen: () => undefined }));
    expect(row).toContain("Shared ticker");
    expect(row).toContain(shortId(pool.id));
    expect(renderToStaticMarkup(createElement(SharedTicker, { shared: 3 }))).toContain("3 live pools use this ticker");
    expect(renderToStaticMarkup(createElement(SharedTicker, { shared: 1 }))).toBe("");
  });
});

describe("the public UTxOs while a mix is sent", () => {
  it("says the mix holds what it spends, until it's all sent", () => {
    const shown = renderToStaticMarkup(createElement(MixHolding, { progress: { total: 5, sent: 2 } }));
    expect(shown).toContain('data-testid="utxos-mix-holding"');
    expect(shown).toContain("2 of 5 sent");
    for (const progress of [null, { total: 5, sent: 5 }, { total: 5, sent: 2, stopped: "locked" }]) {
      expect(renderToStaticMarkup(createElement(MixHolding, { progress }))).toBe("");
    }
  });
});
