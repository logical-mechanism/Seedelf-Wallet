// The new-password form (Create, Restore, Change password): Show makes its
// boxes text boxes, and Chrome's enhanced spell check, or Edge's, sends a
// text box's words off the device. So neither box is ever spell-checked or
// capitalized, as the password boxes elsewhere aren't.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";

import { setLanguage } from "../src/i18n";
import { PasswordField } from "../src/ui/components/PasswordField";
import { SetPassword, strengthHint } from "../src/ui/components/SetPassword";

/** The inputs rendered; attribute names are case-insensitive in HTML, and React keeps some camel-cased. */
const inputs = (html: string) => (html.match(/<input[^>]*>/g) ?? []).map((i) => i.toLowerCase());

describe("the new-password form", () => {
  it("never spell-checks or capitalizes a password, as the password box elsewhere doesn't", () => {
    const form = inputs(renderToStaticMarkup(createElement(SetPassword, { submitLabel: "Create", busy: false, onSubmit: () => undefined })));
    const field = inputs(renderToStaticMarkup(createElement(PasswordField, { id: "password", value: "", onChange: () => undefined })));
    expect(form).toHaveLength(2);
    for (const input of [...form, ...field]) {
      expect(input).toContain('spellcheck="false"');
      expect(input).toContain('autocapitalize="off"');
    }
  });

  // Both default their first box's label, and chunk 19 broke that: moving
  // "Password" into a key dropped the default parameter that supplied it, so
  // the label rendered empty. Every unit test still passed; six e2e tests,
  // which find the box by its label, did not.
  it("labels its box even when the caller names none", () => {
    const label = (html: string) => html.match(/<label[^>]*>([^<]*)<\/label>/)?.[1] ?? "";
    expect(label(renderToStaticMarkup(createElement(SetPassword, { submitLabel: "Create", busy: false, onSubmit: () => undefined })))).toBe("Password");
    expect(label(renderToStaticMarkup(createElement(PasswordField, { id: "password", value: "", onChange: () => undefined })))).toBe("Password");
  });

  it("uses the caller's label when there is one", () => {
    const html = renderToStaticMarkup(
      createElement(SetPassword, { submitLabel: "Change", busy: false, onSubmit: () => undefined, label: "New password" }),
    );
    expect(html).toContain(">New password<");
  });
});

// Chunk 19 made the hints keys and rendered them without `t()`, so every new
// user read `setPassword.hint.weak` under the meter (chunk 23's review, C-1).
// The only e2e check looked at the too-short message, which was translated.
describe("the strength hint", () => {
  afterAll(() => setLanguage("en"));
  const passwords = ["short", "aaaaaaaaaaaa", "correct horse battery", "correct horse battery staple", "C0rrect-Horse-Battery-Staple-9!"];

  it.each(["en", "es", "ja"] as const)("is a sentence in %s, never a key", async (language) => {
    await setLanguage(language);
    for (const password of passwords) {
      const hint = strengthHint(password);
      expect(hint).not.toMatch(/^\w+\.\w+/);
      expect(hint.length).toBeGreaterThan(3);
    }
  });

  it("says how strong a password is once it's long enough", async () => {
    await setLanguage("en");
    expect(strengthHint("aaaaaaaaaaaa")).toMatch(/^Weak\./);
    expect(strengthHint("C0rrect-Horse-Battery-Staple-9!")).toBe("Strong.");
  });
});
