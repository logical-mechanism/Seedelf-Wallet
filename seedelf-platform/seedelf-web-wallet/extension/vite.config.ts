/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build, defineConfig, loadEnv, type Plugin } from "vite";

import pkg from "./package.json" with { type: "json" };
import { buildManifest, type ManifestOptions } from "./src/manifest.ts";

const wasmPkg = fileURLToPath(new URL("../wasm/pkg/", import.meta.url));

/** Emits manifest.json into the build. */
function manifest(options: ManifestOptions): Plugin {
  return {
    name: "seedelf-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(buildManifest(options), null, 2)}\n`,
      });
    },
  };
}

/**
 * Builds the dApp connector's content scripts (src/content/) after the rest:
 * each one file with nothing imported at run time, wrapped so nothing but
 * `window.cardano.seedelf` reaches the page. Chrome runs content scripts as
 * classic scripts, which the main build's module chunks can't be.
 */
function contentScripts(mode: string): Plugin {
  const scripts = { "cip30-page": "src/content/page.ts", "cip30-bridge": "src/content/bridge.ts" };
  return {
    name: "seedelf-content-scripts",
    apply: "build",
    async closeBundle() {
      for (const [name, entry] of Object.entries(scripts)) {
        await build({
          configFile: false,
          logLevel: "warn",
          mode,
          build: {
            outDir: "dist",
            emptyOutDir: false,
            target: "es2022",
            minify: mode !== "development",
            // The icon is written into the page's script, as dApps show it.
            assetsInlineLimit: 16_384,
            // `name` is required for an IIFE, but with nothing exported no global is made.
            lib: {
              entry: fileURLToPath(new URL(entry, import.meta.url)),
              formats: ["iife"],
              name: "seedelf",
              fileName: () => `${name}.js`,
            },
          },
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const mainnetEnabled = env.VITE_ENABLE_MAINNET === "true";
  const storeBuild = env.VITE_STORE_BUILD === "true";

  return {
    plugins: [react(), manifest({ version: pkg.version, mainnetEnabled, storeBuild }), contentScripts(mode)],
    define: {
      __MAINNET_ENABLED__: JSON.stringify(mainnetEnabled),
      __VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        // Built by ../wasm/build.sh (npm run build:wasm).
        "@seedelf/wasm": `${wasmPkg}seedelf_wasm.js`,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: mode === "development",
      minify: mode !== "development",
      rolldownOptions: {
        input: {
          index: fileURLToPath(new URL("index.html", import.meta.url)),
          sw: fileURLToPath(new URL("src/background/sw.ts", import.meta.url)),
        },
        output: {
          // The manifest points at sw.js, so the worker keeps a fixed name.
          entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
        },
      },
    },
    test: {
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  };
});
