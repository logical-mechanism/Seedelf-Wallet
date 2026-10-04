// Warnings the critical-set deriver can't see into. scripts/i18n-critical.mjs
// reads a critical element's own JSX (a privacy or warning callout, anything
// with role="alert"), so a sentence a helper builds, or a const above the
// element puts together, is invisible to it and ships as an unchecked machine
// draft. That is how the review of 2026-10-04 found a dApp's withdrawal, the
// line saying which accounts a site's transaction ties together, Remove
// wallet's list of what it leaves behind and a paused swap's reason, all
// outside the set. Such a key carries `.warn.` or `.privacy.` in its name
// instead, and this holds it there: `keysThroughHelpers` follows what each
// critical element calls, reads and renders, and every key it reaches must be
// in the set, or one of the few words below that a warning only borrows.
import { readFileSync } from "node:fs";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { criticalByName, criticalKeys, keysThroughHelpers, type HelperKey } from "../scripts/i18n-critical.mjs";
import { i18n } from "../src/i18n/core";
import type { AtStake } from "../src/shared/rpc";
import { tiesLine } from "../src/ui/dapp";

const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"),
);
const CRITICAL = new Set(criticalKeys(Object.keys(en)));
/** Parsed once: it reads every screen and what each critical element reaches, which is not a per-test cost. */
const REACHED = keysThroughHelpers({ keys: Object.keys(en) });

/**
 * Words a warning takes from the rest of the wallet rather than words of its
 * own: a thing's name, a duration, a vote option, a list's punctuation. Each
 * shows on its own elsewhere, where it warns of nothing, so `.warn.` would
 * misname it, and none of them can turn what a warning says around. Anything
 * else a warning shows is the warning, and is named for it.
 */
const SHARED_WORDS: Record<string, string> = {
  "accountPicker.numbered": "an account's name, as the account picker shows it",
  "claim.aSession": "a private session's name, when its own can't be read",
  "claim.sessionLower": "a private session's name, as Bring everything back lists it",
  "format.noName": "a token's name, when it has none",
  "swaps.aSwap": "a swap's name, when its tokens can't be read",
  "format.vote.abstain": "a vote option, by the label the Voting screen offers it with",
  "format.vote.noConfidence": "a vote option, by the label the Voting screen offers it with",
  "format.vote.notDelegated": "a vote, by the label the Staking screen shows it with",
  "lovejoin.delayHours": "a duration, as an amount or a date is",
  "histories.list.and": "a list's punctuation",
  "histories.list.comma": "a list's punctuation: joinList's own comma",
};

/**
 * A warning's own words that keep their old names for now: renaming them
 * touches tests/i18n-assembly.test.ts and src/shared/label.ts, which this
 * change leaves to the work under way there. Unlike the shared words, each is
 * to be named `.warn.`; listed, nothing new can hide among them.
 */
const NOT_YET_NAMED: Record<string, string> = {
  "dappUi.whose.account": "where a dApp's staking money goes back to, in its staking warning",
  "dappUi.whose.session": "the same, for a private session",
  "shared.label.badCharacter": "a Seedelf tag's error, in the form's alert",
  "shared.label.tooLong": "the same, for its length",
};

/** What the guard fails on: a key from outside a critical element's JSX, neither in the set nor listed. */
const unnamed = (reached: HelperKey[], critical: Set<string>) =>
  reached
    .filter(({ key }) => !critical.has(key) && !(key in SHARED_WORDS) && !(key in NOT_YET_NAMED))
    .map(({ key, at, via }) => `${key}: ${at}, through ${via.join(" → ")}`)
    .sort();

describe("a warning's words from outside its own JSX", () => {
  it("are all accuracy-critical, or a word the wallet shares", () => {
    expect(
      unnamed(REACHED, CRITICAL),
      "a warning shows these through a helper, a const or a component, where the critical-set deriver can't see " +
        "them: give each key a `.warn.` or `.privacy.` segment, run `node scripts/i18n-critical.mjs --write`, and " +
        "back-translate it into verified-critical-es.json and -ja.json",
    ).toEqual([]);
  });

  // A guard that follows nothing passes everything: these are the routes the
  // review found, each reached under its new name and so in the set.
  it.each([
    ["dappUi.withdrawal.warn.notAllBack", "withdrawalLine", "ui/screens/DappApprovals.tsx"],
    ["dappUi.cert.warn.otherStakeKey", "certificateLine", "ui/screens/DappApprovals.tsx"],
    ["dappUi.ties.privacy.moves", "tiesLine", "ui/screens/DappApprovals.tsx"],
    ["settings.remove.warn.sessionsOpen", "atStakeLines", "ui/screens/Settings.tsx"],
    ["settings.remove.warn.aMix", "atStakeLines", "ui/screens/Settings.tsx"],
    ["settings.warn.moveToMainnet", "MOVE_TO", "ui/screens/Settings.tsx"],
    ["swaps.pause.warn.price", "pauseText", "ui/screens/Swaps.tsx"],
    ["vote.sharedName.warn.unlisted", "sharedDrepName", "ui/screens/Voting.tsx"],
    ["withdraw.warn.publicAccount", "whose", "ui/screens/Withdraw.tsx"],
    ["remove.privacy.yourPublicAccount", "note", "ui/screens/RemoveSeedelf.tsx"],
  ])("%s is reached through %s, in %s, and is critical", (key, first, file) => {
    const routes = REACHED.filter((r) => r.key === key);
    expect(routes.some((r) => r.via[0] === first && r.at.startsWith(`${file}:`)), JSON.stringify(routes)).toBe(true);
    expect(CRITICAL.has(key)).toBe(true);
  });

  it.each([...Object.keys(SHARED_WORDS), ...Object.keys(NOT_YET_NAMED)])(
    "%s, listed, is still shown that way and still not critical",
    (key) => {
      expect(en[key] ?? en[`${key}_other`], "no such key: take it off the list").toBeDefined();
      const shown = REACHED.some((r) => r.key === key);
      expect(shown, "no warning shows it from a helper any more: take it off the list").toBe(true);
      expect(CRITICAL.has(key), "it is critical now: take it off the list").toBe(false);
    },
  );
});

