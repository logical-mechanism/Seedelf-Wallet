// The UI's side of the RPC: ask the service worker to do something.

import type { Reply, RequestName, Requests } from "../shared/rpc";

export async function call<K extends RequestName>(
  type: K,
  payload: Requests[K]["payload"],
): Promise<Requests[K]["result"]> {
  const reply = (await chrome.runtime.sendMessage({ type, ...payload })) as Reply<K> | undefined;
  if (!reply) throw new Error("The wallet's background service didn't answer.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
