// A Seedelf's short form and its output index (the 1.10.0 gate; the owner's call of 2026-11-24).
//
// A Seedelf's name is prefix (4 bytes) ‖ tag (0 to 15 bytes) ‖ output index (1 byte) ‖ the id of the transaction whose
// output the mint spent, cut so the whole is 32 bytes (seedelf-contracts/lib/token_name.ak `generate`). The wallet
// showed a name as its prefix and its last sixteen, and said nobody else could choose those. They are bytes of that
// transaction's id: two Seedelfs minted from two outputs of ONE transaction, under tags as long, share them, and a
// live run of the gate made such a pair, which read alike. The short form has the index too now, which those two
// differ at.
//
// Nothing marks where a name's tag ends, so the index is read as the byte after the tag `seedelfLabel` shows. The
// label drops nothing unseen (the 1.10.0 gate's second review): a space that starts the tag, or follows another, is
// shown as "␣", and the spaces that end it read as the index, "#32". What that still can't tell apart is held here
// too, as what it is: said, not closed.
import { describe, expect, it } from "vitest";

import { isSeedelfShort, seedelfIndex, seedelfLabel, seedelfShort, seedelfTail, SHOWN_SPACE } from "../src/shared/seedelf-name";
import { shortValue } from "../src/ui/components/Contacts";
import { shortCounterparty } from "../src/ui/format";
import { conversationTail, ownShown, revealVerifiedText, seedelfShown } from "../src/ui/messaging";

const hex = (text: string) => Buffer.from(text, "latin1").toString("hex");
const byte = (n: number) => n.toString(16).padStart(2, "0");
/** The id of a transaction, and a name as the policy makes one from an output of it (token_name.ak `generate`). */
const TX = "cfb7f7ed50c0d5ea614b7616eb63a4b4b8" + "9d".repeat(15);
const minted = (tag: string, index: number, tx = TX) => ("5eed0e1f" + hex(tag) + byte(index) + tx).slice(0, 64);

// The two the gate's live run minted, each from an output of one transaction.
const GATE_B = "5eed0e1f67617465422d626a613700cfb7f7ed50c0d5ea614b7616eb63a4b4b8";
const GATE_A = "5eed0e1f67617465412d626a613701cfb7f7ed50c0d5ea614b7616eb63a4b4b8";

