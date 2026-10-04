// Warnings the critical-set deriver can't see into. scripts/i18n-critical.mjs
// reads a critical element's own JSX (a privacy or warning callout, anything
// with role="alert"), so a sentence a helper builds, or a const above the
// element puts together, is invisible to it and ships as an unchecked machine
// draft. That is how the review of 2026-10-04 found a dApp's withdrawal, the
// line saying which accounts a site's transaction ties together, Remove
// wallet's list of what it leaves behind and a paused swap's reason, all
// outside the set; and the final review found what the guard itself couldn't
// follow: a sentence a return's privacy callout is handed as a prop, the
// errors an alert keeps in state, and the words a note named `.privacy.` puts
// in its placeholders. Such a key carries `.warn.` or `.privacy.` in its name
// instead, and this holds it there: `keysThroughHelpers` follows what each
// critical element calls, reads, renders, is handed and keeps, and what each
// call of a key critical by name is handed, and every key it reaches must be
// in the set, or one of the few words below that a warning only borrows.
import { readFileSync } from "node:fs";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { criticalByName, criticalKeys, keysThroughHelpers, type HelperKey } from "../scripts/i18n-critical.mjs";
import { i18n, t } from "../src/i18n/core";
import { boxFrom, historiesNote } from "../src/shared/histories";
import type { AtStake } from "../src/shared/rpc";
import { explorerWarningKey } from "../src/ui/components/ExplorerLink";
import { tiesLine } from "../src/ui/dapp";

const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"),
);
const CRITICAL = new Set(criticalKeys(Object.keys(en)));
/** Parsed once: it reads every screen and what each critical element reaches, which is not a per-test cost. */
const REACHED = keysThroughHelpers({ keys: Object.keys(en) });

/**
 * Words a warning takes from the rest of the wallet rather than words of its
 * own: a thing's name, a button's label, a tag, a duration, a vote option, a
 * list's punctuation. Each shows on its own elsewhere, where it warns of
 * nothing, so `.warn.` would misname it, and none of them can turn what a
 * warning says around. Anything else a warning shows is the warning, and is
 * named for it.
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
  "histories.list.andAnd": "a list's punctuation: the and before a last item that has an and of its own",
  "histories.list.comma": "a list's punctuation: joinList's own comma",
  "accounts.addIt": "a button's label, which the accounts' Koios note names the button by",
  "accounts.checkIt": "a button's label, which the accounts' Koios note names the button by",
  "accounts.lookForNext": "a button's label, which the accounts' Koios note names the button by",
  "histories.tag.lovejoin": "where a UTxO's money came from, as the UTxOs list tags its row",
  "histories.tag.madePrivate": "where a UTxO's money came from, as the UTxOs list tags its row",
  "histories.tag.madePrivateFrom": "where a UTxO's money came from, as the UTxOs list tags its row",
  "histories.tag.received": "where a UTxO's money came from, as the UTxOs list tags its row",
  "histories.tag.session": "where a UTxO's money came from, as the UTxOs list tags its row",
  "histories.tag.unknown": "where a UTxO's money came from, as the UTxOs list tags its row",
  "settings.lovejoin.depthCost": "what a depth costs, as the depth select's options say it",
};

/** What the guard fails on: a key from outside a critical element's JSX, neither in the set nor listed. */
const unnamed = (reached: HelperKey[], critical: Set<string>) =>
  reached
    .filter(({ key }) => !critical.has(key) && !(key in SHARED_WORDS))
    .map(({ key, at, via }) => `${key}: ${at}, through ${via.join(" → ")}`)
    .sort();

