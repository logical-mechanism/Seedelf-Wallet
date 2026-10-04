// Loads the seedelf-wasm module once per service-worker lifetime. Service
// workers can't use top-level await, so callers await `loadWasm()` instead.
//
// An instance that trapped (a Rust panic, a stack overflow, memory out of
// bounds) is broken for good: its stack pointer and its objects' borrow flags
// are left where the trap stopped them, so later calls fail or misbehave.
// `isTrap` tells such an error from a refusal, and `freshWasm` replaces the
// instance. The wallet then counts as locked (wallet.ts): the key objects
// lived in the old instance.

import init, * as wasm from "@seedelf/wasm";
// Built by ../wasm/build.sh (npm run build:wasm).
import { t } from "../i18n";
import wasmUrl from "../../../wasm/pkg/seedelf_wasm_bg.wasm?url";

let ready: Promise<typeof wasm> | undefined;

export function loadWasm(): Promise<typeof wasm> {
  ready ??= init({ module_or_path: wasmUrl }).then(
    () => wasm,
    (e: unknown) => {
      // Don't keep a failed load: the next request tries again.
      ready = undefined;
      // The usual cause: the extension's files were rebuilt or updated under a
      // running worker, which still asks for the old, now deleted, WASM file.
      throw new Error(
        t("worker.wasm.notLoaded", { cause: e instanceof Error ? e.message : String(e) }),
      );
    },
  );
  return ready;
}

/**
 * Whether `e`, thrown out of a WebAssembly call, means the instance itself is
 * broken rather than that the call refused: a trap (`unreachable`, memory
 * access out of bounds), or wasm-bindgen finding a Rust value still borrowed
 * by a call a trap cut short. A JavaScript stack overflow isn't one: it's
 * JSON.stringify's as often as not, and a value it leaves borrowed shows up
 * here on its next use.
 */
export function isTrap(e: unknown): boolean {
  if (e instanceof WebAssembly.RuntimeError) return true;
  return e instanceof Error && /Rust value while it was borrowed|recursive use of an object detected/.test(e.message);
}

/**
 * Replaces a trapped instance with a fresh one of the same module, in place:
 * the exports stay the same functions, so every service keeps working, and
 * every object the old instance made (the wallet's keys among them) stops.
 * That takes the glue's reset function (wasm-bindgen's
 * --experimental-reset-state-function, which build.sh passes). A glue built
 * without it can't be reset, so the extension restarts instead.
 */
export function freshWasm(): void {
  const reset = (wasm as { __wbg_reset_state?: () => void }).__wbg_reset_state;
  if (!reset) return chrome.runtime.reload();
  try {
    reset();
  } catch (e) {
    // wasm-bindgen 0.2.128's reset ends by calling the module's start
    // function. The module has had one since the launch review (a no-op in
    // wasm/src/lib.rs); a module built before then has none, and throws this
    // after the new instance is in place, so that one error means nothing.
    if (!(e instanceof TypeError && e.message.includes("__wbindgen_start"))) throw e;
  }
}
