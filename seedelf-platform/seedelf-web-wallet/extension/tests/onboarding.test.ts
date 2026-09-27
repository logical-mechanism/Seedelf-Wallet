// The welcome screen of a build with both networks asks which one before a
// wallet is created or restored, so a preprod phrase is restored on preprod
// without going through mainnet first. Create and Restore say which network
// they're on, with the way back to change it ("Forgot password" opens
// Restore without the welcome).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Status } from "../src/shared/rpc";

let Onboarding: typeof import("../src/ui/screens/Onboarding");
let Picker: typeof import("../src/ui/components/NetworkPicker");

beforeAll(async () => {
  // The page's view (ui/view.ts) is read from its URL when the module loads.
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Onboarding = await import("../src/ui/screens/Onboarding");
  Picker = await import("../src/ui/components/NetworkPicker");
});

/** The text a person reads, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'");

const status = (network: "mainnet" | "preprod", networks: Array<"mainnet" | "preprod">): Status => ({
  state: "no-wallet",
  version: "1.0.0",
  network,
  networks,
  retryAfterMs: 0,
});

const welcome = (s: Status, start?: "create" | "restore") =>
  renderToStaticMarkup(
    createElement(Onboarding.Onboarding, { status: s, start, onDone: () => undefined, onNetwork: () => undefined }),
  );

describe("the welcome screen's network", () => {
  it("is asked before Create and Restore in a build with both networks, mainnet first", () => {
    const html = welcome(status("mainnet", ["mainnet", "preprod"]));
    expect(html).toContain('data-testid="onboarding-network"');
    const shown = text(html);
    expect(shown.indexOf("Cardano network")).toBeLessThan(shown.indexOf("Create new wallet"));
    expect(shown.indexOf("Mainnet")).toBeLessThan(shown.indexOf("Preprod"));
    expect(shown).toContain("ADA here is real money");
    // The chosen one is pressed.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Mainnet</);
  });

  it("says on preprod that its ADA has no value", () => {
    const shown = text(welcome(status("preprod", ["mainnet", "preprod"])));
    expect(shown).toContain("ADA here is test ADA, with no value");
  });

  it("isn't there in a preprod-only build", () => {
    const html = welcome(status("preprod", ["preprod"]));
    expect(html).not.toContain("onboarding-network");
    expect(text(html)).toContain("Restore wallet");
  });

  it("is the same note Settings gives", () => {
    expect(Picker.NETWORK_NOTE.mainnet).toBe("Mainnet: Cardano's real network. ADA here is real money.");
    expect(Picker.NETWORK_NOTE.preprod).toContain("Preprod: Cardano's test network");
  });
});

describe("Create and Restore say which network", () => {
  it("names it, with the way back to change it, where there are two", () => {
    const restoring = text(welcome(status("preprod", ["mainnet", "preprod"]), "restore"));
    expect(restoring).toContain("Restoring a wallet on Preprod. Change network");
    const creating = text(welcome(status("mainnet", ["mainnet", "preprod"]), "create"));
    expect(creating).toContain("Creating a wallet on Mainnet. Change network");
  });

  it("says nothing of it where there's one", () => {
    expect(welcome(status("preprod", ["preprod"]), "restore")).not.toContain("onboarding-on-network");
  });
});
