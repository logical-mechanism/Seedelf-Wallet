// Chunk 51, e7b#2: a DRep profile's address that the ledger takes is refused for its scheme, or for a space.
//
// The ledger reads an anchor's address as text and checks one thing: at most 128 bytes of UTF-8 from protocol 9
// (cardano-ledger's `instance DecCBOR Url`, `textDecCBOR 128`; Conway's CDDL `url = text .size (0 .. 128)`). No
// Conway rule reads it further. So `ar://` and an Arweave ID (48 bytes) is an anchor the ledger takes, and so is an
// address with a space in it. The form makes an anchor only when `anchorUrlProblem` gives nothing (Governance.tsx),
// and core's `anchor()` refused whitespace and control characters, so each was a refusal on top of the ledger's, where
// the owner's rule (2026-10-19) allows a warning at most. The address is still trimmed, and still needed.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { certificateKinds } from "../src/background/cbor";
import { SESSION_STAKE } from "../src/background/staking";
import type { KoiosDrepStanding } from "../src/background/koios";
import type { OwnDrep } from "../src/shared/rpc";
import { anchorUrlProblem, DrepProfileEdit, MAX_ANCHOR_URL } from "../src/ui/screens/Governance";
import { NetworkContext } from "../src/ui/network";
import { koiosPreprod, loadTestWasm, stakingPreprod, testBalances, vectors } from "./fakes";

const bytes = (s: string) => new TextEncoder().encode(s).length;
/** An Arweave transaction's ID: 32 bytes in base64url, 43 characters. */
const ARWEAVE_ID = "T1rSp2mVhQ8bKcX7wE4yZ0aN6fLg3uJd5HqP9iOvB-_";
const arweave = `ar://${ARWEAVE_ID}`;
/** The same file through Arweave's https gateway, which the form took already. */
const gateway = `https://arweave.net/${ARWEAVE_ID}`;
/** A site's own address with a space in it, as a file name can have: 128 bytes or fewer, so the ledger takes it. */
const spaced = "https://example.com/my profile.jsonld";

const registered: OwnDrep = {
  id: "drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a",
  status: "registered",
  deposit: "500000000",
  active: true,
  expiresEpoch: 340,
  votingPower: "61211118",
  delegators: 1,
  profile: null,
};

/** Edit profile with its file written and `url` given, as the page keeps it: how the address field shows. */
function field(url: string): { invalid: boolean; note: string | undefined } {
  const html = renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(DrepProfileEdit, {
        drep: registered,
        view: {
          form: {
            profile: { givenName: "Tester", objectives: "Keep fees low", doNotList: false },
            file: { file: "{}", hash: "ab".repeat(32) },
            stale: false,
            changed: false,
            url,
          },
        },
        onBack: () => undefined,
        onReview: () => undefined,
      }),
    ),
  );
  const input = /<input id="drep-url"[^>]*>/.exec(html)?.[0];
  expect(input, "the address field is on the page").toBeDefined();
  return {
    invalid: input!.includes('aria-invalid="true"'),
    note: /<p [^>]*id="drep-url-note"[^>]*>([^<]*)<\/p>/.exec(html)?.[1],
  };
}

describe("chunk 51 e7b#2: a DRep profile's address the ledger takes", () => {
  it("gets no refusal for its scheme: the ledger's 128 bytes are the only limit", () => {
    expect(ARWEAVE_ID).toHaveLength(43);
    expect(bytes(arweave)).toBe(48);
    // The gateway's https address of the same file was taken already.
    expect(anchorUrlProblem(gateway)).toBeUndefined();
    // The ledger takes this one too: 48 bytes of text.
    expect(anchorUrlProblem(arweave)).toBeUndefined();
    // The ledger's limit is the refusal that stays: 128 bytes are taken, 129 aren't.
    const most = `ar://${"a".repeat(MAX_ANCHOR_URL - 5)}`;
    expect(bytes(most)).toBe(MAX_ANCHOR_URL);
    expect(anchorUrlProblem(most)).toBeUndefined();
    expect(anchorUrlProblem(`${most}a`)).toBe("drep.form.urlTooLong");
  });

  it("gets no refusal for a space either, and is still trimmed and still needed", () => {
    expect(anchorUrlProblem(spaced)).toBeUndefined();
    // Trimmed first, so spaces around it are no part of it, and only spaces is no address.
    expect(anchorUrlProblem(`  ${gateway}  `)).toBeUndefined();
    expect(anchorUrlProblem(`  ${"a".repeat(MAX_ANCHOR_URL)}  `)).toBeUndefined();
    expect(anchorUrlProblem("   ")).toBe("drep.form.urlNeeded");
  });

  it("isn't marked invalid on Edit profile, as the gateway's address of the same file isn't", () => {
    const https = field(gateway);
    expect(https.invalid, `the field's note says: ${https.note}`).toBe(false);
    const ar = field(arweave);
    expect(ar.invalid, `the field's note says: ${ar.note}`).toBe(false);
    const space = field(spaced);
    expect(space.invalid, `the field's note says: ${space.note}`).toBe(false);
    // The note under the field names the schemes tools read, as it did: a line, not a rule.
    expect(ar.note).toBe(`ipfs://, https:// or http://, at most ${MAX_ANCHOR_URL} bytes.`);
  });

  // Needs core's anchor() as fixed, inside the WebAssembly: run after wasm/build.sh.
  it("is built into the DRep's update as typed, trimmed, by the worker", async () => {
    const wasm = loadTestWasm();
    const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!
      .phrase as string;
    const own = (JSON.parse(wasm.CardanoAccount.fromPhrase(phrase, 0).drepOf()) as { id: string }).id;
    const t = testBalances();
    await t.wallet.create(phrase, "correct horse battery");
    const standing: KoiosDrepStanding = {
      drep_id: own,
      drep_status: "registered",
      active: true,
      expires_epoch_no: 340,
      amount: "61211118",
      live_delegator_count: 1,
      deposit: "500000000",
      meta_url: null,
      meta_hash: null,
    };
    t.koios.dreps.set(own, standing);
    const [some] = koiosPreprod.accounts[stakingPreprod.stake]!.account_utxos;
    t.koios.addedToAccounts.push({ ...some!, tx_hash: "77".repeat(32), tx_index: 0, value: "600000000", asset_list: [] });
    // The scheme first: core never had a rule for it, so a WebAssembly built before the fix gets this far.
    for (const url of [arweave, spaced, `${gateway}\u0007`]) {
      await t.staking.build("preprod", { kind: "drep-update", anchor: { url: ` ${url} `, hash: "ab".repeat(32) } });
      const kept = (await t.session.get<{ txCbor: string }>(SESSION_STAKE))!;
      const tx = Uint8Array.from(Buffer.from(kept.txCbor, "hex"));
      // An UpdateDRep (18), with the address as given, less the spaces around it, in its anchor.
      expect(certificateKinds(tx)).toEqual([18]);
      expect(Buffer.from(tx).includes(Buffer.from(url, "utf8")), url).toBe(true);
      expect(Buffer.from(tx).includes(Buffer.from(` ${url}`, "utf8")), url).toBe(false);
    }
  });
});
