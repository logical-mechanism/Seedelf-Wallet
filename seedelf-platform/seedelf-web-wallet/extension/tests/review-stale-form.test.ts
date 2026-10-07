// "Refresh and review again" on a refused review builds it again from the form
// behind it (chunk 23's second review, PY-1). When Home has read less since
// than the form asks for (another page spent the same UTxOs, say), the form
// can't be built as it stands: the build returned at its guard, and the press
// did nothing and said nothing. Now it goes back to the form, which says why.
// Building past the guard instead would quietly leave out a token the form can
// no longer send, so the guard stays.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { againOrForm } from "../src/ui/components/StaleReview";

describe("Refresh and review again", () => {
  it("builds the review again while the form can be built, and goes back to the form when it can't", () => {
    const pressed: string[] = [];
    const build = async () => {
      pressed.push("build");
    };
    const toForm = () => pressed.push("form");
    againOrForm(true, build, toForm)();
    expect(pressed).toEqual(["build"]);
    againOrForm(false, build, toForm)();
    expect(pressed).toEqual(["build", "form"]);
  });

  // The forms whose readiness Home's balances can change under an open review (Create and Remove can't be made
  // unready by a reading): each one's stale foot goes through it, and back to the same form Back does.
  it.each([
    ["Transfer", "build"],
    ["Withdraw", "build"],
    ["SiteSessions", "make"],
  ])("is how %s's refused review builds again", (screen, build) => {
    const source = readFileSync(new URL(`../src/ui/screens/${screen}.tsx`, import.meta.url), "utf8");
    expect(source).toContain(`busy={busy} onAgain={againOrForm(ready, ${build}, toForm)} />`);
    expect(source).not.toMatch(/onAgain=\{\(\) => void (build|make)\(\)\}/);
    expect(source).toContain("onBack={toForm}");
  });
});