describe("a Seedelf's output index, read from its name", () => {
  it("is the byte after the tag, for the two the live run minted", () => {
    expect(minted("gateB-bja7", 0)).toBe(GATE_B);
    expect(minted("gateA-bja7", 1)).toBe(GATE_A);
    expect([seedelfLabel(GATE_B), seedelfIndex(GATE_B)]).toEqual(["gateB-bja7", 0]);
    expect([seedelfLabel(GATE_A), seedelfIndex(GATE_A)]).toEqual(["gateA-bja7", 1]);
  });

  it("is the byte after the prefix where there's no tag", () => {
    // The README's tagless example, and one minted from output 7.
    expect(seedelfLabel("5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea")).toBeUndefined();
    expect(seedelfIndex("5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea")).toBe(0);
    expect(seedelfIndex(minted("", 7))).toBe(7);
    expect(seedelfShort(minted("", 7))).toBe(`5eed0e1f…${minted("", 7).slice(-16)}\u00a0#7`);
  });

  it("is the byte after a tag of fifteen bytes, the longest, whatever that byte is", () => {
    const tag = "fifteen-letters";
    expect(tag).toHaveLength(15);
    expect([seedelfLabel(minted(tag, 3)), seedelfIndex(minted(tag, 3))]).toEqual([tag, 3]);
    // The window ends with the tag, so even an index that reads as a letter is read as the index.
    expect([seedelfLabel(minted(tag, 65)), seedelfIndex(minted(tag, 65))]).toEqual([tag, 65]);
  });

  it("is the byte after the tag the label shows: the spaces that end a tag read as it, #32", () => {
    expect(SHOWN_SPACE).toBe(String.fromCharCode(0x2423));
    // " a b ": its first space is shown, its last is the byte after the label.
    expect([seedelfLabel(minted(" a b ", 2)), seedelfIndex(minted(" a b ", 2))]).toEqual(["␣a b", 32]);
    // A tag with no space at either end, as Seedelf Wallet mints one, reads as itself with its own index.
    expect([seedelfLabel(minted("a b", 2)), seedelfIndex(minted("a b", 2))]).toEqual(["a b", 2]);
    // No tag, minted from output 32: no label, and its true index.
    expect([seedelfLabel(minted("", 32)), seedelfIndex(minted("", 32))]).toEqual([undefined, 32]);
    expect(seedelfShort(minted("", 32))).toBe(`5eed0e1f…${minted("", 32).slice(-16)}\u00a0#32`);
    // A run of spaces alone is no label.
    expect([seedelfLabel(minted("   ", 5)), seedelfIndex(minted("   ", 5))]).toEqual([undefined, 32]);
  });

  it("shows a space a page wouldn't draw: one that starts the tag, or follows another", () => {
    expect(seedelfLabel(minted("  alice", 0))).toBe("␣␣alice");
    expect(seedelfLabel(minted("a  b", 0))).toBe("a ␣b");
    expect(seedelfLabel(minted("a   b c", 0))).toBe("a ␣␣b c");
    // One space between two letters is drawn, and stays as it is.
    expect(seedelfLabel(minted("my shop", 0))).toBe("my shop");
  });

  it("is undefined where the name ends before it, and for what isn't hex there", () => {
    expect(seedelfIndex("5eed0e1f")).toBeUndefined();
    expect(seedelfIndex(`5eed0e1f${hex("alice")}`)).toBeUndefined();
    expect(seedelfIndex(`5eed0e1f${hex("alice")}0`)).toBeUndefined();
    expect(seedelfIndex(`5eed0e1f${hex("alice")}0g`)).toBeUndefined();
    expect(seedelfIndex("")).toBeUndefined();
    // The form is the sixteen alone then, as it was.
    expect(seedelfTail(`5eed0e1f${hex("fifteen-letters")}`)).toBe(hex("fifteen-letters").slice(-16));
  });
});

