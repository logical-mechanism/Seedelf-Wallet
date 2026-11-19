// The DReps the wallet knows by name, from its own list (src/dreps/, made by
// `npm run dreps` at each release), searched on the device: nobody is asked
// about a DRep until the user picks one. The list misses DReps who registered
// since the release, and leaves out those whose profile asks directories not
// to list them (CIP-119's doNotList, chunk 51, gap-g7#2); a pasted ID finds
// either.

import { bundles, type I18nKey } from "../i18n/translations";
import type { NetworkName } from "../networks";
import mainnet from "../dreps/mainnet.json";
import preprod from "../dreps/preprod.json";
import { nameSkeleton, plainName } from "./format";

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

// Each name as every screen shows it (plainName): a DRep chooses its own, and the list keeps the bidi overrides and
// zero-width characters its generator leaves, which turned a name round where a row showed it as it came:
// Delegations' rows and Activity's staking line (chunk 51, gap-g7#3).
const listOf = (file: { recorded: string; dreps: string[][] }): DrepList => ({
  recorded: file.recorded,
  dreps: file.dreps.map(([id, name]) => ({ id: id!, name: plainName(name!) })),
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

/**
 * Whether `text` looks like a whole DRep ID, to look up as pasted: CIP-129's `drep1…`, or CIP-105's `drep_vkh1…`,
 * `drep_script1…` and deprecated `drep1…`. A `drep_vkh1…` was said to match nothing, though it was a whole ID
 * (release review C36).
 */
export const isDrepId = (text: string) => /^drep(_vkh|_script)?1[02-9ac-hj-np-z]{50,}$/.test(text.trim().toLowerCase());

/** What the wallet calls its own choices for the vote: the two pinned ones, none, and the account's own DRep. */
const CHOICES = [
  "format.vote.abstain",
  "format.vote.noConfidence",
  "format.vote.notDelegated",
  "drep.yourOwn",
  "vote.abstain.title",
  "vote.noConfidence.title",
] as const satisfies readonly I18nKey[];

/** `CHOICES` as each language the wallet speaks writes them, by `nameSkeleton`: made once, when first asked. */
let choices: Set<string> | undefined;

/**
 * Whether a DRep's name looks like one of the wallet's own choices ("Always abstain", "Your own DRep") as any
 * language the wallet speaks writes it, by `nameSkeleton`, as a shared name is told. Every language's, not only
 * the one chosen: the user may switch, and a name is anyone's to pick. This holds a stranger's name up to the
 * wallet's own words, never the reverse, so it isn't the translated text the code mustn't compare (chunk 51,
 * gap-g7#1).
 */
export function posesAsChoice(name: string | undefined): boolean {
  if (!name) return false;
  choices ??= new Set(
    Object.values(bundles)
      .flatMap((words) => CHOICES.map((key) => nameSkeleton((words as Record<string, string>)[key] ?? "")))
      .filter((skeleton) => skeleton !== ""),
  );
  return choices.has(nameSkeleton(name));
}
