// Chunk 51, r2a#1 (also w1b#1): which addresses Send and Make public pay, and what they say of them.
//
// - A key address whose stake part is a script (CIP-19 type 2, `addr_test1y…`) is an ordinary payee: only its
//   payment key spends what's paid there. Core refused it as a script's, counting the stake part too.
// - A script's address (its payment part a script: a multisig's, a contract's) the ledger takes, so the wallet pays
//   it, with one short warning where the refusal was, Review live: the payment carries no datum, which some scripts
//   can never spend and some let anyone take (the Seedelf contract's own address among them). The owner's call of
//   2026-11-18 (B16), by the rule that the wallet refuses only what the ledger or the contracts refuse.
// - A Byron address stays refused, in true words: Seedelf Wallet can't pay one ("That isn't a Cardano address" was
//   false).
//
// The worker's mapping and flag are tested over WebAssembly's answers as they come (`checkPayableAddress` faked where
// the module built before this change would still refuse); the cases at the end ask the real module, and need it
// rebuilt with this change. The screens are the real ones, rendered over the house's useState seed
// (stake-elsewhere-screens.test.ts's seam): a review's state is one only an awaited answer reaches.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => {
  /** Whether a useState's initial value is `want`: an empty object for `{}`, or the same value. */
  const matches = (initial: unknown, want: unknown) =>
    want && typeof want === "object" && !Object.keys(want).length
      ? !!initial && typeof initial === "object" && !Array.isArray(initial) && !Object.keys(initial).length
      : Object.is(initial, want);
  const state = {
    seeds: [] as Array<{ after: unknown[]; initial?: unknown; value: unknown; used?: true }>,
    initials: [] as unknown[],
    seeded(initial: unknown): unknown {
      const before = state.initials;
      state.initials = [...before, initial];
      for (const seed of state.seeds) {
        if (seed.used || before.length < seed.after.length) continue;
        if ("initial" in seed ? !matches(initial, seed.initial) : initial !== undefined) continue;
        const run = before.slice(before.length - seed.after.length);
        if (!seed.after.every((want, i) => matches(run[i], want))) continue;
        seed.used = true;
        return seed.value;
      }
      return initial;
    },
    reset() {
      state.seeds = [];
      state.initials = [];
    },
  };
  return state;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial?: unknown) => react.useState(seam.seeded(initial)) };
});
// Nothing a screen shows is asked of the worker while it renders: any request stays unanswered.
vi.mock("../src/ui/background", async (original) => {
  const pending = { then: () => pending, catch: () => pending, finally: () => pending };
  return { ...(await original<typeof import("../src/ui/background")>()), call: () => pending };
});

const { checkPayable, resolveDestination } = await import("../src/background/destination");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { AccountsContext } = await import("../src/ui/accounts");
const { CardanoSend } = await import("../src/ui/screens/CardanoSend");
const { Withdraw } = await import("../src/ui/screens/Withdraw");
const { bech32 } = await import("./fixtures/bech32");
const { loadTestWasm, ownedUtxos, testBalances, vectors } = await import("./fakes");

const PASSWORD = "correct horse battery";
const v = vectors("cardano_account.json").find((x) => x.account === 0 && x.phrase.split(" ").length === 12)!;
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));
/** A preprod address of CIP-19 header type `type` (0 to 7) over `parts` (hex: a payment part, then any stake part). */
const preprod = (type: number, parts: string) => bech32("addr_test", hexBytes(type.toString(16) + "0" + parts));
const SCRIPT = "77".repeat(28);
const KEY = "11".repeat(28);
const STAKE = "cd".repeat(28);
/** A multisig's address: a script's payment part, no stake part (type 7, `addr_test1w…`). */
const MULTISIG = preprod(7, SCRIPT);
/** A key's payment part, a script's stake part (type 2, `addr_test1y…`): a key address. */
const KEY_STAKED_BY_A_SCRIPT = preprod(2, KEY + SCRIPT);
/** A testnet Byron address (Pallas's own vector). */
const BYRON =
  "37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na";