describe("a Seedelf's short form", () => {
  it("is its prefix, its last sixteen, a space, # and its index; the space a no-break one, so no line ends at it", () => {
    expect(seedelfTail(GATE_A)).toBe(`4b7616eb63a4b4b8${String.fromCharCode(0xa0)}#1`);
    expect(seedelfShort(GATE_B)).toBe("5eed0e1f…4b7616eb63a4b4b8\u00a0#0");
    expect(seedelfShort(GATE_A)).toBe("5eed0e1f…4b7616eb63a4b4b8\u00a0#1");
    expect(seedelfTail(GATE_A)).toBe("4b7616eb63a4b4b8\u00a0#1");
    // An index is said in decimal.
    expect(seedelfShort(minted("alice", 0x1f))).toMatch(/\u00a0#31$/);
    expect(seedelfShort(minted("alice", 0xff))).toMatch(/\u00a0#255$/);
  });

  it("tells the live run's two apart everywhere the wallet cuts a name", () => {
    // Their last sixteen are the same bytes of the transaction both mints spent.
    expect(GATE_A.slice(-16)).toBe(GATE_B.slice(-16));
    expect(shortCounterparty(GATE_B)).toBe("5eed0e1f…4b7616eb63a4b4b8\u00a0#0");
    expect(shortCounterparty(GATE_A)).toBe("5eed0e1f…4b7616eb63a4b4b8\u00a0#1");
    // Contacts' rows, Messages' labels, the list's and the header's tail, a reveal's notice, one's own Seedelf.
    expect(shortValue({ value: GATE_A })).toBe("5eed0e1f…4b7616eb63a4b4b8\u00a0#1");
    expect(seedelfShown(GATE_A, undefined)).toEqual({ short: "5eed0e1f…4b7616eb63a4b4b8\u00a0#1", tail: "4b7616eb63a4b4b8\u00a0#1", tag: "gateA-bja7" });
    expect(seedelfShown(GATE_B, undefined)).toEqual({ short: "5eed0e1f…4b7616eb63a4b4b8\u00a0#0", tail: "4b7616eb63a4b4b8\u00a0#0", tag: "gateB-bja7" });
    expect(conversationTail({ role: "initiator", handle: GATE_A }, undefined)).toBe("…4b7616eb63a4b4b8\u00a0#1");
    expect(conversationTail({ role: "responder", revealed: { name: GATE_B, at: 0 } }, undefined)).toBe("…4b7616eb63a4b4b8\u00a0#0");
    expect(revealVerifiedText(GATE_B, undefined)).toBe("Showed you their Seedelf tagged “gateB-bja7” (5eed0e1f…4b7616eb63a4b4b8\u00a0#0), verified on the chain");
    expect(ownShown(GATE_A)).toBe("gateA-bja7 (5eed0e1f…4b7616eb63a4b4b8\u00a0#1)");
  });

  it("tells a lookalike apart: the same tag, minted from another output of the same transaction", () => {
    const mine = minted("alice", 0);
    for (const index of [1, 2, 9, 31, 127, 200, 255]) {
      const theirs = minted("alice", index);
      // Everything the old form showed is the same: the prefix, the tag, the last sixteen.
      expect(seedelfLabel(theirs)).toBe(seedelfLabel(mine));
      expect(theirs.slice(-16)).toBe(mine.slice(-16));
      expect(theirs.slice(0, 8)).toBe(mine.slice(0, 8));
      // The form with its index isn't.
      expect(seedelfShort(theirs), `#${index}`).not.toBe(seedelfShort(mine));
      expect(seedelfShort(theirs)).toBe(`5eed0e1f…${mine.slice(-16)}\u00a0#${index}`);
    }
    // With no tag at all, too.
    expect(seedelfShort(minted("", 1))).not.toBe(seedelfShort(minted("", 0)));
    expect(minted("", 1).slice(-16)).toBe(minted("", 0).slice(-16));
  });

  it("leaves an address as it was, and anything that isn't a Seedelf's name", () => {
    const address = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
    expect(shortCounterparty(address)).toBe("addr_test1qz2fxv2umy…68faae");
    expect(shortCounterparty("ab".repeat(28))).toBe(`${"ab".repeat(6)}…${"ab".repeat(3)}`);
    expect(shortValue({ value: "$bob" })).toBe("$bob");
  });
});

// The two readings the label's trim hid (the first pass's "limits", which the second review reproduced): each reads
// apart now, even from an output of a transaction made for it, whose id starts with the other's index. Such an id
// sorts first among a mint's inputs, so the wallet's mint would name its Seedelf after it.
describe("what the label's trim hid", () => {
  const made = "00" + TX.slice(2);

  it("a sibling minted from output 32 reads #32, its own index, against #0", () => {
    for (const tx of [TX, made]) {
      const mine = minted("alice", 0, tx);
      const theirs = minted("alice", 32, tx);
      expect(theirs.slice(-16)).toBe(mine.slice(-16));
      expect([seedelfLabel(theirs), seedelfIndex(theirs)]).toEqual(["alice", 32]);
      expect([seedelfLabel(mine), seedelfIndex(mine)]).toEqual(["alice", 0]);
      expect(seedelfShort(theirs)).toBe(`5eed0e1f…${mine.slice(-16)}\u00a0#32`);
      expect(seedelfShort(theirs)).not.toBe(seedelfShort(mine));
    }
  });

  it("a tag moved one place behind a space, its last letter the index, reads ␣alice against alice", () => {
    const mine = minted("alice", 0, made);
    const theirs = minted(" alic", 101, made);
    // The same sixteen and the same byte after the run, the transaction's first: the label alone tells them apart.
    expect(seedelfShort(theirs)).toBe(seedelfShort(mine));
    expect(seedelfLabel(theirs)).toBe("␣alice");
    expect(seedelfLabel(mine)).toBe("alice");
    expect(ownShown(theirs)).not.toBe(ownShown(mine));
    expect(revealVerifiedText(theirs, undefined)).not.toBe(revealVerifiedText(mine, undefined));
  });

  it("a tag with two spaces where the other has one reads apart, though a page draws two spaces as one", () => {
    // "my shop" from output 0, and "my  sho" from output 112 (a "p"): the same bytes after, the same sixteen.
    const mine = minted("my shop", 0, made);
    const theirs = minted("my  sho", 112, made);
    expect(seedelfShort(theirs)).toBe(seedelfShort(mine));
    expect(seedelfLabel(mine)).toBe("my shop");
    expect(seedelfLabel(theirs)).toBe("my ␣shop");
  });
});

/** A label as a page draws it: runs of spaces as one, none at its ends. What's left must still tell two names apart. */
const drawn = (text: string) => text.replace(/ +/g, " ").trim();
/** Everything the wallet shows of a name: its label, drawn, and its short form. */
const shown = (name: string) => `${drawn(seedelfLabel(name) ?? "")}|${seedelfShort(name)}`;

describe("no other Seedelf of the same transaction reads as one Seedelf Wallet minted", () => {
  // Every Seedelf that could be minted from one transaction under a tag of up to three bytes, at every index: the
  // wallet's own letters (a space among them), and bytes that aren't printable (a zero, a one, one over 127), which
  // another wallet's mint may hold. The transaction's id starts with bytes chosen against the reading: an index, a
  // space, a letter. Its other bytes all differ, as a real id's do: the sixteen of a tag one byte longer are other
  // bytes of it (to match them takes 64 bits, which is the reading's last limit).
  const LETTERS = [" ", "a", "b"];
  const BYTES = [...LETTERS, "\u0000", "\u0001", "\u0080"];
  const tagsOf = (alphabet: string[], most: number): string[] => {
    let tags = [""];
    const all = [""];
    for (let n = 0; n < most; n++) {
      tags = tags.flatMap((tag) => alphabet.map((c) => tag + c));
      all.push(...tags);
    }
    return all;
  };
  const rest = Array.from({ length: 30 }, (_, i) => byte(0xa0 + i)).join("");
  const heads = ["0000", "0001", "0100", "0020", "2000", "0061", "6100", "2020", "6161", "0062", "6200", "1f00"];

  it.each(heads)("a transaction whose id starts %s", (head) => {
    const tx = head + rest;
    const names = tagsOf(BYTES, 3).flatMap((tag) => Array.from({ length: 256 }, (_, index) => minted(tag, index, tx)));
    expect(new Set(names).size).toBe(names.length);
    const reads = new Map<string, string[]>();
    for (const name of names) reads.set(shown(name), [...(reads.get(shown(name)) ?? []), name]);
    // The wallet's own: a tag of its letters with no space at either end, from an output under 32.
    const own = tagsOf(LETTERS, 3)
      .filter((tag) => tag === tag.trim())
      .flatMap((tag) => Array.from({ length: 32 }, (_, index) => ({ tag, index, name: minted(tag, index, tx) })));
    expect(own.length).toBe(19 * 32);
    const alike = own.filter((o) => reads.get(shown(o.name))!.length !== 1).map((o) => `${JSON.stringify(o.tag)} #${o.index}: ${reads.get(shown(o.name))!.join(" ")}`);
    expect(alike).toEqual([]);
    // And each reads as what it is: its tag (a doubled space marked), and its own index.
    for (const o of own) {
      expect(drawn((seedelfLabel(o.name) ?? "").replaceAll(SHOWN_SPACE, " ")), o.name).toBe(drawn(o.tag));
      expect(seedelfIndex(o.name), o.name).toBe(o.index);
    }
  });

  it("which the brute force would miss with a label that drew two spaces as they are", () => {
    // The check's own check: with the marks taken back out, "a b" from output 0 and "a  " from output 98 read alike.
    const tx = "0000" + rest;
    const plain = (name: string) => `${drawn((seedelfLabel(name) ?? "").replaceAll(SHOWN_SPACE, " "))}|${seedelfShort(name)}`;
    expect(plain(minted("a  ", 98, tx))).toBe(plain(minted("a b", 0, tx)));
    expect(shown(minted("a  ", 98, tx))).not.toBe(shown(minted("a b", 0, tx)));
  });
});

// Nothing in a name marks where its tag ends (`seedelfLabel`'s own comment), so for some names the byte read isn't the
// index. Each case, with what still tells the two apart, or that nothing does: the limits `seedelfIndex` states.
describe("where the byte read isn't the index", () => {
  it("reads an index of 65 as a letter of the tag: the sibling's TAG differs then", () => {
    const mine = minted("alice", 0);
    const theirs = minted("alice", 65);
    // Their index, an "A", is read into the tag, and the byte shown is the transaction's first that isn't printable.
    expect(seedelfLabel(theirs)).toBe("aliceA");
    expect(seedelfIndex(theirs)).toBe(0xcf);
    expect(theirs.slice(-16)).toBe(mine.slice(-16));
    // The tags differ, wherever both are shown.
    expect(seedelfLabel(theirs)).not.toBe(seedelfLabel(mine));
    expect(ownShown(theirs)).not.toBe(ownShown(mine));
    // And the short forms do here, the transaction's first byte not being this one's index.
    expect(seedelfShort(theirs)).toBe(`5eed0e1f…${mine.slice(-16)}\u00a0#207`);
    expect(seedelfShort(theirs)).not.toBe(seedelfShort(mine));
  });

  it("shows a tag's own byte for a tag with one that isn't printable, and so does its sibling (not told apart)", () => {
    // "José", as another wallet may mint it (Seedelf Wallet's own form refuses the tag: seedelf-tag-rule.test.ts).
    const tag = Buffer.from("José", "utf8").toString("latin1");
    const mine = minted(tag, 0);
    const theirs = minted(tag, 1);
    expect(seedelfLabel(mine)).toBe("Jos");
    // The byte shown is the tag's first that isn't printable, the same in both.
    expect(seedelfIndex(mine)).toBe(0xc3);
    expect(seedelfIndex(theirs)).toBe(0xc3);
    expect(mine).not.toBe(theirs);
    expect(seedelfShort(theirs)).toBe(seedelfShort(mine));
    // A control byte in a tag, the same way.
    expect(seedelfIndex(minted("ab\u0001cd", 0))).toBe(1);
    expect(seedelfShort(minted("ab\u0001cd", 4))).toBe(seedelfShort(minted("ab\u0001cd", 0)));
  });

  it("reads #32 for a tag that ends in a space, whatever its index, and so does its sibling (not told apart)", () => {
    // Another wallet's mint: Seedelf Wallet's form trims a tag's ends.
    const mine = minted("alice ", 0);
    const theirs = minted("alice ", 1);
    expect([seedelfLabel(mine), seedelfIndex(mine)]).toEqual(["alice", 32]);
    expect([seedelfLabel(theirs), seedelfIndex(theirs)]).toEqual(["alice", 32]);
    expect(mine).not.toBe(theirs);
    expect(seedelfShort(theirs)).toBe(seedelfShort(mine));
  });
});

describe("a text that is a Seedelf's short form already", () => {
  it("is what seedelfShort writes, with its index or without", () => {
    for (const name of [GATE_A, GATE_B, minted("", 255), minted("fifteen-letters", 7), minted(" a b ", 2)]) expect(isSeedelfShort(seedelfShort(name)), name).toBe(true);
    expect(isSeedelfShort("5eed0e1f…4b7616eb63a4b4b8\u00a0#1")).toBe(true);
    expect(isSeedelfShort("5eed0e1f…4b7616eb63a4b4b8")).toBe(true);
  });

  it("and nothing else: what an entry saved before, a whole name, an address, a tag, a sentence", () => {
    for (const text of [
      // Twelve and six, as Activity saved a Seedelf with no tag before 1.10.0.
      "5eed0e1f00cf…a4b4b8",
      GATE_A,
      "addr_test1qz2fxv2umy…68faae",
      "alice",
      "5eed0e1f…4b7616eb63a4b4b8 #1",
      "5eed0e1f…4b7616eb63a4b4b8\u00a0#1234",
      "5eed0e1f…4b7616eb63a4b4b8\u00a0#",
      "5eed0e1f…4b7616eb63a4b4\u00a0#1",
      "5eed0e1f…4b7616eb63a4b4b8\u00a0#1 and 2 more",
      "x5eed0e1f…4b7616eb63a4b4b8\u00a0#1",
    ]) expect(isSeedelfShort(text), text).toBe(false);
  });
});
