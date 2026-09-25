// One app, two layouts: a full tab (`?view=tab`), or the narrow one that
// Chrome's side panel shows (`?view=panel`). The toolbar button opens either,
// as the user chose in Settings (shared/open-in.ts). A page opened any other
// way is narrow too.

import { useEffect, useState } from "react";

import { showWalletTab, TAB_PAGE, writeOpenIn, type OpenIn } from "../shared/open-in";

export const view: "panel" | "tab" = new URLSearchParams(location.search).get("view") === "tab" ? "tab" : "panel";

/**
 * Shows the app in a full tab, then closes the side panel: the wallet's tab
 * if one is open, as the toolbar button brings it back, or a new one. A
 * start screen (`#create`, `#restore`) always opens a new one.
 */
export function openInTab(start?: "create" | "restore") {
  const shown = start ? chrome.tabs.create({ url: chrome.runtime.getURL(`${TAB_PAGE}#${start}`) }) : showWalletTab();
  // Closed only once it has: the panel's page going first would drop the request.
  if (view === "panel") void shown.finally(() => window.close());
}

/** The start screen asked for in the URL, if any. */
export function startFromHash(): "create" | "restore" | undefined {
  const hash = location.hash.slice(1);
  return hash === "create" || hash === "restore" ? hash : undefined;
}

/**
 * This page's browser window, read ahead: Chrome opens a side panel only
 * straight from a click (a user gesture), with nothing awaited first.
 */
export function useWindowId(): number | undefined {
  const [id, setId] = useState<number>();
  useEffect(() => {
    chrome.windows.getCurrent().then(
      (w) => setId(w.id),
      () => undefined,
    );
  }, []);
  return id;
}

/**
 * Where the toolbar button opens the wallet from now on. Like Lace, it
 * switches at once: the wallet opens the new way, and this page closes once
 * it has (it stays when the side panel couldn't open). Call it from the
 * click itself, with `windowId` from `useWindowId`.
 */
export function switchOpenIn(mode: OpenIn, windowId: number | undefined): Promise<void> {
  if (mode === "panel" && view === "tab" && windowId !== undefined) {
    // Before any await: the click's gesture is what lets it open.
    chrome.sidePanel.open({ windowId }).then(
      () => window.close(),
      () => undefined,
    );
  }
  const saved = writeOpenIn(mode);
  if (mode === "tab" && view === "panel") {
    void saved.then(() => openInTab());
  }
  return saved;
}
