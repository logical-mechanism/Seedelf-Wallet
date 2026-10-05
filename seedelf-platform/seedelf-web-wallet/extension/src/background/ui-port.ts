// The UI's requests (ui/background.ts), each on a port of its own that only
// this worker listens for. runtime.sendMessage would also hand every request,
// and the password or recovery phrase in it, to every other open wallet page:
// Chrome fires runtime.onMessage in each of them. Ports reach only the frames
// listening to runtime.onConnect, and no page does. The worker's broadcasts
// (state-changed, dapp-changed) carry nothing, so they stay messages.

import { isMessage, UI_PORT, type BuildStage, type Message, type Reply, type ReplyCode, type RequestName } from "../shared/rpc";
import { CollateralRefusedError, StaleReviewError } from "./collateral";

/** What the UI acts on in a refusal: a review to build again (chunk 23's review, P-3). */
function codeOf(error: unknown): ReplyCode | undefined {
  return error instanceof StaleReviewError || error instanceof CollateralRefusedError ? "stale" : undefined;
}

/**
 * Serves one UI port: one request, one reply. Only this extension's own
 * pages may ask, as for any message before: a content script's port, or
 * another extension's, is closed unanswered. `answer` runs the request.
 */
export function serveUi(
  port: chrome.runtime.Port,
  extensionOrigin: string,
  answer: (message: Message, report: (stage: BuildStage) => void) => Promise<unknown>,
): boolean {
  if (port.name !== UI_PORT) return false;
  const sender = port.sender;
  if (sender?.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) {
    port.disconnect();
    return true;
  }
  let open = true;
  port.onDisconnect.addListener(() => (open = false));
  const reply = (r: Reply<RequestName>) => {
    if (!open) return;
    try {
      port.postMessage(r);
    } catch {
      // The page went away as it was answered.
    }
  };
  port.onMessage.addListener((message: unknown) => {
    if (!isMessage(message)) {
      reply({ ok: false, error: "unknown request" });
      return;
    }
    // Stages travel on this same port, ahead of the reply: the page that asked
    // hears them, and no other page does.
    const report = (stage: BuildStage) => {
      if (!open) return;
      try {
        port.postMessage({ stage });
      } catch {
        // The page went away mid-build.
      }
    };
    answer(message, report).then(
      (value) => reply({ ok: true, value } as Reply<RequestName>),
      (error: unknown) => {
        const code = codeOf(error);
        reply({ ok: false, error: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) });
      },
    );
  });
  return true;
}
