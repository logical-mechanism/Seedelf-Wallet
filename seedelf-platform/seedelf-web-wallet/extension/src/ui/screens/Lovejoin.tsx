// Lovejoin's page in the dApp browser (roadmap chunk 16): the wallet's boxes
// in the mixer's pool, found by the Seedelf key wherever other people's mixes
// moved them, when each is due back, and a way to bring one back now. A
// private session's spare ADA goes in on its way back (Settings, Lovejoin).
//
// Mix puts ADA in from here, in boxes of 10 ₳:
//   from the private balance   a new one-time account is funded (one
//                              review), then it runs by itself: the deposit,
//                              the mixes, and the rest back, merged into the
//                              private UTxO its funding left.
//   from the public account    the deposit and every mix, paid by the account
//                              and put up against its collateral; the change
//                              stays in it.
// Either way, each box comes back into the private balance on its own, later.
// A mix from the public account needs its collateral: while there's none,
// the form says so before Review, with Set collateral, Settings' page opened
// here (the owner, 2026-10-14). It was found out after Review, sent to
// Settings.
//
// Mix my boxes again fans every box of the wallet's in the pool out once
// more (a chain cut short, or boxes nobody has mixed since), paid from the
// private balance through a one-time account, as a mix from it is, with no
// deposit. Its boxes wait again, a fresh delay each; none comes back while
// it runs. A box a mix from a public account put in is that account's: the
// private balance paying for its mixes would tie the two (privacy review
// §2.10). So Mix my boxes again leaves those out, and Mix again from my
// public account mixes the active account's, paid by it, which ties nothing
// new; another account's are that account's to mix again, and the page says
// which to switch to. Pay from my private balance anyway takes them all,
// after a warning.
//
// Every chain the wallet sends is recorded (launch review H2). A box one of
// them made and didn't finish mixing is "not mixed yet": it never comes back
// by itself, since it still shows where it went in. Mixing again takes
// those first; Bring it back anyway takes one as it is, after a warning.
// After a restore, with no records, the worker asks Koios what made each
// box: one a deposit made is not mixed yet too, said as Koios said it (whose
// deposit, and why no mix followed, the wallet can't know), and one Koios
// hasn't said of waits the same way until it has (independent review M14).
// The chains that aren't all sent are listed: being sent (no box comes back
// meanwhile), or stopped partway, and why; read again from the device every
// few seconds while one is being sent. A mix from the private balance
// can be stopped before its boxes go in: it then comes back directly. What
// the wallet has in the pool is hidden with the balances (#56), and so is
// how many boxes, since every box is 10 ₳ (privacy review §2.16); the Mix
// form and the reviews show what's being sent. The page says Lovejoin has
// had no third-party audit.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { dateLocale, type I18nKey, joinList, joinSentences, sentenceGap, t, useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { LovejoinWidth } from "../../shared/preferences";
import type {
  Balances,
  CollateralStatus,
  LovejoinChainTx,
  LovejoinChainView,
  LovejoinFunding,
  LovejoinMixView,
  LovejoinPoolStatus,
  LovejoinPublicSummary,
  LovejoinStatus,
  LovejoinUnusable,
  PendingTx,
  Requests,
  SessionOutSummary,
  SessionView,
  TokenAmount,
  TokenQuantity,
  UtxoInfo,
} from "../../shared/rpc";
import { nameOf, publicAccountName, useAccounts } from "../accounts";
import { call } from "../background";
import { BringAllBack } from "../components/BringAllBack";
import { Callout } from "../components/Callout";
import { ExplorerLink } from "../components/ExplorerLink";
import { GivemeNote } from "../components/GivemeNote";
import { HintButton, useHint } from "../components/Hint";
import { HistoriesNote } from "../components/HistoriesNote";
import { SearchIcon, ShieldIcon, WalletIcon } from "../components/Icons";
import {
  chainText,
  COLLATERAL_MIX_COST,
  delayText,
  LOVEJOIN_SEEN,
  LOVEJOIN_UNAUDITED,
  lovejoinHides,
  mixesPerBox,
  useSessionsWhile,
  WidthNote,
  CollateralMixLine,
  CollateralReserveRow,
} from "../components/LovejoinReturn";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { homeBalance, TotalRows } from "../components/ReviewTotals";
import { Screen } from "../components/Screen";
import { SendButton } from "../components/SendButton";
import { refusalOf, SessionRefusedFoot, unsentWhyText, type Refusal } from "../components/SessionRefused";
import { TxDetailButton, TxDetailModal, entryLabel } from "../components/TxDetail";
import { Tabs } from "../components/Tabs";
import { PoolAvatar } from "../components/PoolAvatar";
import { adaText, formatAda, formatPercent, shortHex, whenOf } from "../format";
import {
  bootstrapProgress,
  boxText,
  CLASSIC_BOX,
  CLASSIC_ID,
  crowdText,
  groupPools,
  isCopy,
  poolNamed,
  poolsOf,
  searchGroups,
  shownOnHub,
  type BoxValue,
  type PoolGroup,
  type ShownPool,
} from "../lovejoin-pools";
import { useNetwork } from "../network";
import { useAmounts, usePreferences } from "../preferences";
import { withoutStop } from "../sentence";
import { aboutAda, BOX_BACK_ESTIMATE, SESSION_FEE_ESTIMATE, toCents } from "../swap";
import { tokenAmountText, tokenMark, tokenQuantity, tokenText } from "../tokens";
import { Collateral } from "./Collateral";
import { LovejoinLaunch } from "./LovejoinLaunch";
import { SwapTag, type SwapTone } from "./Swaps";

/** The most boxes one mix takes (the worker's MAX_MIX_BOXES). */
const MAX_BOXES = 10;
/** The most mixes one chain makes (the worker's MAX_CHAIN_MIXES): ten boxes three waves deep, three a mix. */
const MAX_CHAIN_MIXES = MAX_BOXES * mixesPerBox(3);
/**
 * The most boxes one Bootstrap of the classic pool puts in (the worker's
 * MAX_DEPOSIT_BOXES): a Bootstrap is a single deposit with no mixes, so the
 * transaction's size is the only limit, not the handful of boxes a chain of
 * mixes can send.
 */
const MAX_BOOTSTRAP_BOXES = 96;
/** A running mix's page asks the worker to move it on this often. */
const ADVANCE_EVERY_MS = 20_000;
/** And reads its chains' rows again this often while one is being sent: from the device, no Koios request. */
const CHAINS_EVERY_MS = 5_000;
/** How often the public account's collateral is asked about while its payment is on its way: the last reading alone. */
const COLLATERAL_EVERY_MS = 15_000;

type Source = "private" | "public";
type PrivateSummary = SessionOutSummary & { mix: LovejoinFunding };
type Review =
  /** `again`: builds it afresh, on the next unused account, when Send is refused (chunk 23's second review, DX-1). */
  | { source: "private"; summary: PrivateSummary; again: () => Promise<PrivateSummary> }
  | { source: "public"; summary: LovejoinPublicSummary };
/** A review as what it shows reads it: its side and its summary. */
type Reviewed = { source: "private"; summary: PrivateSummary } | { source: "public"; summary: LovejoinPublicSummary };
/** What a pool whose boxes can't pay their own way back today has left after the fee, and needs (chunk 34's §2). */
type CantComeBack = NonNullable<LovejoinPoolStatus["cantComeBack"]>;

/** A Bootstrap puts boxes in with no mixes, from either side (chunk 34: it replaces the seed). */
const bootstraps = (r: Reviewed) => !!(r.source === "private" ? r.summary.mix.bootstrap : r.summary.bootstrap);

/**
 * How the reviewed mix runs once sent, behind the icon by the title (chunk 23): what it costs, hides and ties stays in
 * the review's rows and callouts. A Bootstrap has its own note on either side: nothing is mixed, and its boxes stay
 * until brought back by hand. None for a mix in a pool whose boxes can't pay their own way back (`cantComeBack`): each
 * note ends in each box coming back after its wait, which isn't so there, and the review's callout says how they come
 * back (session 5's cross-area review, M1). From the private balance, where the worker says its collateral is mixed
 * (`collateralMix`: its funding pays for that mix, which its chain sets aside), the 5 ₳ isn't said to come back with
 * what isn't used: it's mixed once, and comes back later (1.6.0's release review, 323-worker#6, gap-3#2; its review of
 * the fixes, fx-promise). A Bootstrap from the private balance is funded first, its deposit
 * once that lands and what's left back after: its note said the deposit went now, in one transaction, which only the
 * public account's does (1.6.0's review of the fixes, R3-21). Exported for its test.
 */
export function reviewHint(r: Reviewed, cantComeBack?: CantComeBack): string | undefined {
  if (bootstraps(r)) return t(r.source === "private" ? "lovejoin.review.bootstrapNotePrivate" : "lovejoin.review.bootstrapNote");
  if (cantComeBack) return undefined;
  if (r.source === "private") {
    const mixed = r.summary.collateralMix === "mixed";
    if (r.summary.mix.again) return t(mixed ? "lovejoin.review.againNoteMixed" : "lovejoin.review.againNote");
    return t(mixed ? "lovejoin.review.privateNoteMixed" : "lovejoin.review.privateNote");
  }
  return t(r.summary.again ? "lovejoin.review.publicAgainNote" : "lovejoin.review.publicNote");
}

/**
 * A review's word of a pool whose boxes can't pay their own way back today, in the pool page's callout's words: said
 * where Review takes the user since the owner's call 34, in place of the rows that promised each box back after its
 * wait (session 5's cross-area review, M1). None elsewhere, the classic pool always (backward compatibility 7).
 */
function StuckReviewNote({ cantComeBack }: { cantComeBack?: CantComeBack }) {
  const tr = useT();
  if (!cantComeBack) return null;
  return (
    <Callout tone="warn" testId="lovejoin-review-stuck">
      {tr("lovejoin.stuck.warn.lead", { has: formatAda(cantComeBack.has), needs: formatAda(cantComeBack.needs) })}
    </Callout>
  );
}

/** A box's ADA. */
const BOX = 10_000_000n;
/** A one-time account's own collateral (sessions.ts SESSION_COLLATERAL). */
const COLLATERAL = 5_000_000n;
/**
 * Left aside for a funding from the private balance: its network fee, about 0.25 ₳, and the least its change holds,
 * a Seedelf output's, 1.46 ₳ at today's 4,310 lovelace a byte, with room for a dearer byte. The build decides exactly.
 * 1 ₳ left the change's least out, so the stepper offered a box the funding then refused (1.6.0's release review,
 * 323-worker#0).
 */
const FEE_ROOM = 2_000_000n;
/** The boxes of other people's a collateral's mix draws from the pool of 5 ₳ boxes (the worker's TAIL_DRAWS). */
const COLLATERAL_MIX_DRAWS = 2;

/**
 * Whether a mix of `boxes` boxes at `depth` can go now, as the last pool read
 * has it (chunk 23's second review, LJ-1): the network's floor of other
 * people's boxes, and two of them for each of its mixes (lovejoin.ts fits),
 * three four boxes a mix (`width`, chunk 34's D3).
 * `fits`: how many boxes the pool has room for at that depth; `shallower`:
 * whether one wave deep would take them all.
 */
export function poolRoom(status: Pick<LovejoinStatus, "others" | "free" | "floor">, boxes: number, depth: number, width = 3) {
  const have = status.free ?? status.others;
  // A mix takes `width - 1` others for each of its own (chunk 34's D3).
  const perBox = mixesPerBox(depth, width) * (width - 1);
  return {
    have,
    need: boxes * perBox,
    floorShort: status.others < status.floor,
    fits: Math.floor(have / perBox),
    shallower: depth > 1 && have >= boxes * mixesPerBox(1, width) * (width - 1),
  };
}

/** The pool's room for a mix at one width (poolRoom). */
type Room = ReturnType<typeof poolRoom>;

/**
 * Which reading of the public account Home handed down, in a word: a new one once a payment to it lands (its outputs
 * at the account, not on their way), the same one however often Home renders it again. A pool's page reads its
 * collateral again at each new one (1.6.0's preprod rehearsal, R6).
 */
export const readingOf = (cardano?: Pick<Balances["cardano"], "lovelace" | "utxos" | "incoming">): string =>
  cardano ? [cardano.lovelace, cardano.utxos, cardano.incoming?.lovelace ?? "", cardano.incoming?.utxos ?? ""].join(".") : "";

/**
 * How many boxes the Mix form's stepper offers at its Four boxes a mix switch's `width`, `depth` waves deep: what the
 * pool has room for (`room`, at that width) and one chain takes (MAX_CHAIN_MIXES). At four, `three`: what three a
 * mix would offer (`threeRoom`), where that's more, for the reason under the stepper. Four takes what fits at four,
 * and the user turns the switch to take more: the form went three behind the switch wherever four couldn't take
 * every box asked (the owner's test of 1.6.0: "Four now, rest next press"). As the build decides it (lovejoin.ts
 * widthFor), which goes three only where the pool changed since, and says so. `chain`: one chain's length caps four
 * before the pool's room does, so the reason says that (1.6.0's review). Exported for its test.
 */
export function formRoom(width: number, depth: number, room?: Room, threeRoom?: Room): { most: number; three?: number; chain?: true } {
  const chainMost = (w: number) => (depth < 1 ? MAX_BOXES : Math.floor(MAX_CHAIN_MIXES / mixesPerBox(depth, w)));
  const at = (w: number, r?: Room) => (!r || r.floorShort ? MAX_BOXES : Math.min(MAX_BOXES, r.fits, chainMost(w)));
  const most = at(width, room);
  if (width !== 4 || !threeRoom) return { most };
  const three = at(3, threeRoom);
  if (three <= most) return { most };
  return room && !room.floorShort && chainMost(width) < Math.min(MAX_BOXES, room.fits) ? { most, three, chain: true } : { most, three };
}

/**
 * The most boxes `held` lovelace pays a mix for (LJ-3): each box more takes
 * the same, its ADA (`box`, the classic pool's 10 ₳ when none is given) and
 * its mixes (`funding`, for `funding.boxes`), beside what's kept `aside`:
 * from the private balance (the default), the one-time account's 5 ₳
 * collateral and room for the network fee and the change (FEE_ROOM). The
 * build decides exactly; this keeps the stepper from offering what plainly
 * can't be paid.
 */
export function boxesAffordable(
  held: string,
  funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees">,
  box = BOX,
  aside = COLLATERAL + FEE_ROOM,
): number {
  const perBox = box + BigInt(funding.mixFees) / BigInt(funding.boxes);
  const besides = BigInt(funding.lovelace) - perBox * BigInt(funding.boxes);
  const spare = BigInt(held) - aside - besides;
  return spare < 0n ? 0 : Number(spare / perBox);
}

/**
 * The most boxes the Mix form's stepper offers, and what holds it there: no more than ten (a mix's most), than the
 * pool has room for (`roomMost`), or than the side that pays (`side`, spendable, as Home hands it down) holds the ADA
 * and, in a token pool, the token for. From the public account its ADA too, since the owner's test of 1.6.0
 * (2026-10-19): the stepper went to ten whatever it held. Its collateral is apart from what's spendable, and the
 * deposit's fee is in the funding's reserve, so nothing more is kept aside there. From the private balance, what its
 * funding pays for its collateral's mix too (`tail`, tailReserveOf) where it's asked: kept aside, for what the form's
 * figures count, never its cap (mixOffer; 1.6.0's release review, 323-worker#0; its review of the fixes, R3-7). From
 * the public account in a token pool, once its UTxOs answer (`account`), as its chain picks them for each count
 * (publicBoxesAffordable, R3-14). No `funding` yet: the ADA holds nothing back. Exported for its test.
 */
export function mixMost(
  source: Source,
  side: Pick<Balances["seedelf"], "lovelace" | "tokens"> | undefined,
  token: TokenQuantity | undefined,
  funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees"> | undefined,
  box: bigint,
  roomMost: number,
  tail = 0n,
  account?: UtxoInfo[],
) {
  const tokenMost = token ? tokenBoxes(side?.tokens, token) : MAX_BOXES;
  const adaMost = !side || !funding
    ? MAX_BOXES
    : source === "public" && token && account
      ? publicBoxesAffordable(account, token, funding, box)
      : boxesAffordable(side.lovelace, funding, box, source === "private" ? COLLATERAL + tail + FEE_ROOM : 0n);
  const affordable = Math.min(adaMost, tokenMost);
  return { tokenMost, adaMost, affordable, most: Math.min(MAX_BOXES, affordable, roomMost) };
}

/**
 * What a mix from the private balance pays beside its funding for its collateral to be mixed on its way into the pool
 * of 5 ₳ boxes as it comes back (lovejoin-funding's `collateralReserve`), as the Mix form counts it: while that pool
 * (`collateralPool`), in the page's own read, holds its floor of other people's boxes, two of them free, and takes new
 * boxes, as the worker's collateralPool decides at build. None otherwise, and none from the public account, which puts
 * up its own collateral. The form left it out, so its totals were 1.5 ₳ under the review's (1.6.0's release review,
 * 320-screens#2, 321-lj-screens#3). Exported for its test.
 */
export function tailReserveOf(
  funding: Pick<LovejoinFunding, "collateralReserve" | "collateralPool"> | undefined,
  source: Source,
  pools: ShownPool[],
): bigint {
  if (source !== "private" || !funding?.collateralReserve || !funding.collateralPool) return 0n;
  const pool = poolNamed(pools, funding.collateralPool);
  if (!pool || pool.unusable || pool.others < pool.floor || pool.free < COLLATERAL_MIX_DRAWS) return 0n;
  return BigInt(funding.collateralReserve);
}

/**
 * The Mix form's stepper and figures (mixMost) at `boxes` boxes, `asked` its collateral's reserve (tailReserveOf). The
 * stepper's cap and the form's refusals never count the reserve: the worker funds a count the balance pays without it
 * (orWithoutReserve), so counting it stopped the stepper a box low and refused a box the worker funds (1.6.0's review of
 * the fixes, R3-7). `tail`: the reserve the figures count, where this count leaves room for it too, as the worker then
 * builds it, so the form's totals are the review's either way. `tailShort`: asked, and this count goes without it,
 * which the form says in a line, never a refusal: its 5 ₳ is then mixed only if enough is left when it comes back.
 * `account`: the public account's UTxOs once they answer, which a token pool's count is picked from (mixMost).
 * Exported for its test.
 */
export function mixOffer(
  source: Source,
  side: Pick<Balances["seedelf"], "lovelace" | "tokens"> | undefined,
  token: TokenQuantity | undefined,
  funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees"> | undefined,
  box: bigint,
  roomMost: number,
  boxes: number,
  asked = 0n,
  account?: UtxoInfo[],
) {
  const offer = mixMost(source, side, token, funding, box, roomMost, 0n, account);
  const tail = asked > 0n && mixMost(source, side, token, funding, box, roomMost, asked).adaMost >= boxes ? asked : 0n;
  return { ...offer, tail, tailShort: asked > 0n && tail === 0n && offer.adaMost >= boxes };
}

/** A Cardano output's least ADA a byte today, 4,310 lovelace on both networks (the parameters' coinsPerUTxOByte). */
const LEAST_PER_BYTE = 4_310n;

/** The CBOR size of a whole number, or of the head of a byte string or map that long (core's head_size). */
const headSize = (n: bigint): bigint => (n < 24n ? 1n : n < 0x100n ? 2n : n < 0x1_0000n ? 3n : n < 0x1_0000_0000n ? 5n : 9n);

/**
 * The least ADA an output to the public account's own base address carries for exactly `tokens`, as core prices what
 * a mix's deposit gives back (minimum_address_payment): 160 bytes and the output's own, at today's LEAST_PER_BYTE, its
 * ADA staged at 5 ₳, twenty tokens to an output. The output is a map of the 57-byte address and its value, 68 bytes
 * before its tokens. None for none.
 */
function accountLeast(tokens: Array<Pick<TokenAmount, "policyId" | "assetName" | "quantity">>): bigint {
  let least = 0n;
  for (let i = 0; i < tokens.length; i += 20) {
    const policies = new Map<string, Array<Pick<TokenAmount, "assetName" | "quantity">>>();
    for (const x of tokens.slice(i, i + 20)) policies.set(x.policyId, [...(policies.get(x.policyId) ?? []), x]);
    let bytes = 68n + headSize(BigInt(policies.size));
    for (const named of policies.values()) {
      // The 28-byte policy id, and its map of names.
      bytes += 30n + headSize(BigInt(named.length));
      for (const { assetName, quantity } of named) {
        const name = BigInt(assetName.length / 2);
        bytes += headSize(name) + name + headSize(BigInt(quantity));
      }
    }
    least += (160n + bytes) * LEAST_PER_BYTE;
  }
  return least;
}

/**
 * WebAssembly's chain's pick of the public account's UTxOs for a mix of `boxes` boxes from it (chain_from_account_at),
 * never its collateral, one kept out of payments or one holding a reference script: in a token pool (`token`, a box's),
 * the fewest UTxOs holding its token that hold the boxes' worth, the most of it first, their ADA counted, less the least
 * ADA of the output that gives the account back their tokens beyond that (accountLeast), which the build pays first;
 * then every UTxO of ADA alone. Between UTxOs holding as much of the token, the one with less ADA first: the stepper
 * never counts on the build's order. `spend`: what that pays the funding with; `enough`: whether they hold the token.
 */
function publicPick(utxos: UtxoInfo[], token: TokenQuantity | undefined, boxes: number): { spend: bigint; enough: boolean } {
  const spendable = utxos.filter((u) => !u.locked && !u.collateral && !u.unspendable);
  const alone = spendable.filter((u) => !u.tokens.length).reduce((sum, u) => sum + BigInt(u.lovelace), 0n);
  if (!token) return { spend: alone, enough: true };
  const key = (x: Pick<TokenAmount, "policyId" | "assetName">) => `${x.policyId}.${x.assetName}`;
  const of = (u: UtxoInfo) => BigInt(u.tokens.find((x) => key(x) === key(token))?.quantity ?? "0");
  const order = (a: bigint, b: bigint) => (a > b ? 1 : a < b ? -1 : 0);
  const holding = spendable.filter((u) => of(u) > 0n).sort((a, b) => order(of(b), of(a)) || order(BigInt(a.lovelace), BigInt(b.lovelace)));
  const wanted = BigInt(token.quantity) * BigInt(boxes);
  let have = 0n;
  let ada = 0n;
  const back = new Map<string, Pick<TokenAmount, "policyId" | "assetName" | "quantity">>();
  for (const u of holding) {
    if (have >= wanted) break;
    have += of(u);
    ada += BigInt(u.lovelace);
    for (const x of u.tokens) {
      const held = BigInt(back.get(key(x))?.quantity ?? "0");
      back.set(key(x), { policyId: x.policyId, assetName: x.assetName, quantity: (held + BigInt(x.quantity)).toString() });
    }
  }
  // The boxes take their worth of the pool's token; all of it where those UTxOs don't hold enough.
  const left = have > wanted ? have - wanted : 0n;
  if (left > 0n) back.set(key(token), { ...back.get(key(token))!, quantity: left.toString() });
  else back.delete(key(token));
  const spend = alone + ada - accountLeast([...back.values()]);
  return { spend: spend > 0n ? spend : 0n, enough: have >= wanted };
}