/** The line where the refusal was. */
const WARNING =
  "That's a script's address. This payment carries no datum: some scripts can never spend it, and some let anyone take it.";
const SENT = "20000000";
const noop = () => undefined;
const none = { lovelace: "0", tokens: [], utxos: 0 };
const cardano = {
  lovelace: "100000000",
  tokens: [],
  utxos: 3,
  addressesUsed: 1,
  locked: none,
  staking: { registered: true, pool: null, drep: null, rewards: "0", deposit: "2000000" },
};
const seedelf = { lovelace: "100000000", tokens: [], utxos: 4, seedelfs: [], locked: none };

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
const has = (markup: string, testId: string) => markup.includes(`data-testid="${testId}"`);

/** `element` on preprod, in a wallet of one account, account 0 on screen. */
function render(element: ReactElement): string {
  const accounts = { accounts: [{ index: 0 }], active: 0, loaded: true, name: "Account 1", several: false, reload: async () => undefined };
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(AccountsContext.Provider, { value: accounts }, element),
      ),
    ),
  );
}

/** A form whose one recipient, typed as `destination.address`, read as `destination`. */
function form(screen: "send" | "withdraw", destination: { address: string; own: boolean; script?: true }): string {
  seam.reset();
  const read = { to: destination.address, read: { state: "read", destination } };
  seam.seeds.push({ after: [], initial: {}, value: { 0: read } });
  const to = destination.address;
  return render(
    screen === "send"
      ? createElement(CardanoSend, { cardano, total: cardano.lovelace, to, onCancel: noop, onSent: noop })
      : createElement(Withdraw, { seedelf, to, onCancel: noop, onSent: noop }),
  );
}

/** Send's review of 20 ₳ to each of `destinations`, as SendService.pay puts the worker's answers in it. */
function sendReview(destinations: object[]): string {
  seam.reset();
  // Its state starts after the form's reads', its Max's, its note's and the note's cut's.
  seam.seeds.push({
    after: [{}, false, "", false],
    value: {
      network: "preprod",
      txHash: "ab".repeat(32),
      max: false,
      fee: "200000",
      changeLovelace: "50000000",
      changeTokens: 0,
      inputs: 2,
      payments: destinations.map((d) => ({ ...d, lovelace: SENT, minimum: null, tokens: [] })),
    },
  });
  return render(createElement(CardanoSend, { cardano, total: cardano.lovelace, onCancel: noop, onSent: noop }));
}

/** Make public's review of 20 ₳ to each of `destinations`, as WithdrawService.build's summaryOf has it. */
function makePublicReview(destinations: object[]): string {
  seam.reset();
  seam.seeds.push({
    after: [{}, false],
    value: {
      network: "preprod",
      txHash: "ab".repeat(32),
      max: false,
      fee: { size: "500000", compute: "50000", scriptReference: "0", total: "550000" },
      changeLovelace: "50000000",
      changeTokens: 0,
      changeOutputs: 1,
      changeMinimum: "0",
      inputs: 3,
      left: 0,
      payments: destinations.map((d) => ({ ...d, lovelace: SENT, minimum: null, tokens: [] })),
    },
  });
  return render(createElement(Withdraw, { seedelf, onCancel: noop, onSent: noop }));
}

beforeEach(() => seam.reset());

