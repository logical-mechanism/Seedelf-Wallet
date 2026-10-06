// The dApp connector's switch in Chrome: its two content scripts are
// registered only while the user has it on and Chrome allows the wallet on
// sites (the optional host permissions in the manifest, asked for from the
// Settings switch, where the user's click lets Chrome ask). Off, they're
// unregistered, so nothing is added to any page. Lace adds its scripts to
// every page, always; this wallet doesn't.
//
// Off never hands Chrome's access to sites back (`permissions.remove`):
// removing `https://*/*` takes every https host under it too, Koios and
// giveme.my included, found on 2026-09-25. Koios's public tier sends
// browsers no CORS headers, so without that grant the wallet can't read the
// chain.
//
// It's applied again whenever the extension starts, and when the user takes
// the access away in Chrome's own settings.
//
// Registered scripts reach only pages loaded after: a site already open as
// the user turned the connector on still found no wallet until it was
// reloaded (blind test §9.2, T15). So turning it on also puts the scripts in
// the https pages open then (`reachOpenPages`), with the same access, and
// adds no permission. Only into a page that has no `window.cardano.seedelf`
// yet: one that has it holds this wallet's scripts already, perhaps an
// earlier version's, cut off from the worker by an update or a reload. A
// second bridge there would send every call on while the first answered
// "Reload this page", so a site that gave up could still have a window open,
// or a transaction sent while it heard it failed (the blind test's
// cross-area review; independent review M3). That page needs a reload, which
// the switch says. Never at a start or an update either.

import { CONTENT_SCRIPTS, DAPP_ORIGINS } from "../shared/dapp";

const IDS = CONTENT_SCRIPTS.map((s) => s.id);

/** Registers or removes the content scripts; returns whether the connector is working. */
export async function applyConnector(on: boolean): Promise<boolean> {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: IDS });
  const allowed = on && (await chrome.permissions.contains({ origins: DAPP_ORIGINS }));
  if (allowed && registered.length === IDS.length) return true;
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  if (allowed) {
    await chrome.scripting.registerContentScripts(
      CONTENT_SCRIPTS.map((s) => ({
        id: s.id,
        js: [s.file],
        matches: DAPP_ORIGINS,
        runAt: "document_start" as const,
        world: s.world,
        // A site's own page only: frames inside it (ads, embeds) get nothing.
        allFrames: false,
        persistAcrossSessions: true,
      })),
    );
    return true;
  }
  return false;
}

/** Whether Chrome lets the wallet on sites: the switch shows off without it. */
export const connectorAllowed = () => chrome.permissions.contains({ origins: DAPP_ORIGINS });

/** Whether a page is one the connector is offered on: https, or localhost for a dApp in development (sw.ts `dappSession`). */
function offered(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

/**
 * Puts the two scripts in the pages open now that the connector is offered
 * on, top frames only, as the registered ones, unless the page's own world
 * has `window.cardano.seedelf` already (above). A tab asleep (Chrome
 * discarded it) loads the registered ones as it wakes, and one Chrome keeps
 * scripts out of (the Web Store) refuses: both are left. Returns how many
 * pages it reached.
 */
export async function reachOpenPages(): Promise<number> {
  if (!(await chrome.permissions.contains({ origins: DAPP_ORIGINS }))) return 0;
  const tabs = await chrome.tabs.query({ url: DAPP_ORIGINS });
  const reached = await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || tab.discarded || !offered(tab.url)) return false;
      try {
        // Asked in the page's own world, where page.ts puts the entry: the bridge's isolated world is a new one for
        // a new version of the extension, so a mark there can't see an earlier version's.
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => !!(window as { cardano?: { seedelf?: unknown } }).cardano?.seedelf,
        });
        if (probe?.result !== false) return false;
        for (const script of CONTENT_SCRIPTS) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [script.file], world: script.world });
        }
        return true;
      } catch {
        // Closed or navigating away as it was reached, or a page Chrome keeps scripts out of.
        return false;
      }
    }),
  );
  return reached.filter(Boolean).length;
}