describe("a warning's words from outside its own JSX", () => {
  it("are all accuracy-critical, or a word the wallet shares", () => {
    expect(
      unnamed(REACHED, CRITICAL),
      "a warning shows these through a helper, a const, a component, a prop or a state, where the critical-set " +
        "deriver can't see them: give each key a `.warn.` or `.privacy.` segment, run `node scripts/i18n-critical.mjs " +
        "--write`, and back-translate it into verified-critical-es.json and -ja.json",
    ).toEqual([]);
  });

  // A guard that follows nothing passes everything: these are the routes the
  // reviews found, each reached under its new name and so in the set.
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
    // A prop: the privacy callout's second sentence, handed in by the swap's return.
    ["swaps.back.privacy.neverAgain", "after", "ui/components/LovejoinReturn.tsx"],
    // A state: what each alert's own screen sets it to, Screen's through its `error` prop.
    ["shared.seedelf.warn.nameRule", "read", "ui/components/Destination.tsx"],
    ["shared.seedelf.warn.ownFromAccount", "read", "ui/components/Destination.tsx"],
    ["unlock.warn.wrongPassword", "error", "ui/screens/Unlock.tsx"],
    ["create.warn.wordMismatch", "error", "ui/components/Screen.tsx"],
    ["settings.password.warn.currentFirst", "error", "ui/components/Screen.tsx"],
    ["settings.sites.warn.notGranted", "error", "ui/screens/Settings.tsx"],
    ["serviceAccess.warn.stillRefused", "error", "ui/App.tsx"],
    // A key critical by name, wherever it's said: what fills its placeholders.
    ["histories.kind.privacy.boxes", 't("histories.privacy.together")', "shared/histories.ts"],
    ["histories.privacy.sessionNames", 't("histories.privacy.sessions")', "shared/histories.ts"],
    ["histories.privacy.accountNames", 't("histories.privacy.accounts")', "shared/histories.ts"],
  ])("%s is reached through %s, in %s, and is critical", (key, first, file) => {
    const routes = REACHED.filter((r) => r.key === key);
    expect(routes.some((r) => r.via[0] === first && r.at.startsWith(`${file}:`)), JSON.stringify(routes)).toBe(true);
    expect(CRITICAL.has(key)).toBe(true);
  });

  it.each(Object.keys(SHARED_WORDS))(
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

  it("says in Spanish that two Lovejoin boxes are spent at once, in words that agree with nothing they're filled with", async () => {
    const boxes = [boxFrom("a".repeat(64)), boxFrom("b".repeat(64))];
    expect(historiesNote(boxes)).toBe(
      "This spends 2 boxes back from Lovejoin together. Anyone can see they're one owner's, which ties them to each other, and undoes some of what Lovejoin did for the boxes.",
    );
    await i18n.changeLanguage("es");
    // It said "juntos… los vincula": masculine and plural, where cajas are
    // feminine and "dinero que hiciste privado…" is singular.
    expect(historiesNote(boxes)).toBe(
      "Esto gasta a la vez 2 cajas de vuelta de Lovejoin. Cualquiera puede ver que hay un solo dueño detrás, lo que vincula entre sí todo lo gastado, y deshace parte de lo que Lovejoin hizo por las cajas.",
    );
  });

  it("says in Spanish that opening a swap's transactions opens these links, not this", async () => {
    expect(t(explorerWarningKey("transactions"))).toBe(
      "Opening these on Cardanoscan tells that site, and your browser history, that these transactions are yours.",
    );
    await i18n.changeLanguage("es");
    expect(t(explorerWarningKey("transactions"))).toBe(
      "Abrir estos enlaces en Cardanoscan le dice a ese sitio, y al historial de tu navegador, que estas transacciones son tuyas.",
    );
  });
});

// ---------------------------------------------------------------------------
// The guard on files of its own
// ---------------------------------------------------------------------------

const ROOT = "/fixture/src";

/** keysThroughHelpers over `files` alone: every one is looked in, and followed. */
function reach(files: Record<string, string>, keys: string[]): HelperKey[] {
  return keysThroughHelpers({
    keys,
    files: Object.keys(files),
    follow: [`${ROOT}/ui/`, `${ROOT}/shared/`],
    read: (path) => files[path],
    root: ROOT,
  });
}

