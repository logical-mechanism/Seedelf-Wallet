// Your accounts, the list of the wallet's other public accounts a payment can
// go to (chunk 18), opens on the public Send and on Make public. Its note was
// the public Send's: "Sending from your private balance avoids that". On Make
// public the money already leaves the private balance, and paying one of your
// own accounts links it to this money and to whoever made it private, which
// the form only said once one was picked. The list now says what picking one
// shows from where the payment leaves.
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountRecipients } from "../src/ui/components/AccountRecipients";

const note = (from: "public" | "private") =>
  renderToStaticMarkup(createElement(AccountRecipients, { from, onPick: () => undefined, onClose: () => undefined }))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

describe("Your accounts' note", () => {
  it("on Make public, says the account picked is linked to this money, never that the link is avoided", () => {
    expect(note("private")).toContain("Anyone can link the account you pick to this money and to whoever made it");
    expect(note("private")).not.toContain("avoids");
  });

  it("on the public Send, still says what paying another of your accounts shows, and how not to", () => {
    expect(note("public")).toContain("Anyone can see your accounts pay each other and tell they're one wallet's.");
    expect(note("public")).not.toContain("whoever made it private");
  });

  it("is told which side each form pays from", () => {
    const source = (screen: string) =>
      readFileSync(new URL(`../src/ui/screens/${screen}.tsx`, import.meta.url), "utf8");
    expect(source("Withdraw")).toContain('ownAccounts="private"');
    expect(source("CardanoSend")).toContain('ownAccounts="public"');
  });
});
