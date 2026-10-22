// 1.6.0's review, Lovejoin's fix round: the Mix form's and Mix my boxes again's Four boxes a mix switch (the owner's
// test of 1.6.0) reaches each build through the worker's requests. Each of the five requests hands it on with
// widthOf; dropped from all five, typecheck sees widthOf unused, but dropped from one alone, nothing did (GAP1-10).
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import type { Message } from "../src/shared/rpc";

/** handle()'s context with the builds stood in for: each records what it was asked. */
function recording() {
  const asked: Record<string, unknown[]> = {};
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      asked[name] = args;
      return {};
    };
  const ctx = {
    network: "preprod",
    sessions: { mixOutBuild: record("mixOutBuild"), againBuild: record("againBuild") },
    lovejoin: { funding: record("funding"), publicAgainBuild: record("publicAgainBuild"), publicBuild: record("publicBuild") },
  } as unknown as Context;
  return { ctx, asked };
}

/** The width each build was handed: the last argument, or its options' `width`. */
const widths: Record<string, (args: unknown[]) => unknown> = {
  funding: (args) => args.at(-1),
  mixOutBuild: (args) => (args[2] as { width?: number }).width,
  againBuild: (args) => args.at(-1),
  publicAgainBuild: (args) => args.at(-1),
  publicBuild: (args) => (args[2] as { width?: number }).width,
};

describe("the Four boxes a mix switch reaches the build through the worker's requests", () => {
  it.each([
    ["lovejoin-funding", "funding", { boxes: 2 }],
    ["lovejoin-mix-private-build", "mixOutBuild", { boxes: 2 }],
    ["lovejoin-again-build", "againBuild", {}],
    ["lovejoin-again-public-build", "publicAgainBuild", {}],
    ["lovejoin-mix-public-build", "publicBuild", { boxes: 2 }],
  ] as const)("%s hands %s the switch's width, either way, and nothing else as one", async (type, build, payload) => {
    for (const width of [4, 3] as const) {
      const { ctx, asked } = recording();
      await handle({ type, ...payload, width } as Message, ctx);
      expect(widths[build]!(asked[build]!)).toBe(width);
    }
    // No switch, or a width that's neither: Settings' (none).
    for (const width of [undefined, 5, "4"]) {
      const { ctx, asked } = recording();
      await handle({ type, ...payload, ...(width !== undefined ? { width } : {}) } as Message, ctx);
      expect(widths[build]!(asked[build]!)).toBeUndefined();
    }
  });
});
