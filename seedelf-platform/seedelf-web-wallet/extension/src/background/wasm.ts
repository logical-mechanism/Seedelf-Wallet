// Loads the seedelf-wasm module once per service-worker lifetime. Service
// workers can't use top-level await, so callers await `loadWasm()` instead.

import init, * as wasm from "@seedelf/wasm";
// Built by ../wasm/build.sh (npm run build:wasm).
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
        `The wallet's core didn't load (${e instanceof Error ? e.message : String(e)}). ` +
          "This usually means the extension was rebuilt or updated while it was running: reload it.",
      );
    },
  );
  return ready;
}
