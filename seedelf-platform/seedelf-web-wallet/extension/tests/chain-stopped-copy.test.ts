// What a return's chain through Lovejoin that stopped partway says of what's
// left (independent review L23): a swap or a mix brings it back by itself;
// a site's session, or a return sent from Bring everything back, keeps it
// at its account until the user brings it back, and says so. Rendered as the
// pages show them.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { SessionView } from "../src/shared/rpc";
import { chainText } from "../src/ui/components/LovejoinReturn";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { subOf } from "../src/ui/screens/Lovejoin";
import { SiteSession } from "../src/ui/screens/SiteSessions";

let Settings: typeof import("../src/ui/screens/Settings");

beforeAll(async () => {
  // The page's view (ui/view.ts) is read from its URL when the module loads.
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
});

const text = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

const STOPPED = { total: 10, sent: 4, confirmed: 4, cut: false, stopped: "The wallet locked, or the browser closed, while its chain was being sent." };
const BY_ITSELF = "once those are on chain, what's left comes back directly";
const BY_HAND = "once those are on chain, what's left stays at the account until you bring it back";

const seedelf = { lovelace: "0", tokens: [], utxos: 0, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };

function session(over: Partial<SessionView>): SessionView {
  return {
    index: 4,
    network: "preprod",
    address: "addr_test1" + "s".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [{ kind: "out", txHash: "ef".repeat(32), at: 0, confirmed: true }],
    holding: { lovelace: "12000000", tokens: [], utxos: 2 },
    chain: STOPPED,
    ...over,
  };
}

describe("a chain through Lovejoin stopped partway (independent review L23)", () => {
  it("says what's left stays at the account when nothing brings it back by itself", () => {
    expect(chainText(STOPPED)).toContain(BY_ITSELF);
    expect(chainText(STOPPED, true)).toContain(BY_HAND);
    // Once it came back, both say so.
    expect(chainText({ ...STOPPED, cut: true }, true)).toBe("Stopped after 4 of 10 transactions; what was left came back directly");
  });

  it("on a site's session's page, says it stays until Bring it back", () => {
    const page = text(
      createElement(SiteSession, {
        session: session({ site: { origin: "https://app.example" } }),
        seedelf,
        reading: false,
        onRefresh: () => undefined,
        onBack: () => undefined,
        onPending: () => undefined,
        onDisconnected: () => undefined,
      }),
    );
    expect(page).toContain(BY_HAND);
    expect(page).not.toContain(BY_ITSELF);
    expect(page).toContain("Bring it back");
  });

  it("on a mix, which runs by itself, says it comes back directly", () => {
    const mix = session({
      mix: { boxes: 2 },
      auto: { step: "returning", stopping: false, filled: false, approvedMinOut: "0" },
    });
    expect(subOf(mix, 0)).toContain(BY_ITSELF);
  });

  it("in Settings, says which sessions bring it back by themselves", () => {
    const shown = text(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(Settings.LovejoinSettings, { network: "mainnet" }),
      ),
    );
    expect(shown).toContain("locking partway stops them, and what's left comes back directly.");
    expect(shown).toContain(
      "A swap or a mix brings it back by itself; a site's session, or a return you sent from Bring everything back, keeps it at its account until you bring it back.",
    );
  });
});
