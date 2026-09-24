// Popup or full tab: one app, two layouts.

export const view: "popup" | "tab" =
  new URLSearchParams(location.search).get("view") === "tab" ? "tab" : "popup";

/** Opens the app in a full tab, optionally at a start screen (`#create`, `#restore`), and closes the popup. */
export function openInTab(start?: "create" | "restore") {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html?view=tab${start ? `#${start}` : ""}`) });
  if (view === "popup") window.close();
}

/** The start screen asked for in the URL, if any. */
export function startFromHash(): "create" | "restore" | undefined {
  const hash = location.hash.slice(1);
  return hash === "create" || hash === "restore" ? hash : undefined;
}
