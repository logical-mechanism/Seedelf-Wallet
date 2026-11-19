// Chunk 51, e3b#3: while a private session's funding that's sent waits for the chain, the connector's window showed
// the funding alone. A request that came in behind it wasn't counted and had no Decline all (CW-7 gave every other
// screen "1 of N waiting" with Decline all), though the worker brings the window to the front for it. Closing the
// window, as the funding's screen says the user can, then declined it, and turned a connecting site away, unseen. The
// funding's review, before Send, had the same gap. Both now show the queue line, the sent funding's screen what changed
// too, as the others do. The verifier's test (verify/e3b-3.md, at 009c4ab4), restored, and the review's case beside it.
//
// The worker is the real one (tests/fakes.ts), the session service's own work stood in for: the funding sent, and Koios
// not seeing it yet, as for its first minute, or several in parts. The window is DappApprovals itself, rendered from
// what the worker lists, its effects run during the render as screens-wiring-review-fixes.test.ts runs them
// (`vi.mock("react")`), and `call` answering at once. The review's state, which only an awaited build reaches, starts
// from a seed, as that file's do.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  /** The components whose effects run, by name: theirs alone, never a child's or a hook's. */
  effects: new Set<string>(["DappApprovals"]),
  /** What the worker lists, as `dapp-approvals` answers it. */
  approvals: [] as unknown[],
  /** A funding's review to start ConnectRequest's review state from: the state after its amount's ("") and tokens' ({}). */
  review: undefined as unknown,
  /** The initial values of the useState calls so far, newest last. */
  initials: [] as unknown[],
}));

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const caller = () => {
    const frames = (new Error().stack ?? "").split("\n");
    const at = frames.findIndex((f) => f.includes("seamEffect"));
    return /at (?:[\w$]+\.)*([\w$]+)/.exec(frames[at + 1] ?? "")?.[1] ?? "";
  };
  /** An effect of a component under test runs during the render, again only when a dependency changes. */
  function seamEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
    const last = react.useRef<readonly unknown[] | null>(null);
    if (!seam.effects.has(caller())) return;
    const was = last.current;
    if (was && deps && deps.length === was.length && deps.every((d, i) => Object.is(d, was[i]))) return;
    last.current = deps ?? [];
    run();
  }
  const empty = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length;
  /** useState, the review's seeded: the first state starting empty right after an amount's "" and its tokens' {}. */
  function useState(initial?: unknown) {
    const [amount, tokens] = seam.initials.slice(-2);
    seam.initials.push(initial);
    if (seam.review !== undefined && initial === undefined && amount === "" && empty(tokens)) {
      const review = seam.review;
      seam.review = undefined;
      return react.useState(review);
    }
    return react.useState(initial);
  }
  return { ...react, useEffect: seamEffect, useLayoutEffect: seamEffect, useState };
});

vi.mock("../src/ui/background", async (original) => {
  const real = await original<typeof import("../src/ui/background")>();
  /** A thenable that answers at once: the window's read lands in the same render. */
  const now = (value: unknown): PromiseLike<unknown> => ({
    then: (ok?: ((v: unknown) => unknown) | null) => {
      ok?.(value);
      return now(undefined) as never;
    },
  });
  const never: PromiseLike<unknown> = { then: () => never as never };
  return {
    ...real,
    call: (type: string) => (type === "dapp-approvals" ? now(seam.approvals) : never),
    onDappChanged: () => () => undefined,
  };
});

const { DappApprovals } = await import("../src/ui/screens/DappApprovals");
const { APIError, DataSignError } = await import("../src/shared/dapp");
const { testBalances, vectors } = await import("./fakes");
type DappError = import("../src/background/dapp").DappError;
type DappSession = import("../src/background/dapp").DappSession;

const PASSWORD = "correct horse battery";
const account = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
const OWN = account.preprod.receive_0 as string;
const TX = "ab".repeat(32);

let pages = 0;
const site = (origin: string): DappSession => ({ id: `e3b-3-${++pages}`, origin, title: "Example" });
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const heard = (p: Promise<unknown>) => p.then(() => undefined, (e: DappError) => e.failure);
/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** The window as the worker lists what waits: DappApprovals, rendered. */
function window(approvals: unknown[]) {
  seam.approvals = approvals;
  seam.initials = [];
  return renderToStaticMarkup(createElement(DappApprovals));
}

