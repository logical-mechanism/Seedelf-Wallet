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
