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
});
