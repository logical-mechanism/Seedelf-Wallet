// A DRep picks its own name, and one named like a choice the wallet makes itself ("Always abstain", "Your own DRep",
// in any language the wallet speaks) read as that choice wherever its name stood alone: the vote's review, Activity and
// its CSV, Delegations (chunk 51, gap-g7#1). voteLabel, which every one of them uses, now says "DRep · name"; the
// account's own DRep is a flag, never passed as a name; and a DRep's card and the vote's review warn of such a name in
// words of their own. It isn't counted as shared: "N DReps on the wallet's list use this name" would be false.
//
// The list here is the real preprod one, with a DRep named like each of two choices.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const ABSTAINER = "drep1yaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWN_ONE = "drep1ybbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
vi.mock("../src/dreps/preprod.json", async (original) => {
  const list = (await original<{ default: { recorded: string; dreps: string[][] } }>()).default;
  return { default: { ...list, dreps: [...list.dreps, [ABSTAINER, "Always abstain"], [OWN_ONE, "Your own DRep"]] } };
});

const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { activityCsv, stakingLine, voteOf } = await import("../src/ui/activity");
const { posesAsChoice } = await import("../src/ui/dreps");
const { shortId, voteLabel } = await import("../src/ui/format");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { DelegationList } = await import("../src/ui/screens/Delegations");
const { StakingReview } = await import("../src/ui/screens/Staking");
const { DrepCard } = await import("../src/ui/screens/Voting");

const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";
const markup = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(PreferencesContext.Provider, { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } }, element),
    ),
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();
const warned = (html: string) => html.includes('data-testid="drep-calls-itself"');

describe("where the vote goes, in words (chunk 51, gap-g7#1)", () => {
  it("never shows a DRep's name alone, and says the account's own DRep by a flag, not a name", () => {
    expect(voteLabel(ABSTAINER, { name: "Always abstain" })).toBe("DRep · Always abstain");
    expect(voteLabel(ABSTAINER, { name: "Always abstain" })).not.toBe(voteLabel("drep_always_abstain"));
    expect(voteLabel(LOGIC_DREP, { own: true })).toBe(t("drep.yourOwn"));
    // A name passed with the flag is the DRep's own, never what's shown for it.
    expect(voteLabel(LOGIC_DREP, { name: "Always abstain", own: true })).toBe("Your own DRep");
    // The pinned two, none, and a DRep with no name are as they were.
    expect(voteLabel("drep_always_abstain")).toBe("Always abstain");
    expect(voteLabel("drep_always_no_confidence", { own: true })).toBe("Always no confidence");
    expect(voteLabel(null)).toBe("Not delegated");
    expect(voteLabel(LOGIC_DREP)).toBe(shortId(LOGIC_DREP));
    expect(voteLabel(LOGIC_DREP, { name: "" })).toBe(shortId(LOGIC_DREP));
  });

  it("knows a name made like one of the wallet's own choices, in any language it speaks, however it's written", () => {
    // Case, spacing and a bidi override aside, as a shared name is told (nameSkeleton).
    for (const name of ["Always abstain", "ALWAYS  ABSTAIN", "Always‮ abstain", "Always no confidence", "Not delegated"]) {
      expect(posesAsChoice(name), name).toBe(true);
    }
    for (const name of ["Your own DRep", "Siempre abstenerse", "Tu propio DRep", "常に棄権", "自分の DRep", "未委任"]) {
      expect(posesAsChoice(name), name).toBe(true);
    }
    for (const name of ["Logical Mechanism dRep", "Always abstaining fan club", "8Ball", "", undefined]) {
      expect(posesAsChoice(name), String(name)).toBe(false);
    }
  });

  it("reads as a DRep in Activity, its CSV and Delegations", () => {
    expect(voteOf("preprod", { drep: ABSTAINER })).toBe("DRep · Always abstain");
    expect(voteOf("preprod", { drep: LOGIC_DREP })).toBe("DRep · Logical Mechanism dRep");
    expect(stakingLine("preprod", { pool: "pool1x", ticker: "LOGIC", drep: ABSTAINER })).toBe("LOGIC · DRep · Always abstain");
    const csv = activityCsv("preprod", [
      { txHash: "ab".repeat(32), at: 1, direction: "self", lovelace: "0", fee: "170000", staking: { drep: OWN_ONE } } as never,
    ]);
    expect(csv).toContain("DRep · Your own DRep");
    const rows = text(
      markup(createElement(DelegationList, { rows: [{ kind: "vote", drep: ABSTAINER, txHash: "cd".repeat(32), at: 1, epoch: 300 }] })),
    );
    expect(rows).toContain("Voting power to DRep · Always abstain");
  });

  it("warns on a DRep's card and its vote's review, and never counts it as a shared name", () => {
    const live = (name?: string) =>
      ({ id: ABSTAINER, name, status: "registered", active: true, expiresEpoch: null, votingPower: "1", delegators: 1 }) as const;
    const card = markup(createElement(DrepCard, { drep: live("Always abstain") }));
    expect(warned(card)).toBe(true);
    expect(text(card)).toContain(t("vote.warn.callsItself"));
    expect(card).not.toContain('data-testid="drep-shared-name"');
    expect(warned(markup(createElement(DrepCard, { drep: live("Logical Mechanism dRep") })))).toBe(false);
    expect(warned(markup(createElement(DrepCard, { drep: live() })))).toBe(false);

    const summary = {
      network: "preprod",
      txHash: "ab".repeat(32),
      action: { kind: "vote", drep: ABSTAINER },
      pool: null,
      drep: ABSTAINER,
      fee: "180000",
      deposit: "0",
      refund: "0",
      withdrawal: "0",
      changeLovelace: "1000000",
      changeTokens: 0,
      inputs: 1,
    } as const;
    const review = (chosen: { drepName?: string; ownDrep?: boolean }) =>
      markup(createElement(StakingReview, { summary, ...chosen, busy: false, onBack: () => undefined, onSend: () => undefined }));
    const lookalike = review({ drepName: "Always abstain" });
    expect(text(lookalike)).toContain("Voting power to DRep · Always abstain");
    expect(warned(lookalike)).toBe(true);
    expect(lookalike).not.toContain('data-testid="drep-shared-name"');
    expect(warned(review({ drepName: "Logical Mechanism dRep" }))).toBe(false);
    // The account's own DRep, by the flag: its label, and nothing to warn of.
    const own = review({ ownDrep: true });
    expect(text(own)).toContain("Voting power to Your own DRep");
    expect(warned(own)).toBe(false);
  });
});
