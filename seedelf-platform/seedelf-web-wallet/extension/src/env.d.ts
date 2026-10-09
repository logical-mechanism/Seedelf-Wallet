// Build-time constants from vite.config.ts `define`.
declare const __MAINNET_ENABLED__: boolean;
declare const __VERSION__: string;
/** VITE_DATA_ORIGIN: a dev or e2e build's data layer (networks.ts `dataOrigin`); empty otherwise, and always in a store build. */
declare const __DATA_ORIGIN__: string;
