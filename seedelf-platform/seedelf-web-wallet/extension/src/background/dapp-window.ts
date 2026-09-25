// The dApp connector's window: a small popup the worker opens when a site
// needs the user (to unlock, connect, or sign), as Lace and Eternl do. One at
// a time: a second request brings back the one already open, which shows
// everything waiting, oldest first.

import type { ApprovalWindow } from "./dapp";

/** The page, in its own view (ui/view.ts). */
export const DAPP_PAGE = "index.html?view=dapp";

const SIZE = { width: 400, height: 640 };

async function openPage(): Promise<chrome.runtime.ExtensionContext | undefined> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
  return contexts.find((c) => new URL(c.documentUrl ?? "", location.href).searchParams.get("view") === "dapp");
}

export const approvalWindow: ApprovalWindow = {
  async show() {
    const open = await openPage();
    if (open) {
      try {
        await chrome.windows.update(open.windowId, { focused: true, drawAttention: true });
        return;
      } catch {
        // Closed since it was found: a new one, then.
      }
    }
    const created = await chrome.windows.create({ url: chrome.runtime.getURL(DAPP_PAGE), type: "popup", focused: true, ...SIZE });
    // Chrome sometimes ignores the size it was created with (Lace's note too).
    if (created?.id !== undefined) await chrome.windows.update(created.id, SIZE).catch(() => undefined);
  },
  async isOpen() {
    return (await openPage()) !== undefined;
  },
};
