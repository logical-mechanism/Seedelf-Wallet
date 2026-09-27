// A site's signing prompt names every token as the rest of the wallet does
// (launch review #18): a stranger's token called "₳" or "tUSDM" is shown by
// its fingerprint, marked, and warned about, never as ADA or the listed
// token. The address a message is signed for is shown whole.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DappTxSummary } from "../src/shared/rpc";
import { ConnectRequest, SignData, SignTx } from "../src/ui/screens/DappApprovals";
import { assetFingerprint } from "../src/ui/tokens";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const TUSDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };
const ADDRESS = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp";

const summary = (over: Partial<DappTxSummary>): DappTxSummary => ({
  txHash: "ab".repeat(32),
  fee: "180000",
  netLovelace: "-500000000",
  netTokens: [],
  spentLovelace: "500180000",
  returnedLovelace: "0",
  stakingLovelace: "0",
  ownInputs: 1,
  paid: [],
  ownOutputs: [],
  mint: [],
  certificates: [],
  withdrawals: [],
  collateral: null,
  scripts: false,
  referenceInputs: 0,
  votes: 0,
  proposals: 0,
  donation: null,
  note: null,
  metadata: false,
  validFrom: null,
  validUntil: null,
  signs: ["0/0"],
  unknownInputs: [],
  othersSign: 0,
  complete: true,
  ...over,
});

const render = (s: DappTxSummary) =>
  renderToStaticMarkup(createElement(SignTx, { summary: s, partial: false, session: false, collateralSpent: false }));

/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("a site's signing prompt", () => {
  it("never shows a stranger's token called ₳ or tUSDM as ADA or the listed tUSDM", () => {
    const fakeAda = { policyId: STRANGER, assetName: hex("₳"), quantity: "1000000000" };
    const fakeUsdm = { policyId: STRANGER, assetName: TUSDM.assetName, quantity: "500" };
    const html = render(
      summary({
        netTokens: [fakeAda, fakeUsdm],
        paid: [{ address: ADDRESS, lovelace: "500000000", tokens: [], datum: null, script: false, seedelf: null, ownPaymentKey: false }],
      }),
    );
    const page = text(html);
    expect(page).not.toMatch(/Gets\s+1,000,000,000 ₳/);
    expect(page).not.toMatch(/Gets\s+500 tUSDM/);
    const ada = assetFingerprint(fakeAda);
    expect(page).toContain(`1,000,000,000 ${ada.slice(0, 10)}…${ada.slice(-6)}`);
    expect(page).toContain("it calls itself ₳, but it isn't ADA");
    expect(page).toContain("it calls itself tUSDM, but it isn't the listed tUSDM");
    expect(html).toContain('data-testid="dapp-lookalike"');
    expect(page).toContain("Tokens here are named like ADA and tUSDM, but aren't");
  });

  it("names a listed token by its ticker in its units, and marks any other in the Pays and Mints rows", () => {
    const foo = { policyId: STRANGER, assetName: hex("FOO"), quantity: "7" };
    const html = render(
      summary({
        netTokens: [{ ...TUSDM, quantity: "2500000" }],
        paid: [
          { address: ADDRESS, lovelace: "2000000", tokens: [foo], datum: null, script: false, seedelf: null, ownPaymentKey: false },
        ],
        mint: [{ ...foo, quantity: "-7" }],
      }),
    );
    const page = text(html);
    expect(page).toMatch(/Gets\s+2.5 tUSDM/);
    expect(page).toMatch(/7 FOO Not on the wallet's list, asset1\w{4}…\w{6}\./);
    expect(page).toMatch(/Burns\s+7 FOO/);
    expect(html).not.toContain('data-testid="dapp-lookalike"');
  });

  it("shows the whole address a message is signed for, on a line of its own", () => {
    const html = renderToStaticMarkup(createElement(SignData, { address: ADDRESS, signer: "payment", payload: "00", text: "Sign in" }));
    expect(html).toContain(`<span class="dapp-address" data-testid="dapp-data-address" data-value="${ADDRESS}">${ADDRESS}</span>`);
  });
});

describe("a site's connect window", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(ConnectRequest, {
        approval: { kind: "connect", id: "a", origin: "https://app.example", title: "App", password: true },
        more: "",
        busy: false,
        held: false,
        onError: () => undefined,
        onAnswer: async () => true,
      }),
    );

  it("chooses nothing for the user: Connect waits for a choice, and each says what it costs (privacy review §3.3)", () => {
    const html = render();
    // Neither the public account nor a private session is pressed.
    expect([...html.matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1])).toEqual(["false", "false"]);
    expect(/<button[^>]*>Connect<\/button>/.exec(html)![0]).toContain("disabled");
    const page = text(html);
    expect(page).toContain("Choose what it sees. Nothing happens until you press Connect or Review");
    expect(page).toContain("Your public account: the site sees its addresses, its balance and its UTxOs, and keeps what it saw. No fee.");
    expect(page).toContain("A private session: the site sees only a new one-time account you fund from your private balance.");
    expect(page).toContain("5 ₳ of collateral that comes back");
    // What each shows once chosen isn't said yet.
    expect(html).not.toContain('data-testid="dapp-connect-privacy"');
    expect(html).not.toContain('data-testid="dapp-private-points"');
  });
});
