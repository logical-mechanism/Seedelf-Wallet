// What Activity says of an entry: who it paid or who paid it, what its file holds, and the names and notes others
// wrote, as chunk 51's whole review left them.
//
// - gap-g10#2: a counterparty's address was cut to its first 3 to 10 characters and its last 6, and the last 6 are a
//   bech32 checksum anyone can solve for, so a poisoner's address read as the one paid before. It keeps ten characters
//   of its own data now, a Seedelf's name its last sixteen (and, since the 1.10.0 gate, its output index:
//   seedelf-short-form.test.ts), and the lists' short forms the same.
// - e9a#5: the CSV kept a private payment still marked Pending (the one Home watches), against its own promise.
// - e9a#6: a session's funding or return, and a box back from Lovejoin, were labelled "Seedelf".
// - gap-g7#3's class: a CIP-20 note another wrote was shown raw, bidi and zero-width characters and all, where the sign
//   window writes such characters as their codes (the DRep names are cleaned where the list loads, ui/dreps.ts, and
//   drep-names-shown.test.ts holds them).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "../src/shared/rpc";

const { t } = await import("../src/i18n");
const { activityCsv, exported } = await import("../src/ui/activity");
const { detailLabel, EntryNote, Who } = await import("../src/ui/screens/Activity");
const { shortCounterparty } = await import("../src/ui/format");
const { shortValue } = await import("../src/ui/components/Contacts");

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  txHash: "aa".repeat(32),
  at: Date.UTC(2026, 10, 1),
  kind: "transfer",
  direction: "out",
  lovelace: "2000000",
  tokens: 0,
  ...over,
});

describe("a counterparty's address, cut to what no one else can choose (chunk 51, gap-g10#2)", () => {
  // CIP-19's base address, and one a poisoner made by solving six symbols of its own stake part (the finding's run):
  // the same last six, a different payment part.
  const BOB = "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
  const POISON = "addr1q8w9pjhjf40ysqum9knusa5c5dgmvdqn9cc8l2ny7tgem8uvtr5s4vwq832vl6dd67z8vjrcguchrvgq3h8tc6wv3dwqe35a3x";

  it("keeps ten characters of an address's own data after its prefix, and its last six", () => {
    expect(shortCounterparty(BOB)).toBe("addr1qx2fxv2umy…e35a3x");
    expect(shortCounterparty(POISON)).toBe("addr1q8w9pjhjf4…e35a3x");
    // A testnet address keeps as much of its own data, its longer prefix aside.
    const preprod = `addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae`;
    expect(shortCounterparty(preprod)).toBe("addr_test1qz2fxv2umy…68faae");
  });

  it("keeps a Seedelf's name's last sixteen, eight bytes of the transaction its mint spent, and its output index", () => {
    const name = `5eed0e1f${"61".repeat(5)}00${"0123456789abcdef".repeat(3)}12345678`;
    expect(shortCounterparty(name)).toBe(`5eed0e1f…${name.slice(-16)}\u00a0#0`);
    // And the lists' short forms say the same, a contact's included.
    expect(shortValue({ value: name })).toBe(shortCounterparty(name));
    expect(shortValue({ value: BOB })).toBe(shortCounterparty(BOB));
    expect(shortValue({ value: "$bob" })).toBe("$bob");
  });

  it("is what an entry's line shows of the address it paid, whole on the element, the poisoner's told apart", () => {
    const line = (name: string) => renderToStaticMarkup(createElement(Who, { name }));
    expect(line(BOB)).toContain(`title="${BOB}"`);
    expect(line(BOB)).toContain(">addr1qx2fxv2umy…e35a3x<");
    expect(line(POISON)).toContain(">addr1q8w9pjhjf4…e35a3x<");
    // A tag or a $handle is short and said whole.
    expect(line("alice")).toBe("<span>alice</span>");
  });

  // The 1.10.0 gate's second review: the worker saves a Seedelf with no tag already cut (seedelf-name.ts
  // `seedelfShort`), its no-break space and index in it. As a plain span it could neither wrap nor shrink, and the
  // line clipped its end, the index, beside most amounts at 360 px.
  it("says a Seedelf's saved short form as it is, in the part that takes a line of its own, never cut again", () => {
    const line = (name: string) => renderToStaticMarkup(createElement(Who, { name }));
    /** What a line says, its tags aside. */
    const said = (html: string) => html.replace(/<[^>]*>/g, "");
    for (const saved of ["5eed0e1f…4b7616eb63a4b4b8\u00a0#1", "5eed0e1f…4b7616eb63a4b4b8\u00a0#255", "5eed0e1f…4b7616eb63a4b4b8"]) {
      expect(line(saved), saved).toMatch(/^<span class="activity__who">[^<]*<wbr\/>[^<]*<\/span>$/);
      // Every character of it, and nothing more.
      expect(said(line(saved))).toBe(saved);
    }
    // It may break in the middle of its sixteen, so never before its index.
    expect(line("5eed0e1f…4b7616eb63a4b4b8\u00a0#1")).toBe(`<span class="activity__who">5eed0e1f…4b7616eb<wbr/>63a4b4b8\u00a0#1</span>`);
    // `shortCounterparty` would cut it a second time: never called for it.
    expect(shortCounterparty("5eed0e1f…4b7616eb63a4b4b8")).not.toBe("5eed0e1f…4b7616eb63a4b4b8");
  });

  it("leaves what an entry saved before as it was: twelve and six, short and whole", () => {
    const line = (name: string) => renderToStaticMarkup(createElement(Who, { name }));
    expect(line("5eed0e1f00cf…a4b4b8")).toBe("<span>5eed0e1f00cf…a4b4b8</span>");
    // And a whole name the chain's reading gives is cut here, once, with the whole of it on the element.
    const whole = "5eed0e1f00cfb7f7ed50c0d5ea614b7616eb63a4b4b89d9d9d9d9d9d9d9d9d9d9d";
    expect(line(whole)).toBe(`<span class="activity__who" title="${whole}" data-value="${whole}">5eed0e1f…${whole.slice(-16)}\u00a0#0</span>`);
  });

  it("keeps the saved short form its own part beside 'and 2 more'", () => {
    const html = renderToStaticMarkup(createElement(Who, { name: "5eed0e1f…4b7616eb63a4b4b8\u00a0#1", more: 2 }));
    expect(html).toBe(`<span class="activity__who">5eed0e1f…4b7616eb<wbr/>63a4b4b8\u00a0#1</span><span class="activity__more"> and 2 more</span>`);
  });
});

