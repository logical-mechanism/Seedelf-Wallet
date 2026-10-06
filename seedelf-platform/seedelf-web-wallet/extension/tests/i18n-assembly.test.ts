// Sentences, lists and full stops put together the way each language does it.
// The translation review (2026-10-03) found Japanese paragraphs with "。 "
// between their sentences, lists with English's comma, a full stop added or
// stripped as English's alone ("…応答しませんでした。.", "…。。"), and a
// dApp's staking said as finished Japanese sentences comma-spliced and ended
// with an ASCII full stop. The helpers are src/i18n's joinSentences,
// sentenceGap and joinList, and src/ui/sentence.ts. This holds the screens to
// them, reading the source as words.test.ts does, then says what the screens
// say, in Japanese and in English, which stays as it was. The worker too,
// since it writes its messages in the user's language (sw.ts): its old
// leftOut stripped English's full stop from a translated reason ("…。。"),
// which this check, reading the screens alone, never saw.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAst } from "vite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { i18n, joinSentences, t } from "../src/i18n/core";
import { historiesNote, madePrivate } from "../src/shared/histories";
import type { DappSite, DappTxSummary, SessionAuto, SessionBackSummary, SessionView, TokenAmount, UtxoInfo } from "../src/shared/rpc";
import { HandleWarning } from "../src/ui/components/HandleWarning";
import { LovejoinNote, ReturnLinks } from "../src/ui/components/LovejoinReturn";
import { OnNetwork } from "../src/ui/components/NetworkPicker";
import { TokenAmountText, TokenRow } from "../src/ui/components/TokenList";
import { certificateLine, signingTies } from "../src/ui/dapp";
import { NetworkContext } from "../src/ui/network";
import { ClaimReview } from "../src/ui/screens/ClaimAll";
import { handleWarning } from "../src/ui/screens/Home";
import { detailOf, NotMixed, WayBack } from "../src/ui/screens/Lovejoin";
import { Session } from "../src/ui/screens/Swaps";
import { historyOf, UtxoDetails } from "../src/ui/screens/Utxos";
import { DrepRow } from "../src/ui/screens/Voting";
import { asSentence, withoutStop, withStop } from "../src/ui/sentence";
import { viewToken } from "../src/ui/tokens";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const EN: Record<string, string> = JSON.parse(readFileSync(`${SRC}/i18n/translations/en.json`, "utf8"));

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/**
 * Where words a person reads are written: the screens, what they share with the worker, and the worker, which
 * speaks the user's language too. Not src/manifest.ts, whose " " joins the CSP's sources, nobody's sentences.
 */
const WRITERS = ["ui", "shared", "background"];
/** Where an ASCII full stop is added on purpose: to the Rust core's English fragments. */
const ENGLISH_FRAGMENTS = "ui/sentence.ts";
/**
 * Words a space joins that aren't the wallet's sentences, so no language's gap applies: a recovery phrase's
 * (BIP39's English list, joined as the Rust core reads them), and a CIP-20 note's lines (the sender's own, in
 * whatever language they wrote, joined as other wallets show them: background/activity.ts noteOf).
 */
const NOT_SENTENCES = new Set(["words", "phrase", "noteLines"]);
/** What `t()` is called in the screens. */
const TRANSLATE = new Set(["t", "tr"]);
/** Functions that give a whole sentence, beside `t()` and the SHOUTED constants (LOVEJOIN_SEEN()). */
const SENTENCES = new Set(["lovejoinHides", "handleWarning"]);

type Node = { type: string; start: number; end: number; [key: string]: unknown };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(f) ? [path] : [];
  });
}

/**
 * Whether a key, or each key of a choice, is a whole sentence in English: it
 * ends as one. "Found:" or "and 2 tokens" isn't, so the space after it, or
 * before it, is inside a sentence and stays.
 */
