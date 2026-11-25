// wasm.ts's replacing of the instance (`renewWasm` at a lock, `freshWasm` after a trap) over glues that aren't the
// built one: a glue with no reset function, a reset that throws before another instance is in place, wasm-bindgen's
// start-function error after one is, a memory that grew. tests/lock-renews-wasm.test.ts has the built module.
//
// The order it holds wasm.ts to: the old memory is taken first, the instance replaced, and only then, and only if
// another instance is in place, the old memory zeroed. So nothing ever runs on zeroed memory, and a reset that fails
// leaves the instance there is as it was.
import { afterEach, describe, expect, it, vi } from "vitest";

const MARK = 0x5a;
const marked = (pages = 1) => {
  const memory = new WebAssembly.Memory({ initial: pages });
  new Uint8Array(memory.buffer).fill(MARK);
  return memory;
};
const every = (memory: WebAssembly.Memory, byte: number) => new Uint8Array(memory.buffer).every((b) => b === byte);

/** wasm.ts over a glue with `exports`, and the extension's restart to watch. */
async function over(exports: Record<string, unknown>) {
  const reload = vi.fn();
  vi.stubGlobal("chrome", { runtime: { reload } });
  vi.resetModules();
  vi.doMock("@seedelf/wasm", () => ({ default: async () => undefined, ...exports }));
  const { freshWasm, renewWasm } = await import("../src/background/wasm");
  return { freshWasm, renewWasm, reload };
}

/** A glue whose reset puts `next` in `first`'s place, then does what `after` does. */
function glue(first: WebAssembly.Memory | undefined, next: WebAssembly.Memory | undefined, after: () => void = () => undefined) {
  let current = first;
  const reset = vi.fn(() => {
    if (next) current = next;
    after();
  });
  const initSync = () => {
    if (!current) throw new TypeError("WebAssembly.Module(): Argument 0 must be a buffer source");
    return { memory: current };
  };
  return { exports: { initSync, __wbg_reset_state: reset }, reset };
}

/**
 * A glue built without wasm-bindgen's reset: the export isn't there. (Vitest's mock throws for a name it wasn't
 * given, where a module's namespace gives undefined: so it's given, as undefined.)
 */
const unresettable = (memory: WebAssembly.Memory) => ({ initSync: () => ({ memory }), __wbg_reset_state: undefined });

afterEach(() => {
  vi.doUnmock("@seedelf/wasm");
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("replacing the WebAssembly instance", () => {
  for (const name of ["renewWasm", "freshWasm"] as const) {
    it(`${name} zeroes the whole of the old memory once another instance is in place, and leaves the new one alone`, async () => {
      const [old, next] = [marked(), marked()];
      const { exports, reset } = glue(old, next);
      (await over(exports))[name]();
      expect(reset).toHaveBeenCalledOnce();
      expect(every(old, 0)).toBe(true);
      expect(every(next, MARK)).toBe(true);
    });

    it(`${name} zeroes a memory that grew: the buffer it has at the end, all of it`, async () => {
      const old = marked();
      const { exports } = glue(old, marked());
      const wasm = await over(exports);
      // Growing replaces the buffer: the pages added are zeros, so they're marked too.
      old.grow(2);
      new Uint8Array(old.buffer).fill(MARK);
      wasm[name]();
      expect(old.buffer.byteLength).toBe(3 * 65536);
      expect(every(old, 0)).toBe(true);
    });

    it(`${name} takes wasm-bindgen's start-function error for nothing: the new instance is in place by then`, async () => {
      const [old, next] = [marked(), marked()];
      const { exports } = glue(old, next, () => {
        throw new TypeError("wasm.__wbindgen_start is not a function");
      });
      (await over(exports))[name]();
      expect(every(old, 0)).toBe(true);
      expect(every(next, MARK)).toBe(true);
    });

    it(`${name} leaves the memory as it was when the reset throws with no other instance in place`, async () => {
      const old = marked();
      const { exports } = glue(old, undefined, () => {
        throw new RangeError("WebAssembly.Instance(): Out of memory");
      });
      const wasm = await over(exports);
      expect(() => wasm[name]()).toThrow("Out of memory");
      expect(every(old, MARK)).toBe(true);
    });

    it(`${name} zeroes nothing when the reset returns with the same instance in place`, async () => {
      const old = marked();
      const { exports, reset } = glue(old, undefined);
      (await over(exports))[name]();
      expect(reset).toHaveBeenCalledOnce();
      expect(every(old, MARK)).toBe(true);
    });

    it(`${name} still resets a glue that has no instance yet`, async () => {
      const next = marked();
      const { exports, reset } = glue(undefined, next);
      (await over(exports))[name]();
      expect(reset).toHaveBeenCalledOnce();
      expect(every(next, MARK)).toBe(true);
    });
  }

  it("a glue with no reset function: a lock's renew does nothing, and never restarts the extension", async () => {
    const old = marked();
    const { renewWasm, reload } = await over(unresettable(old));
    renewWasm();
    expect(reload).not.toHaveBeenCalled();
    expect(every(old, MARK)).toBe(true);
  });

  it("a glue with no reset function: a trap's fresh instance is the extension restarted, as it was", async () => {
    const old = marked();
    const { freshWasm, reload } = await over(unresettable(old));
    freshWasm();
    expect(reload).toHaveBeenCalledOnce();
    expect(every(old, MARK)).toBe(true);
  });
});
