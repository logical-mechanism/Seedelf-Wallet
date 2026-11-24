// A small async key-value interface over chrome.storage, so the wallet logic
// also runs against an in-memory fake under Vitest. Values must be
// JSON-serializable: chrome.storage doesn't keep Uint8Array, so bytes are
// stored as base64.

export interface Area {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(...keys: string[]): Promise<void>;
  clear(): Promise<void>;
  /** Every key that starts with `prefix`: how a family of records is found while locked (wallet.ts reset). */
  keys(prefix: string): Promise<string[]>;
}

export function chromeArea(area: chrome.storage.StorageArea): Area {
  return {
    async get<T>(key: string) {
      return (await area.get(key))[key] as T | undefined;
    },
    set: (key, value) => area.set({ [key]: value }),
    remove: (...keys) => area.remove(keys),
    clear: () => area.clear(),
    // Chrome 130's getKeys reads no values; before it, the whole area is read for its keys.
    async keys(prefix: string) {
      const all = area.getKeys ? await area.getKeys() : Object.keys(await area.get(null));
      return all.filter((k) => k.startsWith(prefix));
    },
  };
}

/** How many bytes go to String.fromCharCode at once: well inside every engine's limit on a call's arguments. */
const CHUNK = 32 * 1024;

// Every sealed record goes through these two at its stored size, up to 0.7 MB for a conversation at its share or the
// requests' room. So they run at full speed (the 1.10.0 gate's round 5, fix item 5.3), giving the same bytes as before.
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(at, at + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
