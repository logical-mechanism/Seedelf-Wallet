// What one payment may hold, as the ledger has it rather than as the wallet chose before its rule of 2026-10-19
// (the wallet refuses only what the ledger or the contracts refuse).
//
// - Chunk 51, gap-g8#4: a payment paid at most 20 recipients. Core has no count, only the ledger's 16 KiB, so the
//   cap is 100 on both sides (here and WebAssembly's), and what doesn't fit is core's TooLarge to say. Only a private
//   session's funding said that in the user's words; Send, private Send and Make public showed core's English.
// - Chunk 51, gap-g8#3: a note was cut to 64 characters, one of CIP-20's lines (Lace's limit). The ledger holds each
//   line to 64 bytes and takes as many lines as fit, and core already writes them: the box takes 500 characters, what
//   Activity keeps of a note.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { checkRecipients, MAX_RECIPIENTS } from "../src/shared/recipients";
import { tooMany } from "../src/background/short";
import { SendService } from "../src/background/send";
import { Collateral } from "../src/background/collateral";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { AccountsContext } from "../src/ui/accounts";
import { CardanoSend } from "../src/ui/screens/CardanoSend";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

/** Core's TooLarge (seedelf-core build.rs), in its fixed English: a transaction over 16 KiB, and an output over 5,000 bytes. */
const TOO_LARGE = [
  "This transaction would be 17093 bytes, over the network's limit of 16384. Send fewer tokens, or pay fewer recipients, at once",
  "One output would hold 5210 bytes of tokens, over the network's limit of 5000. Send fewer tokens at once",
];
const SAID = "That's more than one transaction can hold. Send fewer tokens, or pay fewer recipients, at once.";

describe("how many recipients one payment pays (chunk 51, gap-g8#4)", () => {
  it("is 100, and one more is refused in words", () => {
    expect(MAX_RECIPIENTS).toBe(100);
    expect(() => checkRecipients(100)).not.toThrow();
    expect(() => checkRecipients(101)).toThrow("A payment pays at most 100 recipients at once.");
    expect(() => checkRecipients(0)).toThrow("A payment needs someone to pay.");
  });

  it("says core's refusal of what one transaction can't hold in the user's words", () => {
    for (const english of TOO_LARGE) {
      // Wrapped as WebAssembly's js_error writes a context chain, too.
      for (const message of [english, `Building the payment: ${english}`]) {
        expect((tooMany(new Error(message)) as Error).message, message).toBe(SAID);
      }
    }
    // Anything else as it was, the computation's refusal still its own.
    const other = new Error("Not enough ADA in the Cardano account");
    expect(tooMany(other)).toBe(other);
    expect((tooMany(new Error("This needs more computation than a transaction may use")) as Error).message).toBe(
      "That needs more UTxOs than the wallet can send at once. Send less, or to one recipient at a time.",
    );
  });

  // Chunk 51, still#8: any "over the network's limit of" was taken for TooLarge, so core's limit on reference scripts
  // (build.rs `reference_script_fee`), whose own advice is to spend fewer UTxOs holding one, was said as too many tokens
  // or recipients. Core's other limits keep their own words.
  it("leaves core's other limits their own words", () => {
    for (const english of [
      "This transaction would use 213000 bytes of reference scripts, over the network's limit of 204800. Spend fewer UTxOs holding one at once",
      "That address is 129 bytes, over the network's limit of 128: use a shorter one",
    ]) {
      for (const message of [english, `Building the payment: ${english}`]) {
        const e = new Error(message);
        expect(tooMany(e), message).toBe(e);
      }
    }
  });

  it("says it so on Send from the public account too", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const wasm = loadTestWasm();
    const send = new SendService({
      ...t.deps,
      wasm: {
        ...wasm,
        buildAccountSend: () => {
          throw new Error(TOO_LARGE[0]);
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    const payments = Array.from({ length: 3 }, () => ({ to: THEIRS, lovelace: "2000000", tokens: [] }));
    await expect(send.build("preprod", payments)).rejects.toThrow(SAID);
  });
});

describe("a note on a payment from the public account (chunk 51, gap-g8#3)", () => {
  it("holds 500 characters, as the box counts them", () => {
    const none = { lovelace: "0", tokens: [], utxos: 0 };
    const cardano = {
      lovelace: "100000000",
      tokens: [],
      utxos: 3,
      addressesUsed: 1,
      locked: none,
      staking: { registered: true, pool: null, drep: null, rewards: "0", deposit: "2000000" },
    };
    const accounts = { accounts: [{ index: 0 }], active: 0, loaded: true, name: "Account 1", several: false, reload: async () => undefined };
    const markup = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
          createElement(
            AccountsContext.Provider,
            { value: accounts },
            createElement(CardanoSend, { cardano, total: cardano.lovelace, onCancel: () => undefined, onSent: () => undefined }),
          ),
        ),
      ),
    );
    const hint = markup.match(/data-testid="send-note-hint"[^>]*>([^<]*)</)?.[1];
    expect(hint).toBe("0/500. Anyone can read it, for good.");
  });
});
