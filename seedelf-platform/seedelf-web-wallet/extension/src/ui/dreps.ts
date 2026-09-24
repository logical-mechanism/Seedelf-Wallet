// The DReps the wallet knows by name, from its own list (src/dreps/, made by
// `npm run dreps` at each release), searched on the device: nobody is asked
// about a DRep until the user picks one. The list only misses DReps who
// registered since the release; a pasted ID finds those.

import type { NetworkName } from "../networks";
import mainnet from "../dreps/mainnet.json";
import preprod from "../dreps/preprod.json";

export interface DrepEntry {
  /** CIP-129, as Koios gives it. */
  id: string;
  name: string;
}

interface DrepList {
  /** When the list was made (YYYY-MM-DD). */
  recorded: string;
  dreps: DrepEntry[];
}

const listOf = (file: { recorded: string; dreps: string[][] }): DrepList => ({
  recorded: file.recorded,
  dreps: file.dreps.map(([id, name]) => ({ id: id!, name: name! })),
});

const LISTS: Record<NetworkName, DrepList> = {
  preprod: listOf(preprod),
  // Only a mainnet build carries the mainnet list.
  mainnet: __MAINNET_ENABLED__ ? listOf(mainnet) : { recorded: "", dreps: [] },
};

export const drepList = (network: NetworkName): DrepList => LISTS[network];

/** The DReps whose name or ID holds `query`, case aside, in the list's order (by name). */
export function searchDreps(dreps: DrepEntry[], query: string): DrepEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return dreps;
  return dreps.filter((d) => d.name.toLowerCase().includes(q) || d.id.includes(q));
}

/** Whether `text` looks like a whole DRep ID (CIP-129 or CIP-105), to look up as pasted. */
export const isDrepId = (text: string) => /^drep(_script)?1[02-9ac-hj-np-z]{50,}$/.test(text.trim().toLowerCase());
