// Private Send's recipient field, as it renders (blind test §9.7): what a
// Seedelf's name is, behind the label's ⓘ; and an ordinary address pasted
// there, offered both ways to pay it as two buttons, each saying what it
// shows. Make public alone was offered, and two testers reached the public
// account's Send late or never (T04b, T06).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18n, t } from "../src/i18n/core";
import { NetworkContext } from "../src/ui/network";
import { handedOnAmount, SeedelfNameInput } from "../src/ui/screens/Transfer";

const ADDRESS = "addr_test1qpkazk4e6lacnsk6qz7kmzz7l8z7wnr8dnxkwk0rsrtmmeg2c9rcyq9vjgacgzk0tqhuqgf2djtwvxcv5ptdy3ljf7qscs65nlaz";
const noop = () => undefined;

const render = (props: Partial<Parameters<typeof SeedelfNameInput>[0]>) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(SeedelfNameInput, { id: "transfer-to", value: ADDRESS, onChange: noop, onFound: noop, ...props }),
    ),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("an ordinary address pasted into private Send", () => {
  it("offers both ways as buttons, the private one first, each saying what it shows", () => {
    const html = render({ onPayAddress: noop });
    const shown = text(html);
    expect(shown).toContain("That's an ordinary address, not a Seedelf's name: Send here pays only Seedelfs.");
    expect(shown).toContain("Pay the address from your private balance or your public account instead:");
    const buttons = [...html.matchAll(/<button type="button" class="secondary"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(buttons).toEqual(["Pay from your private balance", "Pay from your public account"]);
    expect(shown).toContain("With Make public. It shows at their end as coming from the Seedelf contract.");
    expect(shown).toContain("With your public account's Send, as any wallet pays: it shows as coming from your public account.");
    // Each button is described by its own line, which a screen reader reads with it.
    for (const [, described] of html.matchAll(/aria-describedby="([^"]+)"[^>]*>Pay from/g)) {
      expect(html).toContain(`id="${described}"`);
    }
  });

  it("says why the public account can't pay now, as a sentence, its button off, beside what it would show", () => {
    // Home's own reasons, which end with no full stop under its actions (cross-area review: they ran on).
    const html = render({ onPayAddress: noop, publicBlocked: t("home.busy.publicEmpty") });
    expect(html).toMatch(/<button type="button" class="secondary"[^>]*disabled=""[^>]*>Pay from your public account<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>Pay from your private balance/);
    expect(text(html)).toContain(
      "Fund your public account first: Receive publicly shows its address. With your public account's Send, as any wallet pays: it shows as coming from your public account.",
    );
    // One that ends a sentence already keeps its one full stop.
    expect(text(render({ onPayAddress: noop, publicBlocked: `${t("home.busy.wait")}.` }))).toContain(
      "Wait for the last transaction to confirm. With your public account's Send",
    );
  });

  it("in Japanese, ends the reason with 。 and runs nothing together", async () => {
    await i18n.changeLanguage("ja");
    try {
      const shown = text(render({ onPayAddress: noop, publicBlocked: t("home.busy.publicEmpty") }));
      expect(t("home.busy.publicEmpty")).toMatch(/^まず公開アカウント/);
      expect(shown).toContain(`${t("home.busy.publicEmpty")}。${t("transfer.privacy.routePublic")}`);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("with several recipients, says to pay it on its own, with no buttons", () => {
    const html = render({});
    expect(text(html)).toContain("Pay it on its own: with no other recipient here, Send offers to pay it from your private balance or your public account.");
    expect(html).not.toContain("Pay from your");
  });

  it("hands on the amount typed, and nothing with Max on: never the figure the box kept under it", () => {
    expect(handedOnAmount("12", false)).toBe("12");
    expect(handedOnAmount("", false)).toBe("");
    // Max on: the box still holds what was typed before, out of sight. The other form asks for its own amount.
    expect(handedOnAmount("12", true)).toBe("");
  });

  it("says what a Seedelf's name is behind the label's ⓘ, and that an address works too", () => {
    const html = render({ value: "", onPayAddress: noop });
    expect(html).toContain('data-testid="transfer-to-name-hint-hint"');
    expect(html).toContain("the 64-character name, starting 5eed0e1f, that someone using Seedelf Wallet gives out to be paid privately");
    expect(text(html)).toContain("Paste the whole name the recipient gave you, or an ordinary address to choose how to pay it.");
    expect(html).not.toContain("Pay from your");
  });
});