function wholeSentence(key: Node | undefined): boolean {
  if (key?.type === "ConditionalExpression") return wholeSentence(key.consequent as Node) && wholeSentence(key.alternate as Node);
  if (key?.type !== "Literal" || typeof key.value !== "string") return false;
  const english = EN[key.value] ?? EN[`${key.value}_other`] ?? "";
  return /[.!?]["”)]?$/.test(english.trimEnd());
}

/** An expression that comes out as a whole sentence: `t(…)` of one, a sentence constant, or a choice of them. */
function sentence(node: Node | null | undefined): boolean {
  if (!node) return false;
  if (node.type === "CallExpression") {
    const callee = node.callee as Node;
    const name = callee.type === "Identifier" ? (callee.name as string) : "";
    if (TRANSLATE.has(name)) return wholeSentence((node.arguments as Node[])[0]);
    return SENTENCES.has(name) || /^[A-Z][A-Z0-9_]+$/.test(name);
  }
  if (node.type === "ConditionalExpression") return sentence(node.consequent as Node) && sentence(node.alternate as Node);
  if (node.type === "LogicalExpression") return node.operator === "&&" && sentence(node.right as Node);
  return false;
}

/** Each place in `file` that joins a language's sentences, lists or full stops the English way. */
function assembledIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
  const found: string[] = [];
  const at = (node: Node, what: string) => found.push(`${source.slice(0, node.start).split("\n").length}: ${what}`);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Node;
    if (n.type === "CallExpression" && (n.callee as Node).type === "MemberExpression") {
      const member = n.callee as Node;
      const method = (member.property as Node).name;
      const arg = (n.arguments as Node[])[0];
      if (method === "join" && arg?.type === "Literal" && typeof arg.value === "string") {
        const object = member.object as Node;
        // ", " is a list a person reads; a bare "," is a machine's format: the CSV's columns, a URL's query.
        if (/, /.test(arg.value)) at(n, "a list joined with English's comma: joinList");
        if (arg.value === " " && !(object.type === "Identifier" && NOT_SENTENCES.has(object.name as string))) {
          at(n, "sentences joined with a space: joinSentences");
        }
      }
      const pattern = (arg?.regex as { pattern?: string } | undefined)?.pattern;
      if (method === "replace" && pattern === "\\.$") at(n, "an English full stop stripped: withoutStop");
      if (method === "replace" && pattern === "\\.?$") at(n, "an English full stop added: withStop");
    }
    if (n.type === "TemplateLiteral") {
      const quasis = (n.quasis as Array<{ value: { cooked: string | null } }>).map((q) => q.value.cooked ?? "");
      const expressions = n.expressions as Node[];
      const last = expressions.length - 1;
      expressions.forEach((e, i) => {
        const before = quasis[i]!;
        const after = quasis[i + 1]!;
        if (sentence(e)) {
          // ` ${t(…)}` after one sentence, `${t(…)} ` before the next, `${t(…)} ${t(…)}` side by side.
          if ((i === 0 && before === " ") || (i === last && after === " ")) at(n, "a sentence put beside another with a space: joinSentences");
          if (i < last && after === " " && sentence(expressions[i + 1])) at(n, "two sentences with a space between: joinSentences");
        }
        // `${reason}.`: words that may be another language's, ended with English's full stop. A "." between two (`${policy}.${name}`) isn't one.
        if (i === last && after === "." && !file.endsWith(ENGLISH_FRAGMENTS)) at(n, "an English full stop added: common.sentence");
        if (i < last && /^, ?$/.test(after)) at(n, "a list with English's comma: joinList");
      });
    }
    if (n.type === "JSXElement" || n.type === "JSXFragment") {
      // What JSX drops: a line break and the indent around it. `{a}{" "}` at a
      // line's end and `{b}` on the next sit side by side.
      const children = (n.children as Node[]).filter((c) => !(c.type === "JSXText" && /^\s*\n\s*$/.test(c.value as string)));
      children.forEach((child, i) => {
        const gap =
          (child.type === "JSXText" && /^[ \t]+$/.test(child.value as string)) ||
          (child.type === "JSXExpressionContainer" && (child.expression as Node).type === "Literal" && (child.expression as Node).value === " ");
        const before = children[i - 1];
        const after = children[i + 1];
        const said = (c?: Node) => c?.type === "JSXExpressionContainer" && sentence(c.expression as Node);
        // A link or a button after a sentence takes the language's gap too: Japanese sets none after 。.
        const control = (c?: Node) => c?.type === "JSXElement" && /^(a|button)$/.test(String(((c.openingElement as Node).name as Node).name));
        if (gap && said(before) && said(after)) at(child, "two sentences with a space between: joinSentences");
        if (gap && said(before) && control(after)) at(child, "a sentence and its link with a space between: sentenceGap");
        if (child.type === "JSXText" && /^\./.test(child.value as string) && before?.type === "JSXExpressionContainer") {
          at(child, "an English full stop added: common.sentence");
        }
      });
    }
    for (const child of Object.values(n)) visit(child);
  };
  visit(ast);
  return found;
}

