// The data layer's fake for the end-to-end tests (chunk 26b): Seedelf Wallet's
// own server at DATA_ORIGIN, which a build made with VITE_DATA_ORIGIN reads on
// mainnet. Its private index answers from the recorded contract (tests/
// fake-index.ts, the unit tests' fake, behind a route). Its public routes and
// submits answer 503, as when db-sync is down, so the wallet asks the Koios
// fake (support.ts) for those, part by part: the fallback is what's tested.
//
// It answers CORS for any origin, as the API does for the wallet's own
// (seedelf-data's DATA_ORIGINS): the wallet holds no host permission for it.
import type { BrowserContext } from "@playwright/test";

import type { KoiosUtxo } from "../src/background/koios";
import { fakeIndex, indexRowOf, SLOT_TIME, type FakeIndex } from "../tests/fake-index";

/** The origin the data-layer build reads (`npm run e2e:data` builds with it). */
export const DATA_ORIGIN = "https://data.seedelf.test";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST",
  "access-control-allow-headers": "accept, content-type",
  "access-control-expose-headers": "retry-after",
};

export interface DataFake {
  index: FakeIndex;
  /** Every request's path, preflights left out. */
  calls: string[];
}

/** Routes DATA_ORIGIN on `context`: the private index over `contract`, made long ago at mainnet's tip now. */
export async function fakeDataLayer(context: BrowserContext, contract: KoiosUtxo[]): Promise<DataFake> {
  const tip = Math.floor(Date.now() / 1000) - SLOT_TIME;
  const index = fakeIndex(tip);
  index.contract = contract.map((u) => ({ row: indexRowOf(u, tip - 100_000) }));
  const fake: DataFake = { index, calls: [] };
  await context.route(`${DATA_ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = request.url();
    fake.calls.push(new URL(url).pathname);
    if (new URL(url).pathname.startsWith("/seedelf/v1/")) {
      const answer = await index.fetch(url).catch(() => undefined);
      if (!answer) return route.abort("connectionrefused");
      return route.fulfill({ status: answer.status, headers: { ...CORS, "content-type": "application/json" }, body: await answer.text() });
    }
    return route.fulfill({
      status: 503,
      headers: { ...CORS, "content-type": "application/json", "retry-after": "30" },
      body: JSON.stringify({ error: "unavailable" }),
    });
  });
  return fake;
}
