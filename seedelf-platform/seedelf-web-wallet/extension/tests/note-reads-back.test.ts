// Chunk 51, still#5: a note the wallet writes reads back whole in its own Activity. Core and the Send form take 500
// characters (code points, Rust's `chars`), and core cuts the note into CIP-20's 64-byte lines, at a space where one
// fits (dropping it) and between characters where none does. Activity kept 500 UTF-16 units of the lines joined with a
// space each, so a Japanese note, a long link or emoji came back cut, and an emoji cut in half left a lone surrogate.
// It now keeps 500 characters of the lines' own text, never cutting inside one; the spaces joining the lines aren't
// the sender's. A stranger's note stays bounded.
import { describe, expect, it } from "vitest";

import { noteOf } from "../src/background/activity";
import { SESSION_SEND } from "../src/background/send";
import type { TxDetail } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;
/** What the Send form takes, as it counts it (CardanoSend.tsx `[...note]`), and core (note.rs MAX_NOTE_CHARS). */
const FORM_MAX = 500;
const LONE_SURROGATE = /\p{Cs}/u;

/** `note` sent from the public account, its CIP-20 lines read off the built transaction, read back as Activity does. */
async function sendAndReadBack(note: string): Promise<string> {
  expect([...note].length, "the form takes it").toBeLessThanOrEqual(FORM_MAX);
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }], note);
  expect(summary.note, "core takes it whole").toBe(note);
  const built = await t.session.get<{ txCbor: string }>(SESSION_SEND);
  const wasm = loadTestWasm();
  const lines = (JSON.parse(wasm.decodeTx(wasm.Network.Preprod, built!.txCbor)) as TxDetail).note!;
  expect(lines.length, "core's 64-byte lines").toBeGreaterThan(1);
  expect(note.includes(" ") ? lines.join(" ") : lines.join(""), "every character is on the transaction").toBe(note);
  return noteOf({ "674": { msg: lines } })!;
}

describe("a note the wallet writes reads back whole in its own Activity (chunk 51, still#5)", () => {
  it("of 500 characters cut at spaces, exactly", async () => {
    const note = "Invoice 2026-118 for October design work, purchase order PO-77341. ".repeat(10).slice(0, 500).trim();
    expect(await sendAndReadBack(note)).toBe(note);
  });

  it("at the cap, ending in an emoji, exactly and never cut inside it", async () => {
    const words = "Thanks for dinner and the lift home, see you at the meetup next week. ";
    const note = `${words.repeat(10).slice(0, 499).trimEnd().padEnd(499, ".")}🎉`;
    const shown = await sendAndReadBack(note);
    expect.soft(LONE_SURROGATE.test(shown), "a lone surrogate").toBe(false);
    expect.soft(shown).toBe(note);
  });

  // With no space to cut at, core cuts between characters, and Activity joins the lines with a space as other wallets
  // do (note.rs `text`): every character comes back, with a space where each cut fell.
  it("in Japanese, 480 characters, every one of them", async () => {
    const note = "お支払いありがとうございました。".repeat(30);
    expect((await sendAndReadBack(note)).replaceAll(" ", "")).toBe(note);
  });

  it("a pasted link of 500 characters, every one of them", async () => {
    const note = `https://pay.example/invoice?ref=${"0123456789abcdef".repeat(30).slice(0, 468)}`;
    expect((await sendAndReadBack(note)).replaceAll(" ", "")).toBe(note);
  });

  it("of 500 emoji, core's longest, every one of them and never half of one", async () => {
    const note = "🌱".repeat(500);
    const shown = await sendAndReadBack(note);
    expect.soft(LONE_SURROGATE.test(shown), "a lone surrogate").toBe(false);
    expect.soft(shown.replaceAll(" ", "")).toBe(note);
  });
});

describe("a stranger's note in Activity (chunk 51, still#5)", () => {
  it("is cut at 500 characters, never inside one", () => {
    const shown = noteOf({ "674": { msg: [`a${"🌱".repeat(600)}`] } })!;
    expect(LONE_SURROGATE.test(shown)).toBe(false);
    expect(shown).toBe(`a${"🌱".repeat(499)}…`);
    expect(noteOf({ "674": { msg: ["x".repeat(600)] } })).toBe(`${"x".repeat(500)}…`);
    expect(noteOf({ "674": { msg: ["x".repeat(300), "y".repeat(300)] } })).toBe(`${"x".repeat(300)} ${"y".repeat(200)}…`);
  });

  it("stays short however many lines it has", () => {
    // Thousands of one-character lines: 500 of them, and the spaces between.
    const ones = noteOf({ "674": { msg: Array.from({ length: 5000 }, () => "x") } })!;
    expect([...ones].length).toBeLessThanOrEqual(2 * FORM_MAX);
    expect(ones.endsWith("…")).toBe(true);
    // Empty lines add only a space each, so they're left out.
    expect(noteOf({ "674": { msg: ["rent", ...Array.from({ length: 5000 }, () => ""), "October"] } })).toBe("rent October");
    expect(noteOf({ "674": { msg: Array.from({ length: 5000 }, () => "") } })).toBeUndefined();
  });
});
