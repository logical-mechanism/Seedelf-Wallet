// The UI's requests (ui/background.ts), each on a port of its own that only
// this worker listens for. runtime.sendMessage would also hand every request,
// and the password or recovery phrase in it, to every other open wallet page:
// Chrome fires runtime.onMessage in each of them. Ports reach only the frames
// listening to runtime.onConnect, and no page does. The worker's broadcasts
// (state-changed, dapp-changed) carry nothing, so they stay messages.

import { isMessage, UI_PORT, type Message, type Reply, type RequestName } from "../shared/rpc";

/**
 * Serves one UI port: one request, one reply. Only this extension's own
 * pages may ask, as for any message before: a content script's port, or
 * another extension's, is closed unanswered. `answer` runs the request.
 */
export function serveUi(port: chrome.runtime.Port, extensionOrigin: string, answer: (message: Message) => Promise<unknown>): boolean {
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
    answer(message).then(
      (value) => reply({ ok: true, value } as Reply<RequestName>),
      (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });
  return true;
}