describe("Save as CSV (chunk 51, e9a#5)", () => {
  it("leaves out the private payment Home watches, as it leaves out the public side's pending", () => {
    const watched = entry({ txHash: "bb".repeat(32) });
    const landed = entry({ txHash: "cc".repeat(32), at: Date.UTC(2026, 9, 1) });
    const pending = entry({ txHash: "dd".repeat(32), pending: true });
    const entries = [watched, pending, landed];
    expect(exported(entries).map((e) => e.txHash)).toEqual([watched.txHash, landed.txHash]);
    expect(exported(entries, watched.txHash).map((e) => e.txHash)).toEqual([landed.txHash]);
    const csv = activityCsv("preprod", entries, watched.txHash);
    expect(csv).toContain(landed.txHash);
    expect(csv).not.toContain(watched.txHash);
    expect(csv).not.toContain(pending.txHash);
  });
});

describe("an entry's who-or-where row (chunk 51, e9a#6)", () => {
  it("is From or To by which way the money went, and Seedelf only for one made or removed", () => {
    const label = (kind: ActivityEntry["kind"], direction: ActivityEntry["direction"]) => detailLabel(entry({ kind, direction }));
    expect(label("session-out", "out")).toBe("activity.row.to");
    expect(label("session-back", "in")).toBe("activity.row.from");
    expect(label("lovejoin-withdraw", "in")).toBe("activity.row.from");
    expect(label("received", "in")).toBe("activity.row.from");
    expect(label("transfer", "out")).toBe("activity.row.to");
    expect(label("send", "out")).toBe("activity.row.to");
    expect(label("mint", "none")).toBe("activity.row.seedelf");
    expect(label("remove", "none")).toBe("activity.row.seedelf");
  });
});

describe("what others wrote, as Activity shows it (chunk 51, gap-g7#3's class)", () => {
  it("writes a note's characters that reorder or hide the rest as their codes, and says so", () => {
    const html = renderToStaticMarkup(createElement(EntryNote, { note: "Pay \u202E0001 ADA" }));
    expect(html).toContain("Pay \\u{202E}0001 ADA");
    expect(html).not.toContain("\u202E");
    expect(html).toContain('data-testid="activity-note-codes"');
    expect(html.replace(/&#x27;/g, "'")).toContain(t("dappUi.warn.hiddenChars"));
    // A plain note says nothing of codes.
    expect(renderToStaticMarkup(createElement(EntryNote, { note: "Thanks for lunch" }))).not.toContain("activity-note-codes");
  });
});