/**
 * The public account's ADA a mix of `boxes` boxes from it can spend (publicPick): its UTxOs of ADA alone and, in a
 * token pool, those of its UTxOs holding the pool's token that its chain picks for them, less what goes back. Not the
 * staking rewards Home counts in what a payment may spend, which a mix withdraws none of, nor ADA held with other
 * tokens: the stepper offered boxes on both that the build then refused (1.6.0's release review, 321-lj-screens#1).
 * Nor every UTxO holding the pool's token, nor the output that gives the account back what the boxes don't take: so it
 * offered more boxes than the build took (1.6.0's review of the fixes, R3-14). From the last reading's UTxOs, as
 * Settings' UTxOs page lists them. Exported for its test.
 */
export function publicMixAda(utxos: UtxoInfo[], token?: TokenQuantity, boxes = 1): string {
  return publicPick(utxos, token, boxes).spend.toString();
}

/**
 * The most boxes, of MAX_BOXES, a mix from the public account pays for in a token pool (`token`, a box's), count by
 * count as its chain picks the account's UTxOs for each (publicPick): which UTxOs holding the token it takes, so what
 * their ADA adds and what goes back, changes with the count, so no one figure gives the cap. It stops below the first
 * count the pick can't pay, though a larger one may pay (the build takes more of those UTxOs only for more boxes), so
 * no count it offers is refused. `funding` priced per box as boxesAffordable prices it.
 */
function publicBoxesAffordable(
  utxos: UtxoInfo[],
  token: TokenQuantity,
  funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees">,
  box: bigint,
): number {
  const perBox = box + BigInt(funding.mixFees) / BigInt(funding.boxes);
  const besides = BigInt(funding.lovelace) - perBox * BigInt(funding.boxes);
  for (let n = 1; n <= MAX_BOXES; n++) {
    const { spend, enough } = publicPick(utxos, token, n);
    if (!enough || spend < besides + perBox * BigInt(n)) return n - 1;
  }
  return MAX_BOXES;
}

/**
 * The public side the Mix and Bootstrap forms show and pay from: what a mix of `boxes` boxes can spend (publicMixAda)
 * once the account's UTxOs answer, `mixable`; Home's figure (`cardano`) before they do, or from a reading too large to
 * keep. The forms word the figure by which it is: the new words sat over Home's figure, and the old label over what a
 * mix can spend (1.6.0's review of the fixes, R3-26, R3-27). In a token pool the figure follows the count, as the UTxOs
 * its chain picks do (R3-14). Exported for its test.
 */
export function publicSideOf<S extends Pick<Balances["cardano"], "lovelace" | "tokens">>(
  cardano: S | undefined,
  accountUtxos: UtxoInfo[] | undefined,
  token?: TokenQuantity,
  boxes = 1,
): { side?: Pick<Balances["cardano"], "lovelace" | "tokens">; mixable: boolean } {
  return cardano && accountUtxos
    ? { side: { lovelace: publicMixAda(accountUtxos, token, boxes), tokens: cardano.tokens }, mixable: true }
    : { side: cardano, mixable: false };
}

/**
 * Why the public account can't pay for one box: `held` is what a mix can spend (`mixable`), or Home's figure, which
 * 1.5.0's words name as what the account holds (R3-26). Exported for its test.
 */
export function cantAffordPublic(first: string, held: string, mixable: boolean): string {
  return t(mixable ? "lovejoin.mix.cantAffordPublic" : "lovejoin.mix.cantAffordPublicHolds", { first, held });
}

/**
 * The count the stepper shows once `most` is known: no more than fits, and one where none does, so − is off with +
 * (blind test T11; the owner's test of 1.6.0 had "4 boxes" beside "too little MIN for one box"). Exported for its test.
 */
export const boxesShown = (boxes: number, most: number) => Math.min(boxes, Math.max(most, 1));

/**
 * The Mix form's line where this many boxes go without its collateral's reserve (mixOffer's `tailShort`) and nothing
 * else stops the mix: the worker funds them without it, and the 5 ₳ is then mixed only if enough is left when it comes
 * back (1.6.0's review of the fixes, R3-7). A warning, never a refusal: fewer boxes, or more ADA made private, pay it.
 * Exported for its test.
 */
export function CollateralIfLeft({ shown }: { shown: boolean }) {
  const tr = useT();
  if (!shown) return null;
  return (
    <p className="note" data-testid="lovejoin-collateral-if-left">
      {tr("lovejoin.mix.privacy.collateralIfLeft")}
    </p>
  );
}

/**
 * Four boxes a mix, for this mix (the owner's test of 1.6.0: "I dont have an option for that"): on the Mix form and
 * Mix my boxes again's review, set as Settings has it until turned, in Settings' own words. `atThree`: on a review
 * that went four with fewer of the wallet's boxes than three a mix would take, how many three would. Exported for
 * its test.
 */
export function FourSwitch({
  four,
  busy,
  onFour,
  atThree,
  testId,
}: {
  four: boolean;
  busy: boolean;
  onFour: (four: boolean) => void;
  atThree?: number;
  testId: string;
}) {
  const tr = useT();
  return (
    <div className="setting-row" data-testid={testId}>
      <span className="stack-tight">
        <span id={`${testId}-label`}>{tr("settings.lovejoin.four")}</span>
        <span className="note" id={`${testId}-note`}>
          {joinSentences([
            tr(four ? "settings.lovejoin.privacy.fourOn" : "settings.lovejoin.privacy.fourOff"),
            atThree !== undefined && tr("lovejoin.mix.atThree", { count: atThree }),
          ])}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={four}
        aria-labelledby={`${testId}-label`}
        aria-describedby={`${testId}-note`}
        onClick={() => onFour(!four)}
        disabled={busy}
        data-testid={`${testId}-switch`}
      />
    </div>
  );
}

/**
 * Mix my boxes again's switch on its review: the width the review was built at, whatever was asked, so it never says
 * four over a review three boxes wide, where four went three or a rebuild at it failed. It said the page's width, set
 * before the rebuild, while the rows and Send's build stayed at the other (1.6.0's release review, 320-screens#4,
 * 321-lj-screens#2). Turned, the review is built again at the other width. None on any other review. Exported for its
 * test.
 */
export function AgainSwitch({ review, busy, onFour }: { review: Reviewed; busy: boolean; onFour: (four: boolean) => void }) {
  const again = review.source === "private" ? review.summary.mix : review.summary;
  if (!again.again) return null;
  return <FourSwitch four={again.width === 4} busy={busy} onFour={onFour} atThree={again.atThree} testId="lovejoin-again-four" />;
}

/**
 * A review built again at the other width, its switch turned (`fourNow`): `rebuild` builds it, and the page takes the
 * width (`take`) only once it's in. One that fails leaves the page's width as it was, its error said, the review and
 * Send's build unchanged (1.6.0's release review, 320-screens#4, 321-lj-screens#2). Exported for its test.
 */
export async function widthTurned(fourNow: boolean, rebuild: (w: LovejoinWidth) => Promise<void>, take: (four: boolean) => void): Promise<void> {
  await rebuild(fourNow ? 4 : 3);
  take(fourNow);
}

/**
 * What the side that pays holds, beside the boxes' count: its ADA, and in a token pool its token, none of it too, as
 * the swap card shows what's held (the owner's test of 1.6.0, 2026-10-19: the form never said how much could go in).
 * The spendable side, as the page has it; hidden with the balances. `mixable`: the public side is what a mix can spend
 * (publicSideOf), and its label says so (1.6.0's review of the fixes, R3-27). Exported for its test.
 */