/** A wallet with its connector on and site B connected to the public account. */
async function withSiteB() {
  const t = testBalances();
  await t.wallet.create(account.phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const b = site("https://b.example");
  const enablingB = t.dapp.call(b, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enablingB).toBe(true);
  return { t, b };
}

describe("chunk 51, e3b#3: requests that come in behind a private session's funding", () => {
  it("are counted on the sent funding's screen, with Decline all, before closing it declines them", async () => {
    const { t, b } = await withSiteB();

    // The session service's sending and reading, stood in for: sent, and not seen by Koios until `landed`.
    const landed = { now: false };
    Object.assign(t.sessions as unknown as Record<string, unknown>, {
      siteOutSubmit: async () => ({ index: 0, pending: {} }),
      siteAccount: async () => ({ address: "", reward: "", keyHash: "00".repeat(28) }),
      accountUtxos: async () => (landed.now ? [{}] : []),
      fundingSeen: async () => "landed",
    });

    // Site A connects to a private session: its funding is sent from the window and waits for the chain.
    const a = site("https://a.example");
    const enablingA = t.dapp.call(a, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    const connectA = t.dapp.approvals()[0]!;
    expect(await t.dapp.answer(connectA.id, true, PASSWORD, { txHash: TX })).toEqual({});
    expect(t.dapp.approvals()).toMatchObject([{ id: connectA.id, kind: "connect", funding: { index: 0, txHash: TX } }]);

    // Meanwhile B asks to sign and C to connect: each brings the window to the front.
    const shown = t.dappWindow.shown;
    const signingB = heard(t.dapp.call(b, "signData", [t.deps.wasm.cip30Address(OWN), hex("Sign in")]));
    const enablingC = heard(t.dapp.call(site("https://c.example"), "enable", []));
    await until(() => t.dapp.approvals().length === 3);
    expect(t.dappWindow.shown).toBe(shown + 2);

    // The window, from what the worker lists: still the funding, and it says two more wait, with Decline all.
    const html = window(t.dapp.approvals());
    const page = text(html);
    expect(html).toContain('data-testid="dapp-funding"');
    expect.soft(page, "the window shows the funding and nothing of what waits behind it").toContain("1 of 3 waiting");
    expect.soft(page).toContain("Decline all");
    expect.soft(html).toContain('data-testid="dapp-queue"');

    // The user closes it, as the funding's screen says they can: the funding goes on; B and C are declined.
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    expect(t.dapp.approvals()).toMatchObject([{ id: connectA.id, funding: { index: 0, txHash: TX } }]);
    expect(await signingB).toEqual({ code: DataSignError.UserDeclined, info: "The user declined." });
    expect(await enablingC).toEqual({ code: APIError.Refused, info: "The user declined." });
    // And C is turned away, as a site declined is.
    await expect(t.dapp.call(site("https://c.example"), "enable", [])).rejects.toMatchObject({
      failure: { code: APIError.Refused, info: "The user declined this site just now. It can ask again in 10 s." },
    });

    // The funding lands: A connects, and nothing waits.
    landed.now = true;
    expect(await enablingA).toBe(true);
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("are counted on the funding's review before Send, with Decline all", async () => {
    const { t, b } = await withSiteB();
    // Site A asks to connect and the user reviews a private session's funding for it; B asks to sign meanwhile.
    const a = site("https://a.example");
    const enablingA = heard(t.dapp.call(a, "enable", []));
    await until(() => t.dapp.approvals().length === 1);
    const signingB = heard(t.dapp.call(b, "signData", [t.deps.wasm.cip30Address(OWN), hex("Sign in")]));
    await until(() => t.dapp.approvals().length === 2);

    // The funding's review, as its build left it: 24 ₳ for the site, the 5 ₳ kept aside, the fee.
    const address = "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
    seam.review = {
      network: "preprod",
      txHash: TX,
      index: 0,
      address,
      payments: [
        { address, lovelace: "24000000", tokens: [] },
        { address, lovelace: "5000000", tokens: [] },
      ],
      max: false,
      fee: { size: "200000", compute: "30000", scriptReference: "0", total: "230000" },
      changeLovelace: "0",
      changeTokens: 0,
      changeOutputs: 0,
      changeMinimum: "0",
      inputs: 1,
      left: 0,
    };
    const html = window(t.dapp.approvals());
    expect(seam.review, "the review's state was seeded").toBeUndefined();
    expect(html).toContain('data-testid="dapp-funding-review"');
    expect.soft(text(html)).toContain("1 of 2 waiting");
    expect.soft(text(html)).toContain("Decline all");
    expect.soft(html).toContain('data-testid="dapp-queue"');

    // Nothing was sent: both still wait, and the window's close declines them, as it always has.
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    expect(await signingB).toEqual({ code: DataSignError.UserDeclined, info: "The user declined." });
    expect(await enablingA).toEqual({ code: APIError.Refused, info: "The user declined." });
  });
});
