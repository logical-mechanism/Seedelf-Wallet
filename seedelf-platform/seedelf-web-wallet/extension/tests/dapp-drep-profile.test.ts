// A site's sign window says where a DRep certificate's profile is, as text
// (the owner's call on C14, 2026-10-06).
import { describe, expect, it } from "vitest";
import { certificateLine } from "../src/ui/dapp";

type Certificate = Parameters<typeof certificateLine>[0];
const update = (anchor?: string) =>
  ({ kind: "drep", own: true, drepAction: "update", drep: null, deposit: null, refund: null, anchor }) as unknown as Certificate;

describe("a DRep certificate's line", () => {
  it("names the profile's address when the certificate has one", () => {
    expect(certificateLine(update("https://example.com/drep.jsonld"), true, "")).toContain("https://example.com/drep.jsonld");
  });

  it("says nothing of a profile when there's none", () => {
    expect(certificateLine(update(), true, "")).not.toContain("Its profile:");
  });
});
