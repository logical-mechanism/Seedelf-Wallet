// The public account as its own DRep (chunk 21): who it is, where it stands,
// the live governance actions it can vote on, and how it voted. Building
// goes through StakingService (staking.ts), as every certificate does.
//
// Reading
//   drep     the account's DRep ID comes from its key `3/0` inside
//            WebAssembly (CIP-105, as Lace derives it); Koios's `drep_info`
//            says where it stands. Asking about an ID nobody has registered
//            tells Koios nothing the chain will: once it's registered, the
//            chain ties it to the account anyway (privacy.md).
//   profile  when it has one, `drep_metadata` says whether Koios found the
//            file and it matched its hash. The wallet never fetches it.
//   actions  every live action (`proposal_list`), its title and abstract as
//            Koios read them from its anchor. The same for everyone, so kept
//            in chrome.storage.local for an hour.
//   votes    the DRep's votes on those actions (`vote_list`).

import type * as Wasm from "@seedelf/wasm";
import type { NetworkName } from "../networks";
import type {
  DrepProfileFile,
  DrepProfileRequest,
  GovAction,
  GovActionList,
  GovernanceView,
  GovVote,
  OwnDrep,
} from "../shared/rpc";
import type { Koios, KoiosProposal } from "./koios";
import { drepName } from "./staking";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.local, per network: the live governance actions, read at most once an hour unless asked. */
export const LOCAL_GOV_ACTIONS_PREFIX = "seedelf.govActions.";

/** How long the list of live actions is kept. */
export const GOV_ACTIONS_TTL_MS = 60 * 60_000;

/** The most of a title or an abstract shown: the rest is the anchor's, to read where it's published. */
const MAX_TITLE = 200;
const MAX_ABSTRACT = 2_000;

export interface GovernanceDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  koios: (network: NetworkName) => Koios;
  local: Area;
  now: () => number;
}

/** The active account's DRep ID (CIP-129), from its key inside WebAssembly. */
export function ownDrepId(deps: Pick<GovernanceDeps, "wallet">): Promise<string> {
  return deps.wallet.withKeys((keys) => (JSON.parse(keys.cardano.drepOf()) as { id: string }).id);
}

/**
 * The account's own DRep, fresh: one `drep_info`, then, unless `light`, what
 * registering costs now (`epoch_params`) when it isn't registered, or what
 * Koios found at its profile (`drep_metadata`) when it has one.
 */
export async function readOwnDrep(deps: GovernanceDeps, network: NetworkName, { light = false } = {}): Promise<OwnDrep> {
  const id = await ownDrepId(deps);
  const koios = deps.koios(network);
  const row = await koios.drepStanding(id);
  if (row?.drep_status !== "registered") {
    let depositNow: string | undefined;
    if (!light) {
      try {
        const deposit = (await koios.epochParams()).drep_deposit;
        if (typeof deposit === "string" || typeof deposit === "number") depositNow = String(deposit);
      } catch {
        // The review says what it locks up, from the build.
      }
    }
    return {
      id,
      status: row ? "retired" : "none",
      deposit: "0",
      ...(depositNow ? { depositNow } : {}),
      active: false,
      expiresEpoch: null,
      votingPower: row?.amount ?? "0",
      delegators: row?.live_delegator_count ?? 0,
      profile: null,
    };
  }
  let profile: OwnDrep["profile"] = null;
  if (row.meta_url && row.meta_hash) {
    let found: Awaited<ReturnType<Koios["drepProfile"]>>;
    if (!light) {
      try {
        found = await koios.drepProfile(id);
      } catch {
        // Unchecked: said as "Koios couldn't say".
      }
    }
    const name = drepName(found?.givenName);
    profile = { url: row.meta_url, hash: row.meta_hash, ...(name ? { name } : {}), valid: found?.is_valid ?? null };
  }
  return {
    id,
    status: "registered",
    deposit: row.deposit ?? "0",
    active: row.active,
    expiresEpoch: row.expires_epoch_no,
    votingPower: row.amount ?? "0",
    delegators: row.live_delegator_count ?? 0,
    profile,
  };
}

/** Text from an action's anchor, as it can be shown: no control or direction-changing characters, cut to `most`. */
export function shownText(text: unknown, most: number, { lines = false } = {}): string | undefined {
  if (typeof text !== "string") return undefined;
  // C0 and C1 controls (but a newline, where lines are kept), bidirectional
  // overrides and isolates, and zero-width characters: each can make a line
  // read as something it isn't.
  const controls = lines
    ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g
    : /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
  const clean = text.replace(controls, lines ? "" : " ").trim();
  if (!clean) return undefined;
  return clean.length > most ? `${clean.slice(0, most).trimEnd()}…` : clean;
}

function actionOf(row: KoiosProposal): GovAction {
  const title = shownText(row.title, MAX_TITLE);
  const abstract = shownText(row.abstract, MAX_ABSTRACT, { lines: true });
  return {
    id: row.proposal_id,
    txHash: row.proposal_tx_hash,
    index: row.proposal_index,
    type: row.proposal_type,
    ...(title ? { title } : {}),
    ...(abstract ? { abstract } : {}),
    proposedEpoch: row.proposed_epoch,
    expiresEpoch: row.expiration,
    deposit: row.deposit ?? "0",
    anchor: row.meta_url && row.meta_hash ? { url: row.meta_url, hash: row.meta_hash } : null,
    anchorValid: row.meta_is_valid ?? null,
  };
}

/** The live governance actions: the list on the device when it's under an hour old, unless `refresh`. */
export async function govActions(deps: GovernanceDeps, network: NetworkName, refresh = false): Promise<GovActionList> {
  const key = LOCAL_GOV_ACTIONS_PREFIX + network;
  const kept = await deps.local.get<GovActionList>(key);
  if (kept && !refresh && deps.now() - kept.updatedAt < GOV_ACTIONS_TTL_MS) return kept;
  const rows = await deps.koios(network).proposalList();
  const list: GovActionList = { actions: rows.map(actionOf), updatedAt: deps.now() };
  await deps.local.set(key, list);
  return list;
}

const VOTES: Record<string, GovVote> = { Yes: "yes", No: "no", Abstain: "abstain" };

/**
 * The Governance actions screen: the live actions, the account's DRep (its
 * `drep_info` alone), and, when it's registered, its vote on each (one
 * `vote_list`). A vote cast again replaces the one before, so the newest is
 * the one that counts.
 */
export async function governance(deps: GovernanceDeps, network: NetworkName, refresh = false): Promise<GovernanceView> {
  const [list, drep] = await Promise.all([govActions(deps, network, refresh), readOwnDrep(deps, network, { light: true })]);
  const votes: Record<string, GovVote> = {};
  if (drep.status === "registered" && list.actions.length) {
    const rows = await deps.koios(network).drepVotes(
      drep.id,
      list.actions.map((a) => a.id),
    );
    for (const row of rows) {
      const vote = VOTES[row.vote];
      if (vote && !(row.proposal_id in votes)) votes[row.proposal_id] = vote;
    }
  }
  return { list, drep, votes };
}

/**
 * A DRep's profile as CIP-119 metadata and its hash, written in WebAssembly,
 * asking no one. The form checks CIP-119's limits first, in the page's
 * language; WebAssembly checks them again.
 */
export function profileFile(deps: Pick<GovernanceDeps, "wasm">, profile: DrepProfileRequest): DrepProfileFile {
  return JSON.parse(deps.wasm.drepProfile(JSON.stringify(profile))) as DrepProfileFile;
}
