// Storage is the extension's own pages' and this worker's, never a content
// script's. The dApp connector's bridge runs in every site's renderer and
// never reads storage, so a renderer a site took over can't read the sealed
// vault (to guess its password offline) or change the settings through it.
// Session storage is this way already; local storage isn't by default. It's
// set at every start, as the level doesn't outlive the browser.
//
// A Chrome that can't set it for local storage keeps the default, and then
// the connector stays off: its scripts are never registered, and the status
// says why (`connectorBlocked`), for Settings.

type Areas = Record<"local" | "session", Pick<chrome.storage.StorageArea, "setAccessLevel">>;

/** Sets both areas to trusted contexts only; whether local storage took it. Never throws. */
export async function keepStorageFromSites(areas: Areas): Promise<boolean> {
  const set = async (area: Areas["local"]) => {
    try {
      if (!area.setAccessLevel) return false;
      await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      return true;
    } catch {
      return false;
    }
  };
  const [local] = await Promise.all([set(areas.local), set(areas.session)]);
  return local;
}

/** The connector's switch (connector.ts `applyConnector`), held off while local storage is open to content scripts. */
export function guardedConnector(
  protectedStorage: Promise<boolean>,
  apply: (on: boolean) => Promise<boolean>,
): (on: boolean) => Promise<boolean> {
  return async (on) => apply(on && (await protectedStorage));
}