describe("what the back-translation of these warnings corrected, through the helpers that say them", () => {
  let Settings: typeof import("../src/ui/screens/Settings");

  beforeAll(async () => {
    // Settings reads the page's URL when it loads (ui/view.ts).
    vi.stubGlobal("location", { search: "?view=tab", hash: "" });
    Settings = await import("../src/ui/screens/Settings");
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("ties the accounts together in Spanish with the pronoun their feminine names take", async () => {
    expect(tiesLine(["account"], true)).toBe(
      "It moves money between this private session and your public account. Signing ties them together on chain, where anyone can see it.",
    );
    await i18n.changeLanguage("es");
    // Una cuenta, una sesión: "los" pointed at nothing in the sentence.
    expect(tiesLine(["account"], true)).toBe(
      "Mueve dinero entre esta sesión privada y tu cuenta pública. Firmar las vincula entre sí en la cadena, donde cualquiera puede verlo.",
    );
  });

  it("says in Japanese that it is another wallet made here, in this browser, that deletes the record", async () => {
    const stake: AtStake[] = [
      {
        network: "mainnet",
        maybeSent: { kind: "send", network: "mainnet", txHash: "ab".repeat(32), submittedAt: 0, confirmations: null, maybeSent: true },
        sessions: [],
        chainSending: false,
        mixMaybeSent: true,
      },
    ];
    const english = Settings.atStakeLines(stake);
    expect(english).toHaveLength(2);
    for (const line of english) expect(line).toContain("but making or restoring another wallet here first deletes that record.");
    await i18n.changeLanguage("ja");
    const lines = Settings.atStakeLines(stake);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toContain("先にここで別のウォレットを作成または復元すると、その記録は削除されます。");
  });
});

// ---------------------------------------------------------------------------
// The guard on files of its own
// ---------------------------------------------------------------------------

const ROOT = "/fixture/src";

/** keysThroughHelpers over `files` alone: each .tsx is a screen, and every file is followable. */
function reach(files: Record<string, string>, keys: string[]): HelperKey[] {
  return keysThroughHelpers({
    keys,
    files: Object.keys(files).filter((f) => f.endsWith(".tsx")),
    follow: [`${ROOT}/ui/`],
    read: (path) => files[path],
    root: ROOT,
  });
}

/** Each key found, by the file of the element that shows it (its line aside) and the names followed to it. */
const routes = (reached: HelperKey[]) =>
  reached.map(({ key, at, via }) => `${key} @${at.replace(/:\d+$/, "")} ${via.join(">")}`).sort();

describe("keysThroughHelpers", () => {
  it("finds the dApp's withdrawal warning as it was before it was named `.warn.`, and so would have failed", () => {
    // The shape of src/ui/dapp.ts and SignTx at 29b8012: the staking callout's
    // tone an expression, its words from withdrawalLine and the `whose` const.
    const before = {
      [`${ROOT}/ui/format.ts`]: `export const formatAda = (lovelace: string) => (Number(lovelace) / 1e6).toFixed(6);`,
      [`${ROOT}/ui/dapp.ts`]: `
        import { t } from "../i18n";
        import { formatAda } from "./format";
        export function withdrawalLine(w: { own: boolean; lovelace: string }, back: boolean, whose: string): string {
          if (!w.own) return t("dappUi.withdrawal.notYours", { amount: formatAda(w.lovelace) });
          return t(back ? "dappUi.withdrawal.into" : "dappUi.withdrawal.notAllBack", { amount: formatAda(w.lovelace), whose });
        }`,
      [`${ROOT}/ui/screens/DappApprovals.tsx`]: `
        import { useT } from "../../i18n";
        import { withdrawalLine } from "../dapp";
        export function SignTx({ s, session, back, staking }: any) {
          const tr = useT();
          const whose = tr(session ? "dappUi.whose.session" : "dappUi.whose.account");
          return (
            <Callout tone={s.certificates.some((c: any) => c.own) || (staking > 0n && !back) ? "warn" : "info"} testId="dapp-staking">
              <ul className="dapp-points">
                {s.withdrawals.map((w: any, i: number) => (
                  <li key={\`w\${i}\`}>{withdrawalLine(w, back, whose)}</li>
                ))}
              </ul>
            </Callout>
          );
        }`,
    };
    const keys = [
      "dappUi.withdrawal.notYours",
      "dappUi.withdrawal.into",
      "dappUi.withdrawal.notAllBack",
      "dappUi.whose.session",
      "dappUi.whose.account",
    ];
    const reached = reach(before, keys);
    expect(routes(reached)).toEqual([
      "dappUi.whose.account @ui/screens/DappApprovals.tsx whose",
      "dappUi.whose.session @ui/screens/DappApprovals.tsx whose",
      "dappUi.withdrawal.into @ui/screens/DappApprovals.tsx withdrawalLine",
      "dappUi.withdrawal.notAllBack @ui/screens/DappApprovals.tsx withdrawalLine",
      "dappUi.withdrawal.notYours @ui/screens/DappApprovals.tsx withdrawalLine",
    ]);
    // Their old names declared nothing and the callout's own JSX names no key,
    // so none was in the set: the guard fails on every one of them.
    expect(reached.filter(({ key }) => !criticalByName(key)).length).toBe(keys.length);
  });

  it("follows a const, a function handed to map, an object of getters and a component, in any tone that can warn", () => {
    const files = {
      [`${ROOT}/ui/moves.ts`]: `
        import { t } from "../i18n";
        export const MOVE_TO: Record<string, string> = { get mainnet() { return t("x.moveToMainnet"); } };`,
      [`${ROOT}/ui/screens/Loud.tsx`]: `
        import { t } from "../../i18n";
        import { MOVE_TO } from "../moves";
        export function Loud({ asking, stake }: { asking: string; stake: string[] }) {
          const lines = atStake(stake);
          const note = noteOf(stake);
          return (
            <>
              <Callout tone="warn">{MOVE_TO[asking]}</Callout>
              <Callout tone="warn"><ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul></Callout>
              <Callout tone={note.tone}>{note.text}</Callout>
              <p className="field-note" role="alert">{problemOf(stake)}</p>
              <Callout tone="privacy"><Line /></Callout>
            </>
          );
        }
        function atStake(stake: string[]) { return stake.map(nameOf); }
        function nameOf(name: string) { return t("x.sessionNamed", { name }); }
        function noteOf(stake: string[]) { return { tone: stake.length ? "warn" : "privacy", text: t("x.note") }; }
        function problemOf(stake: string[]) { return stake.length > 9 ? t("x.tooMany") : undefined; }
        function Line() { return <span>{t("x.line")}</span>; }`,
    };
    const reached = reach(files, ["x.moveToMainnet", "x.sessionNamed", "x.note", "x.tooMany", "x.line"]);
    expect(routes(reached)).toEqual([
      "x.line @ui/screens/Loud.tsx <Line>",
      "x.moveToMainnet @ui/screens/Loud.tsx MOVE_TO",
      "x.note @ui/screens/Loud.tsx note>noteOf",
      "x.sessionNamed @ui/screens/Loud.tsx lines>atStake>nameOf",
      "x.tooMany @ui/screens/Loud.tsx problemOf",
    ]);
  });

  it("leaves out what doesn't show in the element: a key-less formatter, a control's label, a handler, a context's default, an info note", () => {
    const files = {
      [`${ROOT}/ui/format.ts`]: `export const formatAda = (lovelace: string) => (Number(lovelace) / 1e6).toFixed(6);`,
      [`${ROOT}/ui/accounts.tsx`]: `
        import { createContext, useContext } from "react";
        import { t } from "../i18n";
        const AccountsContext = createContext({ get name() { return t("y.contextDefault"); }, several: false });
        export const useAccounts = () => useContext(AccountsContext);`,
      [`${ROOT}/ui/screens/Quiet.tsx`]: `
        import { t } from "../../i18n";
        import { useAccounts } from "../accounts";
        import { formatAda } from "../format";
        export function Quiet({ amount, onRetry }: { amount: string; onRetry: (why: string) => void }) {
          const { several } = useAccounts();
          const retry = () => onRetry(t("y.handler"));
          return (
            <>
              <Callout tone="warn">
                {formatAda(amount)} {several ? "+" : ""}
                <span onClick={() => onRetry(t("y.click"))}>?</span>
                <button type="button" onClick={retry}>{label()}</button>
              </Callout>
              <Callout tone="info">{infoLine()}</Callout>
              <Callout tone={several ? "info" : undefined}>{infoLine()}</Callout>
            </>
          );
        }
        function label() { return t("y.button"); }
        function infoLine() { return t("y.info"); }`,
    };
    expect(reach(files, ["y.contextDefault", "y.handler", "y.click", "y.button", "y.info"])).toEqual([]);
  });
});
