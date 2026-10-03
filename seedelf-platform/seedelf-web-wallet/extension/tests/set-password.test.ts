// The new-password form (Create, Restore, Change password): Show makes its
// boxes text boxes, and Chrome's enhanced spell check, or Edge's, sends a
// text box's words off the device. So neither box is ever spell-checked or
// capitalized, as the password boxes elsewhere aren't.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PasswordField } from "../src/ui/components/PasswordField";
import { SetPassword } from "../src/ui/components/SetPassword";

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