describe("the screens' and the worker's sentences, lists and full stops, in the source", () => {
  it("are joined the language's way everywhere in src/ui, src/shared and src/background", () => {
    const files = WRITERS.flatMap((dir) => sources(`${SRC}/${dir}`));
    expect(files.length).toBeGreaterThan(100);
    // Once only the screens and histories.ts: the worker, the rest of what it shares with them, and the words
    // Activity shows beside its CSV went unread.
    for (const file of ["background/sessions.ts", "background/koios.ts", "shared/recipients.ts", "ui/activity.ts"]) {
      expect(files).toContain(`${SRC}/${file}`);
    }
    expect(files.flatMap((file) => assembledIn(file).map((line) => `${file.slice(SRC.length + 1)}:${line}`))).toEqual([]);
  });

  it("would catch the worker's kinds, its old leftOut among them, and leave a machine's format and a note's lines alone", () => {
    const probe = fileURLToPath(new URL("./fixtures/assembly-probe.ts", import.meta.url));
    expect(assembledIn(probe).map((line) => line.replace(/^\d+: /, ""))).toEqual([
      "sentences joined with a space: joinSentences",
      "two sentences with a space between: joinSentences",
      "a list joined with English's comma: joinList",
      "an English full stop stripped: withoutStop",
    ]);
  });

  it("never run t() as a module loads, where it would keep the language that was on then", () => {
    const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
    const eager = sources(SRC).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
      const found: string[] = [];
      const visit = (node: unknown, inside: boolean): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach((child) => visit(child, inside));
        const n = node as Node;
        // A getter or a method runs when it's read, as a function does.
        const deferred = inside || FUNCTIONS.has(n.type) || n.type === "MethodDefinition" || (n.type === "Property" && (n.kind === "get" || n.method === true));
        const callee = n.callee as Node | undefined;
        if (!inside && n.type === "CallExpression" && callee?.type === "Identifier" && TRANSLATE.has(callee.name as string)) {
          found.push(`${file.slice(SRC.length + 1)}:${source.slice(0, n.start).split("\n").length}`);
        }
        for (const child of Object.values(n)) visit(child, deferred);
      };
      visit(ast, false);
      return found;
    });
    expect(eager).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What the screens say
// ---------------------------------------------------------------------------

let Settings: typeof import("../src/ui/screens/Settings");
let App: typeof import("../src/ui/App");

beforeAll(async () => {
  // Settings and the app shell read the page's URL when they load (ui/view.ts).
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
  App = await import("../src/ui/App");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const japanese = () => i18n.changeLanguage("ja");

/** What a person reads: the markup gone and nothing put in its place, so a gap that isn't there doesn't appear. */
const words = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

const noop = () => undefined;

describe("whole sentences, one after another", () => {
  it("run on in Japanese with nothing between them, and keep English's space", async () => {
    const spent = [madePrivate(0), madePrivate(1)];
    const lines = () => [historiesNote(spent)!, Settings.talksTo(true, true), signingTies([], true)];
    for (const line of lines()) expect(line).toMatch(/\. [A-Z]/);
    await japanese();
    for (const line of lines()) {
      expect(line).toMatch(/。./);
      expect(line).not.toContain("。 ");
    }
    expect(signingTies([], true)).toBe(`${t("dappUi.privacy.tiesToSession")}${t("dappUi.privacy.notAccountNorPrivate")}`);
  });

  it("keep a space after a Latin sentence among Japanese ones, which a raw English message can be", async () => {
    // English and Spanish set a space anyway: nothing changes for them.
    expect(joinSentences(["The node said BadInputsUTxO.", "It tries again."])).toBe("The node said BadInputsUTxO. It tries again.");
    await japanese();
    expect(joinSentences(["insufficient funds.", "3 分後にもう一度試します。"])).toBe("insufficient funds. 3 分後にもう一度試します。");
    expect(joinSentences(['bad request: "x".', "Why?", "もう一度お試しください。"])).toBe('bad request: "x". Why? もう一度お試しください。');
    // After Japanese's own 。, nothing, as ever. Nor after a raw fragment with no stop: ending it is its caller's
    // (withStop), since only a sentence's end says the next sentence needs the space.
    expect(joinSentences(["一つ。", "二つ。"])).toBe("一つ。二つ。");
    expect(joinSentences(["BadInputsUTxO", "二つ。"])).toBe("BadInputsUTxO二つ。");
  });

  it("run on in Lovejoin's notes and reviews", async () => {
    const session: SessionView = {
      index: 1,
      network: "preprod",
      address: "addr_test1mix",
      createdAt: 0,
      stage: "closed",
      txs: [],
      holding: null,
      mix: { boxes: 2, skipped: "プールのボックスが足りません。" },
      leftBehind: [{ txHash: "12".repeat(32), txIndex: 0, reason: "fee", lovelace: "900000" }],
    };
    await japanese();
    const detail = detailOf(session)!;
    // The reason's own 。 isn't doubled by the sentence it's put in.
    expect(detail).toContain("Lovejoin は除外されました: プールのボックスが足りません。");
    expect(detail).not.toContain("。。");
    expect(detail).not.toContain("。 ");
    for (const page of [words(createElement(WayBack)), words(createElement(NotMixed, { count: 3, busy: false, onAnyway: noop }))]) {
      expect(page).toMatch(/。./);
      expect(page).not.toContain("。 ");
    }
  });

  it("run on into a link after them, and in a page's own words put after a note", async () => {
    const status = { state: "unlocked" as const, version: "1.0.0", network: "preprod" as const, networks: ["mainnet" as const, "preprod" as const], retryAfterMs: 0 };
    const settings = () => words(createElement(Settings.Settings, { status, onBack: noop, onRemoved: noop, onNetwork: noop }));
    const onNetwork = () => words(createElement(OnNetwork, { status, doing: "restore", onChange: noop }));
    const back: SessionBackSummary = { network: "preprod", index: 2, txHash: "cd".repeat(32), fee: "1", lovelace: "1", tokens: [], depositOutputs: 1, inputs: 1 };
    const links = () => words(createElement(ReturnLinks, { back, after: t("swaps.back.privacy.neverAgain") }));
    const seedelf: UtxoInfo = { txHash: "34".repeat(32), index: 0, lovelace: "2000000", tokens: [], locked: false, seedelf: { name: "5eed0e1f00", label: "web-wallet" } };
    const holds = () => words(createElement(UtxoDetails, { of: "seedelf", utxo: seedelf, busy: false, onLock: noop, onClose: noop }));
    expect(settings()).toContain("to compare against. Report a translation error");
    expect(onNetwork()).toContain("Restoring a wallet on Preprod. Change network");
    expect(links()).toContain("as Make private does. The account is never used again.");
    expect(holds()).toContain("It holds your Seedelf web-wallet. Only removing the Seedelf spends it.");
    await japanese();
    expect(settings()).toContain("比較のために英語はいつでも選べます。翻訳の誤りを報告する");
    expect(onNetwork()).toContain("Preprod でウォレットを復元しています。ネットワークを変更");
    expect(links()).toContain("同じです。このアカウントは二度と使われません。");
    expect(holds()).toContain("あなたの Seedelf web-wallet を保持しています。Seedelf を削除したときだけ使われます。");
  });

  it("run on in a return's review, with the reason it left Lovejoin out put in once", async () => {
    const back: SessionBackSummary = {
      network: "preprod",
      index: 4,
      txHash: "cd".repeat(32),
      fee: "300000",
      lovelace: "5200000",
      tokens: [],
      depositOutputs: 1,
      inputs: 2,
      lovejoinSkipped: "ボックスが足りません。",
    };
    await japanese();
    const note = words(createElement(LovejoinNote, { back }));
    expect(note).toContain(": ボックスが足りません。そのため");
    expect(note).not.toContain("。。");
    const site: SessionView = {
      index: 4,
      network: "preprod",
      address: "addr_test1site",
      createdAt: 0,
      stage: "open",
      txs: [],
      holding: { lovelace: "25000000", tokens: [], utxos: 2 },
      site: { origin: "https://app.example" },
    };
    const review = words(
      createElement(ClaimReview, {
        built: { returns: [back], skipped: [] },
        chosen: new Set([4]),
        sessions: [site],
        direct: false,
        busy: false,
        onToggle: noop,
        onDirect: noop,
      }),
    );
    // Bring everything back's list of returns that left Lovejoin out: each reason ends with Japanese's full stop, once.
    expect(review).toContain("app.example: ボックスが足りません。");
    expect(review).not.toContain("。.");
    expect(review).not.toContain("。。");
  });
});

describe("a reason as it came, set before the next sentence", () => {
  // The network's refusal ends in the node's own words, with no full stop of its own (koios.rejected). Before
  // another sentence in Japanese, which sets nothing between two, it ran on: "…TxSubmitFail"}3 分後に…".
  const refusal = () => t("koios.rejected", { why: '{"tag":"TxSubmitFail"}' });

  it("is ended by its line's own stop in a mix's detail, and a stop it brought isn't doubled", async () => {
    const at = Date.UTC(2026, 9, 4, 3);
    const time = new Date(at).toLocaleTimeString();
    const mix = (why: string): SessionView => ({
      index: 3,
      network: "preprod",
      address: "addr_test1mix",
      createdAt: 0,
      stage: "open",
      txs: [],
      holding: null,
      mix: { boxes: 2 },
      chain: { total: 9, sent: 4, confirmed: 3, cut: false, stopped: why },
      auto: { step: "returning", stopping: false, filled: false, approvedMinOut: "0", retry: { at, error: why, reason: "other" } },
    });
    // English gains the full stop the node's words never had; a reason that ends in one reads as it did.
    expect(detailOf(mix(refusal()))).toBe(`Why it stopped: ${refusal()}. It tries again at ${time}. What went wrong: ${refusal()}.`);
    const cut = t("lj.chainCut");
    expect(detailOf(mix(cut))).toBe(`Why it stopped: ${cut} It tries again at ${time}. What went wrong: ${cut}`);
    await japanese();
    expect(detailOf(mix(refusal()))).toBe(`停止した理由: ${refusal()}。${time} にもう一度試します。問題の内容: ${refusal()}。`);
    expect(detailOf(mix(t("lj.chainCut")))).not.toContain("。。");
  });

  it("takes a stop of its own in a swap's retry line, and Japanese keeps a space after it", async () => {
    const swap = (retry: NonNullable<SessionAuto["retry"]>): SessionView => ({
      index: 2,
      network: "preprod",
      address: "addr_test1" + "q".repeat(50),
      createdAt: 0,
      stage: "open",
      txs: [{ kind: "out", txHash: "ab".repeat(32), at: 0, confirmed: true }],
      swap: {
        amount: "10000000",
        tokenIn: "lovelace",
        tokenOut: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d",
        slippage: 1,
        amountOut: "4200000",
        minAmountOut: "4158000",
        display: { in: { label: "₳", decimals: 6 }, out: { label: "tUSDM", decimals: 6 } },
      },
      holding: { lovelace: "14000000", tokens: [], utxos: 2 },
      auto: { step: "ordering", stopping: false, filled: false, approvedMinOut: "4158000", retry },
    });
    const page = (retry: NonNullable<SessionAuto["retry"]>) =>
      words(createElement(Session, { session: swap(retry), reading: false, onRefresh: noop, onBack: noop, onChanged: noop }));
    // Two and a half minutes off: "in 3 minutes" for as long as the test takes.
    const at = Date.now() + 150_000;
    expect(page({ at, error: refusal(), reason: "other" })).toContain(`${refusal()}. Trying again in 3 minutes. Try now`);
    // A reason the worker gave a code reads as it did.
    expect(page({ at, error: "Koios", reason: "koios-silent" })).toContain("Koios didn't answer. Trying again in 3 minutes. Try now");
    await japanese();
    expect(page({ at, error: refusal(), reason: "other" })).toContain(`${refusal()}. 3 分後にもう一度試します。今すぐ試す`);
    expect(page({ at, error: "Koios", reason: "koios-silent" })).toContain("Koios が応答しませんでした。3 分後にもう一度試します。今すぐ試す");
  });

  it("ends with the language's own stop in Lock's warning, before Try again", async () => {
    const warning = (message: string) => words(createElement(App.LockFailed, { message, onRetry: noop }));
    // As it read with a message that ends in a full stop; one without (the browser's, often) gains one.
    expect(warning("Storage refused.")).toContain("The wallet couldn't lock: Storage refused. Try again.");
    expect(warning("Extension context invalidated")).toContain("The wallet couldn't lock: Extension context invalidated. Try again.");
    await japanese();
    expect(warning("Extension context invalidated")).toContain(
      "ウォレットをロックできませんでした: Extension context invalidated。もう一度お試しください。",
    );
    const locked = t("worker.wallet.locked");
    expect(warning(locked)).toContain(`ウォレットをロックできませんでした: ${locked}もう一度お試しください。`);
    expect(warning(locked)).not.toContain("。。");
  });
});

describe("a dApp's staking, in a sentence", () => {
  type Certificate = DappTxSummary["certificates"][number];
  const own = (c: Partial<Certificate>): Certificate => ({
    kind: "register",
    own: true,
    pool: null,
    poolAction: null,
    drep: null,
    deposit: null,
    refund: null,
    ...c,
  });
  const pool = "pool1abc";
  const drep = "drep_always_abstain";

  it("says each of WebAssembly's kinds as English said it", () => {
    const line = (c: Partial<Certificate>) => certificateLine(own(c), true, "your public account");
    expect(line({})).toBe("Registers your stake key.");
    expect(line({ deposit: "2000000" })).toBe("Registers your stake key (a 2\u00a0₳ deposit).");
    expect(line({ kind: "register-delegate", deposit: "2000000", pool })).toBe("Registers your stake key (a 2\u00a0₳ deposit), stakes with pool1abc.");
    expect(line({ kind: "register-vote", deposit: "2000000", drep })).toBe("Registers your stake key (a 2\u00a0₳ deposit), delegates your vote: Always abstain.");
    expect(line({ kind: "register-delegate-vote", deposit: "2000000", pool, drep })).toBe(
      "Registers your stake key (a 2\u00a0₳ deposit), stakes with pool1abc, delegates your vote: Always abstain.",
    );
    expect(line({ kind: "delegate", pool })).toBe("Stakes with pool1abc.");
    expect(line({ kind: "vote", drep })).toBe("Delegates your vote: Always abstain.");
    expect(line({ kind: "delegate-vote", pool, drep })).toBe("Stakes with pool1abc, delegates your vote: Always abstain.");
    expect(line({ kind: "unregister" })).toBe("Stops your staking.");
  });

  it("is whole Japanese sentences, its clauses joined as Japanese joins them, with Japanese's full stop", async () => {
    await japanese();
    const line = (c: Partial<Certificate>, back = true) => certificateLine(own(c), back, t("dappUi.whose.warn.account"));
    expect(line({ kind: "register-delegate-vote", deposit: "2000000", pool, drep })).toBe(
      "あなたのステーク鍵を登録し（2\u00a0₳ のデポジット）、pool1abc にステーキングし、投票権を委任します（委任先: 常に棄権）。",
    );
    expect(line({ kind: "unregister", refund: "2000000" }, false)).toBe(
      "あなたのステーキングを停止しますが、その 2\u00a0₳ のデポジットはすべてが公開アカウントへ戻るわけではありません。上に表示された送信額に含まれています。",
    );
    for (const kind of ["register", "delegate", "vote", "delegate-vote", "unregister"]) {
      const said = line({ kind, pool: kind.includes("delegate") ? pool : null, drep: kind.includes("vote") ? drep : null });
      expect(said).toMatch(/。$/);
      expect(said).not.toMatch(/\.$/);
    }
  });
});

describe("a full stop where a clause is said as a sentence", () => {
  it("is the language's when the wallet adds one, and never a second", async () => {
    // The Rust core's reasons are lower-case English fragments.
    expect(asSentence("invalid checksum")).toBe("Invalid checksum.");
    expect(asSentence("Koios didn't answer.")).toBe("Koios didn't answer.");
    expect(asSentence("Why?")).toBe("Why?");
    expect(asSentence("ウォレットが応答しませんでした。")).toBe("ウォレットが応答しませんでした。");
    expect(asSentence("本当ですか？")).toBe("本当ですか？");
    expect(withoutStop("  the pool is short. ")).toBe("the pool is short");
    expect(withoutStop("プールが足りません。")).toBe("プールが足りません");
    expect(withoutStop("Why?")).toBe("Why?");
    expect(withStop("it places no order")).toBe("it places no order.");
    expect(withStop(" it places no order. ")).toBe("it places no order.");
    expect(withStop("注文を出しません。")).toBe("注文を出しません。");
    expect(withStop("Why?")).toBe("Why?");
  });

  it("ends a token's mark, and a site's wait, with Japanese's 。", async () => {
    const foo: TokenAmount = { policyId: "ab".repeat(28), assetName: "464f4f", quantity: "5", decimals: 0, fingerprint: "asset1foo" };
    const mark = () => words(createElement(TokenAmountText, { token: foo, amount: "500" }));
    expect(mark()).toBe("500 FOONot on the wallet's list, asset1foo.");
    const sites: DappSite[] = [{ origin: "https://app.example", connectedAt: 0, session: 3 }];
    const sessions: SessionView[] = [
      { index: 3, network: "preprod", address: "addr_test1s", createdAt: 0, stage: "funding", txs: [], holding: null, site: { origin: "https://app.example" } },
    ];
    const wait = () => words(createElement(Settings.SiteRows, { sites, sessions, busy: false, onDisconnect: noop }));
    expect(wait()).toContain("Its funding is on its way: wait for it to land.");
    await japanese();
    expect(mark()).toBe("500 FOOウォレットのリストに含まれていません: asset1foo。");
    expect(wait()).toContain("資金提供が送信中です。届くまでお待ちください。");
    expect(wait()).not.toContain("ください.");
  });
});

describe("a list", () => {
  const handle = (name: string) => ({ policyId: "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a", assetName: `000de140${Buffer.from(name).toString("hex")}` });

  it("takes Japanese's comma in a warning, a UTxO's history and Remove wallet's sessions", async () => {
    const utxo: UtxoInfo = { txHash: "34".repeat(32), index: 0, lovelace: "2000000", tokens: [], locked: false, history: { id: `received:${"ab".repeat(32)}+session:1`, origin: "session" } };
    const open = () =>
      Settings.atStakeLines([
        {
          network: "preprod",
          sessions: [
            { index: 0, kind: "swap" },
            { index: 2, kind: "mix" },
          ],
          chainSending: false,
        },
      ])[0]!;
    expect(historyOf(utxo)).toBe("Received, Private session 2");
    expect(open()).toContain("private session 1 (a swap), private session 3 (a mix)");
    await japanese();
    expect(words(createElement(HandleWarning, { tokens: [handle("alice"), handle("bob")] }))).toContain("$alice、$bob");
    expect(handleWarning(["alice", "bob"])).toContain("$alice、$bob");
    expect(historyOf(utxo)).toBe("受取、プライベートセッション 2");
    expect(open()).not.toContain(", ");
    expect(open()).toContain("プライベートセッション 1（スワップ）、プライベートセッション 3（ミックス）");
  });

  it("takes Japanese's comma in what a screen reader says for a row", async () => {
    const foo: TokenAmount = { policyId: "ab".repeat(28), assetName: "464f4f", quantity: "5", decimals: 0, fingerprint: "asset1foo" };
    const token = () => renderToStaticMarkup(createElement(TokenRow, { view: viewToken("preprod", foo), onOpen: noop }));
    const drep = () => renderToStaticMarkup(createElement(DrepRow, { drep: { id: `drep1${"q".repeat(52)}`, name: "Alice" }, shared: false, disabled: false, onPick: noop }));
    // The amount is hidden, as balances are until the settings are read.
    expect(token()).toContain('aria-label="FOO, ••••"');
    expect(drep()).toMatch(/aria-label="Alice, drep1q+…q+"/);
    await japanese();
    expect(token()).toContain('aria-label="FOO、••••"');
    expect(drep()).toMatch(/aria-label="Alice、drep1q+…q+"/);
  });
});