/** Each key found, by the file of the element that shows it and the names followed to it, lines aside. */
const routes = (reached: HelperKey[]) =>
  reached.map(({ key, at, via }) => `${key} @${at} ${via.join(">")}`.replace(/:\d+/g, "")).sort();

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

  it("follows a prop to what each use of its component hands it, children and a render prop too", () => {
    // ReturnLinks' shape: the privacy callout's second sentence is handed in by the swap's return.
    const files = {
      [`${ROOT}/ui/components/Parts.tsx`]: `
        import { t } from "../../i18n";
        export function Links({ after }: { after?: string }) {
          return <Callout tone="privacy">{joinSentences([t("p.privacy.base"), after])}</Callout>;
        }
        export function Warn({ children }: { children: unknown }) { return <Callout tone="warn">{children}</Callout>; }
        export function Field({ error }: { error?: string }) { return error ? <p className="error" role="alert">{error}</p> : null; }
        export function Later({ render }: { render: () => string }) { return <Callout tone="warn">{render()}</Callout>; }`,
      [`${ROOT}/ui/screens/S.tsx`]: `
        import { useState } from "react";
        import { t } from "../../i18n";
        import { Field, Later, Links, Warn } from "../components/Parts";
        export function S({ done }: { done: boolean }) {
          const [error, setError] = useState<string>();
          function check(typed: string) { if (!typed) setError(t("p.empty")); }
          return (
            <form onSubmit={() => check("")}>
              <Links after={done ? undefined : t("p.neverAgain")} />
              <Warn>{t("p.wrapped")}</Warn>
              <Field error={error} />
              <Later render={() => t("p.rendered")} />
            </form>
          );
        }`,
    };
    expect(routes(reach(files, ["p.privacy.base", "p.neverAgain", "p.wrapped", "p.empty", "p.rendered"]))).toEqual([
      "p.empty @ui/components/Parts.tsx error><Field> at ui/screens/S.tsx>error>setError",
      "p.neverAgain @ui/components/Parts.tsx after><Links> at ui/screens/S.tsx",
      "p.rendered @ui/components/Parts.tsx render><Later> at ui/screens/S.tsx",
      "p.wrapped @ui/components/Parts.tsx children><Warn> at ui/screens/S.tsx",
    ]);
  });

  it("follows a state to every call of its setter, and a callback's parameter to the call it's written into", () => {
    // Destination's shape: the alert shows what an effect set, one message from a promise's callback.
    const files = {
      [`${ROOT}/shared/name.ts`]: `
        import { t } from "../i18n";
        export const RULE = () => t("q.rule");
        export const OWN = () => t("q.own");`,
      [`${ROOT}/ui/screens/D.tsx`]: `
        import { useEffect, useState } from "react";
        import { call } from "../background";
        import { OWN, RULE } from "../../shared/name";
        function useRead(to: string) {
          const [read, setRead] = useState<{ message?: string }>({});
          useEffect(() => {
            if (to.startsWith("5eed")) {
              setRead({ message: RULE() });
              return;
            }
            const reading = call("lookup", { to }).then((s: { own: boolean }) => (s.own ? { message: OWN() } : {}));
            reading.then((r) => setRead(r), (e: Error) => setRead({ message: e.message }));
          }, [to]);
          return read;
        }
        export function D({ to }: { to: string }) {
          const read = useRead(to);
          return <p className="field-note" role="alert">{read.message}</p>;
        }`,
    };
    expect(routes(reach(files, ["q.rule", "q.own"]))).toEqual([
      "q.own @ui/screens/D.tsx read>useRead>read>setRead>r>reading.then() at ui/screens/D.tsx>reading>OWN",
      "q.rule @ui/screens/D.tsx read>useRead>read>setRead>RULE",
    ]);
  });

  it("starts at a t() call, and a <Rich k>, whose key is critical by name, for what fills it", () => {
    // histories.ts's shape: a plain note's privacy sentence, its kinds put together in a helper.
    const files = {
      [`${ROOT}/shared/notes.ts`]: `
        import { t } from "../i18n";
        function listed(items: string[]) { return items.join(t("r.comma")); }
        export function note(boxes: number, received: number) {
          const kinds = [...(boxes ? [t("r.kind.boxes", { count: boxes })] : []), ...(received ? [t("r.kind.received")] : [])];
          return t("r.privacy.together", { kinds: listed(kinds) });
        }`,
      [`${ROOT}/ui/screens/A.tsx`]: `
        import { Rich, t } from "../../i18n";
        export function A() {
          return <p className="note"><Rich k="r.privacy.cost" parts={{ add: <strong>{t("r.addIt")}</strong> }} /></p>;
        }`,
    };
    const keys = ["r.comma", "r.kind.boxes", "r.kind.received", "r.privacy.together", "r.privacy.cost", "r.addIt"];
    expect(routes(reach(files, keys))).toEqual([
      'r.addIt @ui/screens/A.tsx <Rich k="r.privacy.cost">',
      'r.comma @shared/notes.ts t("r.privacy.together")>listed',
      'r.kind.boxes @shared/notes.ts t("r.privacy.together")>kinds',
      'r.kind.received @shared/notes.ts t("r.privacy.together")>kinds',
    ]);
  });

  it("counts a tone that can come out as a warning, however it's worked out, and not one that can't", () => {
    const files = {
      [`${ROOT}/ui/screens/T.tsx`]: `
        import { t } from "../../i18n";
        const WARN = "warn";
        const INFO = "info";
        export function T({ note, x, several }: any) {
          return (
            <>
              <Callout tone={note.tone ?? "info"}>{a()}</Callout>
              <Callout tone={x ? WARN : "info"}>{b()}</Callout>
              <Callout tone={x ? note.tone : "info"}>{c()}</Callout>
              <Callout tone={note.kind === "pending" ? note.tone : undefined}>{d()}</Callout>
              <Callout tone={several ? "info" : undefined}>{e()}</Callout>
              <Callout tone={x && "info"}>{f()}</Callout>
              <Callout tone={INFO}>{g()}</Callout>
            </>
          );
        }
        function a() { return t("s.a"); }
        function b() { return t("s.b"); }
        function c() { return t("s.c"); }
        function d() { return t("s.d"); }
        function e() { return t("s.e"); }
        function f() { return t("s.f"); }
        function g() { return t("s.g"); }`,
      // Callout as another name: still a callout.
      [`${ROOT}/ui/screens/N.tsx`]: `
        import { t } from "../../i18n";
        import { Callout as Note } from "../components/Callout";
        export function N() { return <Note tone="warn">{h()}</Note>; }
        function h() { return t("s.h"); }`,
    };
    const keys = ["s.a", "s.b", "s.c", "s.d", "s.e", "s.f", "s.g", "s.h"];
    expect(reach(files, keys).map((r) => r.key).sort()).toEqual(["s.a", "s.b", "s.c", "s.d", "s.h"]);
  });

  it("follows names through export *, an export alias, a namespace import and a class's member", () => {
    const files = {
      [`${ROOT}/ui/lines.ts`]: `
        import { t } from "../i18n";
        function line() { return t("m.alias"); }
        export { line as warningLine };
        export function starred() { return t("m.star"); }
        export function spaced() { return t("m.namespace"); }
        export class Lines { static warning() { return t("m.class"); } }`,
      [`${ROOT}/ui/index.ts`]: `export * from "./lines";`,
      [`${ROOT}/ui/screens/M.tsx`]: `
        import { starred, warningLine } from "..";
        import * as lines from "../lines";
        import { Lines } from "../lines";
        export function M() {
          return <Callout tone="warn">{warningLine()} {starred()} {lines.spaced()} {Lines.warning()}</Callout>;
        }`,
    };
    expect(routes(reach(files, ["m.alias", "m.star", "m.namespace", "m.class"]))).toEqual([
      "m.alias @ui/screens/M.tsx warningLine",
      "m.class @ui/screens/M.tsx Lines",
      "m.namespace @ui/screens/M.tsx lines>spaced",
      "m.star @ui/screens/M.tsx starred",
    ]);
  });

  it("follows what's put in a variable later, block by block", () => {
    const files = {
      [`${ROOT}/ui/screens/V.tsx`]: `
        import { t } from "../../i18n";
        function why() { return t("v.loop"); }
        export function V({ a, items }: any) {
          const lines: string[] = [];
          if (a) lines.push(t("v.pushed"));
          let reason = t("v.first");
          if (items.length) reason = t("v.later");
          for (const why of items) console.log(why);
          if (a) {
            const line = t("v.block");
            return <Callout tone="warn">{lines.map((l) => <p key={l}>{l}</p>)} {reason} {line} {why()}</Callout>;
          }
          const line = t("v.other");
          return <p className="note">{line}</p>;
        }`,
    };
    // v.other is the note's: the other block's `line`.
    expect(routes(reach(files, ["v.loop", "v.pushed", "v.first", "v.later", "v.block", "v.other"]))).toEqual([
      "v.block @ui/screens/V.tsx line",
      "v.first @ui/screens/V.tsx reason",
      "v.later @ui/screens/V.tsx reason>reason =",
      "v.loop @ui/screens/V.tsx why",
      "v.pushed @ui/screens/V.tsx lines>lines.push",
    ]);
  });

  it("leaves out what a helper throws, a count, what a callback only chooses, and what a call hands a function that never reads it", () => {
    const files = {
      [`${ROOT}/ui/background.ts`]: `
        import { t } from "../i18n";
        export function call(type: string, payload: unknown): Promise<unknown> {
          return new Promise((resolve) => {
            if (!type) throw new Error(t("w.noAnswer"));
            resolve(payload);
          });
        }`,
      [`${ROOT}/ui/screens/P.tsx`]: `
        import { useState } from "react";
        import { t } from "../../i18n";
        import { call } from "../background";
        function tag(u: { locked: boolean }) { return u.locked ? t("w.tag") : undefined; }
        function line(x: string) { if (!x) throw new Error(t("w.thrown")); return t("w.shown"); }
        export function P({ list, x }: any) {
          const [review, setReview] = useState<unknown>();
          const stuck = list.filter((u: { locked: boolean }) => tag(u)).length;
          async function build() { setReview(await call("build", { problems: t("w.payload") })); }
          return <Callout tone="warn">{line(x)} {t("w.count", { count: stuck })} {String(review)}</Callout>;
        }`,
    };
    const keys = ["w.noAnswer", "w.tag", "w.thrown", "w.shown", "w.payload", "w.count"];
    expect(routes(reach(files, keys))).toEqual(["w.shown @ui/screens/P.tsx line"]);
  });

  it("gives a helper's parameter only what the call it's reached through hands it, not its other callers'", () => {
    const files = {
      [`${ROOT}/ui/screens/H.tsx`]: `
        import { t } from "../../i18n";
        function withName(name: string) { return t("c.frame", { name }); }
        export function H() {
          const warned = t("c.warned");
          const plain = t("c.plain");
          return (
            <>
              <Callout tone="warn">{withName(warned)}</Callout>
              <p className="note">{withName(plain)}</p>
            </>
          );
        }`,
    };
    expect(routes(reach(files, ["c.frame", "c.warned", "c.plain"]))).toEqual([
      "c.frame @ui/screens/H.tsx withName",
      "c.warned @ui/screens/H.tsx warned",
    ]);
  });
});
