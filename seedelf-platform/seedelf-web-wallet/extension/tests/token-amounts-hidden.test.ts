// A token box's problem with balances hidden (HM-9): once another recipient takes some of a token, a box can hold more
// than is left, and its line says what is left, a balance. Masked, as the box's own "of …" and its refusal are.
import { describe, expect, it } from "vitest";

import { tokenChoices } from "../src/ui/components/TokenAmounts";
import { tokenKey } from "../src/ui/format";
import { HIDDEN } from "../src/ui/preferences";

const tusdm = {
  policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
  assetName: "0014df10745553444d",
  quantity: "1234560000",
  decimals: 6,
  fingerprint: "",
};
const typed = { [tokenKey(tusdm)]: "2000" };

describe("a token box holding more than is left", () => {
  it("says what's left, and masks it while balances are hidden", () => {
    expect(tokenChoices("preprod", [tusdm], typed).problems[tokenKey(tusdm)]).toBe("That's more than the 1,234.56 you hold.");
    const hidden = tokenChoices("preprod", [tusdm], typed, () => HIDDEN);
    expect(hidden.problems[tokenKey(tusdm)]).toBe(`That's more than the ${HIDDEN} you hold.`);
    expect(hidden.ok).toBe(false);
  });
});

// Chunk 51's T1 lens over the screens (lane T1l, t1l#9): a box holding what the form can't read as an amount keeps
// the form from Review, as a letter does. sanitizeAmount keeps such text as typed, so without the check the payment
// went without that token, Review on and no reason given.
describe("a token box holding what isn't an amount (chunk 51, t1l#9)", () => {
  const whole = { policyId: "ab".repeat(28), assetName: "58", quantity: "100", decimals: 0, fingerprint: "" };

  it("isn't sent, and holds Review with the reason", () => {
    const sixPlaces = tokenChoices("preprod", [tusdm], { [tokenKey(tusdm)]: "1.2.3" });
    expect(sixPlaces).toEqual({ sent: [], problems: { [tokenKey(tusdm)]: "Enter an amount with at most 6 decimal places." }, ok: false });
    const wholeOnly = tokenChoices("preprod", [whole], { [tokenKey(whole)]: "1.5" });
    expect(wholeOnly.ok).toBe(false);
    expect(wholeOnly.sent).toEqual([]);
    expect(wholeOnly.problems[tokenKey(whole)]).toBe("Enter a whole number.");
    // The control: an amount it reads is sent.
    expect(tokenChoices("preprod", [whole], { [tokenKey(whole)]: "2" })).toEqual({
      sent: [{ policyId: whole.policyId, assetName: whole.assetName, quantity: "2" }],
      problems: {},
      ok: true,
    });
  });
});