export function HeldOnSide({
  source,
  side,
  token,
  mixable,
  testId,
}: {
  source: Source;
  side?: Pick<Balances["seedelf"], "lovelace" | "tokens">;
  token?: TokenQuantity;
  mixable?: boolean;
  testId: string;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  if (!side) return null;
  const held = token && side.tokens.find((t) => t.policyId === token.policyId && t.assetName === token.assetName);
  const parts = [
    `${amounts.ada(side.lovelace)} ₳`,
    ...(token ? [amounts.text(tokenAmountText(network, held || { ...token, quantity: "0" }))] : []),
  ];
  const where = tr(source === "private" ? "lovejoin.mix.inPrivate" : mixable ? "lovejoin.mix.inPublicSpendable" : "lovejoin.mix.inPublic");
  return (
    <span className="field-held" title={where} data-testid={testId}>
      <WalletIcon size={14} />
      <span className="sr-only">{where}</span>
      {parts.join(" · ")}
    </span>
  );
}

/**
 * What a mix of `funding.boxes` boxes takes, all told, before anything is
 * built, from the page's side of it (blind test §9.8, T11: "costs about
 * 3.8 ₳" and "Into a one-time account 15.3 ₳, and 5 ₳ of collateral" didn't
 * reconcile, and the box's way back wasn't on the page). WebAssembly's plan
 * (`funding`, seedelf-core `funding_for`) is the boxes, their mixes at
 * MIX_FEE_ESTIMATE each, and a reserve (DEPOSIT_RESERVE, 1.5 ₳) for the
 * deposit's network fee and the change the chain leaves; what isn't built
 * yet is priced at ui/swap.ts's estimates. What the fees don't use comes
 * back.
 *
 * - `reserve`: the plan's ADA besides the boxes and their mixes.
 * - `tail`: from the private balance, what the funding pays besides for its
 *   collateral's mix (`tail` given, tailReserveOf); `tailFees`, what that mix
 *   uses up (COLLATERAL_MIX_COST), a cost; `tailBack`, the collateral back
 *   later as a box of its own, less its way back, rather than once it's
 *   mixed (1.6.0's release review, 320-screens#2, 321-lj-screens#4).
 * - `networkFees`: SESSION_FEE_ESTIMATE for each transaction besides the
 *   mixes (`txs`): from the private balance, this payment, the deposit and
 *   the return of what's left; from the public account, the deposit.
 * - `backFees`: bringing each box back (BOX_BACK_ESTIMATE), from the box.
 * - `cost`: the mixes, those network fees and the boxes' way back, and the
 *   collateral's mix where it's paid for.
 * - `leaving`: from the private balance, the plan, its collateral's reserve,
 *   the 5 ₳ kept aside and this payment's fee; from the public account, the
 *   boxes, their mixes and the deposit's fee. What else the account needs to
 *   start it stays there.
 * - `later`: what comes back hours later, each box less its way back.
 *   `soon`: what comes back once it's mixed, the 5 ₳ kept aside (unless it's
 *   mixed too) and what the reserves leave; none from the public account,
 *   whose change stays in it.
 */
export function mixCosts(funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees">, source: Source, box = BOX, tail = 0n) {
  const boxes = BigInt(funding.boxes) * box;
  const mixFees = BigInt(funding.mixFees);
  const reserve = BigInt(funding.lovelace) - boxes - mixFees;
  const paid = source === "private" ? tail : 0n;
  const tailFees = paid ? COLLATERAL_MIX_COST : 0n;
  const tailBack = paid ? COLLATERAL - BOX_BACK_ESTIMATE : 0n;
  const txs = source === "private" ? 3 : 1;
  const networkFees = BigInt(txs) * SESSION_FEE_ESTIMATE;
  const backFees = BigInt(funding.boxes) * BOX_BACK_ESTIMATE;
  const cost = mixFees + networkFees + backFees + tailFees;
  const leaving = (source === "private" ? BigInt(funding.lovelace) + paid + COLLATERAL : boxes + mixFees) + SESSION_FEE_ESTIMATE;
  const later = boxes - backFees;
  const soon = leaving - cost - later - tailBack;
  return {
    boxes,
    mixFees,
    reserve,
    tail: paid,
    tailFees,
    tailBack,
    txs,
    networkFees,
    backFees,
    cost,
    leaving,
    later,
    soon: soon > 0n ? soon : 0n,
  };
}

/**
 * The Mix form's Back later row: about what each box brings back (`later`, all of them, from mixCosts), its token too,
 * and after how long. None in a pool whose boxes can't pay their own way back today (`cantComeBack`): they wait for
 * the fees, as the callout above says, and the row promised each back after its wait (session 5's cross-area review,
 * M1). What bringing them back costs stays among the costs: still true. Exported for its test.
 */
export function EachBoxBackRow({
  funding,
  later,
  token,
  cantComeBack,
}: {
  funding: Pick<LovejoinFunding, "boxes" | "delay">;
  later: bigint;
  token?: BoxValue["token"];
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  const network = useNetwork();
  if (cantComeBack) return null;
  const ada = aboutAda(later / BigInt(funding.boxes));
  const delay = delayText(funding.delay);
  return (
    <Row
      label={tr("lovejoin.backLater")}
      value={
        token
          ? tr("lovejoin.mix.eachBoxBackToken", { count: funding.boxes, ada, token: tokenAmountText(network, token), delay })
          : tr("lovejoin.mix.eachBoxBack", { count: funding.boxes, ada, delay })
      }
      stack
    />
  );
}

/**
 * The Mix form's What leaves now and what comes back, adding up to what it costs, in the reviews' words; the reserve
 * in the 15.3 ₳ named (blind test §9.8, T11). The review gives this payment's fee exactly. A token pool's token goes
 * with the boxes' ADA, and comes back with each box. From the private balance, where the funding pays for its
 * collateral's mix too (`costs.tail`): that reserve goes into the one-time account and the total, as the review counts
 * it, and the 5 ₳ comes back later, as a box of its own, not once the boxes are mixed (1.6.0's release review,
 * 320-screens#2, 321-lj-screens#3, 321-lj-screens#4). Exported for its test.
 */
export function MixMoves({
  source,
  funding,
  costs,
  token,
  cantComeBack,
}: {
  source: Source;
  funding: LovejoinFunding;
  costs: ReturnType<typeof mixCosts>;
  token?: BoxValue["token"];
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  const network = useNetwork();
  return (
    <ReviewRows testId="lovejoin-mix-moves">
      {source === "private" ? (
        <>
          {/* The 15.3 ₳ and what it's made of, the reserve named (T11 asked whether 15.3 was 10 + 3.8 + 1.5). */}
          <Row
            label={tr("lovejoin.mix.intoOneTime")}
            value={withToken(network, adaText((BigInt(funding.lovelace) + costs.tail).toString()), funding.token)}
          />
          <Row
            label={tr("lovejoin.mix.partBoxes", { count: funding.boxes })}
            value={withToken(network, adaText(costs.boxes.toString()), funding.token)}
            part
          />
          <Row label={tr("lovejoin.mix.feesLabel")} value={adaText(funding.mixFees)} part />
          <Row label={tr("swaps.review.part.room")} value={tr("swaps.review.part.roomValue", { ada: formatAda(costs.reserve.toString()) })} part />
          {/* Its collateral's mix, paid in the same UTxO, in the review's own row's words. */}
          {costs.tail > 0n && (
            <Row label={tr("lovejoin.collateralReserve.label")} value={tr("lovejoin.collateralReserve.value", { ada: formatAda(costs.tail.toString()) })} part />
          )}
          <Row label={tr("lovejoin.review.itsCollateral")} value={tr("swaps.review.comesBack", { ada: formatAda(COLLATERAL.toString()) })} />
          <Row label={tr("lovejoin.mix.feeLabel")} value={adaText(toCents(SESSION_FEE_ESTIMATE))} />
          <Row
            label={tr("lovejoin.mix.totalPrivate")}
            value={withToken(network, adaText(toCents(costs.leaving)), funding.token)}
            strong
            testId="lovejoin-mix-leaving"
          />
          {/* What it's made of is the note under the rows. */}
          <Row label={tr("lovejoin.mix.backSoon")} value={adaText(toCents(costs.soon))} />
        </>
      ) : (
        <>
          <Row label={tr("lovejoin.mix.fromPublic")} value={publicNeedsText(network, funding)} stack />
          <Row
            label={tr("lovejoin.mix.totalPublic")}
            value={withToken(network, adaText(toCents(costs.leaving)), funding.token)}
            strong
            testId="lovejoin-mix-leaving"
          />
        </>
      )}
      <EachBoxBackRow funding={funding} later={costs.later} token={token} cantComeBack={cantComeBack} />
      {/* The collateral, mixed once in the pool of 5 ₳ boxes, back by itself after a box's wait. */}
      {costs.tailBack > 0n && (
        <Row
          label={tr("lovejoin.collateralBox.label")}
          value={tr("lovejoin.mix.eachBoxBack", { count: 1, ada: aboutAda(costs.tailBack), delay: delayText(funding.delay) })}
          stack
        />
      )}
    </ReviewRows>
  );
}

/**
 * A row whose label has an ⓘ, the text opening in the row, under it:
 * "Mixed 2 waves deep, 4 mixes", with what a wave is (it was explained only
 * in Settings and on the review, which a short pool never reaches: blind
 * test T11), and the network fees, with which transactions they are, which
 * as part of the value squeezed the label to a word a line (visual review).
 * `testId` names the text; the icon is `${testId}-hint`.
 */
function HintedRow({
  label,
  value,
  hint,
  testId,
  part,
}: {
  label: string;
  value: string;
  hint: string;
  testId: string;
  part?: boolean;
}) {
  const { open, toggle, id } = useHint();
  return (
    <div className={`review__row review__row--hinted${part ? " review__row--part" : ""}`}>
      <dt className="hinted">
        {label}
        <HintButton text={hint} open={open} onToggle={toggle} controls={id} testId={`${testId}-hint`} />
      </dt>
      <dd>{value}</dd>
      {open && (
        <dd className="note hint__text review__hint" id={id} data-testid={testId}>
          {hint}
        </dd>
      )}
    </div>
  );
}

/** A mix that's over: back, or never funded. */
const isOver = (s: SessionView) => s.stage === "closed" || s.stage === "failed";

/**
 * The running mixes' indexes, as one string: what the page's 20 s advance is keyed on. The 2 s watch replaces
 * the mixes with every read, and an advance keyed on them was torn down before it ever fired (release review C37).
 */
export const runningKey = (mixes: SessionView[]) =>
  mixes
    .filter((m) => !isOver(m))
    .map((m) => m.index)
    .join(",");

/** A mix of the wallet's boxes again that may still spend them: no box comes back meanwhile. */
const isMixingAgain = (s: SessionView) => !!s.mix?.again && !isOver(s) && !s.txs.some((t) => t.kind === "back");

/** A mix whose funding the chain hasn't shown, but which may still land: it can be looked for again. */
const unseen = (s: SessionView) => s.stage === "failed" && !s.unsent;

/** A mix that runs and hasn't started its chain: Stop brings it back directly, with no box going in. */
const stoppable = (s: SessionView) => !isOver(s) && !s.chain && !s.auto?.stopping;

/** A mix whose next try can be had now: one waiting to retry, or a funding to look for again. */
const retryable = (s: SessionView) => (!!s.auto?.retry && !isOver(s) && !s.chain?.stopped) || unseen(s);

/** A mix whose funding went in parts and fell short: nothing of it goes into Lovejoin, and Stop brings back what came. */
const short = (s: SessionView) => !!s.parts?.short && !s.auto?.stopping && !isOver(s);

/** A mix's tag. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") {
    return unseen(s) ? { tone: "wait", label: t("lovejoin.tag.notSeen") } : { tone: "bad", label: t("lovejoin.tag.notFunded") };
  }
  if (short(s)) return { tone: "wait", label: t("lovejoin.tag.short") };
  if (s.stage === "closed") {
    return s.mix?.skipped ? { tone: "off", label: t("lovejoin.tag.notMixed") } : { tone: "done", label: t("lovejoin.tag.done") };
  }
  if (s.auto?.stopping) return { tone: "live", label: t("lovejoin.tag.stopping") };
  if (s.auto?.retry) return { tone: "wait", label: t("lovejoin.tag.retrying") };
  return { tone: "live", label: t("lovejoin.tag.running") };
}

/** What a mix is doing, in a line: its chain sent, then on chain. A reason in full goes under it (detailOf). */
export function subOf(s: SessionView, now: number): string {
  if (s.stage === "failed") return t(unseen(s) ? "lovejoin.sub.fundingUnseen" : "lovejoin.sub.fundingFailed");
  if (s.stage === "funding") return t("lovejoin.sub.funding");
  if (short(s)) return t("lovejoin.sub.fundingShort", { landed: s.parts!.landed, total: s.parts!.total });
  if (s.mix?.skipped) return t("lovejoin.sub.skipped");
  // Its chain stopped before any of it went (a lock before its first send, a deposit turned away): nothing of it went
  // in, so while it isn't over the runner builds it again, through Lovejoin (buildBack's `started`), and nothing comes
  // back directly. It reads as a mix that goes on (the last review, L5); why it stopped is said under it (detailOf).
  const again = !!s.auto && s.stage !== "closed" && !!s.chain?.stopped && !s.chain.cut && s.chain.sent === 0;
  if ((s.chain?.cut || s.chain?.stopped) && !again) return chainText(s.chain, !s.auto);
  if (s.stage === "closed") return t("lovejoin.sub.since", { when: whenOf(s.createdAt, new Date(now)) });
  if (s.chain && !again) return chainText(s.chain, !s.auto);
  if (s.auto?.stopping) return t("lovejoin.sub.stopping");
  if (s.auto?.retry) return t("lovejoin.sub.retrying");
  // Found as the wallet unlocked, its next step waits a fresh draw of up to 20 minutes (privacy review §3.1).
  if (s.auto?.waitsUntil !== undefined && s.auto.waitsUntil > now) return t("lovejoin.sub.waiting");
  return t("lovejoin.sub.next");
}

/**
 * Why a mix stopped, was left out of Lovejoin (the pool below its floor, say),
 * or what went wrong and is tried again: in full, under its row. And what
 * stays at its account, if anything.
 */
export function detailOf(s: SessionView): string | undefined {
  const lines: string[] = [];
  // Each line a whole sentence, ended by its own key: a reason as it came (the network's refusal ends in the
  // node's raw words, with no stop) would run into the next line in Japanese, which sets nothing between them.
  if (s.mix?.skipped) lines.push(t("lj.leftOut", { reason: withoutStop(s.mix.skipped) }));
  if (s.chain?.stopped) lines.push(t("lovejoin.detail.whyStopped", { why: withoutStop(s.chain.stopped) }));
  if (s.auto?.retry && !isOver(s)) {
    // The wallet's language, as every time is, not the browser's; to the second, as a retry is often under a minute off.
    const at = new Date(s.auto.retry.at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    lines.push(t("lovejoin.detail.triesAgain", { at, error: withoutStop(s.auto.retry.error) }));
  }
  if (unseen(s)) lines.push(t("lovejoin.detail.mayLand"));
  if (short(s)) lines.push(t("lovejoin.detail.short"));
  // Turned away: why, when the worker knew (chunk 23's second review, DX-5).
  const why = s.stage === "failed" && s.unsent ? unsentWhyText(s.unsentWhy) : undefined;
  if (why) lines.push(why);
  if (s.leftBehind?.length) lines.push(t("lovejoin.detail.leftBehind", { count: s.leftBehind.length }));
  return lines.length ? joinSentences(lines) : undefined;
}

/** Whose a chain is: a session's, or the public account's mix. */
const chainName = (c: LovejoinChainView) =>
  c.session === undefined ? t("lovejoin.chain.fromPublic") : t("lovejoin.privateSession", { number: c.session + 1 });

/**
 * The wallet's chains through Lovejoin that aren't all sent: one being sent
 * holds every box back until it's done; one that stopped partway says why,
 * and the boxes it didn't mix wait for Mix my boxes again. One whose boxes
 * were all mixed again or brought back since isn't listed (lovejoin.ts
 * `shown`). `onOpen`: the page opens a transaction of one in its own view
 * (ChainTxs).
 */
export function Chains({ chains, onOpen }: { chains: LovejoinChainView[]; onOpen?: OpenChainTx }) {
  const amounts = useAmounts();
  const tr = useT();
  if (!chains.length) return null;
  return (
    <section className="section" aria-labelledby="lovejoin-chains-title">
      <h2 id="lovejoin-chains-title">{tr("lovejoin.chains.title")}</h2>
      <ul className="list" data-testid="lovejoin-chains">
        {chains.map((c) => (
          <li key={`${c.session ?? "public"}.${c.at}`} className="token-row swap-row">
            <span className="avatar avatar--contact" aria-hidden="true">
              <ShieldIcon size={16} />
            </span>
            <span className="token-row__label">
              {tr("lovejoin.chains.label", { whose: chainName(c), boxes: amounts.count(c.boxes, "amount.boxes") })}
            </span>
            <SwapTag
              {...(c.stopped
                ? { tone: "off" as const, label: tr("lovejoin.chains.stopped") }
                : { tone: "live" as const, label: tr("lovejoin.chains.sending") })}
            />
            {/* One stopped at a transaction that may have gone through says so (independent review L5). */}
            <span className="token-row__sub">
              {c.stopped
                ? tr(c.maybeSent ? "lovejoin.chains.afterMaybe" : "lovejoin.chains.after", { sent: c.sent, total: c.total })
                : tr("lovejoin.chains.sent", { sent: c.sent, total: c.total })}
              {/* Which width it went at (chunk 34's D3): said only where it's four. */}
              {c.width === 4 && ` · ${tr("lovejoin.mixes.four")}`}
            </span>
            <p className="token-row__detail" data-testid="lovejoin-chain-detail">
              {c.stopped
                ? tr("lovejoin.chains.whyStopped", { why: withoutStop(c.stopped) })
                : tr("lovejoin.chains.waitAll")}
            </p>
            {c.txs && <ChainTxs txs={c.txs} onOpen={onOpen} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opens a chain's transaction `txHash`, its `i`th, in Transaction details, held by the page. */
type OpenChainTx = (txHash: string, i: number) => void;

/**
 * Where each transaction of a chain being sent is: what its row says beside
 * it. One whose send began, or may have reached a node, is being sent, never
 * not sent yet (1.3.0's release review, C29).
 */
const TX_STATE: Record<LovejoinChainTx["state"], I18nKey> = {
  landed: "lovejoin.chains.tx.landed",
  sent: "lovejoin.chains.tx.sent",
  sending: "lovejoin.chains.tx.sending",
  waiting: "lovejoin.chains.tx.waiting",
};

/**
 * A chain's transactions while some of it is still to send, under its row:
 * each by what it is (the deposit, each mix, the return), opening in
 * Transaction details, with where it is. The review showed the one the money
 * goes in through; the rest are looked at here while they're sent. Once the
 * last is sent the wallet holds none of them, and the list goes, though up
 * to four may not be on chain yet; a chain of four or fewer goes whole at
 * once (at Send; from the private balance, in the runner's step once its
 * funding lands) and is never listed. The owner's words (2026-10-01) were
 * "audit is about the whole chain, afterwards", in Activity or the chain's
 * own row: keeping a sent chain's list until it lands is theirs to decide
 * (1.3.0's release review, C28). `onOpen`: the page holds the view it opens,
 * so this list going doesn't close it.
 */
function ChainTxs({ txs, onOpen }: { txs: LovejoinChainTx[]; onOpen?: OpenChainTx }) {
  const tr = useT();
  // Each mix by its place among the mixes: the deposit and the return aren't counted.
  const mixNumber = (i: number) => txs.slice(0, i + 1).filter((tx) => tx.kind === "mix").length;
  return (
    <details className="disclosure chain-txs" data-testid="lovejoin-chain-txs">
      <summary>{tr("lovejoin.chains.txs")}</summary>
      <ol>
        {txs.map((tx, i) => (
          <li key={tx.txHash} className="field-row">
            <TxDetailButton
              txHash={tx.txHash}
              label={
                tx.kind === "deposit"
                  ? tr("lovejoin.chains.tx.deposit")
                  : tx.kind === "back"
                    ? tr("lovejoin.chains.tx.back")
                    : tr("lovejoin.chains.tx.mix", { n: mixNumber(i) })
              }
              testId={`lovejoin-chain-tx-${i}`}
              onOpen={onOpen && (() => onOpen(tx.txHash, i))}
            />
            <span className="note">{tr(TX_STATE[tx.state])}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The box Bring one back anyway takes: one whose making Koios hasn't said of
 * yet first, after a restore, since it may well be mixed, while the others
 * surely aren't (independent review M14).
 */
export const anywayBox = (status?: Pick<LovejoinStatus, "notMixed" | "unsure">) => status?.unsure?.[0] ?? status?.notMixed[0];

/**
 * What Bring it back anyway's warning says of the box it takes (anywayBox).
 * After a restore, one a deposit made (`deposits`) is said as Koios said it,
 * never as the user's deposit or a stopped chain's: whose deposit it was,
 * and why no mix followed it, the wallet can't know (independent review M14).
 * Then the button that hides it first, unless mixing again is refused in the
 * pool (`againOff`, againRefused): there it named a button that was off
 * (session 5, call 34's check of every state's words). A box another public
 * account's deposit put in is said as that account's (`account`, its name):
 * "your public account" read as the one on screen, whose Mix again from my
 * public account doesn't take it (1.6.0's release review, x-privacy#0).
 */
export function anywayWarning(
  status?: Pick<LovejoinStatus, "notMixed" | "unsure" | "deposits" | "fromPublic">,
  againOff = false,
  account?: string,
): string {
  const box = anywayBox(status);
  const has = (list?: Array<{ txHash: string; txIndex: number }>) =>
    !!box && !!list?.some((b) => b.txHash === box.txHash && b.txIndex === box.txIndex);
  const found = has(status?.deposits);
  if (has(status?.unsure)) return t("lovejoin.anyway.privacy.untold");
  if (has(status?.fromPublic) && account !== undefined) {
    return joinSentences([
      t(found ? "lovejoin.anyway.privacy.publicDepositNamed" : "lovejoin.anyway.privacy.publicStoppedNamed", { account }),
      !againOff && t("lovejoin.anyway.privacy.hidesNamed", { account }),
    ]);
  }
  if (has(status?.fromPublic)) {
    return joinSentences([
      t(found ? "lovejoin.anyway.privacy.publicDeposit" : "lovejoin.anyway.privacy.publicStopped"),
      !againOff && t("lovejoin.anyway.privacy.hidesPublic"),
    ]);
  }
  return joinSentences([
    t(found ? "lovejoin.anyway.privacy.deposit" : "lovejoin.anyway.privacy.stopped"),
    !againOff && t("lovejoin.anyway.privacy.hides"),
  ]);
}

/**
 * Who pays for a box to come back where its own ADA can't (the owner's call 36), as `lovejoin-withdraw-now`'s `paid`
 * takes it: the private balance (`"private"`), the default, or the public account (`true`).
 */
export type Payer = "private" | true;

/**
 * What Bring one back anyway asks the worker for: the box anywayBox takes, as it is. In a pool whose boxes can't pay
 * their own way back, `paid` by the payer its question's button named: a box-paid withdraw is one core refuses there
 * (34g's last review, SCREENS-1), and the private balance pays by default (the owner's call 36).
 */
export function anywayRequest(status: Pick<LovejoinStatus, "notMixed" | "unsure">, paid?: Payer) {
  const box = anywayBox(status);
  return box ? { box, anyway: true as const, ...(paid ? { paid } : {}) } : undefined;
}

/**
 * What Bring one back of a Bootstrap's box asks the worker for: one someone else's mix has moved since it went in,
 * when there's one, as status lists those after the boxes still where the deposit put them; `paid` as for
 * anywayRequest.
 */
export function heldRequest(pool: Pick<ShownPool, "bootstrap">, paid?: Payer) {
  const box = pool.bootstrap?.at(-1);
  return box ? { box, ...(paid ? { paid } : {}) } : undefined;
}

/** What the escape hatch asks the worker for: one of the pool's boxes, paid by the payer its question's button named. */
export const hatchRequest = (pool: Pick<ShownPool, "id">, paid: Payer) => ({ pool: pool.id ?? CLASSIC_ID, paid });

/**
 * Whose box the escape hatch takes, where every box it can take is another public account's (`otherAccounts`): the
 * worker takes the account on screen's own, and those no public account put in, first, then another account's, the
 * lowest first (its hatchOrder). Its question names that account then (1.6.0's release review, R3-3). None while it may
 * take one of the others. It never takes a box not mixed yet, one Koios hasn't said the making of, or a Bootstrap's.
 * Exported for its test.
 */
export function hatchAccountOf(pool: Pick<ShownPool, "boxes" | "notMixed" | "unsure" | "bootstrap" | "otherAccounts">): number | undefined {
  const key = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
  const never = new Set([...pool.notMixed, ...(pool.unsure ?? []), ...(pool.bootstrap ?? [])].map(key));
  const others = new Map((pool.otherAccounts ?? []).map((b) => [key(b), b.account]));
  const accounts = pool.boxes.filter((b) => !never.has(key(b))).map((b) => others.get(key(b)));
  return accounts.length && accounts.every((a) => a !== undefined) ? Math.min(...(accounts as number[])) : undefined;
}

/**
 * The buttons of a question where a box comes back paid (the owner's call 36): Pay from my private balance first, the
 * default, `danger` as each of these confirms was (what comes back shows what it ties), then Pay from my public
 * account below it, a button as plain to see (a costed choice is never a link under the text), then the way to leave
 * it. Stacked: three side by side don't fit the popup. `testId` names each, by its question.
 */
function PayerButtons({ testId, keep, onKeep, onPay }: { testId: string; keep: string; onKeep: () => void; onPay: (paid: Payer) => void }) {
  const tr = useT();
  return (
    <div className="stack">
      <button type="button" className="danger" onClick={() => onPay("private")} data-testid={`${testId}-private`}>
        {tr("lovejoin.stuck.confirmPrivate")}
      </button>
      <button type="button" className="secondary" onClick={() => onPay(true)} data-testid={`${testId}-public`}>
        {tr("lovejoin.stuck.confirm")}
      </button>
      <button type="button" className="secondary" onClick={onKeep} data-testid={`${testId}-keep`}>
        {keep}
      </button>
    </div>
  );
}

/**
 * What each payer ties, in the order PayerButtons offers them, in the question's body (the owner's call 36). Where the
 * box is a public account's (`box`, its index: that account's deposit put it there, a Bootstrap's or a mix's cut short,
 * or, from the escape hatch, its mix's leaf) and the wallet has several, which accounts too: the private balance skips
 * money made private from another account where it can (the worker's order), and the account on screen paying for
 * another's box ties the two, which no question said (1.6.0's release review, x-privacy#0). Each in its own note, named
 * in it, never in a sentence after it, which made the question longer (R3-23).
 */
function PayerNotes({ box }: { box?: number }) {
  const tr = useT();
  const { accounts, active, several } = useAccounts();
  const named = several && box !== undefined;
  return (
    <>
      <p className="note">{tr(named ? "lovejoin.stuck.privacy.privateNamed" : "lovejoin.stuck.privacy.private")}</p>
      <p className="note">
        {named && box !== active
          ? tr("lovejoin.stuck.privacy.publicNamed", { account: nameOf(accounts, box), active: nameOf(accounts, active) })
          : tr("lovejoin.stuck.privacy.public")}
      </p>
    </>
  );
}

/**
 * Bring one back anyway's question: what the box it takes shows (anywayWarning), and the button that hides it first
 * unless mixing again is refused in the pool (`againOff`). In a stuck pool, who pays, with the escape hatch's words
 * and buttons, the private balance first (anywayRequest). A box another public account's deposit put in is said as
 * that account's, by name (`otherAccounts`; x-privacy#0). `onConfirm` is handed the payer chosen, none where nobody
 * pays. Exported for its test.
 */
export function AnywayQuestion({
  pool,
  stuck,
  againOff = false,
  onKeep,
  onConfirm,
}: {
  pool: Pick<LovejoinStatus, "notMixed" | "unsure" | "deposits" | "fromPublic" | "otherAccounts">;
  stuck: boolean;
  againOff?: boolean;
  onKeep: () => void;
  onConfirm: (paid?: Payer) => void;
}) {
  const tr = useT();
  const { accounts, active } = useAccounts();
  const taken = anywayBox(pool);
  const same = (b: { txHash: string; txIndex: number }) => !!taken && b.txHash === taken.txHash && b.txIndex === taken.txIndex;
  const unsure = !!pool.unsure?.some(same);
  // Whose deposit put it there, where a public account's did: the one on screen's, or another, named.
  const other = pool.otherAccounts?.find(same)?.account;
  const account = other ?? (pool.fromPublic.some(same) ? active : undefined);
  return (
    <Modal
      title={tr(unsure ? "lovejoin.anyway.titleUnsure" : "lovejoin.anyway.title")}
      titleId="lovejoin-anyway-title"
      onClose={onKeep}
      foot={
        stuck ? (
          <PayerButtons testId="lovejoin-anyway" keep={tr("lovejoin.anyway.keep")} onKeep={onKeep} onPay={onConfirm} />
        ) : (
          <>
            <button type="button" className="secondary" onClick={onKeep} data-testid="lovejoin-anyway-keep">
              {tr("lovejoin.anyway.keep")}
            </button>
            <button type="button" className="danger" onClick={() => onConfirm()} data-testid="lovejoin-anyway-confirm">
              {tr("lovejoin.anyway.confirm")}
            </button>
          </>
        )
      }
    >
      <p className="note">{anywayWarning(pool, againOff, other !== undefined ? nameOf(accounts, other) : undefined)}</p>
      {stuck && <PayerNotes box={account} />}
    </Modal>
  );
}

/**
 * The escape hatch's question (chunk 34's §2): one of the pool's boxes back, paid from the private balance, the
 * default, or from the public account (the owner's call 36), each saying what it ties. `account`: where every box it
 * can take is another public account's, that one (hatchAccountOf), named as PayerNotes names it (1.6.0's release
 * review, R3-3); asked for, so a call that forgets it fails the typecheck. `onConfirm` is handed the payer chosen
 * (hatchRequest). Exported for its test.
 */
export function PaidQuestion({
  account,
  onKeep,
  onConfirm,
}: {
  account: number | undefined;
  onKeep: () => void;
  onConfirm: (paid: Payer) => void;
}) {
  const tr = useT();
  return (
    <Modal
      title={tr("lovejoin.stuck.title")}
      titleId="lovejoin-paid-title"
      onClose={onKeep}
      foot={<PayerButtons testId="lovejoin-paid" keep={tr("lovejoin.stuck.keep")} onKeep={onKeep} onPay={onConfirm} />}
    >
      <PayerNotes box={account} />
    </Modal>
  );
}

/**
 * Why mixing the wallet's boxes again in `pool` is refused now, if it is: a pool that takes no new box refuses it
 * (a box below the network's minimum; MONEY-3, narrowed by the owner's call 34), but a copy, where it deposits
 * nothing, only for its own other reasons (`again`; R2-2, R3-2). What turns the page's ways of mixing again off, and
 * what the words around them follow (34g's last review, SCREENS-3).
 */
export function againRefused(pool: Pick<LovejoinPoolStatus, "unusable">): LovejoinUnusable["why"] | undefined {
  return pool.unusable?.why === "superseded" ? pool.unusable.again : pool.unusable?.why;
}

/**
 * The wallet's boxes that a chain of its made and didn't finish mixing, or,
 * after a restore, that a deposit made (`deposits` of them): they never
 * come back by themselves. Those a deposit made are said as Koios said it,
 * never as a stopped chain's: the wallet can't know whose deposit it was,
 * or why no mix followed it. Mixing again takes them first: Mix again from
 * my public account those a mix from the active account made (`fromPublic`
 * of them), Mix my boxes again the rest, but for those another account's mix
 * made (`elsewhere`): neither takes them, and the note under the callout
 * says which account to switch to (OtherAccounts). Bring it back anyway
 * takes one as it is. After a restore, a box whose making Koios hasn't said
 * of yet (`unsure` of them) waits too, until it has, and Mix my boxes again
 * refuses meanwhile (independent review M14).
 */
export function NotMixed({
  count,
  fromPublic = 0,
  elsewhere = 0,
  unsure = 0,
  deposits = 0,
  againOff = false,
  busy,
  onAnyway,
}: {
  count: number;
  fromPublic?: number;
  elsewhere?: number;
  unsure?: number;
  deposits?: number;
  /** Mixing again is refused in the pool now (againRefused): no word sends the user to it (SCREENS-3). */
  againOff?: boolean;
  busy: boolean;
  onAnyway: () => void;
}) {
  const amounts = useAmounts();
  const tr = useT();
  if (!count) return null;
  // Those known not to be mixed, said first; the others (`unsure`) may be, and are said apart (independent review M14).
  const known = count - Math.min(unsure, count);
  const first = known || count;
  // How many is an amount too: while balances are hidden, it's "some" (privacy review §2.16).
  const many = amounts.hidden || first > 1;
  // What the sentences agree with: a hidden amount reads as several, however many it is.
  const agree = many ? 2 : 1;
  // After a restore, those a deposit made: as Koios said, never a stopped chain's or the user's deposit (M14).
  const found = Math.min(deposits, known);
  const stopped = known - found;
  const why = !found
    ? tr("lovejoin.warn.notMixed.why.stopped", { count: agree })
    : !stopped
      ? tr("lovejoin.warn.notMixed.why.deposit", { count: agree })
      : tr("lovejoin.warn.notMixed.why.both", {
          stopped: amounts.hidden ? tr("lovejoin.warn.notMixed.some") : tr("lovejoin.warn.notMixed.number", { count: stopped }),
          others: tr("lovejoin.warn.notMixed.theOther", { count: amounts.hidden || found > 1 ? 2 : 1 }),
        });
  // A mix from the public account made them: the account pays to mix them again, and the private balance stays out of it (§2.10).
  // Of those, the ones this account's buttons take: another account's mix's are that account's to mix again.
  const here = known - Math.min(elsewhere, known);
  const agreeHere = amounts.hidden || here > 1 ? 2 : 1;
  const takes = !here || againOff
    ? undefined
    : fromPublic >= here
      ? tr("lovejoin.warn.notMixed.takes.public", { count: agreeHere })
      : fromPublic > 0
        ? tr("lovejoin.warn.notMixed.takes.both")
        : tr("lovejoin.warn.notMixed.takes.private", { count: agreeHere });
  const asks = tr("lovejoin.warn.notMixed.asks");
  // Koios hasn't said how these went in: said as they are, without the number while balances are hidden.
  const tail = amounts.hidden ? tr("lovejoin.warn.notMixed.unsureTailHidden") : tr("lovejoin.warn.notMixed.unsureTail", { count: unsure });
  const lead = !known
    ? amounts.hidden
      ? tr("lovejoin.warn.notMixed.unsureAllHidden")
      : tr("lovejoin.warn.notMixed.unsureAll", { count: first })
    : amounts.hidden
      ? tr("lovejoin.warn.notMixed.leadHidden", { why })
      : tr("lovejoin.warn.notMixed.lead", { count: first, why });
  return (
    <Callout tone="warn" testId="lovejoin-not-mixed">
      <div className="stack-tight">
        <span>{!known ? joinSentences([lead, asks]) : joinSentences([lead, takes, unsure > 0 && tail, unsure > 0 && asks])}</span>
        <button type="button" className="link align-start" onClick={onAnyway} disabled={busy} data-testid="lovejoin-anyway">
          {tr("lovejoin.notMixed.anyway")}
        </button>
      </div>
    </Callout>
  );
}

/**
 * The wallet's boxes a Bootstrap holds in the pool (chunk 34's session 1, 6): they stay there for other people to mix
 * with, and never come back by themselves. Bring one back takes one by hand, after its own question (what a box
 * nobody has mixed shows); Bring them all back lets them come back by themselves, one at a time. How many is hidden
 * with the balances, as every count of boxes is (privacy review §2.16). In a pool whose boxes can't pay their own way
 * back (`stuck`), the note that they then come back by themselves is left out: they wait for the fees, as the pool's
 * callout and Bring them all back's question say (session 5's cross-area review, L2).
 */
export function BootstrapHeld({
  count,
  busy,
  mixingAgain = false,
  stuck = false,
  pressed,
  onOne,
  onAll,
}: {
  count: number;
  busy: boolean;
  mixingAgain?: boolean;
  stuck?: boolean;
  pressed?: string;
  onOne: () => void;
  onAll: () => void;
}) {
  const amounts = useAmounts();
  const tr = useT();
  if (!count) return null;
  return (
    <Callout tone="info" testId="lovejoin-held">
      <div className="stack-tight">
        <span>{tr("lovejoin.bootstrap.held", { count: amounts.hidden ? 2 : count, boxes: amounts.count(count, "amount.boxes") })}</span>
        <span>
          <button type="button" className="link" disabled={busy || mixingAgain} onClick={onOne} data-testid="lovejoin-held-one">
            {pressed === "held" ? tr("lovejoin.working") : tr("lovejoin.bootstrap.bringOne")}
          </button>
          {" "}
          <button type="button" className="link" disabled={busy} onClick={onAll} data-testid="lovejoin-held-all">
            {pressed === "release" ? tr("lovejoin.working") : tr("lovejoin.bootstrap.bringAll")}
          </button>
        </span>
        {!stuck && <span className="note">{tr("lovejoin.bootstrap.allNote")}</span>}
      </div>
    </Callout>
  );
}

/**
 * The question before a Bootstrap's boxes come back (1.6.0's release review, PRIV-5): one by hand (`all` false), or
 * all of them let go to come back by themselves (`all`), which asked nothing though each such box makes the link
 * bringing one back asks about. A box nobody has mixed since shows its way in and back out; one a public account's
 * Bootstrap put in ties that account too: the account on screen's (`fromAccount`), "your public account", or another's
 * (`others`, by index), named, as "your public account" read as the one on screen (1.6.0's release review,
 * x-privacy#0). In a pool whose boxes can't pay their own way back (`stuck`),
 * one comes back paid, from the private balance by default or the public account, each button saying who pays and
 * each note what it ties, as the escape hatch's (the owner's call 36); and all of them, let go, wait in the pool until
 * the fees allow, as the worker puts each off meanwhile (STUCK_WAIT_MS), which the question says: it said only that
 * each then comes back by itself, and nothing came back, with nothing saying why (the merged fixes' review, MERGED-2).
 * Letting them go stays offered: they then come back by themselves once the fees allow, with no one bringing them back
 * by hand. `onConfirm` is handed the payer chosen, none where nobody pays (heldRequest).
 */
export function HeldQuestion({
  all,
  stuck,
  fromAccount,
  others = [],
  onKeep,
  onConfirm,
}: {
  all: boolean;
  stuck: boolean;
  fromAccount: boolean;
  others?: number[];
  onKeep: () => void;
  onConfirm: (paid?: Payer) => void;
}) {
  const tr = useT();
  const { accounts, active } = useAccounts();
  const paying = stuck && !all;
  // The accounts that paid, by name, the last after "and", as a list says it.
  const names = others.map((index) => nameOf(accounts, index));
  const named = names.length < 2 ? (names[0] ?? "") : `${joinList(names.slice(0, -1))}${tr("histories.list.and")}${names.at(-1)}`;
  const keep = tr(all ? "lovejoin.bootstrap.keepAll" : "lovejoin.bootstrap.keep");
  return (
    <Modal
      title={tr(all ? "lovejoin.bootstrap.allTitle" : "lovejoin.bootstrap.oneTitle")}
      titleId="lovejoin-held-title"
      onClose={onKeep}
      foot={
        paying ? (
          <PayerButtons testId="lovejoin-held" keep={keep} onKeep={onKeep} onPay={onConfirm} />
        ) : (
          <>
            <button type="button" className="secondary" onClick={onKeep} data-testid="lovejoin-held-keep">
              {keep}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onConfirm()}
              data-testid={all ? "lovejoin-held-all-confirm" : "lovejoin-held-confirm"}
            >
              {tr(all ? "lovejoin.bootstrap.bringAll" : "lovejoin.bootstrap.bringOne")}
            </button>
          </>
        )
      }
    >
      <p className="note">
        {joinSentences([
          tr(all ? "lovejoin.bootstrap.privacy.all" : "lovejoin.bootstrap.privacy.one"),
          fromAccount && tr("lovejoin.bootstrap.privacy.account"),
          others.length > 0 && tr("lovejoin.bootstrap.privacy.accountNamed", { count: others.length, account: named }),
          all && stuck && tr("lovejoin.bootstrap.warn.allStuck"),
        ])}
      </p>
      {paying && <PayerNotes box={others[0] ?? (fromAccount ? active : undefined)} />}
    </Modal>
  );
}

/**
 * Which public accounts' Bootstraps put in `boxes`, those of a public account's a Bring one back or a Bring them all
 * back takes (heldPublic): the account on screen's (`fromAccount`), and the others, by index (`others`, from the pool's
 * `otherAccounts`), which HeldQuestion names (1.6.0's release review, x-privacy#0). Exported for its test.
 */
export function heldAccountsOf(pool: Pick<LovejoinPoolStatus, "otherAccounts">, boxes: Array<{ txHash: string; txIndex: number }>) {
  const otherOf = (b: { txHash: string; txIndex: number }) =>
    pool.otherAccounts?.find((o) => o.txHash === b.txHash && o.txIndex === b.txIndex)?.account;
  const others = [...new Set(boxes.flatMap((b) => otherOf(b) ?? []))].sort((a, b) => a - b);
  return { fromAccount: boxes.some((b) => otherOf(b) === undefined), others };
}

/**
 * The wallet's boxes in the pool that a mix from a public account put in (privacy review §2.10), by
 * `txHash#txIndex`: every account's (`all`), which the private balance leaves out; the active account's (`mine`),
 * which Mix again from my public account takes; and the other accounts (`accounts`, by index), each the one to
 * mix its own again.
 */
export function publicBoxesOf(status?: Pick<LovejoinStatus, "fromPublic" | "otherAccounts">) {
  const key = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
  const all = new Set((status?.fromPublic ?? []).map(key));
  const away = new Set((status?.otherAccounts ?? []).map(key));
  const mine = new Set([...all].filter((k) => !away.has(k)));
  const accounts = [...new Set((status?.otherAccounts ?? []).map((b) => b.account))].sort((a, b) => a - b);
  return { all, mine, accounts };
}

/**
 * Boxes a mix from another public account put in: that account mixes them again, which ties nothing new, so Mix
 * again from my public account leaves them out here. Which account, by the name the picker on Home shows.
 */
export function OtherAccounts({ accounts }: { accounts: number[] }) {
  const tr = useT();
  const { accounts: known } = useAccounts();
  return accounts.map((index) => (
    <p key={index} className="note" data-testid="lovejoin-other-account">
      {tr("lovejoin.otherAccount", { account: publicAccountName(known.find((a) => a.index === index) ?? { index }) })}
    </p>
  ));
}

/**
 * A pool page's buttons for the wallet's boxes in it, under its callouts: Mix again from my public account (the active
 * account's boxes, paid by it), Mix my boxes again (the rest, from the private balance), Bring one back now, and Pay
 * from my private balance anyway. Each way of mixing again counts the boxes it would take as the worker takes them,
 * leaving out those a Bootstrap holds (split), a public Bootstrap's among the account's: counted, they offered Mix
 * again where a Bootstrap held every box, and the worker answered that none was in the pool. In a pool that takes no
 * new box (`unusable`), every one is off, saying why under them as Mix says it, before the worker refuses it (the
 * merged fixes' review, MERGED-4). Exported for its test.
 */
export function AgainActions({
  pool,
  busy,
  mixingAgain,
  publicSending,
  pressed,
  onAgain,
  onAgainPublic,
  onNow,
  onAnyway,
}: {
  pool: ShownPool;
  busy: boolean;
  /** The wallet's boxes are being mixed again: nothing else mixes them, and none comes back, meanwhile. */
  mixingAgain: boolean;
  /** A public mix's chain is being sent: Mix again from my public account waits for it. */
  publicSending: boolean;
  /** Which of the page's buttons is working. */
  pressed?: string;
  onAgain: () => void;
  onAgainPublic: () => void;
  onNow: () => void;
  onAnyway: () => void;
}) {
  const tr = useT();
  const owned = pool.boxes.length;
  if (!owned) return null;
  const notMixed = pool.notMixed.length;
  const { all: theirs, mine: ownPublic } = publicBoxesOf(pool);
  const key = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
  const notMixedOf = (set: Set<string>) => pool.notMixed.filter((b) => set.has(key(b))).length;
  const publicNotMixed = notMixedOf(theirs);
  const ownNotMixed = notMixedOf(ownPublic);
  const held = pool.bootstrap?.length ?? 0;
  // What each way of mixing again takes: never a box a Bootstrap holds, as the worker leaves those out (MERGED-4).
  const holds = new Set((pool.bootstrap ?? []).map(key));
  // The other accounts to switch to: only those with a box mixing again takes. A public Bootstrap's held boxes are the
  // account's too, and none of its buttons takes them (34g's last review, SCREENS-2).
  const otherAccounts = [...new Set((pool.otherAccounts ?? []).filter((b) => !holds.has(key(b))).map((b) => b.account))].sort((a, b) => a - b);
  const unheld = (set: Set<string>) => [...set].filter((k) => !holds.has(k)).length;
  const fromAccount = unheld(ownPublic);
  const anyAccount = unheld(theirs);
  const privately = pool.boxes.filter((b) => !theirs.has(key(b)) && !holds.has(key(b))).length;
  // A pool that takes no new box: mixing again makes new boxes there too, so the worker refuses it (MONEY-3; since the
  // owner's call 34, only a box below the network's minimum: one whose boxes can't pay their own way back takes them).
  // But not in a copy: mixing again the boxes already in it makes no deposit, so nothing new goes in, and the worker
  // takes it there, under the floor and the other reasons as anywhere. Off there too, a box not mixed yet had no private
  // way out, while the callout above said Mix my boxes again takes it first (round two's review, R2-2). Where the pool's
  // other reasons refuse it in a copy too (`again`), off, in that reason's words: the page kept it on, and the worker
  // refused it on the press, where the same pool not a copy said so before (the last review, R3-2).
  const why = againRefused(pool);
  const unusable = why ? unusableText({ why }) : undefined;
  // Its boxes can't pay their own way back: a withdraw a box pays fails, so Bring one back now isn't offered, and the
  // callout above brings one back paid (the escape hatch).
  const stuck = !!pool.cantComeBack;
  // Bring one back now takes only a box known to be mixed: with every unheld box not mixed yet, the worker refuses it
  // with "Mix them again first", which is no way while mixing again is refused too (SCREENS-3). Bring one back anyway,
  // in the callout above, stays.
  const unmixed = new Set([...pool.notMixed, ...(pool.unsure ?? [])].map(key));
  const nowRefused = !!why && pool.boxes.every((b) => holds.has(key(b)) || unmixed.has(key(b)));
  return (
    <div className="stack">
      <OtherAccounts accounts={otherAccounts} />
      {/* The active account's boxes alone: paying for another's mixes would tie the two accounts (§2.10). */}
      {fromAccount > 0 && (
        <button
          type="button"
          className={ownNotMixed ? "primary" : "secondary"}
          disabled={busy || mixingAgain || publicSending || !!unusable}
          onClick={onAgainPublic}
          data-testid="lovejoin-again-public"
        >
          {pressed === "again-public" ? tr("common.building") : tr("lovejoin.againPublic")}
        </button>
      )}
      {privately > 0 && (
        <button
          type="button"
          className={notMixed > publicNotMixed ? "primary" : "secondary"}
          disabled={busy || mixingAgain || !!unusable}
          onClick={onAgain}
          data-testid="lovejoin-again"
        >
          {pressed === "again" ? tr("common.building") : tr("lovejoin.again")}
        </button>
      )}
      {/* Why no way of mixing again can be pressed, under them, as Mix says it under Review (MERGED-4). */}
      {unusable && (fromAccount > 0 || privately > 0 || anyAccount > 0) && (
        <p className="field-note" data-testid="lovejoin-again-why">
          {unusable}
        </p>
      )}
      {/* Only with a box no Bootstrap holds: those come back by hand, from the callout above (UI-5). */}
      {!stuck && owned > held && !nowRefused && (
        <button type="button" className="secondary" disabled={busy || mixingAgain} onClick={onNow} data-testid="lovejoin-now">
          {pressed === "now" ? tr("lovejoin.working") : tr("lovejoin.bringBackNow")}
        </button>
      )}
      {anyAccount > 0 && (
        <button
          type="button"
          className="link align-start"
          disabled={busy || mixingAgain || !!unusable}
          onClick={onAnyway}
          data-testid="lovejoin-again-anyway"
        >
          {tr("lovejoin.payPrivateAnyway")}
        </button>
      )}
      {mixingAgain && (
        <p className="note" data-testid="lovejoin-again-running">
          {tr("lovejoin.againRunning")}
        </p>
      )}
    </div>
  );
}

/**
 * Lovejoin's hub (chunk 34's session 1, 4, 5 and 13): the wallet's boxes in
 * every pool, the chains being sent, every mix followed until its last box is
 * back, then the pools grouped by token, each opening its own page (PoolPage),
 * and Start a pool (LovejoinLaunch). Every pool listed is genuine and finished:
 * that's all the wallet reads, the same for everyone.
 */
export function Lovejoin({
  seedelf,
  cardano,
  publicTotal,
  banner,
  onBack,
  onPending,
}: {
  /** The private balance: the stepper offers no more boxes than it pays for (chunk 23's second review, LJ-3). */
  seedelf: Balances["seedelf"];
  /** The public account, for the tokens the wallet holds there (the hub's order) and a public mix's token. */
  cardano?: Balances["cardano"];
  /**
   * The public account as Home shows it (Home's reviewTotals: its UTxOs, rewards and what's on its way back), for a
   * public review's "Public account after", as Send and Make private say it. Not worked out from `cardano`: Home hands
   * that down spendable, with the rewards a payment spends already in it (1.6.0's rehearsal, R9). None: no after line.
   */
  publicTotal?: string;
  /** Home's banner for the transaction it's watching: a withdraw or a mix sent from here shows in it. */
  banner?: ReactNode;
  onBack: () => void;
  onPending: (pending: PendingTx) => void;
}) {
  const tr = useT();
  const network = useNetwork();
  const [status, setStatus] = useState<LovejoinStatus>();
  // The chains' rows: status's, then read again while one is being sent (lovejoin-chains), from the device alone.
  const [rows, setRows] = useState<LovejoinChainView[]>([]);
  const lookChains = useCallback(() => call("lovejoin-chains", {}).then(setRows, () => undefined), []);
  // A chain's transaction open in Transaction details, held here: its list going (all sent, or stopped) doesn't
  // close it (1.3.0's release review, C28).
  const [opened, setOpened] = useState<{ txHash: string; i: number }>();
  const [mixes, setMixes] = useState<SessionView[]>([]);
  // Every mix, from either side and in any pool, until its last box is back (session 1, 5): the device alone.
  const [entries, setEntries] = useState<LovejoinMixView[]>([]);
  const lookEntries = useCallback(() => call("lovejoin-mixes", {}).then(setEntries, () => undefined), []);
  // Asked first: stopping a mix.
  const [asking, setAsking] = useState<{ stop: number }>();
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The last pool read failed: what the page showed from before isn't the pool now (LJ-5).
  const [readFailed, setReadFailed] = useState(false);
  // A pool's own page, by its id (none: the classic pool), opened from a token's list (`token`) or the hub; a token's
  // list of pools, by its group's key (the owner's test of 1.6.0); or Start a pool; nothing, the hub.
  const [view, setView] = useState<{ pool: string | undefined; token?: string } | { token: string } | { launch: true }>();
  const [query, setQuery] = useState("");

  // One pool read on open, and on Refresh; the mixes from the device's record.
  const load = useCallback(async () => {
    setReading(true);
    // The mix sessions, from the device's record, apart from the pool read: one that failed left Your mixes without
    // them, so a private mix read as a return of its session and lost its Stop and Try now (1.6.0's release review,
    // UI-6).
    const sessions = call("sessions", {}).then(
      (all) => setMixes(all.filter((x) => x.mix)),
      () => undefined,
    );
    try {
      const s = await call("lovejoin-status", {});
      setStatus(s);
      setRows(s.chains);
      setUpdatedAt(Date.now());
      setError(undefined);
      setReadFailed(false);
    } catch (e) {
      setError((e as Error).message);
      setReadFailed(true);
      // The chains need no pool read: listed from the device all the same.
      void lookChains();
    } finally {
      // So do the mixes in the list.
      void lookEntries();
      await sessions;
      setReading(false);
    }
  }, [lookChains, lookEntries]);

  /** Your mixes' Clear and Clear all: marked on the device, then the list read again from it (no Koios request). */
  const clear = async (keys: ClearKeys) => {
    try {
      await call("lovejoin-mixes-clear", keys);
      await Promise.all([lookEntries(), call("sessions", {}).then((all) => setMixes(all.filter((x) => x.mix)))]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The first read, and beside it the look for token pools launched since the wallet last looked (chunk 34's 34c),
  // once as the page opens: what it finds is read again at once, after the first read (lookForPools, R10).
  useEffect(() => {
    let live = true;
    const first = load();
    void lookForPools(first, () => (live ? load() : Promise.resolve()));
    return () => {
      live = false;
    };
  }, [load]);

  // A mix that runs takes its next step while the page is open, as the alarm would: keyed on which mixes run, not on
  // the list the watch below reads afresh every 2 s (runningKey).
  const running = runningKey(mixes);
  useEffect(() => {
    if (!running) return;
    const indexes = running.split(",").map(Number);
    const timer = setInterval(() => {
      void Promise.all(indexes.map((index) => call("session-advance", { index }))).then(
        (moved) => setMixes((was) => was.map((m) => moved.find((x) => x.index === m.index) ?? m)),
        () => undefined,
      );
    }, ADVANCE_EVERY_MS);
    return () => clearInterval(timer);
  }, [running]);

  // Its chain's progress, as it's sent and confirmed: the record alone, every few seconds, and the list of mixes with it.
  useSessionsWhile(
    mixes.some((m) => !isOver(m)),
    (all) => {
      setMixes(all.filter((x) => x.mix));
      void lookEntries();
    },
  );

  // The public mix being sent: how many of its transactions are in so far. Its Send sends the first few;
  // while the page is open, it sends the rest as blocks make room (the alarm does too, once a minute).
  const [sending, setSending] = useState<PublicProgress | null>(null);
  // A pool's page is sending a public mix's first transactions now: read every second for its button.
  const [sendingPublic, setSendingPublic] = useState(false);
  const publicRunning = !!sending && !sending.stopped;
  useEffect(() => {
    void call("lovejoin-mix-public-progress", {}).then(setSending, () => undefined);
  }, []);

  // The chains' rows, read again from the device while one is being sent (no Koios request): a chain all sent or
  // stopped since the pool was read leaves its row, or says so, rather than listing transactions the wallet no
  // longer holds; and the public mix's row never comes back, from the read at its Send, once its section goes
  // (1.3.0's release review, C28).
  const rowsSending = rows.some((c) => !c.stopped);
  useEffect(() => {
    if (!rowsSending) return;
    const timer = setInterval(() => {
      void lookChains();
      void lookEntries();
    }, CHAINS_EVERY_MS);
    return () => clearInterval(timer);
  }, [rowsSending, lookChains, lookEntries]);

  useEffect(() => {
    if (!sendingPublic && !publicRunning) return;
    const timer = setInterval(() => {
      call("lovejoin-mix-public-progress", { advance: !sendingPublic }).then(async (s) => {
        // All sent, or stopped, as the page sent the rest: the rows are read again first, so the mix's row from the
        // read at its Send never shows as its section goes.
        if (!sendingPublic && !s?.txs) await Promise.all([lookChains(), lookEntries()]);
        setSending(s);
      }, () => undefined);
    }, sendingPublic ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [sendingPublic, publicRunning, lookChains, lookEntries]);

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Stops a mix before its boxes go in: everything at its account comes back directly. */
  const stop = (index: number) => {
    setAsking(undefined);
    void act(async () => {
      const moved = await call("session-stop", { index });
      setMixes((was) => was.map((m) => (m.index === index ? moved : m)));
    });
  };

  /** A mix waiting to try again: now. */
  const retry = (index: number) =>
    act(async () => {
      const moved = await call("session-resume", { index });
      setMixes((was) => was.map((m) => (m.index === index ? moved : m)));
    });

  const pools = poolsOf(status);
  const holdings = [...seedelf.tokens, ...(cardano?.tokens ?? [])];

  if (view && "launch" in view) {
    return (
      <LovejoinLaunch
        seedelf={seedelf}
        publicTotal={publicTotal}
        pools={pools}
        holdings={holdings}
        banner={banner}
        onBack={() => setView(undefined)}
        onOpenPool={(id) => setView({ pool: id })}
        onSent={(pending) => {
          onPending(pending);
          void load();
        }}
      />
    );
  }
  // A copy pool the wallet has nothing in isn't listed (MERGED-1): one with its boxes is, flagged.
  const groups = groupPools(pools.filter(shownOnHub), holdings);
  // A token's own list of pools, from its tile (the owner's test of 1.6.0): each opens its page, and Back the grid.
  const tokenGroup = view && "token" in view && !("pool" in view) ? groups.find((g) => g.key === view.token) : undefined;
  if (tokenGroup && status) {
    const name = tokenGroup.token ? tokenText(network, tokenGroup.token).label : "ADA";
    return (
      <Screen
        title={name}
        titleId="lovejoin-token-title"
        onBack={() => setView(undefined)}
        aside={tr("lovejoin.pools.count", { count: tokenGroup.pools.length })}
        error={error}
      >
        {banner}
        <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load()} />
        <section className="section">
          <PoolGroupList group={tokenGroup} titled={false} onOpen={(id) => setView({ pool: id, token: tokenGroup.key })} />
        </section>
      </Screen>
    );
  }
  // A pool's page stays open through a read that fails, saying so, with what it last read (34f's review, 10).
  const page = view && "pool" in view ? poolNamed(pools, view.pool) : undefined;
  if (page && status) {
    return (
      <PoolPage
        key={page.id ?? "classic"}
        pool={page}
        pools={pools}
        seedelf={seedelf}
        cardano={cardano}
        publicTotal={publicTotal}
        banner={banner}
        reading={reading}
        updatedAt={updatedAt}
        readFailed={readFailed}
        mixingAgain={mixes.some(isMixingAgain)}
        sending={sending}
        onSendingPublic={setSendingPublic}
        onSending={setSending}
        onRefresh={load}
        // Back to its token's list where it was opened from one; a mix sent, to the hub, where it's followed.
        onBack={() => setView(view && "pool" in view && view.token ? { token: view.token } : undefined)}
        onHub={() => setView(undefined)}
        onPending={onPending}
      />
    );
  }

  // The public mix being sent shows its own progress below: the list takes the others.
  const chains = rows.filter((c) => !(sending && c.session === undefined));
  const listed = searchGroups(network, groups, query);
  const tokenPools = pools.some((p) => p.id !== undefined);
  return (
    <Screen
      title="Lovejoin"
      titleId="lovejoin-title"
      onBack={onBack}
      backDisabled={busy}
      aside={tr(tokenPools ? "lovejoin.asideTokens" : "lovejoin.aside")}
      error={error}
    >
      {banner}
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load()} />
      {status && !status.available && <p className="note">{tr("lj.notOnNetwork")}</p>}
      {/* Reading, or a read that failed: said so, never "None" from before or from nothing (LJ-5). */}
      {(!status || (status.available && readFailed)) && (
        <p className="note" data-testid="lovejoin-status-unread">
          {tr(readFailed && !reading ? "lovejoin.status.unread" : "lovejoin.status.reading")}
        </p>
      )}
      {status?.available && !readFailed && <YourBoxes pools={pools} />}

      <Chains chains={chains} onOpen={(txHash, i) => setOpened({ txHash, i })} />

      {sending && (
        <div className="stack" data-testid="lovejoin-public-sending">
          <p className="note">
            {tr("lovejoin.sending.lead")}{" "}
            {sending.stopped
              ? tr(sending.maybeSent ? "lovejoin.sending.stoppedMaybe" : "lovejoin.sending.stopped", {
                  sent: sending.sent,
                  total: sending.total,
                })
              : tr("lovejoin.sending.sent", { sent: sending.sent, total: sending.total })}
          </p>
          {sending.stopped && (
            <p className="token-row__detail">{tr("lovejoin.detail.whyStopped", { why: withoutStop(sending.stopped) })}</p>
          )}
          {!sending.stopped && sending.txs && <ChainTxs txs={sending.txs} onOpen={(txHash, i) => setOpened({ txHash, i })} />}
        </div>
      )}
      {/* A chain's transaction opened from either list above, held by the page: the list going doesn't close it. */}
      {opened && (
        <TxDetailModal txHash={opened.txHash} testId={`lovejoin-chain-tx-${opened.i}`} onClose={() => setOpened(undefined)} />
      )}

      <MixList
        entries={entries}
        sessions={mixes}
        chains={rows}
        pools={pools}
        busy={busy}
        onRetry={(index) => void retry(index)}
        onStop={(index) => setAsking({ stop: index })}
        onClear={(keys) => void clear(keys)}
      />

      {status?.available && !readFailed && (
        <section className="section stack" aria-labelledby="lovejoin-pools-title">
          <h2 id="lovejoin-pools-title">{tr("lovejoin.pools.title")}</h2>
          {/* Search once there's enough to search: by ticker, name, policy ID or fingerprint (session 1, 13). */}
          {groups.length > SEARCH_FROM && (
            <label className="search">
              <SearchIcon size={16} />
              <input
                type="search"
                value={query}
                placeholder={tr("lovejoin.pools.search")}
                aria-label={tr("lovejoin.pools.search")}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="lovejoin-pools-search"
              />
            </label>
          )}
          {/* A grid of tokens once there's more than ADA's to choose from (the owner's test of 1.6.0); ADA's alone keeps
              its rows, as the classic pool's hub read before (backward compatibility 7). */}
          {groups.length > 1 ? (
            listed.length > 0 && <PoolGrid groups={listed} onToken={(key) => setView({ token: key })} onPool={(id) => setView({ pool: id })} />
          ) : (
            listed.map((g) => <PoolGroupList key={g.key} group={g} onOpen={(id) => setView({ pool: id })} />)
          )}
          {!listed.length && (
            <p className="note" data-testid="lovejoin-pools-none">
              {tr("lovejoin.pools.noneMatch", { query: query.trim() })}
            </p>
          )}
          <StartedPools started={status.started} now={Date.now()} />
          {/* A button, not a link: starting a pool costs money (choices, not links). */}
          <button type="button" className="secondary" disabled={busy} onClick={() => setView({ launch: true })} data-testid="lovejoin-start-pool">
            {tr("lovejoin.start.open")}
          </button>
          {!tokenPools && (
            <p className="note" data-testid="lovejoin.start.warn.cost">
              {tr("lovejoin.start.warn.cost")}
            </p>
          )}
        </section>
      )}

      <WayBack />
      {asking && (
        <Modal
          title={tr("lovejoin.stop.title")}
          titleId="lovejoin-stop-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.stop.keep")}
              </button>
              <button type="button" className="danger" onClick={() => stop(asking.stop)} data-testid="lovejoin-stop-confirm">
                {tr("lovejoin.stop.confirm")}
              </button>
            </>
          }
        >
          <p className="note">{tr("lovejoin.stop.note")}</p>
        </Modal>
      )}
    </Screen>
  );
}

/**
 * The hub's look for token pools launched since the wallet last looked (chunk 34's 34c), once as it opens, beside its
 * first read (`first`). When the look changed the pools the wallet reads (`grew`), they're read again (`read`), once,
 * and only after that first read, so the first can't land over it. It was fire and forget: a wallet restored on a
 * fresh profile opened the hub while the look was still asking Koios, and the hub said "None" of its boxes, with the
 * classic pool alone, until Refresh, though the look then found two token pools and the worker read 8 of the
 * wallet's boxes in one (1.6.0's rehearsal, R10). Nothing more when it changed nothing, or failed. Exported for its
 * test.
 */
export async function lookForPools(first: Promise<unknown>, read: () => Promise<unknown>): Promise<void> {
  const looked = await call("lovejoin-look-for-pools", {}).catch(() => undefined);
  if (!looked?.grew) return;
  await first.catch(() => undefined);
  await read();
}

/** How far the public account's mix being sent has got (`lovejoin-mix-public-progress`). */
type PublicProgress = NonNullable<Requests["lovejoin-mix-public-progress"]["result"]>;

/** The hub's search shows once there are more token groups than this. */
const SEARCH_FROM = 4;

/**
 * How long after a start was sent a look should have found it: its block, the 10 minutes a launch's block settles
 * (lovejoin-pools.ts SETTLE_MS) and a look's 5 minutes, with room to spare (1.6.0's release review, 320-screens#0).
 */
const STARTED_FOUND_MS = 30 * 60_000;

/**
 * The hub's line for each start the wallet sent that no look has found yet (status `started`, kept a day): every
 * wallet finds it once its block has settled (34c). Past STARTED_FOUND_MS, that it hasn't shown, and what that may
 * mean: its start didn't go through, or an earlier one of the same values did, which makes it a copy no wallet shows,
 * what it locked gone for good. It said for a day that it was on its way, then went without a word (1.6.0's release
 * review, 320-screens#0). Exported for its test.
 */
export function StartedPools({ started, now }: { started?: LovejoinStatus["started"]; now: number }) {
  const tr = useT();
  return (started ?? []).map((s) => {
    const when = whenOf(s.at, new Date(now));
    return (
      <p key={s.txHash} className="note" data-testid="lovejoin-started">
        {now - s.at < STARTED_FOUND_MS
          ? tr("lovejoin.pools.startedNotFound", { when })
          : joinSentences([tr("lovejoin.pools.startedMissing", { when }), tr("lovejoin.pools.warn.startedCopy")])}
      </p>
    );
  });
}

/**
 * The wallet's boxes in Lovejoin, as the hub's first rows: where they're all
 * in the classic pool, today's rows, word for word (backward compatibility
 * 7); across pools, how many in all, and each pool's below it. Then how many
 * aren't mixed yet, and when the next comes back. Hidden with the balances,
 * as every count of boxes is (privacy review §2.16).
 */
export function YourBoxes({ pools }: { pools: ShownPool[] }) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  const holding = pools.filter((p) => p.boxes.length > 0);
  const owned = holding.reduce((sum, p) => sum + p.boxes.length, 0);
  const notMixed = pools.reduce((sum, p) => sum + p.notMixed.length, 0);
  const unsure = pools.reduce((sum, p) => sum + (p.unsure?.length ?? 0), 0);
  // The next due among the pools whose boxes come back by themselves: not one whose boxes can't pay their own way back,
  // whose due times the worker only puts off (session 5's cross-area review, L2).
  const next = pools
    .filter((p) => p.boxes.length > p.notMixed.length && !p.cantComeBack)
    .flatMap((p) => p.due.slice(0, 1))
    .sort((a, b) => a - b)[0];
  const one = holding.length === 1 ? holding[0]! : undefined;
  const onlyClassic = pools.every((p) => p.id === undefined || !p.boxes.length);
  return (
    <ReviewRows testId="lovejoin-status">
      <Row
        label={tr(pools.length > 1 && !onlyClassic ? "lovejoin.row.yoursAll" : "lovejoin.row.yours")}
        value={
          !owned
            ? tr("lovejoin.row.none")
            : one
              ? valueOfBoxes(network, one, amounts)
              : amounts.count(owned, "amount.boxes")
        }
        strong
      />
      {/* Across pools: each one's, set in under the total. */}
      {holding.length > 1 &&
        holding.map((p) => (
          <Row key={p.id ?? "classic"} label={boxText(network, p.box)} value={valueOfBoxes(network, p, amounts)} part />
        ))}
      {notMixed > unsure && <Row label={tr("lovejoin.row.notMixed")} value={amounts.count(notMixed - unsure, "amount.boxes")} />}
      {unsure > 0 && <Row label={tr("lovejoin.row.notKnown")} value={amounts.count(unsure, "amount.boxes")} />}
      {owned > notMixed && next !== undefined && (
        <Row label={tr("lovejoin.row.nextBack")} value={next <= Date.now() ? tr("lovejoin.row.soon") : whenOf(next, new Date())} />
      )}
    </ReviewRows>
  );
}

/**
 * The wallet's boxes in pool `p` and what they hold: "3 boxes, 30 ₳" in the classic pool, as the page said it;
 * "2 boxes, 200 NIGHT + 9 ₳" in a token pool. Hidden with the balances.
 */
function valueOfBoxes(network: NetworkName, p: ShownPool, amounts: ReturnType<typeof useAmounts>): string {
  const boxes = amounts.count(p.boxes.length, "amount.boxes");
  if (!p.box.token) return t("lovejoin.row.yoursValue", { boxes, ada: amounts.ada(p.lovelace) });
  const token = p.token ?? { ...p.box.token, quantity: (BigInt(p.box.token.quantity) * BigInt(p.boxes.length)).toString() };
  return t("lovejoin.row.yoursValueToken", {
    boxes,
    token: amounts.text(tokenQuantity(network, token)),
    ticker: tokenText(network, token).label,
    ada: amounts.ada(p.lovelace),
  });
}

/**
 * The hub's pools as a grid of tokens (the owner's test of 1.6.0: "a grid where the token gets the token image"): one
 * tile a token, in groupPools' order (ADA's, those the wallet holds, then by crowd), each with its logo and ticker,
 * and under them the wallet's boxes in its pools (a count of boxes, hidden with the balances) or how many pools it
 * has. A token with one pool opens that pool's page, a list of one being a tap for nothing; one with more, its own
 * list (PoolGroupList), whose rows say each pool's crowd and flags. Exported for its test.
 */
/** What a token's tile opens: its one pool's page, or its list of pools. Exported for its test. */
export const tileOpens = (g: PoolGroup): { pool: string | undefined } | { token: string } =>
  g.pools.length === 1 ? { pool: g.pools[0]!.id } : { token: g.key };

export function PoolGrid({
  groups,
  onToken,
  onPool,
}: {
  groups: PoolGroup[];
  onToken: (key: string) => void;
  onPool: (id: string | undefined) => void;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  return (
    <ul className="pool-grid" data-testid="lovejoin-pool-grid">
      {groups.map((g) => {
        const name = g.token ? tokenText(network, g.token).label : "ADA";
        const mine = g.pools.reduce((n, p) => n + p.boxes.length, 0);
        const sub = mine > 0 ? amounts.count(mine, "amount.boxes") : tr("lovejoin.pools.count", { count: g.pools.length });
        const opens = tileOpens(g);
        return (
          <li key={g.key}>
            <button
              type="button"
              className="pool-tile"
              aria-label={joinList([name, sub])}
              onClick={() => ("token" in opens ? onToken(opens.token) : onPool(opens.pool))}
              data-testid={`lovejoin-token-${g.token ? g.key : "ada"}`}
            >
              <PoolAvatar token={g.token} />
              <span className="pool-tile__name">{name}</span>
              <span className="pool-tile__sub">{sub}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One token's pools on the hub: its name, then each pool by what a box holds,
 * its crowd, the wallet's boxes in it (hidden with the balances), and what
 * the pool's page has to say: boxes not mixed yet, held by a Bootstrap, a way
 * back the network's fees don't pay, a bootstrap under way, a pool the wallet
 * started. Each opens its page.
 */
export function PoolGroupList({
  group,
  onOpen,
  titled = true,
}: {
  group: PoolGroup;
  onOpen: (id: string | undefined) => void;
  /** Its token's name over the rows; none on the token's own screen, whose title it is. */
  titled?: boolean;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  const name = group.token ? tokenText(network, group.token) : undefined;
  return (
    <div className="stack-tight" data-testid={`lovejoin-group-${group.token ? group.key : "ada"}`}>
      {titled && (
        <h3 className="pool-group__title">
          {name ? name.label : "ADA"}
          {name && !name.listed && <span className="note"> {tokenMark(name)}</span>}
        </h3>
      )}
      <ul className="list">
        {group.pools.map((p) => {
          // A copy takes no box to start it with: never said to be being started beside the line saying so (MERGED-1).
          const progress = isCopy(p) ? undefined : bootstrapProgress(p);
          const flags = [
            progress && tr("lovejoin.pools.starting", { have: progress.have, floor: progress.floor }),
            p.notMixed.length > 0 && tr("lovejoin.pools.flag.notMixed", { n: amounts.hidden ? tr("home.lovejoin.some") : p.notMixed.length }),
            (p.bootstrap?.length ?? 0) > 0 && tr("lovejoin.pools.flag.held", { n: amounts.hidden ? tr("home.lovejoin.some") : p.bootstrap!.length }),
            // Whether or not the wallet has boxes there: a new box still goes in, and waits (the owner's call 34). Its
            // page says so before Review; the row said it only for the wallet's boxes.
            p.cantComeBack && tr("lovejoin.pools.warn.stuck"),
            p.mine && tr("lovejoin.pools.flag.mine"),
          ].filter((f): f is string => !!f);
          return (
            <li key={p.id ?? "classic"}>
              <button
                type="button"
                className="token-row"
                onClick={() => onOpen(p.id)}
                data-testid={`lovejoin-pool-${p.id ?? "classic"}`}
              >
                <PoolAvatar token={group.token} />
                <span className="token-row__label">{boxText(network, p.box)}</span>
                <span className="token-row__amount">{p.boxes.length ? amounts.count(p.boxes.length, "amount.boxes") : ""}</span>
                <span className="token-row__sub">{crowdText(p)}</span>
                {flags.length > 0 && (
                  <span
                    className={`token-row__detail${p.notMixed.length || p.cantComeBack ? "" : " token-row__detail--plain"}`}
                    data-testid="lovejoin-pool-flags"
                  >
                    {flags.join(tr("lovejoin.pools.flagJoin"))}
                  </span>
                )}
                {/* A pool that takes no new box, in the words its page says it in: only the page said it, and both
                    Mix again stayed on (the merged fixes' review, MERGED-4). A sentence of its own, so a line of its
                    own, never run into the flags. */}
                {p.unusable && (
                  <span className="token-row__detail" data-testid="lovejoin-pool-unusable">
                    {unusableText(p.unusable)}
                  </span>
                )}
                {progress && (
                  <span className="meter" aria-hidden="true">
                    <span className="meter__fill" style={{ width: `${progress.percent}%` }} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One card in Your mixes: a mix in the list, its private session's view when it has one, or such a view alone. */
export interface MixItem {
  key: string;
  at: number;
  entry?: LovejoinMixView;
  session?: SessionView;
}

/** How many mixes that are over Your mixes keeps showing, newest first, as Mixes from your private balance did. */
const OVER_SHOWN = 5;

/**
 * Your mixes (chunk 34's session 1, 5): every mix, from either side and in
 * any pool, listed until its last box is back, each saying enough to tell it
 * apart: what went in and where, who paid, how its transactions are going,
 * and whether a Bootstrap holds them. Not how many boxes are back: the pool's
 * page says that (the owner's test of 1.6.0). A mix from the private balance
 * keeps its session's stage and line, Stop and Try now, from its funding on;
 * once it's over and its boxes are all back, it stays with the last few that
 * are over, as before. Its chain's transactions are under Chains while it's
 * being sent.
 */
export function MixList({
  entries,
  sessions,
  chains,
  pools,
  busy,
  onRetry,
  onStop,
  onClear,
}: {
  entries: LovejoinMixView[];
  sessions: SessionView[];
  chains: LovejoinChainView[];
  pools: ShownPool[];
  busy: boolean;
  onRetry: (index: number) => void;
  onStop: (index: number) => void;
  /** Clears the mixes named from the list (Clear, Clear all); none given, no Clear is offered. */
  onClear?: (keys: ClearKeys) => void;
}) {
  const tr = useT();
  const [shown, setShown] = useState(MIXES_PAGE);
  const items = mixItems(entries, sessions);
  if (!items.length) return null;
  const done = items.filter(clearable);
  const page = items.slice(0, shown);
  const more = Math.min(MIXES_PAGE, items.length - page.length);
  return (
    <section className="section" aria-labelledby="lovejoin-mixes-title">
      <div className="field-row">
        <h2 id="lovejoin-mixes-title">{tr("lovejoin.yourMixes.title")}</h2>
        {/* Every mix not in flight, at once: Activity keeps their transactions (the owner's test of 1.6.0). */}
        {onClear && done.length > 0 && (
          <button type="button" className="link" disabled={busy} onClick={() => onClear(clearKeys(done))} data-testid="lovejoin-mixes-clear-all">
            {tr("lovejoin.mixes.clearAll")}
          </button>
        )}
      </div>
      <ul className="list" data-testid="lovejoin-mixes">
        {page.map((item) => (
          <MixCard
            key={item.key}
            item={item}
            chain={item.entry ? chainOf(chains, item.entry) : undefined}
            pools={pools}
            busy={busy}
            onRetry={onRetry}
            onStop={onStop}
            onClear={onClear && clearable(item) ? () => onClear(clearKeys([item])) : undefined}
          />
        ))}
      </ul>
      {/* Ten at a time: someone mixing a lot has a long list (the owner's test of 1.6.0). */}
      {more > 0 && (
        <button type="button" className="secondary" onClick={() => setShown((n) => n + MIXES_PAGE)} data-testid="lovejoin-mixes-more">
          {tr("tokens.showMore", { number: more })}
        </button>
      )}
    </section>
  );
}

/** How many of Your mixes show at first, and how many more each Show more adds. */
const MIXES_PAGE = 10;

/** What Clear sends for mixes `items`: each one's list entry by id, and its mix session by index. */
export interface ClearKeys {
  entries: string[];
  sessions: number[];
}

export const clearKeys = (items: MixItem[]): ClearKeys => ({
  entries: items.flatMap((i) => (i.entry ? [i.entry.id] : [])),
  sessions: items.flatMap((i) => (i.session ? [i.session.index] : [])),
});

/**
 * Whether mix `item` can be cleared from Your mixes: nothing of it in flight (the owner's test of 1.6.0). Its mix
 * session over, closed or its funding turned away (one whose funding may still land keeps Try again), and its chain
 * not being sent. Its boxes may still be out, held or not mixed yet: the pool's page says so. Exported for its test.
 */
export function clearable(item: MixItem): boolean {
  const { entry: e, session: s } = item;
  if (s && !(s.stage === "closed" || (s.stage === "failed" && !!s.unsent))) return false;
  return !(e?.chain && !e.chain.done && !e.chain.stopped);
}

/**
 * The cards, newest first: each mix in the list, with its session's view
 * where a private mix's session made it; each mix session not in the list
 * (its funding on its way, never sent, or over with its boxes all back), the
 * last few that are over among them.
 */
export function mixItems(entries: LovejoinMixView[], sessions: SessionView[]): MixItem[] {
  // Cleared ones are left out (the owner's test of 1.6.0); a cleared entry's session stays named as listed, so it
  // doesn't come back as a card of its own.
  const fromEntries: MixItem[] = entries.filter((e) => !e.cleared).map((e) => ({
    key: e.id,
    at: e.at,
    entry: e,
    ...(e.session !== undefined ? { session: sessions.find((s) => s.index === e.session && s.mix) } : {}),
  }));
  const listed = new Set(entries.flatMap((e) => (e.session !== undefined ? [e.session] : [])));
  const alone = sessions
    .filter((s) => s.mix && !listed.has(s.index))
    .sort((a, b) => b.createdAt - a.createdAt);
  const open = alone.filter((s) => !isOver(s));
  // The last few over, then those cleared left out: clearing them never brings older ones back in their place.
  const over = alone
    .filter(isOver)
    .slice(0, Math.max(0, OVER_SHOWN - open.length))
    .filter((s) => !s.mix?.cleared);
  return [...fromEntries, ...[...open, ...over].map((s) => ({ key: `session.${s.index}`, at: s.createdAt, session: s }))].sort(
    (a, b) => b.at - a.at,
  );
}

/** The chain row of mix `e`, while it's listed under Chains: the same record, so the same time and session. */
const chainOf = (chains: LovejoinChainView[], e: LovejoinMixView) => chains.find((c) => c.at === e.at && c.session === e.session);

/** A mix's card: what went in, where and from whom, and how it's going (Your mixes). */
function MixCard({
  item,
  chain,
  pools,
  busy,
  onRetry,
  onStop,
  onClear,
}: {
  item: MixItem;
  chain?: LovejoinChainView;
  pools: ShownPool[];
  busy: boolean;
  onRetry: (index: number) => void;
  onStop: (index: number) => void;
  /** Clears it from the list: only one not in flight (clearable). */
  onClear?: () => void;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  const { accounts } = useAccounts();
  const { entry: e, session: s } = item;
  // What a share's box holds: the classic pool's 10 ₳ whether it was read or not (none named is the classic pool); a
  // token pool's as read, and one not read this time by its id alone. After a pool read that failed, a classic mix
  // read "2 boxes in pool " and a token pool's mix session "2 boxes of 10 ₳" (1.6.0's release review, UI-6).
  const boxOf = (pool?: string) => (pool === undefined ? CLASSIC_BOX : poolNamed(pools, pool)?.box);
  const boxesIn = (pool: string | undefined, count: number) => {
    const box = boxOf(pool);
    const boxes = amounts.count(count, "amount.boxes");
    return box ? tr("lovejoin.mixes.boxesOf", { boxes, box: boxText(network, box) }) : tr("lovejoin.mixes.boxesIn", { boxes, pool: shortHex(pool ?? "", 8, 4) });
  };
  const shareText = (share: LovejoinMixView["shares"][number]) => boxesIn(share.pool, share.boxes);
  let label: string;
  let sub: string;
  let tag: { tone: SwapTone; label: string };
  let detail: string | undefined;
  if (e) {
    const what = e.shares.map(shareText).join(tr("histories.list.comma"));
    label = e.bootstrap ? tr("lovejoin.mixes.bootstrap", { what }) : e.again ? tr("lovejoin.mixes.againOf", { what }) : what;
    // A mix session's (its view is a mix's), or a swap's or a site's return; or the public account that paid.
    const whose =
      e.session !== undefined
        ? tr(s ? "lovejoin.privateSession" : "lovejoin.mixes.returnOf", { number: e.session + 1 })
        : accounts.length > 1
          ? publicAccountName(accounts.find((a) => a.index === e.account) ?? { index: e.account ?? 0 })
          : tr("lovejoin.chain.fromPublic");
    // How its transactions are going, not how many boxes are back: the pool's page says what's in it and when the next
    // comes back (the owner's test of 1.6.0, 2026-10-19). A private mix's session says it as 1.5.0's list did, its
    // transactions sent and then on chain, a retry and its error too; any other mix, from its chain's record while
    // the wallet keeps it, how many were sent.
    const stopped = !!e.chain?.stopped && !e.chain.done;
    const state = s
      ? subOf(s, Date.now())
      : e.chain
        ? stopped
          ? tr(e.chain.maybeSent ? "lovejoin.chains.afterMaybe" : "lovejoin.chains.after", { sent: e.chain.sent, total: e.chain.total })
          : tr("lovejoin.chains.sent", { sent: e.chain.sent, total: e.chain.total })
        : undefined;
    tag =
      s && !isOver(s)
        ? tagOf(s)
        : !s && e.chain && !e.chain.done && !stopped
          ? { tone: "live", label: tr("lovejoin.chains.sending") }
          : stopped
            ? { tone: "off", label: tr("lovejoin.chains.stopped") }
            : e.bootstrap && !e.released
              ? { tone: "off", label: tr("lovejoin.tag.held") }
              : s
                ? tagOf(s)
                : { tone: "done", label: tr("lovejoin.tag.done") };
    // Who paid and how, then the state, which reads as a sentence of its own ("Sending 3 of 6 transactions"): set apart
    // by a dot, as Activity's lines are. A Bootstrap's hold by its boxes' count, which the label says: "it" for one box
    // (1.6.0's release review, x-i18n-es#2); a count, so hidden with the balances, as the label's is.
    const boxes = e.shares.reduce((n, share) => n + share.boxes, 0);
    sub = [
      joinList(
        [
          whose,
          e.bootstrap && !e.released
            ? amounts.count(boxes, "lovejoin.mixes.held")
            : e.bootstrap
              ? amounts.count(boxes, "lovejoin.mixes.released")
              : undefined,
          e.chain?.width === 4 ? tr("lovejoin.mixes.four") : undefined,
        ].filter((x): x is string => !!x),
      ),
      state,
    ]
      .filter(Boolean)
      .join(" · ");
    // Its chain is said under Chains while it's listed there; once it's gone from there, why it stopped is said here.
    detail =
      joinSentences([
        s && detailOf(s),
        !chain && e.chain?.stopped && !e.chain.done ? tr("lovejoin.detail.whyStopped", { why: withoutStop(e.chain.stopped) }) : undefined,
      ]) || undefined;
  } else {
    label = s!.mix!.again
      ? tr("lovejoin.mixes.again", { boxes: amounts.count(s!.mix!.boxes, "amount.boxes") })
      : boxesIn(s!.mix!.pool, s!.mix!.boxes);
    tag = tagOf(s!);
    sub = subOf(s!, Date.now());
    detail = detailOf(s!);
  }
  const canRetry = !!s && retryable(s);
  const canStop = !!s && stoppable(s);
  return (
    <li className="token-row swap-row mix-card" data-testid="lovejoin-mix-card">
      <span className="avatar avatar--contact" aria-hidden="true">
        <ShieldIcon size={16} />
      </span>
      <span className="token-row__label">{label}</span>
      <SwapTag {...tag} />
      <span className="token-row__sub">{sub}</span>
      {(detail || canStop || canRetry || onClear) && (
        <p className="token-row__detail" data-testid="lovejoin-mix-detail">
          {detail}
          {/* After the detail's sentences, the language's gap; between two links, a space. */}
          {canRetry && (
            <>
              {detail ? sentenceGap() : null}
              <button type="button" className="link" disabled={busy} onClick={() => onRetry(s!.index)}>
                {tr(unseen(s!) ? "common.tryAgain" : "lovejoin.mixes.tryNow")}
              </button>
            </>
          )}
          {canStop && (
            <>
              {canRetry ? " " : detail ? sentenceGap() : null}
              <button type="button" className="link" disabled={busy} onClick={() => onStop(s!.index)} data-testid="lovejoin-mix-stop">
                {tr("lovejoin.mixes.stop")}
              </button>
            </>
          )}
          {onClear && (
            <>
              {canRetry || canStop ? " " : detail ? sentenceGap() : null}
              <button type="button" className="link" disabled={busy} onClick={onClear} data-testid="lovejoin-mix-clear">
                {tr("lovejoin.mixes.clear")}
              </button>
            </>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * A pool's own page (chunk 34's §9): what a box holds, the pool's crowd, the
 * wallet's boxes in it and when the next comes back, its launch, then Mix and
 * Bootstrap. Below the floor, Bootstrap leads, with how the bootstrap is
 * going. The classic pool's page says what Lovejoin's page said before, word
 * for word (backward compatibility 7).
 */
export function PoolPage({
  pool,
  pools = [],
  seedelf,
  cardano,
  publicTotal,
  banner,
  reading,
  updatedAt,
  readFailed,
  mixingAgain,
  sending,
  onSendingPublic,
  onSending,
  onRefresh,
  onBack,
  onHub,
  onPending,
}: {
  pool: ShownPool;
  /**
   * Every pool the page's read holds: the Mix form counts what a mix pays for its collateral's mix while the pool of
   * 5 ₳ boxes it would go into takes it (tailReserveOf). None: no such pool.
   */
  pools?: ShownPool[];
  seedelf: Balances["seedelf"];
  cardano?: Balances["cardano"];
  /** The public account as Home shows it, for a public review's after line (R9). */
  publicTotal?: string;
  banner?: ReactNode;
  reading: boolean;
  updatedAt?: number;
  /** The last read failed: what the page shows is from the read before (LJ-5). */
  readFailed: boolean;
  /** The wallet's boxes are being mixed again: no box comes back, and nothing else mixes them, meanwhile. */
  mixingAgain: boolean;
  sending: PublicProgress | null;
  /** A public mix's first transactions are being sent from here. */
  onSendingPublic: (sending: boolean) => void;
  onSending: (progress: PublicProgress | null) => void;
  onRefresh: () => Promise<void>;
  onBack: () => void;
  /** To the hub, where a mix sent is followed: Back's way where none is given. */
  onHub?: () => void;
  onPending: (pending: PendingTx) => void;
}) {
  const amounts = useAmounts();
  const tr = useT();
  const network = useNetwork();
  // Asked first: bringing back a box not mixed yet, mixing a public mix's boxes again from the private balance,
  // bringing back a box a Bootstrap holds, or one paid for to come back (the private balance or the public account).
  // `heldAll`: Bring them all back asks first too (1.6.0's release review, PRIV-5).
  const [asking, setAsking] = useState<{ anyway: true } | { privateAnyway: true } | { held: true } | { heldAll: true } | { paid: true }>();
  const [busy, setBusy] = useState(false);
  /** Which of the page's buttons is working. */
  const [pressed, setPressed] = useState<"now" | "again" | "again-public" | "anyway" | "held" | "release" | "paid">();
  const [error, setError] = useState<string>();
  const [source, setSource] = useState<Source>("private");
  const [boxes, setBoxes] = useState(1);
  /** How many a Bootstrap puts in, its own count: typed, so 30 isn't 30 presses. */
  const [bootstrapBoxes, setBootstrapBoxes] = useState<number>();
  // What the boxes take at the page's width (chunk 34's D3; the switch since the owner's test of 1.6.0).
  const [asked, setAsked] = useState<LovejoinFunding>();
  const [review, setReview] = useState<Review>();
  // A refused mix's funding: built again, or watched where it may have gone out (chunk 23's second review, DX-1).
  const [refusal, setRefusal] = useState<Refusal>();
  // Bootstrapping, behind its own link under Mix while the pool holds enough: it gives whoever puts it in nothing
  // (LJ-6; chunk 34: it replaces the seed). Below the floor it leads the page.
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  // The most a Bootstrap from the private balance puts in at once, as the worker holds it (its funding's reserves pay
  // the deposit and its way back for no more): asked once the form shows with that side chosen, a read of the
  // parameters as any build makes (1.6.0's release review, MONEY-6). None in a pool that takes no new box, which says
  // so itself.
  const [privateMost, setPrivateMost] = useState<number>();
  // A copy takes no new box for good (MERGED-1): no Bootstrap is offered there, so nothing asks its most (R2-2).
  const copy = isCopy(pool);
  const bootstrapShown = !copy && (bootstrapOpen || (pool.floor > 0 && pool.others < pool.floor));
  useEffect(() => {
    if (!bootstrapShown || source !== "private") return;
    let live = true;
    call("lovejoin-bootstrap-most", pool.id ? { pool: pool.id } : {}).then(
      ({ most }) => live && setPrivateMost(most),
      () => live && setPrivateMost(undefined),
    );
    return () => {
      live = false;
    };
  }, [bootstrapShown, source, pool.id]);
  // The public account's collateral, which a mix from it puts up, and its page, opened here while it isn't set.
  const [collateral, setCollateral] = useState<CollateralStatus>();
  const [collateralOpen, setCollateralOpen] = useState(false);
  const readCollateral = useCallback(() => call("collateral", {}).then(setCollateral, () => undefined), []);
  const box = BigInt(pool.box.lovelace);
  const token = pool.box.token;

  // Read when the public side is chosen, from the last reading (no request), and every 15 s while its payment is on
  // its way: Home's watch reads the balances again once it lands, wherever the user is, and this follows. At once,
  // from each new reading Home hands down, as Home's Public tab does: the page said the collateral was on its way for
  // up to 15 s after the banner said "Collateral set" (1.6.0's preprod rehearsal, R6).
  const collateralComing = source === "public" && collateral?.state === "waiting";
  const accountReading = readingOf(cardano);
  useEffect(() => {
    if (source !== "public") return;
    void readCollateral();
    if (!collateralComing) return;
    const timer = setInterval(() => void readCollateral(), COLLATERAL_EVERY_MS);
    return () => clearInterval(timer);
  }, [source, collateralComing, readCollateral, accountReading]);

  // The public account's UTxOs, read beside its collateral from each reading Home hands down (no request): what a mix
  // from it spends is its ADA alone, not all Home counts (publicMixAda; 1.6.0's release review, 321-lj-screens#1).
  // None, or a reading too large to keep: Home's figure, as before.
  const [accountUtxos, setAccountUtxos] = useState<UtxoInfo[]>();
  useEffect(() => {
    if (source !== "public") return;
    let live = true;
    call("utxos", {}).then(
      (lists) => live && setAccountUtxos(lists.cardano),
      () => live && setAccountUtxos(undefined),
    );
    return () => {
      live = false;
    };
  }, [source, accountReading]);

  /** Refresh: the pool, and from the public side its collateral again, from the last reading (R6: it didn't). */
  const refresh = async () => {
    if (source === "public") void readCollateral();
    await onRefresh();
  };

  // Four boxes a mix, this page's: Settings' until the switch is turned, on the Mix form or Mix my boxes again's
  // review (the owner's test of 1.6.0: "I dont have an option for that"). Every build from here asks its width.
  const { prefs, loaded: prefsLoaded } = usePreferences();
  const [fourChosen, setFour] = useState<boolean>();
  const four = fourChosen ?? (prefsLoaded && prefs.lovejoinWidth === 4);
  const roomWidth: LovejoinWidth = four ? 4 : 3;

  // What the chosen number of boxes takes in this pool, at the switch's width: WebAssembly and the settings, no Koios.
  useEffect(() => {
    let live = true;
    call("lovejoin-funding", { boxes, width: roomWidth, ...(pool.id ? { pool: pool.id } : {}) }).then(
      (f) => live && setAsked(f),
      () => live && setAsked(undefined),
    );
    return () => {
      live = false;
    };
  }, [boxes, pool.id, roomWidth]);

  // What a mix can take now, said before Review (chunk 23's second review, LJ-1, LJ-3): no more boxes than the
  // pool has others for at the set depth and the switch's width, nor than the side that pays pays for, its token too.
  // From the last pool read and WebAssembly's price of the boxes: no request of its own. At four, no more than fit at
  // four, and the reason says what three would take (formRoom).
  const roomAt = (w: number) => (asked ? poolRoom(pool, boxes, asked.depth, w) : undefined);
  const room = roomAt(roomWidth);
  const { most: roomMost, three: threeMost, chain: chainCaps } = formRoom(roomWidth, asked?.depth ?? 0, room, four ? roomAt(3) : undefined);
  const funding = asked;
  const width = funding?.width ?? 3;
  // The side that pays, its ADA and, for a token pool, its token: what it pays for (what's shown beside the count is
  // `shownSide`, below). From the public account, the ADA its chain spends (publicMixAda).
  // Worded by which it is (publicSideOf: 1.6.0's review of the fixes, R3-26, R3-27), and in a token pool what its
  // chain picks for this many boxes (R3-14).
  const { side: publicSide, mixable } = publicSideOf(cardano, accountUtxos, token, boxes);
  const side = source === "private" ? seedelf : publicSide;
  // What a mix from the private balance pays for its collateral's mix, while the pool of 5 ₳ boxes takes it: in the
  // form's figures where this many boxes leave room for it, never what caps the stepper or refuses (mixOffer: 1.6.0's
  // release review, 320-screens#2, 323-worker#0; its review of the fixes, R3-7). From the public account in a token
  // pool, the stepper counts the chain's own pick, count by count (R3-14).
  const { tokenMost, adaMost, affordable, most, tail, tailShort } = mixOffer(
    source,
    side,
    token,
    funding,
    box,
    roomMost,
    boxes,
    tailReserveOf(funding, source, pools),
    mixable ? accountUtxos : undefined,
  );
  // What's shown beside the count, and named where one box can't go: in a token pool, what the chain picks for the most
  // boxes the stepper offers, one where none fits. The count's own pick grew as + was pressed, and sat below what the
  // count offered costs (1.6.0's review of the fixes, the last look, LW-4). The cap above stays count by count.
  const shownSide = source === "private" ? seedelf : publicSideOf(cardano, accountUtxos, token, most || 1).side;
  // Fewer fit now than the stepper shows (another side chosen, a new read): it comes down to what does (boxesShown).
  useEffect(() => {
    const shown = boxesShown(boxes, most);
    if (shown !== boxes) setBoxes(shown);
  }, [most, boxes]);

  async function act(task: () => Promise<void>, button?: typeof pressed) {
    setBusy(true);
    setPressed(button);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPressed(undefined);
    }
  }

  const named = pool.id ? { pool: pool.id } : {};
  // Bringing one back from a pool's page takes one of its boxes, the classic pool's too: none named would be any pool's.
  const own = { pool: pool.id ?? CLASSIC_ID };

  // The worker may say no, and why: a chain being sent, the last withdraw maybe on its way, boxes not mixed yet.
  const now = () =>
    act(async () => {
      onPending(await call("lovejoin-withdraw-now", own));
      await onRefresh();
    }, "now");

  /**
   * Brings back a box not mixed yet, as it is: it shows where it went in (anywayBox, anywayWarning). In a pool whose
   * boxes can't pay their own way back, paid by the payer its question's button named (anywayRequest, SCREENS-1; the
   * owner's call 36).
   */
  const anyway = (paid?: Payer) => {
    const request = anywayRequest(pool, paid);
    setAsking(undefined);
    if (!request) return;
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", request));
      await onRefresh();
    }, "anyway");
  };

  /**
   * Brings back one box a Bootstrap holds (chunk 34's session 1, 6), as heldRequest picks it. In a pool whose boxes
   * can't pay their own way back, paid by the payer its question's button named (the owner's call 36).
   */
  const bringHeld = (paid?: Payer) => {
    const request = heldRequest(pool, paid);
    setAsking(undefined);
    if (!request) return;
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", request));
      await onRefresh();
    }, "held");
  };

  /**
   * Bring them all back: the Bootstraps' boxes come back by themselves from here, one at a time (round three, 24).
   * After its question, as Bring one back's (PRIV-5).
   */
  const releaseHeld = () => {
    setAsking(undefined);
    void act(async () => {
      await call("lovejoin-bootstrap-release", named);
      await onRefresh();
    }, "release");
  };

  /**
   * The escape hatch (chunk 34's §2): one of this pool's boxes back, paid from the private balance or the public
   * account, as its question's button named (the owner's call 36), which ties what pays to the box. Its question says
   * so first.
   */
  const paid = (by: Payer) => {
    setAsking(undefined);
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", hatchRequest(pool, by)));
      await onRefresh();
    }, "paid");
  };

  /** A mix from the private balance, reviewed: `build` builds it, now and again after a refusal (DX-1). */
  const privateReview = async (build: () => Promise<PrivateSummary>) =>
    setReview({ source: "private", summary: await build(), again: build });

  /**
   * Mix my boxes again's review, from the private balance: `anyway`, those a mix from the public account put in too;
   * `w`, four or three a mix.
   */
  const againReview = (anyway: boolean, w: LovejoinWidth) =>
    privateReview(() => call("lovejoin-again-build", { ...named, width: w, ...(anyway ? { anyway: true } : {}) }));

  /** Mix again from my public account's review: the boxes a mix from it put in, paid by the account (§2.10), at `w`. */
  const againPublicReview = async (w: LovejoinWidth) =>
    setReview({ source: "public", summary: await call("lovejoin-again-public-build", { ...named, width: w }) });

  /**
   * Mixes the boxes again from the private balance (againReview), at the page's width where none is given (its
   * review's switch builds it again at the other).
   */
  const again = (anyway = false, w: LovejoinWidth = roomWidth) => {
    setAsking(undefined);
    return act(() => againReview(anyway, w), "again");
  };

  /** Mixes the boxes a mix from the public account put in again (againPublicReview), at `w` as again's. */
  const againPublic = (w: LovejoinWidth = roomWidth) => act(() => againPublicReview(w), "again-public");

  /**
   * Mix my boxes again's review, its switch turned: the review built again at the other width, and the page's width
   * with it once that review is in (widthTurned). One that fails leaves both, and Send's build, as they were.
   */
  const againAt = (fourNow: boolean) => {
    if (!review) return;
    if (review.source === "private") {
      const anyway = !!review.summary.mix.publicToo;
      void act(() => widthTurned(fourNow, (w) => againReview(anyway, w), setFour), "again");
    } else void act(() => widthTurned(fourNow, againPublicReview, setFour), "again-public");
  };

  const reviewTitle = (r: Review) => {
    if (bootstraps(r)) return tr("lovejoin.review.bootstrap");
    return tr((r.source === "private" ? r.summary.mix.again : r.summary.again) ? "lovejoin.review.again" : "lovejoin.review.mix");
  };

  const build = () =>
    act(async () => {
      if (source === "private") await privateReview(() => call("lovejoin-mix-private-build", { boxes, width: roomWidth, ...named }));
      else setReview({ source, summary: await call("lovejoin-mix-public-build", { boxes, width: roomWidth, ...named }) });
    });

  /**
   * Bootstraps from whichever side is chosen, as a mix does: boxes in with no
   * mixes, held in the pool until brought back by hand. A mix needs other
   * people's boxes for each of its own, and the wallet's own never count
   * towards the floor, so an empty pool can only be started by someone
   * depositing into it for nothing. From the public account it's one deposit,
   * which spends no script and so needs no collateral; from the private
   * balance it's a one-time account funded by a Seedelf spend, which puts up
   * giveme.my's collateral as every Seedelf spend does, and deposits from
   * there.
   */
  const bootstrap = () =>
    act(async () => {
      if (source === "private") {
        await privateReview(() => call("lovejoin-mix-private-build", { boxes: putting, bootstrap: true, ...named }));
      } else setReview({ source, summary: await call("lovejoin-mix-public-build", { boxes: putting, bootstrap: true, ...named }) });
    });

  const send = async () => {
    if (!review || busy) return;
    setBusy(true);
    setError(undefined);
    if (review.source === "public") onSendingPublic(true);
    try {
      if (review.source === "private") {
        const { pending } = await call("lovejoin-mix-private-submit", { txHash: review.summary.txHash });
        onPending(pending);
      } else {
        onPending(await call("lovejoin-mix-public-submit", { txHash: review.summary.txHash }));
        onSending(await call("lovejoin-mix-public-progress", {}));
      }
      setReview(undefined);
      // Sent: the hub, where the mix is followed in Your mixes and a chain shows as it's sent.
      (onHub ?? onBack)();
      await onRefresh();
    } catch (e) {
      // A mix from the private balance recorded its session before it was sent, so Send can't go again: it's
      // built again, or watched from the hub's list of mixes (DX-1).
      const refused = review.source === "private" ? await refusalOf(e, review.summary.index, review.summary.txHash) : undefined;
      if (refused) setRefusal(refused);
      else setError((e as Error).message);
    } finally {
      onSendingPublic(false);
      setBusy(false);
    }
  };

  /** A refused mix, built afresh on the next unused account; back to the page when it can't be (DX-1). */
  const buildAgain = async () => {
    if (review?.source !== "private" || busy) return;
    // The refusal stays until the new review is in, so the button says Building…, never Sending….
    setBusy(true);
    setError(undefined);
    try {
      setReview({ ...review, summary: await review.again() });
    } catch (e) {
      setReview(undefined);
      setError((e as Error).message);
    } finally {
      setRefusal(undefined);
      setBusy(false);
    }
  };

  /** Leaves a review, and its alert with it (DX-1). */
  const leaveReview = () => {
    setReview(undefined);
    setRefusal(undefined);
    setError(undefined);
  };

  if (collateralOpen) {
    const back = () => {
      setCollateralOpen(false);
      void readCollateral();
    };
    return (
      <Collateral
        onBack={back}
        onSent={(pending) => {
          onPending(pending);
          back();
        }}
      />
    );
  }

  if (review) {
    const isBootstrap = bootstraps(review);
    return (
      <Screen
        title={reviewTitle(review)}
        titleId="lovejoin-review-title"
        review
        hint={reviewHint(review, pool.cantComeBack)}
        hintTestId="lovejoin-review-note"
        onBack={leaveReview}
        backDisabled={busy}
        aside={tr(isBootstrap ? "lovejoin.review.nothingSentBootstrap" : "lovejoin.review.nothingSent")}
        error={error}
        foot={
          refusal ? (
            <SessionRefusedFoot
              refusal={refusal}
              busy={busy}
              onAgain={() => void buildAgain()}
              onWatch={() => {
                leaveReview();
                (onHub ?? onBack)();
                void onRefresh();
              }}
            />
          ) : (
            // Building… while Mix my boxes again's switch builds the review again, and a public mix's progress only on a
            // public mix's review, never another's on a private one (1.6.0's release review, 320-screens#3).
            <SendButton
              label={tr(isBootstrap ? "lovejoin.review.bootstrapStart" : "lovejoin.review.start")}
              busy={busy}
              rebuilding={pressed === "again" || pressed === "again-public"}
              sending={review.source === "public" && sending ? tr("lovejoin.sendingOf", { sent: sending.sent, total: sending.total }) : undefined}
              onClick={() => void send()}
              testId="lovejoin-send"
            />
          )
        }
      >
        {/* A pool whose boxes can't pay their own way back: said on the review, which then promises none back after
            its wait (session 5's cross-area review, M1). Never the classic pool. */}
        {review.source === "private" ? (
          <PrivateReview summary={review.summary} before={homeBalance(seedelf)} box={pool.box} cantComeBack={pool.cantComeBack} />
        ) : (
          // "Public account after" in the pools new in 1.6.0 only: the classic pool's screens read byte for byte as
          // 1.5.x's (the plan's backward compatibility 7; fix round two, R9).
          <PublicReview summary={review.summary} box={pool.box} before={pool.id ? publicTotal : undefined} cantComeBack={pool.cantComeBack} />
        )}
        {/* Mix my boxes again's width, turned here: it's built again at the other (the owner's test of 1.6.0). The
            switch says the width this review is at (1.6.0's release review, 320-screens#4). */}
        {!refusal && <AgainSwitch review={review} busy={busy} onFour={againAt} />}
        {/* The chain's first transaction, not the one Send names: the account's
            money goes in there, and every mix after it only moves what that put
            in the pool, under rules nothing here could change (the owner,
            2026-10-01). A mix from the private balance is this one transaction —
            its chain is built later, when the session runs, against the pool as
            it is then. */}
        {review.source === "private" ? (
          <TxDetailButton txHash={review.summary.txHash} testId="lovejoin-tx" />
        ) : (
          <TxDetailButton txHash={review.summary.entry} label={entryLabel(review.summary)} testId="lovejoin-tx" />
        )}
        <p className="note" data-testid="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED()}
        </p>
      </Screen>
    );
  }

  const owned = pool.boxes.length;
  const notMixed = pool.notMixed.length;
  // The boxes a mix from a public account put in, and how many of those aren't mixed yet (§2.10): the private balance
  // leaves every account's out, and Mix again from my public account takes the active account's alone.
  const { all: theirs, mine: ownPublic } = publicBoxesOf(pool);
  const notMixedOf = (set: Set<string>) => pool.notMixed.filter((b) => set.has(`${b.txHash}#${b.txIndex}`)).length;
  const publicNotMixed = notMixedOf(theirs);
  const ownNotMixed = notMixedOf(ownPublic);
  // After a restore, those whose making Koios hasn't said of yet (independent review M14).
  const unsure = new Set((pool.unsure ?? []).map((b) => `${b.txHash}#${b.txIndex}`));
  const next = pool.due[0];
  // A token pool whose boxes can't pay their own way back today (chunk 34's escape hatch): said whether or not the
  // wallet has boxes there, before Review, since a mix, a Bootstrap and mixing again still put boxes in (the owner's
  // call 34). `stuck`: the wallet has boxes there, so one comes back only paid, which its questions ask (call 36).
  const cantComeBack = pool.cantComeBack;
  const stuck = !!cantComeBack && owned > 0;
  // The escape hatch takes a box known to be mixed that no Bootstrap holds, as the worker picks one: with none, it
  // was offered and refused, pointing at buttons that can't work there (SCREENS-1). Those boxes have their own.
  const hatchless = new Set([...pool.notMixed, ...(pool.unsure ?? []), ...(pool.bootstrap ?? [])].map((b) => `${b.txHash}#${b.txIndex}`));
  const hatchTakes = pool.boxes.some((b) => !hatchless.has(`${b.txHash}#${b.txIndex}`));
  // The pool can't be mixed in yet: a Bootstrap is the only thing that starts one. It's offered whatever the pool
  // holds (chunk 34's D2: "Bootstrap a pool, any time"), and leads the page while the pool is short. Never in a copy,
  // which takes no new box for good: there Mix says why, and nothing says to help start it (round two's review, R2-2).
  const short = !copy && pool.floor > 0 && pool.others < pool.floor;
  const progress = bootstrapProgress(pool);
  // What a Bootstrap may put in, as the worker holds it: one deposit's worth at most, from the private balance what
  // its reserves pay the deposit and its way back for; what it still needs is the default, and the user can type any
  // of it. And from the private balance, whether it holds too little for the boxes, the reserves and the fee, or for
  // the token (bootstrapLimits, MONEY-6).
  const { most: bootstrapMost, needed, putting, short: bootstrapShort, tokenShort } = bootstrapLimits(pool, source, seedelf, privateMost, bootstrapBoxes);
  // What the Bootstrap form shows the public account can spend: at its own count, as its deposit picks a token pool's
  // UTxOs for that many, never the Mix stepper's (publicSideOf, R3-14).
  const bootstrapSide = source === "private" ? seedelf : publicSideOf(cardano, accountUtxos, token, putting).side;
  // A token pool that takes no new box under today's parameters: Mix and Bootstrap are off, and say why before Review
  // (1.6.0's release review, MONEY-3). The worker refuses them too. Only a box below the network's minimum, or a copy,
  // since the owner's call 34: one whose boxes can't pay their own way back says so in its callout instead.
  const unusable = pool.unusable ? unusableText(pool.unusable) : undefined;
  // The wallet's boxes a Bootstrap holds in this pool: they never come back by themselves (chunk 34).
  const held = pool.bootstrap?.length ?? 0;
  // Of those, the ones a public account's Bootstrap put in that no mix has moved since: bringing one back ties that
  // account to the private balance, which both of their questions say (PRIV-5).
  const heldPublic = (pool.bootstrap ?? []).filter((b) => theirs.has(`${b.txHash}#${b.txIndex}`));
  const lastHeld = pool.bootstrap?.at(-1);
  // A box's share of the funding (its ADA and its mixes), and the first box's, which carries the rest (LJ-3), its
  // collateral's mix's reserve too where that's paid for.
  const perBox = funding ? box + BigInt(funding.mixFees) / BigInt(funding.boxes) : 0n;
  const firstBox = funding ? BigInt(funding.lovelace) - perBox * BigInt(funding.boxes - 1) + tail : 0n;
  const tokenName = token ? tokenText(network, token).label : "";
  // Why no more boxes than this, once the stepper stops: at ten too, a mix's most (the owner's test of 1.6.0).
  const capped =
    most >= 1 && boxes >= most
      ? most === MAX_BOXES
        ? tr("lovejoin.mix.capMix", { count: MAX_BOXES })
        : tokenMost === most && token
          ? tr(source === "private" ? "lovejoin.mix.capToken" : "lovejoin.mix.capTokenPublic", { count: most, token: tokenName })
          : affordable === most
            ? tr(source === "private" ? "lovejoin.mix.capBalance" : "lovejoin.mix.capBalancePublic", {
                count: most,
                per: formatAda(perBox.toString()),
              })
            : threeMost !== undefined
              ? // At four, the pool's room or one chain's length, whichever caps it: three a mix would take more (the
                // owner's test of 1.6.0; 1.6.0's review).
                tr(chainCaps ? "lovejoin.mix.capFourChain" : "lovejoin.mix.capFour", { count: most, three: threeMost })
              : tr("lovejoin.mix.capPool", { count: most })
      : undefined;
  // Not even one box can go, so − and + are both off (blind test T11): the pool's room, the token held, or the ADA of
  // the side that pays.
  const stuckForm =
    funding && most < 1
      ? room && !room.floorShort && room.fits < 1
        ? threeMost !== undefined
          ? tr("lovejoin.mix.noneFitFour", { count: threeMost })
          : tr("lovejoin.mix.noneFitPool")
        : token && tokenMost < 1
          ? tr(source === "private" ? "lovejoin.mix.noneToken" : "lovejoin.mix.noneTokenPublic", { token: tokenName })
          : tr(source === "private" ? "lovejoin.mix.noneAfford" : "lovejoin.mix.noneAffordPublic")
      : undefined;
  // What the mix takes, all told, and what comes back (blind test §9.8), its collateral's mix too where it's paid for.
  const costs = funding ? mixCosts(funding, source, box, tail) : undefined;
  // Why Review can't be pressed now (LJ-1, LJ-5, LJ-6): the pool under its floor, without enough other boxes for one
  // at this depth (and whether one wave deep would do), the token not held, or a private balance short of one box.
  const notNow = readFailed
    ? tr("lovejoin.status.unread")
    : unusable
    ? unusable
    : room?.floorShort
    ? joinSentences([t("lj.floorShortSentence", { count: pool.others, floor: pool.floor }), tr("lovejoin.pool.seedAbove")])
    : room && room.fits < 1
      ? joinSentences([
          tr("lovejoin.pool.tooFew", {
            count: room.have,
            need: mixesPerBox(funding!.depth, roomWidth) * (roomWidth - 1),
            deep: tr("lovejoin.deep", { count: funding!.depth }),
          }),
          tr(room.shallower ? "lovejoin.pool.shallower" : "lj.tryLater"),
        ])
      : token && tokenMost < 1
        ? tr(source === "private" ? "lovejoin.mix.noneToken" : "lovejoin.mix.noneTokenPublic", { token: tokenName })
        : funding && adaMost < 1
          ? source === "private"
            ? tr("lovejoin.mix.cantAfford", { first: formatAda(firstBox.toString()), held: amounts.ada(seedelf.lovelace) })
            : cantAffordPublic(formatAda(firstBox.toString()), amounts.ada(shownSide?.lovelace ?? "0"), mixable)
          : undefined;
  // Then, from the public account, its collateral: on its way, or not set, with the way to set it under the reason.
  const collateralShort = source === "public" && !!collateral && collateral.state !== "set";
  const cannot =
    notNow ??
    (collateralShort
      ? tr(collateral.state === "waiting" ? "lovejoin.mix.collateralComing" : "lovejoin.mix.needsCollateral")
      : undefined);
  const offerCollateral = !notNow && collateralShort && collateral.state === "none";
  const boxWords = boxText(network, pool.box);

  // Which side pays: the mix's, or below the floor, the Bootstrap's, which then leads the page.
  const sourceTabs = (
    <Tabs
      label={tr(short ? "lovejoin.bootstrap.from" : "lovejoin.mix.from")}
      prefix="lovejoin-"
      tabs={[
        { value: "private", label: tr("lovejoin.mix.private") },
        { value: "public", label: tr("lovejoin.mix.public") },
      ]}
      value={source}
      onChange={setSource}
    />
  );

  // Below the floor nothing can mix here yet: Mix says why in a line, and Bootstrap above leads (session 1, 16).
  const mixForm = short ? (
    <section className="section stack-tight" aria-labelledby="lovejoin-mix-title" data-testid="lovejoin-mix-short">
      <h2 id="lovejoin-mix-title">{tr("lovejoin.mix.title")}</h2>
      <p className="note" data-testid="lovejoin-mix-why">
        {joinSentences([t("lj.floorShortSentence", { count: pool.others, floor: pool.floor }), tr("lovejoin.pool.seedAbove")])}
      </p>
    </section>
  ) : (
    <section className="section stack" aria-labelledby="lovejoin-mix-title">
      <h2 id="lovejoin-mix-title">{tr("lovejoin.mix.title")}</h2>
      {sourceTabs}
      <div className="field" role="tabpanel" id={`lovejoin-panel-${source}`} aria-labelledby={`lovejoin-tab-${source}`}>
        <div className="field-row">
          <label htmlFor="lovejoin-boxes">{tr("lovejoin.mix.boxesOfLabel", { box: boxWords })}</label>
          <HeldOnSide source={source} side={shownSide} token={token} mixable={mixable} testId="lovejoin-held-balance" />
        </div>
        <div className="stepper">
          <button type="button" className="icon-button" aria-label={tr("lovejoin.mix.fewer")} disabled={boxes <= 1} onClick={() => setBoxes((b) => b - 1)}>
            −
          </button>
          <output id="lovejoin-boxes" className="stepper__value" data-testid="lovejoin-boxes">
            {boxesValue(network, pool.box, boxes)}
          </output>
          <button type="button" className="icon-button" aria-label={tr("lovejoin.mix.more")} disabled={boxes >= most} onClick={() => setBoxes((b) => b + 1)}>
            +
          </button>
        </div>
        {/* At its most below ten: why no more (LJ-3). */}
        {capped && (
          <p className="note" data-testid="lovejoin-boxes-cap">
            {capped}
          </p>
        )}
        {/* This many go without the collateral's reserve: said, never refused (R3-7). */}
        <CollateralIfLeft shown={tailShort && !notNow} />
        {/* Neither button can be pressed: why, beside them, not only under Review a screen further down (blind
            test T11). */}
        {stuckForm && (
          <p className="note" data-testid="lovejoin-boxes-none">
            {stuckForm}
          </p>
        )}
      </div>
      {/* This mix's width, Settings' until turned: at four the stepper stops at what fits four a mix, and says what
          three would take (the owner's test of 1.6.0). */}
      <FourSwitch four={four} busy={busy} onFour={setFour} testId="lovejoin-mix-four" />
      {funding && costs && (
        <ReviewRows testId="lovejoin-mix-cost">
          {/* What the pool has to mix with, before Review, not after it (LJ-1). */}
          {room && (
            <Row
              label={tr("lovejoin.pool.label")}
              value={
                room.floorShort
                  ? tr("lovejoin.pool.belowFloor", { count: pool.others, floor: pool.floor })
                  : room.have >= room.need
                    ? tr("lovejoin.pool.enough", { count: room.have })
                    : tr("lovejoin.pool.short", { count: room.have, need: room.need })
              }
            />
          )}
          <HintedRow
            label={tr("lovejoin.mixedLabel")}
            value={tr("lovejoin.mix.depthAndMixes", { count: funding.depth, mixes: tr("amount.mixes", { count: funding.mixes }) })}
            hint={tr(width === 4 ? "lovejoin.mix.privacy.wavesFour" : "lovejoin.mix.privacy.waves", {
              count: funding.depth,
              one: width ** funding.depth,
              mixes: mixesPerBox(funding.depth, width),
            })}
            testId="lovejoin-waves"
          />
          {/* In proportion: what mixing this much costs, as a share of it (chunk 23's review, D-3), and all of it:
              the mixes alone left out the network fees and the way back (blind test §9.8, T11). The rows set in
              under it are what it's made of, and add up to it. A token pool's share would price its token, which
              the wallet doesn't (chunk 34's session 1, 14): the cost alone. */}
          {token ? (
            <Row
              label={tr("lovejoin.mix.costOfBoxes", { boxes: tr("lovejoin.boxesOf", { count: funding.boxes, box: boxWords }) })}
              value={adaText(toCents(costs.cost))}
              strong
              testId="lovejoin-mix-total"
            />
          ) : (
            <Row
              label={tr("lovejoin.mix.costOf", { ada: formatAda(costs.boxes.toString()) })}
              value={tr("lovejoin.mix.feesShare", {
                ada: aboutAda(costs.cost),
                percent: formatPercent((Number(toCents(costs.cost)) / Number(costs.boxes)) * 100),
              })}
              strong
              testId="lovejoin-mix-total"
            />
          )}
          <Row label={tr("lovejoin.mix.feesLabel")} value={adaText(funding.mixFees)} part />
          <HintedRow
            label={tr("lovejoin.mix.networkLabel")}
            value={adaText(toCents(costs.networkFees))}
            hint={tr(source === "private" ? "lovejoin.mix.networkHintPrivate" : "lovejoin.mix.networkHintPublic", {
              each: aboutAda(SESSION_FEE_ESTIMATE),
              reserve: formatAda(costs.reserve.toString()),
            })}
            testId="lovejoin-network"
            part
          />
          <Row label={tr("lovejoin.mix.backLabel", { count: funding.boxes })} value={adaText(costs.backFees.toString())} part />
          {/* Its collateral's mix, where the funding pays for it: its deposit, its one mix and its box's way back
              (1.6.0's release review, 320-screens#2). */}
          {costs.tailFees > 0n && <Row label={tr("lovejoin.collateralMix.label")} value={adaText(toCents(costs.tailFees))} part />}
        </ReviewRows>
      )}
      {/* What leaves now and what comes back, adding up to what it costs, in the reviews' words (MixMoves). */}
      {funding && costs && <MixMoves source={source} funding={funding} costs={costs} token={token} cantComeBack={pool.cantComeBack} />}
      {/* That the wallet has to be unlocked for any of it to happen (LJ-2). Where each part ends up (LJ-7) is
          the rows' to say: what comes back once it's mixed, and what isn't used stays (copy-trim pass). */}
      <p className="note" data-testid="lovejoin-mix-rest">
        {tr("lovejoin.mix.whileUnlocked")}
      </p>
      {/* Before Review, not at the page's foot under everything else (D-3). */}
      <Callout tone="warn" testId="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED()}
      </Callout>
      <button
        type="button"
        className={short ? "secondary" : "primary"}
        disabled={busy || !funding || !!cannot}
        onClick={() => void build()}
        data-testid="lovejoin-mix"
      >
        {busy ? tr("common.building") : tr("common.review")}
      </button>
      {/* Why Review can't be pressed, under it, rather than found out after it (LJ-1, LJ-6). */}
      {cannot && (
        <p className="field-note" data-testid="lovejoin-mix-why">
          {cannot}
        </p>
      )}
      {offerCollateral && (
        <button type="button" className="secondary" disabled={busy} onClick={() => setCollateralOpen(true)} data-testid="lovejoin-set-collateral">
          {tr("collateral.set")}
        </button>
      )}
    </section>
  );

  const bootstrapForm = (
    <div className="stack" data-testid="lovejoin-bootstrap-offer">
      {short && <Callout tone="warn">{tr("lovejoin.bootstrap.warn.floor", { count: pool.others, floor: pool.floor })}</Callout>}
      {/* Below the floor the Mix section has no tabs: the side that pays is chosen here. */}
      {short && sourceTabs}
      <Callout tone="privacy">
        {joinSentences([
          tr("lovejoin.bootstrap.privacy.hidesNothing"),
          tr(source === "private" ? "lovejoin.bootstrap.privacy.fromPrivate" : "lovejoin.bootstrap.privacy.fromPublic"),
        ])}
      </Callout>
      <div className="field">
        <div className="field-row">
          <label htmlFor="lovejoin-bootstrap-boxes">{tr("lovejoin.bootstrap.boxesOfLabel", { box: boxWords })}</label>
          <HeldOnSide source={source} side={bootstrapSide} token={token} mixable={mixable} testId="lovejoin-bootstrap-held-balance" />
        </div>
        <input
          id="lovejoin-bootstrap-boxes"
          type="number"
          min={1}
          max={bootstrapMost}
          step={1}
          inputMode="numeric"
          value={bootstrapBoxes ?? needed}
          disabled={busy}
          onChange={(e) => setBootstrapBoxes(e.target.value === "" ? undefined : Math.floor(Number(e.target.value)))}
          data-testid="lovejoin-bootstrap-boxes"
        />
        <p className="note" data-testid="lovejoin-bootstrap-cost">
          {joinSentences([
            tr(source === "private" ? "lovejoin.bootstrap.costPrivateOf" : "lovejoin.bootstrap.costPublicOf", {
              count: putting,
              value: boxesValue(network, pool.box, putting, false),
            }),
            short && tr("lovejoin.bootstrap.needs", { count: needed }),
            // From the private balance, the most its funding's reserve pays the deposit for, once the worker said.
            source === "private" && privateMost !== undefined
              ? tr("lovejoin.bootstrap.atMostPrivate", { most: bootstrapMost })
              : tr("lovejoin.bootstrap.atMost", { most: bootstrapMost }),
          ])}
        </p>
      </div>
      <button
        type="button"
        className={short ? "primary" : "secondary"}
        disabled={busy || bootstrapShort || !!unusable}
        onClick={() => void bootstrap()}
        data-testid="lovejoin-bootstrap"
      >
        {tr("lovejoin.bootstrap.button", { count: putting })}
      </button>
      {/* A pool that takes no new box (MONEY-3); from the private balance, the obvious shortfall: said here, in its
          words, before a build (LJ-6). */}
      {(unusable || bootstrapShort) && (
        <p className="field-note" data-testid="lovejoin-bootstrap-why">
          {unusable ??
            (tokenShort
              ? tr("lovejoin.bootstrap.cantAffordToken", { token: tokenName })
              : tr("lovejoin.bootstrap.cantAfford", { held: amounts.ada(seedelf.lovelace) }))}
        </p>
      )}
    </div>
  );

  return (
    <Screen
      title={boxWords}
      titleId="lovejoin-pool-title"
      onBack={onBack}
      backDisabled={busy}
      aside={pool.id ? crowdText(pool) : tr("lovejoin.pool.asideClassic", { crowd: crowdText(pool) })}
      error={error}
    >
      {banner}
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void refresh()} />
      {readFailed && !reading && (
        <p className="note" data-testid="lovejoin-status-unread">
          {tr("lovejoin.status.unread")}
        </p>
      )}
      <ReviewRows testId="lovejoin-status">
        {/* What the wallet has in the pool is a balance, and so is how many boxes: hidden while balances are (launch review #56, privacy review §2.16). */}
        <Row label={tr("lovejoin.row.yours")} value={owned ? valueOfBoxes(network, pool, amounts) : tr("lovejoin.row.none")} strong />
        {notMixed > unsure.size && <Row label={tr("lovejoin.row.notMixed")} value={amounts.count(notMixed - unsure.size, "amount.boxes")} />}
        {unsure.size > 0 && <Row label={tr("lovejoin.row.notKnown")} value={amounts.count(unsure.size, "amount.boxes")} />}
        {/* Not where the boxes can't pay their own way back: the worker only puts their time off, and the callout below
            says how they come back (session 5's cross-area review, L2). */}
        {owned > notMixed && next !== undefined && !cantComeBack && (
          <Row label={tr("lovejoin.row.nextBack")} value={next <= Date.now() ? tr("lovejoin.row.soon") : whenOf(next, new Date())} />
        )}
      </ReviewRows>
      {/* A token pool's launch, on Cardanoscan: the public transaction every wallet found it by. */}
      {/* Where the data layer counted them: the deposits the pool's boxes could have come from (34c, 31). */}
      {pool.crowd && (
        <ReviewRows testId="lovejoin-crowd">
          <HintedRow
            label={tr("lovejoin.pool.depositsLabel")}
            value={tr("lovejoin.pool.depositsValue", { count: pool.crowd.deposits })}
            hint={tr("lovejoin.pool.depositsHint")}
            testId="lovejoin-deposits"
          />
        </ReviewRows>
      )}
      {pool.launch && (
        <div className="stack-tight">
          {/* One this wallet started, or a copy, listed only while the wallet has something in it (34g's last review,
              PRIVACY-3): opening it tells Cardanoscan, and the browser's history, it's of interest here. */}
          <ExplorerLink network={network} tx={pool.launch} private={!!pool.mine || copy} className="link align-start">
            {tr("lovejoin.pool.launch")}
          </ExplorerLink>
          {pool.mine && <p className="note">{tr("lovejoin.pool.mine")}</p>}
        </div>
      )}
      {/* A way back today's fees don't pay (chunk 34's §2): said before Review, the wallet's boxes there or not (the
          owner's call 34); with a box the escape hatch takes, the hatch, the user's call. */}
      {cantComeBack && (
        <Callout tone="warn" testId="lovejoin-stuck">
          <div className="stack-tight">
            <span>
              {tr("lovejoin.stuck.warn.lead", {
                has: formatAda(cantComeBack.has),
                needs: formatAda(cantComeBack.needs),
              })}
            </span>
            {hatchTakes && (
              <button type="button" className="link align-start" disabled={busy || mixingAgain} onClick={() => setAsking({ paid: true })} data-testid="lovejoin-paid">
                {pressed === "paid" ? tr("lovejoin.working") : tr("lovejoin.stuck.bring")}
              </button>
            )}
          </div>
        </Callout>
      )}
      <NotMixed
        count={notMixed}
        fromPublic={ownNotMixed}
        elsewhere={publicNotMixed - ownNotMixed}
        unsure={unsure.size}
        deposits={pool.deposits?.length ?? 0}
        againOff={!!againRefused(pool)}
        busy={busy || mixingAgain}
        onAnyway={() => setAsking({ anyway: true })}
      />
      <BootstrapHeld
        count={held}
        busy={busy}
        mixingAgain={mixingAgain}
        stuck={!!cantComeBack}
        pressed={pressed}
        onOne={() => setAsking({ held: true })}
        onAll={() => setAsking({ heldAll: true })}
      />
      <AgainActions
        pool={pool}
        busy={busy}
        mixingAgain={mixingAgain}
        publicSending={!!sending && !sending.stopped}
        pressed={pressed}
        onAgain={() => void again()}
        onAgainPublic={() => void againPublic()}
        onNow={() => void now()}
        onAnyway={() => setAsking({ privateAnyway: true })}
      />

      {/* Below its floor the pool needs boxes put in before anyone can mix: Bootstrap leads, with how it's going
          (session 1, 16). Above it, Bootstrap is offered behind its link, under Mix (D2: any time). */}
      {short && (
        <section className="section stack" aria-labelledby="lovejoin-bootstrap-title" data-testid="lovejoin-bootstrap-lead">
          <h2 id="lovejoin-bootstrap-title">{tr("lovejoin.bootstrap.title")}</h2>
          {progress && (
            <div className="stack-tight" data-testid="lovejoin-bootstrap-progress">
              <span className="meter meter--large" role="img" aria-label={tr("lovejoin.bootstrap.progress", { have: progress.have, floor: progress.floor })}>
                <span className="meter__fill" style={{ width: `${progress.percent}%` }} />
              </span>
              <span className="note">{tr("lovejoin.bootstrap.progress", { have: progress.have, floor: progress.floor })}</span>
            </div>
          )}
          {bootstrapForm}
        </section>
      )}
      {mixForm}
      {/* Not in a copy, which takes no new box for good: off with its reason, Bootstrap pointed to a way the worker
          never takes there (R2-2). Mix, above, says why once. */}
      {!short && !bootstrapOpen && !copy && (
        <div className="stack-tight">
          <button type="button" className="link align-start" onClick={() => setBootstrapOpen(true)} data-testid="lovejoin-bootstrap-open">
            {tr("lovejoin.bootstrap.open")}
          </button>
          <p className="note" data-testid="lovejoin-bootstrap-short">
            {tr("lovejoin.bootstrap.privacy.short")}
          </p>
        </div>
      )}
      {!short && bootstrapOpen && !copy && bootstrapForm}

      {/* Every box of the wallet's in this pool back now, behind its question (the owner's test of 1.6.0: "on that pool
          mix page, something that allows that pool specific"); Settings' brings back every pool's. */}
      <BringAllBack network={network} pool={pool.id ?? CLASSIC_ID} shown={owned > 0 || held > 0 || notMixed > 0} onOver={() => void onRefresh()} />

      <WayBack />
      {asking && "anyway" in asking && (
        <AnywayQuestion pool={pool} stuck={stuck} againOff={!!againRefused(pool)} onKeep={() => setAsking(undefined)} onConfirm={anyway} />
      )}
      {asking && "privateAnyway" in asking && (
        <Modal
          title={tr("lovejoin.privateAnyway.title")}
          titleId="lovejoin-again-anyway-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.privateAnyway.keep")}
              </button>
              <button type="button" className="danger" onClick={() => void again(true)} data-testid="lovejoin-again-anyway-confirm">
                {tr("lovejoin.payPrivateAnyway")}
              </button>
            </>
          }
        >
          <p className="note">{tr("lovejoin.privateAnyway.privacy.ties")}</p>
        </Modal>
      )}
      {/* Bringing back a Bootstrap's box: what one nobody has mixed shows, said first (chunk 34's 34a′, for 34d). */}
      {/* Bringing back a Bootstrap's boxes, one or all: what one nobody has mixed shows, said first, with the public
          account's part, and who pays where the pool's boxes can't pay their own way back (PRIV-5; call 36). */}
      {asking && ("held" in asking || "heldAll" in asking) && (
        <HeldQuestion
          all={"heldAll" in asking}
          stuck={stuck}
          {...heldAccountsOf(pool, "heldAll" in asking ? heldPublic : heldPublic.filter((b) => b === lastHeld))}
          onKeep={() => setAsking(undefined)}
          onConfirm={"heldAll" in asking ? releaseHeld : bringHeld}
        />
      )}
      {/* The escape hatch's question: who pays, the private balance first, and what each ties (chunk 34's §2; call 36). */}
      {asking && "paid" in asking && <PaidQuestion account={hatchAccountOf(pool)} onKeep={() => setAsking(undefined)} onConfirm={paid} />}
    </Screen>
  );
}

/**
 * The most boxes one Bootstrap of any pool but the classic puts in (the worker's mostBootstrap: MAX_TOKEN_DEPOSIT_BOXES
 * for every pool on the new scripts, an ADA pool's too).
 */
const MAX_TOKEN_BOOTSTRAP_BOXES = 64;

/**
 * What a Bootstrap's funding from the private balance carries beside its boxes: the deposit's reserve, which pays its
 * fee, and the way back's, which pays the sweep of what's left into the private balance, since it puts up no
 * collateral (seedelf-core's DEPOSIT_RESERVE and BOOTSTRAP_BACK_RESERVE, 1.5 ₳ each; 1.6.0's release review,
 * 318-rust#0). What neither uses comes back.
 */
const BOOTSTRAP_RESERVE = 3_000_000n;

/**
 * Why a token pool takes no new box, in the words the worker refuses one with (lovejoin.ts unusableReason): the pool's
 * page says it under Mix, Bootstrap and Mix again before Review, and the hub on its row (1.6.0's release review,
 * MONEY-3; the merged fixes' review, MERGED-4). A box below the network's minimum, which nothing can be built for, or
 * a copy (`superseded`), read for the boxes already in it and taking no new one, for good (MERGED-1). Boxes that can't
 * pay their own way back, or a check that couldn't be made, are no reason since the owner's call 34: the first is the
 * page's stuck callout. Keys, not words.
 */
const UNUSABLE: Record<LovejoinUnusable["why"], I18nKey> = {
  belowMinimum: "lj.unusable.warn.belowMinimum",
  superseded: "lj.unusable.warn.superseded",
};
export const unusableText = (u: LovejoinUnusable): string => t(UNUSABLE[u.why]);

/** How many boxes of `token` (each `token.quantity` of it) a balance's tokens hold; none known, none. */
export function tokenBoxes(tokens: TokenAmount[] | undefined, token: TokenQuantity): number {
  const held = tokens?.find((t) => t.policyId === token.policyId && t.assetName === token.assetName);
  return held ? Number(BigInt(held.quantity) / BigInt(token.quantity)) : 0;
}

/**
 * What the Bootstrap form offers in pool `pool`, paid from `source`, held to the worker's own bounds (1.6.0's release
 * review, MONEY-6 = UI-10): the form offered 96 for any pool without a token where the worker takes 64 in every pool
 * but the classic, 96 from the private balance where its funding's reserve pays the deposit for fewer, and left that
 * reserve out of what the balance must hold, so Review was refused after it was pressed.
 * - `most`: one deposit's (mostBootstrap), and from the private balance what its reserves pay the deposit and its way
 *   back for (`privateMost`, the worker's privateBootstrapMost) once known.
 * - `needed`: what the pool lacks of its floor, the form's default; `putting`: `asked` (or `needed`), 1 to `most`.
 * - `short`: the private balance holds too little for them: the boxes, the funding's reserves (BOOTSTRAP_RESERVE: the
 *   deposit's and the way back's) and the fee's room, no collateral (a deposit alone runs no script; the owner,
 *   2026-10-23); or too little of the pool's token (`tokenShort`).
 */
export function bootstrapLimits(
  pool: Pick<ShownPool, "id" | "box"> & Partial<Pick<ShownPool, "floor" | "others">>,
  source: Source,
  seedelf: { lovelace: string; tokens?: TokenAmount[] },
  privateMost?: number,
  asked?: number,
): { most: number; needed: number; putting: number; short: boolean; tokenShort: boolean } {
  const deposit = pool.id ? MAX_TOKEN_BOOTSTRAP_BOXES : MAX_BOOTSTRAP_BOXES;
  const most = source === "private" && privateMost !== undefined ? Math.max(1, Math.min(deposit, privateMost)) : deposit;
  const floor = pool.floor ?? 0;
  const others = pool.others ?? 0;
  const needed = floor > 0 && others < floor ? Math.min(floor - others, most) : 1;
  const putting = Math.min(Math.max(asked ?? needed, 1), most);
  const token = pool.box.token;
  const tokenShort = source === "private" && !!token && tokenBoxes(seedelf.tokens, token) < putting;
  const costs = BigInt(putting) * BigInt(pool.box.lovelace) + BOOTSTRAP_RESERVE + FEE_ROOM;
  return { most, needed, putting, short: source === "private" && (costs > BigInt(seedelf.lovelace) || tokenShort), tokenShort };
}

/**
 * The stepper's value: "2 boxes, 20 ₳" in the classic pool, as it was; "2 boxes, 200 NIGHT + 9 ₳" in a token pool.
 * `counted` false: what they hold alone, "200 NIGHT + 9 ₳", for a sentence that counts them itself.
 */
function boxesValue(network: NetworkName, box: BoxValue, count: number, counted = true): string {
  const ada = formatAda((BigInt(count) * BigInt(box.lovelace)).toString());
  if (!box.token) return counted ? t("lovejoin.mix.boxesAda", { count, ada }) : t("lovejoin.box.ada", { ada });
  const quantity = tokenQuantity(network, { ...box.token, quantity: (BigInt(count) * BigInt(box.token.quantity)).toString() });
  const value = t("lovejoin.box.token", { quantity, token: tokenText(network, box.token).label, ada });
  return counted ? t("lovejoin.mix.boxesValue", { count, value }) : value;
}

/** An amount of ADA, and a token pool's token beside it: "15.3 ₳ and 200 NIGHT". */
function withToken(network: NetworkName, ada: string, token?: TokenQuantity): string {
  return token ? t("lovejoin.adaAndToken", { ada, token: tokenAmountText(network, token) }) : ada;
}

/**
 * What a mix from the public account needs it to hold, in a line: the Mix form's *From your public account*. The
 * classic pool's chain spends ADA alone; a token pool's spends the account's UTxOs holding its token first, their
 * ADA counted, and needs the token too, so it names the token and not "ADA alone" (1.6.0's release review, UI-11).
 */
export function publicNeedsText(network: NetworkName, funding: Pick<LovejoinFunding, "lovelace" | "token">): string {
  const ada = formatAda(funding.lovelace);
  return funding.token
    ? t("lovejoin.mix.publicNeedsToken", { ada, token: tokenAmountText(network, funding.token) })
    : t("lovejoin.mix.publicNeeds", { ada });
}

/**
 * How a box comes back, on Lovejoin's page (privacy review §2.4, §2.6): into
 * a private UTxO of its own, with nothing on the way back naming where it
 * went in, and hidden from people reading the chain, not from the services
 * that carry both ends. Exported for its test.
 */
export function WayBack() {
  const tr = useT();
  return (
    <Callout tone="privacy" testId="lovejoin-way-back">
      {joinSentences([tr("lovejoin.privacy.wayBack"), LOVEJOIN_SEEN()])}
    </Callout>
  );
}

/**
 * What a mix from the public account hides (privacy review §2.6, §5.3): the
 * account paid its mixes in the open, and while few people bring Lovejoin
 * boxes back into a Seedelf, the wallet's way back stands out among the
 * boxes those mixes made.
 */
const PUBLIC_MIX_WAY_BACK = () => t("lovejoin.privacy.publicWayBack");

/**
 * What a mix's or a mix-again's funding takes from the private balance, and
 * the balance after, as every other review says them, rather than its change
 * (blind test §9.8). `before`: the private balance as Home shows it.
 */
function FundingTotals({ summary, before }: { summary: SessionOutSummary; before?: string }) {
  const network = useNetwork();
  const leaving = summary.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(summary.fee.total));
  // A token pool's token leaves with the boxes' ADA, said with it, by its amount and name as the row above says it,
  // not counted (1.6.0's preprod rehearsal, R3): "186.74 ₳ and 4,000 MIN", not "and 1 token".
  const sent = summary.payments.flatMap((p) => p.tokens);
  const tokens = new Set(sent.map((t) => `${t.policyId}.${t.assetName}`)).size;
  const named =
    tokens === 1
      ? tokenAmountText(network, { ...sent[0]!, quantity: sent.reduce((sum, t) => sum + BigInt(t.quantity), 0n).toString() })
      : undefined;
  return <TotalRows side="private" leaving={leaving} before={before} tokens={tokens} named={named} />;
}

/**
 * How a review says the mixes: "2 waves deep, 8 mixes, about 7.6 ₳", and four
 * boxes a mix when it goes four (chunk 34's D3: a chain's view says which
 * width it went at). Why four asked goes three is the review's note under it.
 */
function mixedValue(mix: { depth: number; mixes: number; mixFees?: string; width?: number }): string {
  const value = mix.mixFees
    ? t("lovejoin.review.depthMixesCost", { count: mix.depth, mixes: t("amount.mixes", { count: mix.mixes }), ada: formatAda(mix.mixFees) })
    : t("lovejoin.mix.depthAndMixes", { count: mix.depth, mixes: t("amount.mixes", { count: mix.mixes }) });
  return mix.width === 4 ? t("lovejoin.review.fourWide", { value }) : value;
}

/**
 * The funding's first payment less what it pays for its collateral's mix, or for a Bootstrap's way back, which rows of
 * their own show.
 */
const lessReserve = (lovelace: string, summary: SessionOutSummary) =>
  (BigInt(lovelace) - BigInt(summary.collateralReserve ?? "0") - BigInt(summary.bootstrapReserve ?? "0")).toString();

/**
 * A mix from the private balance: the one-time account's funding, then what runs by itself. `box`: what each box in
 * its pool holds (the classic pool's 10 ₳ when none is given). `cantComeBack`: the pool's boxes can't pay their own
 * way back today, said first, and no row promises a box back after its wait (session 5's cross-area review, M1).
 */
export function PrivateReview({
  summary,
  before,
  box = CLASSIC_BOX,
  cantComeBack,
}: {
  summary: SessionOutSummary & { mix: LovejoinFunding };
  before?: string;
  box?: BoxValue;
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  const network = useNetwork();
  const [boxesPart, collateral] = summary.payments;
  const { mix } = summary;
  if (mix.again) return <AgainReview summary={summary} before={before} cantComeBack={cantComeBack} />;
  return (
    <>
      <StuckReviewNote cantComeBack={cantComeBack} />
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="lovejoin-private-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        {/* A Bootstrap has no mixes: its funding pays for the boxes and the fees alone (1.6.0's rehearsal, R4). */}
        <Row
          label={tr(mix.bootstrap ? "lovejoin.review.forBoxesBootstrap" : "lovejoin.review.forBoxes")}
          value={withToken(network, `${formatAda(lessReserve(boxesPart!.lovelace, summary))}\u00a0₳`, boxesPart!.tokens[0])}
        />
        {/* A Bootstrap's funding pays no collateral: its deposit alone runs no script (the owner, 2026-10-23). */}
        {collateral && (
          <Row label={tr("lovejoin.review.itsCollateral")} value={tr("swaps.review.comesBack", { ada: formatAda(collateral.lovelace) })} />
        )}
        <CollateralReserveRow reserve={summary.collateralReserve} />
        {/* Its way back in a collateral's place: the sweep of what the deposit leaves into the private balance (1.6.0's
            release review, 318-rust#0). */}
        {summary.bootstrapReserve && (
          <Row label={tr("lovejoin.review.returnRest")} value={tr("lovejoin.collateralReserve.value", { ada: formatAda(summary.bootstrapReserve) })} />
        )}
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
        {/* Funded as several transactions, every one needed (the owner's call, 2026-10-21). */}
        {summary.parts && <Row label={tr("review.parts")} value={String(summary.parts.length)} />}
        <FundingTotals summary={summary} before={before} />
      </ReviewRows>
      <h2>{tr("lovejoin.review.thenItself")}</h2>
      <ReviewRows testId="lovejoin-private-then">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOf", { count: mix.boxes, box: boxText(network, box) })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={mix.bootstrap ? tr("lovejoin.review.notAtAll") : mixedValue(mix)} />
        {/* A Bootstrap's boxes come back only when brought back by hand, stuck or not: its row stays. */}
        {(mix.bootstrap || !cantComeBack) && (
          <Row
            label={tr("lovejoin.backLater")}
            value={mix.bootstrap ? tr("lovejoin.review.bootstrapBack") : tr("lovejoin.eachBoxAfter", { delay: delayText(mix.delay) })}
            stack
          />
        )}
      </ReviewRows>
      {mix.bootstrap ? (
        <Callout tone="warn" testId="lovejoin-bootstrap-warning">
          {tr("lovejoin.bootstrap.privacy.hidesNothing")}
        </Callout>
      ) : (
        <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.private"), lovejoinHides(mix.depth, mix.width)])}</Callout>
      )}
      <WidthNote fellBack={mix.fellBack} />
      {summary.parts && (
        <p className="note" data-testid="lovejoin-private-parts">
          {joinSentences([
            tr("review.fundingPartsNote", { count: summary.parts.length }),
            summary.parts.some((p) => p.waits) && tr("review.partsWait", { count: summary.parts.filter((p) => p.waits).length }),
          ])}
        </p>
      )}
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-private-histories" />
      <GivemeNote funding />
      <CollateralMixNote summary={summary} />
    </>
  );
}

/**
 * That giveme.my backs and sees the collateral's mix too: it runs by itself as the session comes back, so it's said
 * where the funding is approved, in the swap approval's words, as a return reviewed by hand says it (CollateralTailNote;
 * 1.6.0's release review, x-privacy#1). Mixed where the funding pays for that mix; mixed only if enough is left where a
 * 5 ₳ pool may take it otherwise; nothing where none can (the worker's `collateralMix`; its review of the fixes,
 * fx-promise).
 */
function CollateralMixNote({ summary }: { summary: Pick<SessionOutSummary, "collateralMix"> }) {
  return <CollateralMixLine mix={summary.collateralMix} mixed="swaps.review.privacy.collateralMix" testId="lovejoin-collateral-mix-note" />;
}

/** Mix my boxes again: the one-time account's funding, then the fan-out of the boxes in the pool. */
function AgainReview({
  summary,
  before,
  cantComeBack,
}: {
  summary: SessionOutSummary & { mix: LovejoinFunding };
  before?: string;
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  const [mixesPart, collateral] = summary.payments;
  const { mix } = summary;
  return (
    <>
      <StuckReviewNote cantComeBack={cantComeBack} />
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="lovejoin-again-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label={tr("lovejoin.review.forMixes")} value={`${formatAda(lessReserve(mixesPart!.lovelace, summary))}\u00a0₳`} />
        <Row label={tr("lovejoin.review.itsCollateral")} value={tr("swaps.review.comesBack", { ada: formatAda(collateral!.lovelace) })} />
        <CollateralReserveRow reserve={summary.collateralReserve} />
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
        {/* Funded as several transactions, every one needed (the owner's call, 2026-10-21). */}
        {summary.parts && <Row label={tr("review.parts")} value={String(summary.parts.length)} />}
        <FundingTotals summary={summary} before={before} />
      </ReviewRows>
      <h2>{tr("lovejoin.review.thenItself")}</h2>
      <ReviewRows testId="lovejoin-again-then">
        <Row
          label={tr("lovejoin.review.mixedAgain")}
          value={
            mix.owned && mix.owned > mix.boxes
              ? tr("lovejoin.review.someOfYours", { boxes: mix.boxes, owned: mix.owned })
              : tr("lovejoin.review.allOfYours", { count: mix.boxes })
          }
          strong
        />
        <Row label={tr("lovejoin.mixedLabel")} value={mixedValue(mix)} />
        {!cantComeBack && <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfterMixes", { delay: delayText(mix.delay) })} stack />}
      </ReviewRows>
      <WidthNote fellBack={mix.fellBack} />
      {mix.owned && mix.owned > mix.boxes && (
        <p className="note" data-testid="lovejoin-again-rest">
          {tr("lovejoin.review.asManyAsOneGo", { count: mix.boxes })}
        </p>
      )}
      <Callout tone="privacy">
        {joinSentences([
          tr("lovejoin.review.privacy.again"),
          lovejoinHides(mix.depth, mix.width),
          mix.publicToo && tr("lovejoin.review.privacy.publicToo"),
        ])}
      </Callout>
      {summary.parts && (
        <p className="note" data-testid="lovejoin-again-parts">
          {joinSentences([
            tr("review.fundingPartsNote", { count: summary.parts.length }),
            summary.parts.some((p) => p.waits) && tr("review.partsWait", { count: summary.parts.filter((p) => p.waits).length }),
          ])}
        </p>
      )}
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-again-histories" />
      <GivemeNote funding />
      <CollateralMixNote summary={summary} />
    </>
  );
}

/**
 * What a chain from the public account takes from it, all told (release review C41): the boxes it puts in, none
 * mixing its own again, and every fee. Its change stays, and as a row of its own read as what would be left
 * (ReviewTotals). With several accounts, TotalRows names the one that pays.
 */
const publicLeaving = (summary: LovejoinPublicSummary, box: BoxValue) =>
  (summary.again ? 0n : BigInt(summary.boxes) * BigInt(box.lovelace)) + BigInt(summary.fees);

/**
 * The token pool's token a mix from the public account takes from it too, by its amount and name: its deposit's,
 * none mixing again. Said in the total, as the row above names it (1.6.0's preprod rehearsal, R3).
 */
const publicToken = (network: NetworkName, summary: LovejoinPublicSummary) =>
  summary.token && !summary.again ? tokenAmountText(network, summary.token) : undefined;

/**
 * A mix from the public account: the deposit and every mix, sent now. `box`: what each box in its pool holds (the
 * classic pool's 10 ₳ when none is given). `before`: the public account as Home shows it, for "Public account after",
 * on a mix, a Bootstrap and a mix again alike, as the private side's reviews and Send say it: none of the three said
 * it (1.6.0's rehearsal, R9). None, no after line. `cantComeBack`: as PrivateReview's (M1).
 */
export function PublicReview({
  summary,
  box = CLASSIC_BOX,
  before,
  cantComeBack,
}: {
  summary: LovejoinPublicSummary;
  box?: BoxValue;
  before?: string;
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  const network = useNetwork();
  if (summary.again) return <PublicAgainReview summary={summary} box={box} before={before} cantComeBack={cantComeBack} />;
  if (summary.bootstrap) return <PublicBootstrapReview summary={summary} box={box} before={before} cantComeBack={cantComeBack} />;
  return (
    <>
      <StuckReviewNote cantComeBack={cantComeBack} />
      <ReviewRows testId="lovejoin-public-review">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOf", { count: summary.boxes, box: boxText(network, box) })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={mixedValue(summary)} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <TotalRows side="public" leaving={publicLeaving(summary, box)} before={before} named={publicToken(network, summary)} />
        {!cantComeBack && <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfter", { delay: delayText(summary.delay) })} stack />}
      </ReviewRows>
      <WidthNote fellBack={summary.fellBack} />
      <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.public"), PUBLIC_MIX_WAY_BACK()])}</Callout>
    </>
  );
}

/**
 * Bootstrap the pool: the deposit alone, no mixes, its boxes held there until
 * brought back by hand. It buys whoever puts it in nothing, so the review
 * says that plainly rather than borrowing the mix's words.
 */
function PublicBootstrapReview({
  summary,
  box,
  before,
  cantComeBack,
}: {
  summary: LovejoinPublicSummary;
  box: BoxValue;
  before?: string;
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  const network = useNetwork();
  return (
    <>
      <StuckReviewNote cantComeBack={cantComeBack} />
      <ReviewRows testId="lovejoin-bootstrap-review">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOf", { count: summary.boxes, box: boxText(network, box) })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={tr("lovejoin.review.notAtAll")} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <TotalRows side="public" leaving={publicLeaving(summary, box)} before={before} named={publicToken(network, summary)} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.review.bootstrapBack")} stack />
      </ReviewRows>
      <Callout tone="warn" testId="lovejoin-bootstrap-warning">
        {tr("lovejoin.review.warn.bootstrap")}
      </Callout>
    </>
  );
}

/** Mix again from my public account: the boxes a mix from it put in, each mix paid by it, sent now (§2.10). */
function PublicAgainReview({
  summary,
  box,
  before,
  cantComeBack,
}: {
  summary: LovejoinPublicSummary;
  box: BoxValue;
  before?: string;
  cantComeBack?: CantComeBack;
}) {
  const tr = useT();
  return (
    <>
      <StuckReviewNote cantComeBack={cantComeBack} />
      <ReviewRows testId="lovejoin-public-again-review">
        <Row label={tr("lovejoin.review.mixedAgain")} value={tr("lovejoin.review.publicPutIn", { count: summary.boxes })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={mixedValue(summary)} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <TotalRows side="public" leaving={publicLeaving(summary, box)} before={before} />
        {!cantComeBack && <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfterMixes", { delay: delayText(summary.delay) })} stack />}
      </ReviewRows>
      <WidthNote fellBack={summary.fellBack} />
      <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.publicAgain"), PUBLIC_MIX_WAY_BACK()])}</Callout>
    </>
  );
}
