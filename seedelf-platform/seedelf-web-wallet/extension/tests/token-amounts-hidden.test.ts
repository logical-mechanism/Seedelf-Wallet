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
