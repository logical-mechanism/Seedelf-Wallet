// What the screens say where a click or a file tells someone what's the
// user's: the private Activity's CSV (privacy review §2.21), and a link to
// Cardanoscan on the private side (§3.4), which opens in the browser's own
// profile and lands in its history.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PendingTx, SessionView } from "../src/shared/rpc";
import { ExplorerLink } from "../src/ui/components/ExplorerLink";
import { PendingBanner, privateBanner, PRIVATE_KINDS } from "../src/ui/components/PendingBanner";
import { NetworkContext } from "../src/ui/network";
import { ExportNote } from "../src/ui/screens/Activity";
import { SiteSession } from "../src/ui/screens/SiteSessions";

/** What a person reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));

const WARNING = "Opening this tells Cardanoscan and your browser history that this transaction is yours.";
const HASH = "ab".repeat(32);

describe("the Activity CSV's note", () => {
  it("says, on the private side, what the file ties together for whoever has it", () => {
    const shown = text(markup(createElement(ExportNote, { of: "seedelf", listed: 3, more: false })));
    expect(shown).toContain("The file isn't encrypted.");
    expect(shown).toContain(
      "Whoever has it can tie your private payments, sessions and Lovejoin boxes to each other, to your public account",
    );
    expect(shown).toContain("and to the Seedelf each payment went to.");
  });

  it("says the public side's is on the chain anyway, and what Load more adds", () => {
    const shown = text(markup(createElement(ExportNote, { of: "cardano", listed: 20, more: true })));
    expect(shown).toContain("It has the 20 transactions read so far: Load more first to include older ones.");
    expect(shown).toContain("The file isn't encrypted, though everything in it is on the chain anyway.");
    expect(shown).not.toContain("Lovejoin");
  });
});

describe("a link to Cardanoscan", () => {
  const link = (props: Partial<Parameters<typeof ExplorerLink>[0]>) =>
    markup(createElement(ExplorerLink, { network: "preprod", tx: HASH, children: "View on Cardanoscan", ...props }));

  it("says, on the private side, what opening it tells, and describes the link with it", () => {
    const html = link({ private: true });
    expect(html).toContain(`href="https://preprod.cardanoscan.io/transaction/${HASH}"`);
    expect(html).toContain('rel="noreferrer"');
    expect(text(html)).toContain(WARNING);
    const described = html.match(/aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${described}"`);
  });

  it("stays plain on the public side", () => {
    const html = link({});
    expect(text(html)).toBe("View on Cardanoscan");
    expect(html).not.toContain("aria-describedby");
  });

  it("for a whole account, says so", () => {
    const html = link({ private: true, tx: undefined, address: "addr_test1xyz" });
    expect(html).toContain('href="https://preprod.cardanoscan.io/address/addr_test1xyz"');
    expect(text(html)).toContain("that this account is yours");
  });

  it("in a group, leaves the note to the group, and keeps it as the link's title", () => {
    const html = link({ private: true, note: false });
    expect(html).not.toContain("explorer-note");
    expect(html).toContain(`title="${WARNING.replaceAll("'", "&#x27;")}"`);
  });
});

describe("Home's banner for a sent transaction", () => {
  // What the public account signs carries its slot (account.ts validUntil); a Seedelf spend carries none.
  const IN_THE_OPEN = new Set<PendingTx["kind"]>(["move-in", "mint", "send", "collateral", "stake", "vote"]);
  const sent = (kind: PendingTx["kind"], slot = IN_THE_OPEN.has(kind)): PendingTx => ({
    kind,
    network: "preprod",
    txHash: HASH,
    submittedAt: 0,
    confirmations: 1,
    ...(slot ? { invalidHereafter: 90_000_000 } : {}),
  });
  const banner = (pending: PendingTx) =>
    text(markup(createElement(PendingBanner, { pending, watching: false, onDismiss: () => undefined })));

  it("warns on a private payment, a session's step and a Lovejoin box", () => {
    for (const kind of ["transfer", "withdraw", "remove", "session-out", "session-back", "lovejoin-withdraw", "lovejoin-mix"] as const) {
      expect(banner(sent(kind)), kind).toContain(WARNING);
    }
  });

  it("warns on a stealth mint, paid from the private balance: a mint of the same kind, with no slot", () => {
    // The very mint meant to hide who paid: its banner linked to Cardanoscan without the note, while its Activity
    // entry had it.
    const stealth = sent("mint", false);
    expect(privateBanner(stealth)).toBe(true);
    expect(banner(stealth)).toContain(WARNING);
    // On its way, and maybe sent, it says so too.
    expect(banner({ ...stealth, confirmations: null })).toContain(WARNING);
    expect(banner({ ...stealth, confirmations: null, maybeSent: true })).toContain(WARNING);
  });

  it("stays plain for what the public account signs in the open, an account-paid mint included", () => {
    for (const kind of IN_THE_OPEN) {
      expect(PRIVATE_KINDS.has(kind)).toBe(false);
      expect(privateBanner(sent(kind)), kind).toBe(false);
      expect(banner(sent(kind)), kind).not.toContain("tells Cardanoscan");
    }
  });
});

describe("a site's private session", () => {
  it("says what opening its account on Cardanoscan tells", () => {
    const session: SessionView = {
      index: 4,
      network: "preprod",
      address: "addr_test1" + "s".repeat(50),
      createdAt: 0,
      stage: "open",
      txs: [{ kind: "out", txHash: "ef".repeat(32), at: 0, confirmed: true }],
      holding: { lovelace: "0", tokens: [], utxos: 0 },
      site: { origin: "https://app.example" },
    };
    const seedelf = { lovelace: "0", tokens: [], utxos: 0, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
    const html = markup(
      createElement(SiteSession, {
        session,
        attached: true,
        seedelf,
        reading: false,
        onRefresh: () => undefined,
        onBack: () => undefined,
        onPending: () => undefined,
        onDisconnected: () => undefined,
      }),
    );
    expect(html).toContain(`href="https://preprod.cardanoscan.io/address/${session.address}"`);
    expect(text(html)).toContain("that this account is yours");
  });
});
