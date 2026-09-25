// Where the toolbar button opens the wallet: a full tab (the default) or
// Chrome's side panel, after Lace's view mode (views-extension's
// default-open-mode). It's the browser's choice, not a wallet's, so it has
// its own key in chrome.storage.local, which removing the wallet leaves
// alone. Chrome itself opens the side panel on a click
// (`setPanelBehavior`), so it's told on every change and whenever the
// extension starts; with the tab, the click reaches the worker, which opens
// the wallet's tab or brings back the one already open.

export type OpenIn = "tab" | "panel";

/** chrome.storage.local: where the toolbar button opens the wallet. */
export const OPEN_IN = "seedelf.openIn";
export const DEFAULT_OPEN_IN: OpenIn = "tab";

/** The page, in a full tab or in the side panel (manifest `side_panel`). */
export const TAB_PAGE = "index.html?view=tab";
export const PANEL_PAGE = "index.html?view=panel";

export const isOpenIn = (value: unknown): value is OpenIn => value === "tab" || value === "panel";

export async function readOpenIn(): Promise<OpenIn> {
  const kept = (await chrome.storage.local.get(OPEN_IN))[OPEN_IN];
  return isOpenIn(kept) ? kept : DEFAULT_OPEN_IN;
}

/** Tells Chrome what a click on the toolbar button does. */
export function applyOpenIn(mode: OpenIn): Promise<void> {
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === "panel" });
}

export async function writeOpenIn(mode: OpenIn): Promise<void> {
  await chrome.storage.local.set({ [OPEN_IN]: mode });
  await applyOpenIn(mode);
}
