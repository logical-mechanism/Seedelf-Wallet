// Seedelf Messaging's relay for the end-to-end tests (chunk 54f): the unit
// tests' relay in memory (tests/fake-relay.ts, protocol.md §17), behind a
// route on each wallet's browser, so two wallets share one pool. Its routes
// are on the data layer's origin, whichever a build names (networks.ts
// `relayOrigin`): the real server's on a dev or store build, DATA_ORIGIN on
// e2e:data's. Nothing reaches the real relay.
//
// It answers CORS for any origin, as the API does: the wallet holds no host
// permission for it. Only the worker may ask it (`byWorker`, as support.ts
// holds Koios to): a page that does is running the worker's code itself.
import type { BrowserContext } from "@playwright/test";

import { fakeRelay as memoryRelay, type FakeRelay } from "../tests/fake-relay";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST",
  "access-control-allow-headers": "accept, content-type",
  "access-control-expose-headers": "retry-after",
};

/** Every messaging route, on any origin. */
const ROUTES = /^https:\/\/[^/]+\/messaging\/v1\//;

export interface RelayFake {
  relay: FakeRelay;
  /** Each request a wallet made, as `label METHOD path`, preflights left out. */
  calls: string[];
  /** Requests a page made instead of the worker: there must be none. */
  strays: string[];
}

/** One relay, in memory, on the real clock, at the price `bits` asks of a post (the unit tests' 4 bits by default). */
export function relayFake(bits = 4): RelayFake {
  const relay = memoryRelay({
    get now() {
      return Date.now();
    },
  });
  relay.price = bits;
  return { relay, calls: [], strays: [] };
}

/** Routes the relay's paths on `context`, its requests labelled `label`. */
export async function routeRelay(context: BrowserContext, fake: RelayFake, label: string): Promise<void> {
  await context.route(ROUTES, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (!request.serviceWorker()) fake.strays.push(request.url());
    const url = request.url();
    fake.calls.push(`${label} ${request.method()} ${new URL(url).pathname}`);
    const body = request.postDataBuffer();
    const answer = await fake.relay
      .fetch(url, { method: request.method(), ...(body ? { body: new Uint8Array(body).buffer } : {}) })
      .catch(() => undefined);
    if (!answer) return route.abort("connectionrefused");
    const headers: Record<string, string> = { ...CORS };
    answer.headers.forEach((value, name) => (headers[name] = value));
    return route.fulfill({ status: answer.status, headers, body: Buffer.from(await answer.arrayBuffer()) });
  });
}
