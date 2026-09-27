// Chrome's enhanced spell check, or Edge's, sends what's typed in a
// spell-checked field off the device. Nothing typed in the wallet is:
// the page says so once, on its <body>, and the fields that say who the
// user is or pays say so again (privacy review §2.19). The public Send's
// note isn't either: it would go to Google before it's sent, even one
// that's never sent.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Balances } from "../src/shared/rpc";
import { ContactEditor } from "../src/ui/components/Contacts";
import { NetworkContext } from "../src/ui/network";
import { CardanoSend } from "../src/ui/screens/CardanoSend";

/** The input with `id`, lowercased: React keeps some attributes camel-cased. */
const input = (html: string, id: string) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0].toLowerCase();

const NONE = { lovelace: "0", tokens: [], utxos: 0 };

describe("spell check", () => {
  it("is off for the whole page", () => {
    const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(page).toMatch(/<body spellcheck="false">/);
  });

  it("is off for a contact's name", () => {
    const html = renderToStaticMarkup(createElement(ContactEditor, { onClose: () => undefined, onSaved: () => undefined }));
    expect(input(html, "contact-name")).toContain('spellcheck="false"');
  });

  it("is off for a public payment's note", () => {
    const cardano = { ...NONE, addressesUsed: 1, locked: NONE } as unknown as Balances["cardano"];
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(CardanoSend, { cardano, onCancel: () => undefined, onSent: () => undefined }),
      ),
    );
    expect(input(html, "send-note")).toContain('spellcheck="false"');
  });
});
