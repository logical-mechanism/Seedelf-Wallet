// Loads the built package (run ../build.sh first) and re-exports it.
import { readFileSync } from "node:fs";

import { initSync } from "../pkg/seedelf_wasm.js";

initSync({
  module: readFileSync(new URL("../pkg/seedelf_wasm_bg.wasm", import.meta.url)),
});

export * from "../pkg/seedelf_wasm.js";