describe("what the worker says of an address (chunk 51, r2a#1)", () => {
  it("says a Byron address can't be paid, in words, and anything else WebAssembly refuses isn't an address", () => {
    const wasm = loadTestWasm();
    const refusing = (said: string) =>
      ({ ...wasm, checkPayableAddress: () => { throw new Error(said); } }) as typeof wasm;
    expect(() => checkPayable(refusing("Seedelf Wallet can't pay a Byron address"), "preprod", BYRON)).toThrow(
      "Seedelf Wallet can't pay a Byron address.",
    );
    // A script's address is no longer refused, so nothing WebAssembly refuses past the prefixes is said to be one.
    for (const said of ["That isn't a Cardano address", "Payments go to an address on preprod: not a stake, Byron or other network's address"]) {
      expect(() => checkPayable(refusing(said), "preprod", MULTISIG)).toThrow("That isn't a Cardano address.");
    }
  });

  it("flags a script's address, by its payment part alone, and nothing else", async () => {
    const tb = testBalances();
    await tb.wallet.create(v.phrase, PASSWORD);
    const wasm = loadTestWasm();
    // As WebAssembly answers with this change: the ledger takes any of these on preprod.
    const deps = { ...tb.deps, wasm: { ...wasm, checkPayableAddress: () => undefined } as typeof wasm };
    const resolve = (to: string) => resolveDestination(deps, "preprod", to);
    // A script's payment part, with no stake part, with a key's, a script's and a pointer (types 7, 1, 3 and 5).
    const POINTER = "010203";
    for (const script of [MULTISIG, preprod(1, SCRIPT + STAKE), preprod(3, SCRIPT + SCRIPT), preprod(5, SCRIPT + POINTER)]) {
      expect(await resolve(script), script).toEqual({ address: script, own: false, script: true });
      expect(await resolve(` ${script.toUpperCase()} `), "as a user may paste it").toMatchObject({ script: true });
    }
    // A key's payment part, whatever its stake part: not a script's (types 2, 0, 4 and 6).
    for (const key of [KEY_STAKED_BY_A_SCRIPT, preprod(0, KEY + STAKE), preprod(4, KEY + POINTER), preprod(6, KEY)]) {
      expect(await resolve(key), key).toEqual({ address: key, own: false });
    }
  });
});

describe("Send and Make public to a script's address (chunk 51, r2a#1)", () => {
  it("say in one line where the refusal was that it carries no datum, and Review stays live", () => {
    for (const screen of ["send", "withdraw"] as const) {
      const shown = form(screen, { address: MULTISIG, own: false, script: true });
      expect(has(shown, `${screen}-script`), screen).toBe(true);
      expect(words(shown), screen).toContain(WARNING);
      expect(shown, screen).not.toContain('role="alert"');
      // A key address staked by a script says nothing of the kind.
      const plain = form(screen, { address: KEY_STAKED_BY_A_SCRIPT, own: false });
      expect(has(plain, `${screen}-script`), screen).toBe(false);
    }
  });

  it("say it again on the review, by its number where there are several", () => {
    const script = { address: MULTISIG, own: false, script: true };
    const plain = { address: KEY_STAKED_BY_A_SCRIPT, own: false };
    for (const [screen, review] of [
      ["send", sendReview],
      ["withdraw", makePublicReview],
    ] as const) {
      const one = review([script]);
      expect(words(one), screen).toContain(WARNING);
      expect(words(review([plain])), screen).not.toContain("script's address");
      const several = words(review([plain, script]));
      expect(several, screen).toContain(
        "Recipient 2 is a script's address. That payment carries no datum: some scripts can never spend it, and some let anyone take it.",
      );
      expect(several, screen).not.toContain("Recipient 1 is a script's address");
    }
  });
});

describe("with WebAssembly rebuilt with this change (chunk 51, r2a#1)", () => {
  it("pays a key address staked by a script and a script's address, and says why it won't pay a Byron one", async () => {
    const tb = testBalances();
    await tb.wallet.create(v.phrase, PASSWORD);
    expect(await tb.withdraw.resolve("preprod", KEY_STAKED_BY_A_SCRIPT)).toEqual({ address: KEY_STAKED_BY_A_SCRIPT, own: false });
    expect(await tb.withdraw.resolve("preprod", MULTISIG)).toEqual({ address: MULTISIG, own: false, script: true });
    // The Seedelf contract's own address: anyone can take a payment there with no datum, which the warning says.
    const contract = ownedUtxos[0]!.address;
    expect(await tb.withdraw.resolve("preprod", contract)).toEqual({ address: contract, own: false, script: true });
    await expect(tb.withdraw.resolve("preprod", BYRON)).rejects.toThrow("Seedelf Wallet can't pay a Byron address.");
  });
});
