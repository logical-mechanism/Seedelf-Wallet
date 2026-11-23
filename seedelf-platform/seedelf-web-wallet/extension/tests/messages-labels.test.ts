// protocol.md §7's labels as Messages says them (src/ui/messaging.ts), held in all three languages (the 1.10.0 gate's
// screens#12 and tests-ci#5 (f): nothing in tests/ read them before). A label is what tells the user who the other
// side is, so a tag anyone can mint never stands in a contact's place (screens#3), "Continues" is said only of a
// verified continuation, a sentence is never put together from translated pieces (i18n#2), and a conversation started
// again and then answered is live again (screens#2).
import { afterAll, describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";
import type { Contact, MessagingConversation } from "../src/shared/rpc";
import {
  answeredAfterRestart,
  clockHoursOf,
  continuedName,
  conversationDetail,
  conversationTail,
  conversationTitle,
  expiresOf,
  initialOf,
  ownShown,
  revealVerifiedText,
  seedelfOf,
  seedelfShown,
  shareUsedUp,
  tagShared,
} from "../src/ui/messaging";

afterAll(async () => {
  await i18n.changeLanguage("en");
});

/** A Seedelf's name: the prefix, its tag (none if empty), and its last sixteen. */
const nameOf = (tag: string, tail = "0123456789abcdef") => {
  const head = "5eed0e1f" + Buffer.from(tag).toString("hex") + "00";
  return head + "c".repeat(64 - head.length - tail.length) + tail;
};
const ALICE = nameOf("alice");
const BOB = nameOf("bob", "fedcba9876543210");
const MINE = nameOf("web-wallet", "1111222233334444");
/** A Seedelf with no tag: the byte after the prefix isn't printable. */
const BARE = "5eed0e1f" + "00" + "ab".repeat(20) + "0123456789abcdef";
/** A stranger's Seedelf tagged as the user's contact for ALICE is named. */
const LOOKALIKE = nameOf("Alice B", "aaaabbbbccccdddd");
const CONTACTS: Contact[] = [{ id: "1", name: "Alice B", kind: "seedelf", value: ALICE, network: "preprod" }];
const titleOf = (cid: string) => (cid === "old" ? "Old one" : undefined);

type Labelled = Pick<MessagingConversation, "role" | "handle" | "to" | "continues" | "name" | "revealed">;
const label = (c: Labelled, contacts?: Contact[]) => ({
  title: conversationTitle(c, contacts),
  tail: conversationTail(c, contacts),
  detail: conversationDetail(c, contacts, titleOf),
});

describe("§7's labels, each row of its table", () => {
  it("names a Seedelf the user wrote to by its tag, with its last sixteen beside it, and by a contact as Send does", () => {
    expect(label({ role: "initiator", handle: ALICE })).toEqual({
      title: "alice",
      tail: "…0123456789abcdef",
      detail: ["5eed0e1f…0123456789abcdef"],
    });
    // A contact's name only for the contact's own Seedelf, and said to be one; no tail, which marks a tag.
    expect(label({ role: "initiator", handle: ALICE }, CONTACTS)).toEqual({
      title: "Alice B",
      tail: undefined,
      detail: ["Your contact · 5eed0e1f…0123456789abcdef"],
    });
    // The user's own name stands over the label, which is still said under it.
    expect(label({ role: "initiator", handle: ALICE, name: "Work" })).toEqual({
      title: "Work",
      tail: undefined,
      detail: ["alice", "5eed0e1f…0123456789abcdef"],
    });
  });

  it("never lets a tag that copies a contact's name read as the contact (screens#3)", () => {
    const stranger = label({ role: "responder", to: MINE, revealed: { name: LOOKALIKE, at: 1 } }, CONTACTS);
    const contact = label({ role: "responder", to: MINE, revealed: { name: ALICE, at: 1 } }, CONTACTS);
    // The same text in the name's place: the tag is "Alice B", as is the contact.
    expect(stranger.title).toBe(contact.title);
    // But the tag carries its last sixteen and no "your contact"; the contact's line says it's one.
    expect(stranger.tail).toBe("…aaaabbbbccccdddd");
    expect(contact.tail).toBeUndefined();
    expect(stranger.detail).toEqual(["Verified Seedelf 5eed0e1f…aaaabbbbccccdddd", "Wrote to your Seedelf web-wallet (5eed0e1f…1111222233334444)"]);
    expect(contact.detail).toEqual([
      "Verified Seedelf 5eed0e1f…0123456789abcdef · your contact",
      "Wrote to your Seedelf web-wallet (5eed0e1f…1111222233334444)",
    ]);
    // And the shared name is flagged, for the stranger's alone.
    expect(tagShared(LOOKALIKE, CONTACTS, [])).toBe(true);
    expect(tagShared(ALICE, CONTACTS, [])).toBe(false);
  });

  it("flags a tag that reads as another conversation's name for another Seedelf, lookalike letters and case folded", () => {
    expect(tagShared(BOB, [], [{ title: "B0B", seedelf: nameOf("x") }])).toBe(true);
    // The same Seedelf in another conversation (started again, say) is no other.
    expect(tagShared(BOB, [], [{ title: "bob", seedelf: BOB }])).toBe(false);
    // A name the user gave a conversation with no Seedelf known counts too.
    expect(tagShared(BOB, [], [{ title: "Bob" }])).toBe(true);
    expect(tagShared(BOB, [], [{ title: "Carol", seedelf: nameOf("carol") }])).toBe(false);
    // Nothing is flagged for a Seedelf with no tag: its name's place says "Seedelf".
    expect(tagShared(BARE, [], [{ title: "Seedelf" }])).toBe(false);
  });

  it("says nothing of a Seedelf for a stranger who showed none: an unknown sender, and the Seedelf of the user's they wrote to", () => {
    expect(label({ role: "responder", to: MINE })).toEqual({
      title: "Unknown sender",
      tail: undefined,
      detail: ["Wrote to your Seedelf web-wallet (5eed0e1f…1111222233334444)"],
    });
    expect(seedelfOf({ role: "responder" })).toBeUndefined();
    expect(initialOf("Unknown sender", false)).toBe("?");
  });

  it("says 'Continues' only of a verified continuation, and 'Says it continues … (unverified)' of a claim", () => {
    expect(label({ role: "responder", continues: { cid: "old", verified: true } }).detail).toEqual(["Continues Old one"]);
    expect(label({ role: "responder", to: MINE, continues: { cid: "old", verified: false } }).detail).toEqual([
      "Wrote to your Seedelf web-wallet (5eed0e1f…1111222233334444)",
      "Says it continues Old one (unverified)",
    ]);
    // A request's one line says what it continues first, where the rest would cut it off (screens#14).
    expect(
      conversationDetail({ role: "responder", to: MINE, continues: { cid: "old", verified: false } }, undefined, titleOf, { continuesFirst: true })[0],
    ).toBe("Says it continues Old one (unverified)");
  });

  it("names a continuation with nothing to call it in a sentence of its own, never 'Continues Unknown sender' (i18n#2)", () => {
    expect(label({ role: "responder", continues: { cid: "gone", verified: true } }).detail).toEqual(["Continues an earlier conversation"]);
    expect(label({ role: "responder", continues: { cid: "gone", verified: false } }).detail).toEqual([
      "Says it continues an earlier conversation (unverified)",
    ]);
    // What Messages hands it: a conversation's own name, its Seedelf's contact or tag, else the short name; none for
    // an unknown sender's.
    expect(continuedName({ role: "responder" }, undefined)).toBeUndefined();
    expect(continuedName({ role: "responder", name: "Bea" }, undefined)).toBe("Bea");
    expect(continuedName({ role: "initiator", handle: ALICE }, CONTACTS)).toBe("Alice B");
    expect(continuedName({ role: "initiator", handle: BARE }, undefined)).toBe("5eed0e1f…0123456789abcdef");
  });
});

describe("a verified reveal's line (protocol.md §19.5)", () => {
  it("says which it is, as Send does: a contact, a tag as a tag, or the short name alone", () => {
    expect(revealVerifiedText(ALICE, CONTACTS)).toBe(
      "Showed you their Seedelf, your contact Alice B (5eed0e1f…0123456789abcdef), verified on the chain",
    );
    expect(revealVerifiedText(LOOKALIKE, CONTACTS)).toBe(
      "Showed you their Seedelf tagged “Alice B” (5eed0e1f…aaaabbbbccccdddd), verified on the chain",
    );
    expect(revealVerifiedText(BARE, undefined)).toBe("Showed you their Seedelf 5eed0e1f…0123456789abcdef, verified on the chain");
  });

  it("never says 'Seedelf Seedelf' for an untagged one, in any language (i18n#2)", async () => {
    for (const lang of ["en", "es", "ja"]) {
      await i18n.changeLanguage(lang);
      expect(revealVerifiedText(BARE, undefined)).not.toMatch(/Seedelf\s+Seedelf/);
      expect(conversationDetail({ role: "responder", to: BARE }, undefined, titleOf).join(" ")).not.toMatch(/Seedelf\s+Seedelf/);
    }
    await i18n.changeLanguage("en");
  });

  it("says in Spanish and Japanese whose Seedelf it is: the other side's own (i18n#3)", async () => {
    await i18n.changeLanguage("es");
    expect(revealVerifiedText(LOOKALIKE, CONTACTS)).toBe(
      "Te mostró su Seedelf con la etiqueta “Alice B” (5eed0e1f…aaaabbbbccccdddd), verificado en la cadena",
    );
    expect(revealVerifiedText(ALICE, CONTACTS)).toContain("tu contacto Alice B");
    await i18n.changeLanguage("ja");
    expect(revealVerifiedText(BARE, undefined)).toBe("相手が自分の Seedelf 5eed0e1f…0123456789abcdef を見せました。チェーン上で検証済みです");
    expect(revealVerifiedText(LOOKALIKE, CONTACTS)).toContain("タグ「Alice B」");
    await i18n.changeLanguage("en");
  });

  it("keeps the unverified word in every language: the one word no negation check reads", async () => {
    const claim = { role: "responder" as const, continues: { cid: "old", verified: false } };
    const words: Record<string, RegExp> = { en: /\(unverified\)/, es: /\(sin verificar\)/, ja: /（未検証）/ };
    for (const [lang, word] of Object.entries(words)) {
      await i18n.changeLanguage(lang);
      expect(conversationDetail(claim, undefined, titleOf).join(" ")).toMatch(word);
      expect(conversationDetail({ ...claim, continues: { cid: "gone", verified: false } }, undefined, titleOf).join(" ")).toMatch(word);
    }
    await i18n.changeLanguage("en");
  });
});

describe("the names under a Seedelf", () => {
  it("cut a name to its prefix and its last sixteen, and read a tag as the list does", () => {
    expect(seedelfShown(ALICE, undefined)).toEqual({ short: "5eed0e1f…0123456789abcdef", tail: "0123456789abcdef", tag: "alice" });
    expect(seedelfShown(ALICE, CONTACTS)).toMatchObject({ contact: "Alice B", tag: "alice" });
    expect(seedelfShown(BARE, undefined)).toEqual({ short: "5eed0e1f…0123456789abcdef", tail: "0123456789abcdef" });
    expect(ownShown(MINE)).toBe("web-wallet (5eed0e1f…1111222233334444)");
    expect(ownShown(BARE)).toBe("5eed0e1f…0123456789abcdef");
  });
});

describe("a conversation started again (screens#2)", () => {
  const base = { restartedAs: "next", unanswered: false } as const;
  it("is live again once the other side answered in it, and not before", () => {
    // Started again after 48 hours with no reply: unanswered until a reply comes.
    expect(answeredAfterRestart({ ...base, unanswered: true })).toBe(false);
    expect(answeredAfterRestart(base)).toBe(true);
    // Started again with its share of first messages used up: that's said until a reply comes.
    expect(answeredAfterRestart({ ...base, firstContactLeft: { messages: 0, bytes: 0 } })).toBe(false);
    // Continued in a new one where it couldn't continue: live once a later message of it decrypts.
    expect(answeredAfterRestart({ ...base, unreachable: true })).toBe(false);
    // Never started again: nothing to say.
    expect(answeredAfterRestart({ unanswered: false })).toBe(false);
  });

  it("knows a share used up from what's left of it", () => {
    expect(shareUsedUp({ firstContactLeft: { messages: 0, bytes: 0 } })).toBe(true);
    expect(shareUsedUp({ firstContactLeft: { messages: 3, bytes: 900 } })).toBe(false);
    expect(shareUsedUp({})).toBe(false);
  });
});

describe("times and the clock", () => {
  it("says when a sent message leaves the server in the language's own words, with no word of the wallet's (i18n#5)", () => {
    const now = new Date(2026, 10, 22, 15, 0).getTime();
    const today = new Date(2026, 10, 22, 21, 15).getTime();
    const tomorrow = new Date(2026, 10, 23, 9, 15).getTime();
    expect(expiresOf(today, now)).toMatch(/^\d{1,2}:15/);
    // Another day: its date with the time, never "tomorrow" put in from the wallet's words.
    expect(expiresOf(tomorrow, now)).toMatch(/23/);
    expect(expiresOf(tomorrow, now)).not.toMatch(/tomorrow/i);
  });

  it("gives the clock's offset in hours, one decimal, without its sign", () => {
    expect(clockHoursOf(2.5)).toBe("2.5");
    expect(clockHoursOf(-0.6)).toBe("0.6");
    expect(clockHoursOf(-3)).toBe("3");
  });
});
