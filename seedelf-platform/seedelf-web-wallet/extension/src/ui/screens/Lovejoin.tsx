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
import type {
  Balances,
  CollateralStatus,
  LovejoinChainTx,
  LovejoinChainView,
  LovejoinFunding,
  LovejoinMixView,
  LovejoinPublicSummary,
  LovejoinStatus,
  PendingTx,
  Requests,
  SessionOutSummary,
  SessionView,
  TokenAmount,
  TokenQuantity,
} from "../../shared/rpc";
import { publicAccountName, useAccounts } from "../accounts";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ExplorerLink } from "../components/ExplorerLink";
import { GivemeNote } from "../components/GivemeNote";
import { HintButton, useHint } from "../components/Hint";
import { HistoriesNote } from "../components/HistoriesNote";
import { SearchIcon, ShieldIcon } from "../components/Icons";
import {
  chainText,
  delayText,
  LOVEJOIN_SEEN,
  LOVEJOIN_UNAUDITED,
  lovejoinHides,
  mixesPerBox,
  useSessionsWhile,
  WidthNote,
} from "../components/LovejoinReturn";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { homeBalance, TotalRows } from "../components/ReviewTotals";
import { Screen } from "../components/Screen";
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
  poolNamed,
  poolsOf,
  searchGroups,
  type BoxValue,
  type PoolGroup,
  type ShownPool,
} from "../lovejoin-pools";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { withoutStop } from "../sentence";
import { aboutAda, BOX_BACK_ESTIMATE, SESSION_FEE_ESTIMATE, toCents } from "../swap";
import { tokenAmountText, tokenMark, tokenQuantity, tokenText } from "../tokens";
import { Collateral } from "./Collateral";
import { LovejoinLaunch } from "./LovejoinLaunch";
import { SwapTag, type SwapTone } from "./Swaps";

/** The most boxes one mix takes (the worker's MAX_MIX_BOXES). */
const MAX_BOXES = 10;
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

/** A box's ADA. */
const BOX = 10_000_000n;
/** A one-time account's own collateral (sessions.ts SESSION_COLLATERAL). */
const COLLATERAL = 5_000_000n;
/** Left aside for the funding's network fee: the build decides exactly. */
const FEE_ROOM = 1_000_000n;

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

/**
 * The most boxes `held` lovelace pays a mix from the private balance for
 * (LJ-3): each box more takes the same, its ADA (`box`, the classic pool's
 * 10 ₳ when none is given) and its mixes (`funding`,
 * for `funding.boxes`), beside the account's 5 ₳ collateral and room for the
 * network fee. The build decides exactly; this keeps the stepper from
 * offering what plainly can't be paid.
 */
export function boxesAffordable(held: string, funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees">, box = BOX): number {
  const perBox = box + BigInt(funding.mixFees) / BigInt(funding.boxes);
  const besides = BigInt(funding.lovelace) - perBox * BigInt(funding.boxes);
  const spare = BigInt(held) - COLLATERAL - FEE_ROOM - besides;
  return spare < 0n ? 0 : Number(spare / perBox);
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
 * - `networkFees`: SESSION_FEE_ESTIMATE for each transaction besides the
 *   mixes (`txs`): from the private balance, this payment, the deposit and
 *   the return of what's left; from the public account, the deposit.
 * - `backFees`: bringing each box back (BOX_BACK_ESTIMATE), from the box.
 * - `cost`: the mixes, those network fees and the boxes' way back.
 * - `leaving`: from the private balance, the plan, the 5 ₳ kept aside and
 *   this payment's fee; from the public account, the boxes, their mixes and
 *   the deposit's fee. What else the account needs to start it stays there.
 * - `later`: what comes back hours later, each box less its way back.
 *   `soon`: what comes back once it's mixed, the 5 ₳ kept aside and what the
 *   reserve leaves; none from the public account, whose change stays in it.
 */
export function mixCosts(funding: Pick<LovejoinFunding, "boxes" | "lovelace" | "mixFees">, source: Source, box = BOX) {
  const boxes = BigInt(funding.boxes) * box;
  const mixFees = BigInt(funding.mixFees);
  const reserve = BigInt(funding.lovelace) - boxes - mixFees;
  const txs = source === "private" ? 3 : 1;
  const networkFees = BigInt(txs) * SESSION_FEE_ESTIMATE;
  const backFees = BigInt(funding.boxes) * BOX_BACK_ESTIMATE;
  const cost = mixFees + networkFees + backFees;
  const leaving = (source === "private" ? BigInt(funding.lovelace) + COLLATERAL : boxes + mixFees) + SESSION_FEE_ESTIMATE;
  const later = boxes - backFees;
  const soon = leaving - cost - later;
  return { boxes, mixFees, reserve, txs, networkFees, backFees, cost, leaving, later, soon: soon > 0n ? soon : 0n };
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

/** A mix's tag. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") {
    return unseen(s) ? { tone: "wait", label: t("lovejoin.tag.notSeen") } : { tone: "bad", label: t("lovejoin.tag.notFunded") };
  }
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
 */
export function anywayWarning(status?: Pick<LovejoinStatus, "notMixed" | "unsure" | "deposits" | "fromPublic">): string {
  const box = anywayBox(status);
  const has = (list?: Array<{ txHash: string; txIndex: number }>) =>
    !!box && !!list?.some((b) => b.txHash === box.txHash && b.txIndex === box.txIndex);
  const found = has(status?.deposits);
  if (has(status?.unsure)) return t("lovejoin.anyway.privacy.untold");
  if (has(status?.fromPublic)) {
    return t(found ? "lovejoin.anyway.privacy.publicDeposit" : "lovejoin.anyway.privacy.publicStopped");
  }
  return t(found ? "lovejoin.anyway.privacy.deposit" : "lovejoin.anyway.privacy.stopped");
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
  busy,
  onAnyway,
}: {
  count: number;
  fromPublic?: number;
  elsewhere?: number;
  unsure?: number;
  deposits?: number;
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
  const takes = !here
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
 * with the balances, as every count of boxes is (privacy review §2.16).
 */
export function BootstrapHeld({
  count,
  busy,
  mixingAgain = false,
  pressed,
  onOne,
  onAll,
}: {
  count: number;
  busy: boolean;
  mixingAgain?: boolean;
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
        <span className="note">{tr("lovejoin.bootstrap.allNote")}</span>
      </div>
    </Callout>
  );
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
 * Lovejoin's hub (chunk 34's session 1, 4, 5 and 13): the wallet's boxes in
 * every pool, the chains being sent, every mix followed until its last box is
 * back, then the pools grouped by token, each opening its own page (PoolPage),
 * and Start a pool (LovejoinLaunch). Every pool listed is genuine and finished:
 * that's all the wallet reads, the same for everyone.
 */
export function Lovejoin({
  seedelf,
  cardano,
  banner,
  onBack,
  onPending,
}: {
  /** The private balance: the stepper offers no more boxes than it pays for (chunk 23's second review, LJ-3). */
  seedelf: Balances["seedelf"];
  /** The public account, for the tokens the wallet holds there (the hub's order) and a public mix's token. */
  cardano?: Balances["cardano"];
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
  // A pool's own page, by its id (none: the classic pool), or Start a pool; nothing, the hub.
  const [view, setView] = useState<{ pool: string | undefined } | { launch: true }>();
  const [query, setQuery] = useState("");

  // One pool read on open, and on Refresh; the mixes from the device's record.
  const load = useCallback(async () => {
    setReading(true);
    try {
      const [s, all] = await Promise.all([call("lovejoin-status", {}), call("sessions", {})]);
      setStatus(s);
      setRows(s.chains);
      setMixes(all.filter((x) => x.mix));
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
      setReading(false);
    }
  }, [lookChains, lookEntries]);

  useEffect(() => {
    void load();
  }, [load]);

  // Token pools launched since the wallet last looked (chunk 34's 34c), once as the page opens: read from the next
  // pool read on.
  useEffect(() => {
    void call("lovejoin-look-for-pools", {}).catch(() => undefined);
  }, []);

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
  // A pool's page stays open through a read that fails, saying so, with what it last read (34f's review, 10).
  const page = view && "pool" in view ? poolNamed(pools, view.pool) : undefined;
  if (page && status) {
    return (
      <PoolPage
        key={page.id ?? "classic"}
        pool={page}
        seedelf={seedelf}
        cardano={cardano}
        banner={banner}
        reading={reading}
        updatedAt={updatedAt}
        readFailed={readFailed}
        mixingAgain={mixes.some(isMixingAgain)}
        sending={sending}
        onSendingPublic={setSendingPublic}
        onSending={setSending}
        onRefresh={load}
        onBack={() => setView(undefined)}
        onPending={onPending}
      />
    );
  }

  // The public mix being sent shows its own progress below: the list takes the others.
  const chains = rows.filter((c) => !(sending && c.session === undefined));
  const groups = groupPools(pools, holdings);
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
          {listed.map((g) => (
            <PoolGroupList key={g.key} group={g} onOpen={(id) => setView({ pool: id })} />
          ))}
          {!listed.length && (
            <p className="note" data-testid="lovejoin-pools-none">
              {tr("lovejoin.pools.noneMatch", { query: query.trim() })}
            </p>
          )}
          {/* A start the wallet sent, not found yet: every wallet finds it once its block has settled (34c). */}
          {status.started?.map((s) => (
            <p key={s.txHash} className="note" data-testid="lovejoin-started">
              {tr("lovejoin.pools.startedNotFound", { when: whenOf(s.at, new Date()) })}
            </p>
          ))}
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

/** How far the public account's mix being sent has got (`lovejoin-mix-public-progress`). */
type PublicProgress = NonNullable<Requests["lovejoin-mix-public-progress"]["result"]>;

/** The hub's search shows once there are more token groups than this. */
const SEARCH_FROM = 4;

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
  // The next due among the pools whose boxes come back by themselves.
  const next = pools
    .filter((p) => p.boxes.length > p.notMixed.length)
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
 * One token's pools on the hub: its name, then each pool by what a box holds,
 * its crowd, the wallet's boxes in it (hidden with the balances), and what
 * the pool's page has to say: boxes not mixed yet, held by a Bootstrap, a way
 * back the network's fees don't pay, a bootstrap under way, a pool the wallet
 * started. Each opens its page.
 */
export function PoolGroupList({ group, onOpen }: { group: PoolGroup; onOpen: (id: string | undefined) => void }) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  const name = group.token ? tokenText(network, group.token) : undefined;
  return (
    <div className="stack-tight" data-testid={`lovejoin-group-${group.token ? group.key : "ada"}`}>
      <h3 className="pool-group__title">
        {name ? name.label : "ADA"}
        {name && !name.listed && <span className="note"> {tokenMark(name)}</span>}
      </h3>
      <ul className="list">
        {group.pools.map((p) => {
          const progress = bootstrapProgress(p);
          const flags = [
            progress && tr("lovejoin.pools.starting", { have: progress.have, floor: progress.floor }),
            p.notMixed.length > 0 && tr("lovejoin.pools.flag.notMixed", { n: amounts.hidden ? tr("home.lovejoin.some") : p.notMixed.length }),
            (p.bootstrap?.length ?? 0) > 0 && tr("lovejoin.pools.flag.held", { n: amounts.hidden ? tr("home.lovejoin.some") : p.bootstrap!.length }),
            p.cantComeBack && p.boxes.length > 0 && tr("lovejoin.pools.warn.stuck"),
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
                    className={`token-row__detail${p.notMixed.length || (p.cantComeBack && p.boxes.length) ? "" : " token-row__detail--plain"}`}
                    data-testid="lovejoin-pool-flags"
                  >
                    {flags.join(tr("lovejoin.pools.flagJoin"))}
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
interface MixItem {
  key: string;
  at: number;
  entry?: LovejoinMixView;
  session?: SessionView;
}

/** How many mixes that are over Your mixes keeps showing, newest first, as Mixes from your private balance did. */
const OVER_SHOWN = 5;

/**
 * Your mixes (chunk 34's session 1, 5): every mix, from either side and in
 * any pool, followed until its last box is back, each saying enough to tell
 * it apart: what went in and where, who paid, how many boxes are back, and
 * whether a Bootstrap holds them. A mix from the private balance keeps its
 * session's stage, Stop and Try now, from its funding on; once it's over and
 * its boxes are all back, it stays with the last few that are over, as
 * before. Its chain's transactions are under Chains while it's being sent.
 */
export function MixList({
  entries,
  sessions,
  chains,
  pools,
  busy,
  onRetry,
  onStop,
}: {
  entries: LovejoinMixView[];
  sessions: SessionView[];
  chains: LovejoinChainView[];
  pools: ShownPool[];
  busy: boolean;
  onRetry: (index: number) => void;
  onStop: (index: number) => void;
}) {
  const tr = useT();
  const items = mixItems(entries, sessions);
  if (!items.length) return null;
  return (
    <section className="section" aria-labelledby="lovejoin-mixes-title">
      <h2 id="lovejoin-mixes-title">{tr("lovejoin.yourMixes.title")}</h2>
      <ul className="list" data-testid="lovejoin-mixes">
        {items.map((item) => (
          <MixCard
            key={item.key}
            item={item}
            chain={item.entry ? chainOf(chains, item.entry) : undefined}
            pools={pools}
            busy={busy}
            onRetry={onRetry}
            onStop={onStop}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The cards, newest first: each mix in the list, with its session's view
 * where a private mix's session made it; each mix session not in the list
 * (its funding on its way, never sent, or over with its boxes all back), the
 * last few that are over among them.
 */
export function mixItems(entries: LovejoinMixView[], sessions: SessionView[]): MixItem[] {
  const fromEntries: MixItem[] = entries.map((e) => ({
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
  const over = alone.filter(isOver).slice(0, Math.max(0, OVER_SHOWN - open.length));
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
}: {
  item: MixItem;
  chain?: LovejoinChainView;
  pools: ShownPool[];
  busy: boolean;
  onRetry: (index: number) => void;
  onStop: (index: number) => void;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const network = useNetwork();
  const { accounts } = useAccounts();
  const { entry: e, session: s } = item;
  // What a share's box holds: its pool's, as read; a pool not read this time by its id alone.
  const boxOf = (pool?: string) => poolNamed(pools, pool)?.box;
  const shareText = (share: LovejoinMixView["shares"][number]) => {
    const box = boxOf(share.pool);
    const boxes = amounts.count(share.boxes, "amount.boxes");
    return box ? tr("lovejoin.mixes.boxesOf", { boxes, box: boxText(network, box) }) : tr("lovejoin.mixes.boxesIn", { boxes, pool: shortHex(share.pool ?? "", 8, 4) });
  };
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
    const out = e.shares.reduce((sum, x) => sum + x.boxes, 0);
    const back = e.shares.reduce((sum, x) => sum + x.back, 0);
    const moved = e.shares.reduce((sum, x) => sum + x.moved, 0);
    // How many are back, and how many a later mix of the wallet's took on (Mix my boxes again): counts of boxes, hidden.
    const progress = amounts.hidden
      ? undefined
      : moved
        ? tr("lovejoin.mixes.backMoved", { back, out, moved })
        : tr("lovejoin.mixes.back", { back, out });
    const sending = e.chain && !e.chain.done && !e.chain.stopped;
    tag =
      s && !isOver(s) && !e.chain
        ? tagOf(s)
        : sending
          ? { tone: "live", label: tr("lovejoin.chains.sending") }
          : e.chain?.stopped && !e.chain.done
            ? { tone: "off", label: tr("lovejoin.chains.stopped") }
            : e.bootstrap && !e.released
              ? { tone: "off", label: tr("lovejoin.tag.held") }
              : { tone: "live", label: tr("lovejoin.tag.comingBack") };
    sub = joinList(
      [
        whose,
        e.bootstrap && !e.released ? tr("lovejoin.mixes.held") : e.bootstrap ? tr("lovejoin.mixes.released") : progress,
        e.chain?.width === 4 ? tr("lovejoin.mixes.four") : undefined,
      ].filter((x): x is string => !!x),
    );
    // Its chain is said under Chains while it's listed there; once it's gone from there, why it stopped is said here.
    detail =
      joinSentences([
        s && detailOf(s),
        !chain && e.chain?.stopped && !e.chain.done ? tr("lovejoin.detail.whyStopped", { why: withoutStop(e.chain.stopped) }) : undefined,
      ]) || undefined;
  } else {
    label = tr(s!.mix!.again ? "lovejoin.mixes.again" : "lovejoin.mixes.boxesOf", {
      boxes: amounts.count(s!.mix!.boxes, "amount.boxes"),
      box: boxText(network, boxOf(s!.mix!.pool) ?? CLASSIC_BOX),
    });
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
      {(detail || canStop || canRetry) && (
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
function PoolPage({
  pool,
  seedelf,
  cardano,
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
  onPending,
}: {
  pool: ShownPool;
  seedelf: Balances["seedelf"];
  cardano?: Balances["cardano"];
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
  onPending: (pending: PendingTx) => void;
}) {
  const amounts = useAmounts();
  const tr = useT();
  const network = useNetwork();
  // Asked first: bringing back a box not mixed yet, mixing a public mix's boxes again from the private balance,
  // bringing back a box a Bootstrap holds, or one the public account pays to bring back.
  const [asking, setAsking] = useState<{ anyway: true } | { privateAnyway: true } | { held: true } | { paid: true }>();
  const [busy, setBusy] = useState(false);
  /** Which of the page's buttons is working. */
  const [pressed, setPressed] = useState<"now" | "again" | "again-public" | "anyway" | "held" | "release" | "paid">();
  const [error, setError] = useState<string>();
  const [source, setSource] = useState<Source>("private");
  const [boxes, setBoxes] = useState(1);
  /** How many a Bootstrap puts in, its own count: typed, so 30 isn't 30 presses. */
  const [bootstrapBoxes, setBootstrapBoxes] = useState<number>();
  // What the boxes take at Settings' width, and at three where four would fall back (chunk 34's D3, 34f's review, 5).
  const [asked, setAsked] = useState<LovejoinFunding>();
  const [atThree, setAtThree] = useState<LovejoinFunding>();
  const [review, setReview] = useState<Review>();
  // A refused mix's funding: built again, or watched where it may have gone out (chunk 23's second review, DX-1).
  const [refusal, setRefusal] = useState<Refusal>();
  // Bootstrapping, behind its own link under Mix while the pool holds enough: it gives whoever puts it in nothing
  // (LJ-6; chunk 34: it replaces the seed). Below the floor it leads the page.
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  // The public account's collateral, which a mix from it puts up, and its page, opened here while it isn't set.
  const [collateral, setCollateral] = useState<CollateralStatus>();
  const [collateralOpen, setCollateralOpen] = useState(false);
  const readCollateral = useCallback(() => call("collateral", {}).then(setCollateral, () => undefined), []);
  const box = BigInt(pool.box.lovelace);
  const token = pool.box.token;

  // Read when the public side is chosen, from the last reading (no request), and every 15 s while its payment is on
  // its way: Home's watch reads the balances again once it lands, wherever the user is, and this follows.
  const collateralComing = source === "public" && collateral?.state === "waiting";
  useEffect(() => {
    if (source !== "public") return;
    void readCollateral();
    if (!collateralComing) return;
    const timer = setInterval(() => void readCollateral(), COLLATERAL_EVERY_MS);
    return () => clearInterval(timer);
  }, [source, collateralComing, readCollateral]);

  // What the chosen number of boxes takes in this pool: WebAssembly and the settings, no Koios.
  useEffect(() => {
    let live = true;
    call("lovejoin-funding", { boxes, ...(pool.id ? { pool: pool.id } : {}) }).then(
      (f) => live && setAsked(f),
      () => live && setAsked(undefined),
    );
    return () => {
      live = false;
    };
  }, [boxes, pool.id]);

  // What a mix can take now, said before Review (chunk 23's second review, LJ-1, LJ-3): no more boxes than the
  // pool has others for at the set depth, nor, from the private balance, than it pays for, its token too. From the
  // last pool read and WebAssembly's price of the boxes: no request of its own. Four boxes a mix goes four when the
  // pool has room for all the boxes asked, and three where three takes more, as the build decides it (widthFor): the
  // stepper offers what either takes, and the form says when it mixes three at a time, priced at three.
  const askedWidth = asked?.width ?? 3;
  const roomAt = (w: number) => (asked ? poolRoom(pool, boxes, asked.depth, w) : undefined);
  const wide = roomAt(askedWidth);
  const three = askedWidth === 4 ? roomAt(3) : undefined;
  const fallsBack = !!wide && !!three && !wide.floorShort && wide.fits < boxes && three.fits > wide.fits;
  const room = fallsBack ? three : wide;
  const roomWidth = fallsBack ? 3 : askedWidth;
  useEffect(() => {
    if (!fallsBack) return;
    let live = true;
    call("lovejoin-funding", { boxes, width: 3, ...(pool.id ? { pool: pool.id } : {}) }).then(
      (f) => live && setAtThree(f),
      () => live && setAtThree(undefined),
    );
    return () => {
      live = false;
    };
  }, [fallsBack, boxes, pool.id]);
  // The funding the form shows: three's while four falls back (until it's in, four's).
  const funding = fallsBack ? (atThree?.boxes === boxes ? atThree : asked) : asked;
  const width = funding?.width ?? 3;
  // From the private balance: its ADA, and, for a token pool, its token; from the public account, its token.
  const side = source === "private" ? seedelf.tokens : cardano?.tokens;
  const tokenMost = token ? tokenBoxes(side, token) : MAX_BOXES;
  const adaMost = source === "private" && funding ? boxesAffordable(seedelf.lovelace, funding, box) : MAX_BOXES;
  const affordable = Math.min(adaMost, tokenMost);
  const roomMost = !wide || wide.floorShort ? MAX_BOXES : Math.max(wide.fits, three?.fits ?? 0);
  const most = Math.min(MAX_BOXES, affordable, roomMost);
  // Fewer fit now than the stepper shows (another side chosen, a new read): it comes down to what does.
  useEffect(() => {
    if (most >= 1 && boxes > most) setBoxes(most);
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

  /** Brings back a box not mixed yet, as it is: it shows where it went in (anywayBox, anywayWarning). */
  const anyway = () => {
    const taken = anywayBox(pool);
    setAsking(undefined);
    if (!taken) return;
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", { box: taken, anyway: true }));
      await onRefresh();
    }, "anyway");
  };

  /**
   * Brings back one box a Bootstrap holds (chunk 34's session 1, 6): one someone else's mix has moved since it went
   * in, when there's one, as status lists those after the boxes still where the deposit put them. In a pool whose
   * boxes can't pay their own way back, the public account pays, as its question said.
   */
  const bringHeld = () => {
    const held = pool.bootstrap?.at(-1);
    setAsking(undefined);
    if (!held) return;
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", { box: held, ...(stuck ? { paid: true } : {}) }));
      await onRefresh();
    }, "held");
  };

  /** Bring them all back: the Bootstraps' boxes come back by themselves from here, one at a time (round three, 24). */
  const releaseHeld = () =>
    act(async () => {
      await call("lovejoin-bootstrap-release", named);
      await onRefresh();
    }, "release");

  /**
   * The escape hatch (chunk 34's §2): one of this pool's boxes back with the public account paying its fee, which
   * ties the box to the account. Its question says so first.
   */
  const paid = () => {
    setAsking(undefined);
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", { ...own, paid: true }));
      await onRefresh();
    }, "paid");
  };

  /** A mix from the private balance, reviewed: `build` builds it, now and again after a refusal (DX-1). */
  const privateReview = async (build: () => Promise<PrivateSummary>) =>
    setReview({ source: "private", summary: await build(), again: build });

  /** Mixes the boxes again from the private balance: `anyway`, those a mix from the public account put in too. */
  const again = (anyway = false) => {
    setAsking(undefined);
    return act(() => privateReview(() => call("lovejoin-again-build", { ...named, ...(anyway ? { anyway: true } : {}) })), "again");
  };

  /** Mixes the boxes a mix from the public account put in again, paid by the account (§2.10). */
  const againPublic = () =>
    act(async () => {
      setReview({ source: "public", summary: await call("lovejoin-again-public-build", named) });
    }, "again-public");

  /** A Bootstrap puts boxes in with no mixes, from either side (chunk 34: it replaces the seed). */
  const bootstraps = (r: Review) => !!(r.source === "private" ? r.summary.mix.bootstrap : r.summary.bootstrap);
  const reviewTitle = (r: Review) => {
    if (bootstraps(r)) return tr("lovejoin.review.bootstrap");
    return tr((r.source === "private" ? r.summary.mix.again : r.summary.again) ? "lovejoin.review.again" : "lovejoin.review.mix");
  };
  // How the reviewed mix runs once sent, behind the icon by the title (chunk 23): what it costs, hides and
  // ties stays in the review's rows and callouts.
  const howItRuns = (r: Review) => {
    // A Bootstrap has its own note on either side: nothing is mixed, and its boxes stay until brought back by hand.
    if (bootstraps(r)) return tr("lovejoin.review.bootstrapNote");
    if (r.source === "private") return tr(r.summary.mix.again ? "lovejoin.review.againNote" : "lovejoin.review.privateNote");
    if (r.summary.again) return tr("lovejoin.review.publicAgainNote");
    return tr("lovejoin.review.publicNote");
  };

  const build = () =>
    act(async () => {
      if (source === "private") await privateReview(() => call("lovejoin-mix-private-build", { boxes, ...named }));
      else setReview({ source, summary: await call("lovejoin-mix-public-build", { boxes, ...named }) });
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
      onBack();
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
        hint={howItRuns(review)}
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
                onBack();
                void onRefresh();
              }}
            />
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => void send()} data-testid="lovejoin-send">
              {!busy
                ? tr(isBootstrap ? "lovejoin.review.bootstrapStart" : "lovejoin.review.start")
                : sending
                  ? tr("lovejoin.sendingOf", { sent: sending.sent, total: sending.total })
                  : tr("common.sending")}
            </button>
          )
        }
      >
        {review.source === "private" ? (
          <PrivateReview summary={review.summary} before={homeBalance(seedelf)} box={pool.box} />
        ) : (
          <PublicReview summary={review.summary} box={pool.box} />
        )}
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
  const { all: theirs, mine: ownPublic, accounts: otherAccounts } = publicBoxesOf(pool);
  const publicBoxes = theirs.size;
  const notMixedOf = (set: Set<string>) => pool.notMixed.filter((b) => set.has(`${b.txHash}#${b.txIndex}`)).length;
  const publicNotMixed = notMixedOf(theirs);
  const ownNotMixed = notMixedOf(ownPublic);
  // After a restore, those whose making Koios hasn't said of yet (independent review M14).
  const unsure = new Set((pool.unsure ?? []).map((b) => `${b.txHash}#${b.txIndex}`));
  // The box Bring one back anyway takes, which its warning is about.
  const taken = anywayBox(pool);
  const firstUnsure = !!taken && unsure.has(`${taken.txHash}#${taken.txIndex}`);
  const next = pool.due[0];
  // A token pool whose boxes can't pay their own way back today (chunk 34's escape hatch).
  const stuck = !!pool.cantComeBack && owned > 0;
  // The pool can't be mixed in yet: a Bootstrap is the only thing that starts one. It's offered whatever the pool
  // holds (chunk 34's D2: "Bootstrap a pool, any time"), and leads the page while the pool is short.
  const short = pool.floor > 0 && pool.others < pool.floor;
  const progress = bootstrapProgress(pool);
  const bootstrapMost = token ? MAX_TOKEN_BOOTSTRAP_BOXES : MAX_BOOTSTRAP_BOXES;
  // What it still needs, which is what a Bootstrap defaults to: one transaction's
  // worth at most, and the user can type any of it.
  const needed = short ? Math.min(pool.floor - pool.others, bootstrapMost) : 1;
  const putting = Math.min(Math.max(bootstrapBoxes ?? needed, 1), bootstrapMost);
  // Bootstrapping from the private balance: the boxes, the collateral and the fee are more than it holds, or its
  // token than it holds of it.
  const bootstrapShort =
    source === "private" &&
    (BigInt(putting) * box + COLLATERAL + FEE_ROOM > BigInt(seedelf.lovelace) || (!!token && tokenBoxes(seedelf.tokens, token) < putting));
  // The wallet's boxes a Bootstrap holds in this pool: they never come back by themselves (chunk 34).
  const held = pool.bootstrap?.length ?? 0;
  // A box's share of the funding (its ADA and its mixes), and the first box's, which carries the rest (LJ-3).
  const perBox = funding ? box + BigInt(funding.mixFees) / BigInt(funding.boxes) : 0n;
  const firstBox = funding ? BigInt(funding.lovelace) - perBox * BigInt(funding.boxes - 1) : 0n;
  const tokenName = token ? tokenText(network, token).label : "";
  // Why no more boxes than this, when the stepper stops short of ten.
  const capped =
    most >= 1 && boxes >= most && most < MAX_BOXES
      ? tokenMost === most && token
        ? tr(source === "private" ? "lovejoin.mix.capToken" : "lovejoin.mix.capTokenPublic", { count: most, token: tokenName })
        : affordable === most
          ? tr("lovejoin.mix.capBalance", { count: most, per: formatAda(perBox.toString()) })
          : tr("lovejoin.mix.capPool", { count: most })
      : undefined;
  // Not even one box can go, so − and + are both off (blind test T11): the pool's room, the token held, or the
  // private balance.
  const stuckForm =
    funding && most < 1
      ? room && !room.floorShort && room.fits < 1
        ? tr("lovejoin.mix.noneFitPool")
        : token && tokenMost < 1
          ? tr(source === "private" ? "lovejoin.mix.noneToken" : "lovejoin.mix.noneTokenPublic", { token: tokenName })
          : tr("lovejoin.mix.noneAfford")
      : undefined;
  // What the mix takes, all told, and what comes back (blind test §9.8).
  const costs = funding ? mixCosts(funding, source, box) : undefined;
  // Why Review can't be pressed now (LJ-1, LJ-5, LJ-6): the pool under its floor, without enough other boxes for one
  // at this depth (and whether one wave deep would do), the token not held, or a private balance short of one box.
  const notNow = readFailed
    ? tr("lovejoin.status.unread")
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
          ? tr("lovejoin.mix.cantAfford", { first: formatAda(firstBox.toString()), held: amounts.ada(seedelf.lovelace) })
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
        <label htmlFor="lovejoin-boxes">{tr("lovejoin.mix.boxesOfLabel", { box: boxWords })}</label>
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
        {/* Neither button can be pressed: why, beside them, not only under Review a screen further down (blind
            test T11). */}
        {stuckForm && (
          <p className="note" data-testid="lovejoin-boxes-none">
            {stuckForm}
          </p>
        )}
        {/* Four boxes a mix where the pool has room for three (chunk 34's D3): said before Review. */}
        {fallsBack && (
          <p className="note" data-testid="lovejoin-width-short">
            {t("lj.width.warn.short")}
          </p>
        )}
      </div>
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
        </ReviewRows>
      )}
      {/* What leaves now and what comes back, adding up to what it costs, in the reviews' words; the reserve
          in the 15.3 ₳ named (blind test §9.8, T11). The review gives this payment's fee exactly. A token pool's
          token goes with the boxes' ADA, and comes back with each box. */}
      {funding && costs && (
        <ReviewRows testId="lovejoin-mix-moves">
          {source === "private" ? (
            <>
              {/* The 15.3 ₳ and what it's made of, the reserve named (T11 asked whether 15.3 was 10 + 3.8 + 1.5). */}
              <Row label={tr("lovejoin.mix.intoOneTime")} value={withToken(network, adaText(funding.lovelace), funding.token)} />
              <Row
                label={tr("lovejoin.mix.partBoxes", { count: funding.boxes })}
                value={withToken(network, adaText(costs.boxes.toString()), funding.token)}
                part
              />
              <Row label={tr("lovejoin.mix.feesLabel")} value={adaText(funding.mixFees)} part />
              <Row label={tr("swaps.review.part.room")} value={tr("swaps.review.part.roomValue", { ada: formatAda(costs.reserve.toString()) })} part />
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
              <Row label={tr("lovejoin.mix.fromPublic")} value={tr("lovejoin.mix.publicNeeds", { ada: formatAda(funding.lovelace) })} stack />
              <Row
                label={tr("lovejoin.mix.totalPublic")}
                value={withToken(network, adaText(toCents(costs.leaving)), funding.token)}
                strong
                testId="lovejoin-mix-leaving"
              />
            </>
          )}
          <Row
            label={tr("lovejoin.backLater")}
            value={
              token
                ? tr("lovejoin.mix.eachBoxBackToken", {
                    count: funding.boxes,
                    ada: aboutAda(costs.later / BigInt(funding.boxes)),
                    token: tokenAmountText(network, token),
                    delay: delayText(funding.delay),
                  })
                : tr("lovejoin.mix.eachBoxBack", {
                    count: funding.boxes,
                    ada: aboutAda(costs.later / BigInt(funding.boxes)),
                    delay: delayText(funding.delay),
                  })
            }
            stack
          />
        </ReviewRows>
      )}
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
        <label htmlFor="lovejoin-bootstrap-boxes">{tr("lovejoin.bootstrap.boxesOfLabel", { box: boxWords })}</label>
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
            tr("lovejoin.bootstrap.atMost", { most: bootstrapMost }),
          ])}
        </p>
      </div>
      <button
        type="button"
        className={short ? "primary" : "secondary"}
        disabled={busy || bootstrapShort}
        onClick={() => void bootstrap()}
        data-testid="lovejoin-bootstrap"
      >
        {tr("lovejoin.bootstrap.button", { count: putting })}
      </button>
      {/* From the private balance, the obvious shortfall is said here, in its words, before a build (LJ-6). */}
      {bootstrapShort && (
        <p className="field-note" data-testid="lovejoin-bootstrap-why">
          {token && tokenBoxes(seedelf.tokens, token) < putting
            ? tr("lovejoin.bootstrap.cantAffordToken", { token: tokenName })
            : tr("lovejoin.bootstrap.cantAfford", { held: amounts.ada(seedelf.lovelace) })}
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
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void onRefresh()} />
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
        {owned > notMixed && next !== undefined && (
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
          {/* One this wallet started: opening it tells Cardanoscan, and the browser's history, it's of interest here. */}
          <ExplorerLink network={network} tx={pool.launch} private={!!pool.mine} className="link align-start">
            {tr("lovejoin.pool.launch")}
          </ExplorerLink>
          {pool.mine && <p className="note">{tr("lovejoin.pool.mine")}</p>}
        </div>
      )}
      {/* A way back today's fees don't pay (chunk 34's §2): the escape hatch, the user's call. */}
      {stuck && (
        <Callout tone="warn" testId="lovejoin-stuck">
          <div className="stack-tight">
            <span>
              {tr("lovejoin.stuck.warn.lead", {
                has: formatAda(pool.cantComeBack!.has),
                needs: formatAda(pool.cantComeBack!.needs),
              })}
            </span>
            <button type="button" className="link align-start" disabled={busy || mixingAgain} onClick={() => setAsking({ paid: true })} data-testid="lovejoin-paid">
              {pressed === "paid" ? tr("lovejoin.working") : tr("lovejoin.stuck.bring")}
            </button>
          </div>
        </Callout>
      )}
      <NotMixed
        count={notMixed}
        fromPublic={ownNotMixed}
        elsewhere={publicNotMixed - ownNotMixed}
        unsure={unsure.size}
        deposits={pool.deposits?.length ?? 0}
        busy={busy || mixingAgain}
        onAnyway={() => setAsking({ anyway: true })}
      />
      <BootstrapHeld
        count={held}
        busy={busy}
        mixingAgain={mixingAgain}
        pressed={pressed}
        onOne={() => setAsking({ held: true })}
        onAll={() => void releaseHeld()}
      />
      {owned > 0 && (
        <div className="stack">
          <OtherAccounts accounts={otherAccounts} />
          {/* The active account's boxes alone: paying for another's mixes would tie the two accounts (§2.10). */}
          {ownPublic.size > 0 && (
            <button
              type="button"
              className={ownNotMixed ? "primary" : "secondary"}
              disabled={busy || mixingAgain || !!sending && !sending.stopped}
              onClick={() => void againPublic()}
              data-testid="lovejoin-again-public"
            >
              {pressed === "again-public" ? tr("common.building") : tr("lovejoin.againPublic")}
            </button>
          )}
          {owned > publicBoxes && (
            <button
              type="button"
              className={notMixed > publicNotMixed ? "primary" : "secondary"}
              disabled={busy || mixingAgain}
              onClick={() => void again()}
              data-testid="lovejoin-again"
            >
              {pressed === "again" ? tr("common.building") : tr("lovejoin.again")}
            </button>
          )}
          {!stuck && (
            <button type="button" className="secondary" disabled={busy || mixingAgain} onClick={() => void now()} data-testid="lovejoin-now">
              {pressed === "now" ? tr("lovejoin.working") : tr("lovejoin.bringBackNow")}
            </button>
          )}
          {publicBoxes > 0 && (
            <button
              type="button"
              className="link align-start"
              disabled={busy || mixingAgain}
              onClick={() => setAsking({ privateAnyway: true })}
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
      )}

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
      {!short && !bootstrapOpen && (
        <div className="stack-tight">
          <button type="button" className="link align-start" onClick={() => setBootstrapOpen(true)} data-testid="lovejoin-bootstrap-open">
            {tr("lovejoin.bootstrap.open")}
          </button>
          <p className="note" data-testid="lovejoin-bootstrap-short">
            {tr("lovejoin.bootstrap.privacy.short")}
          </p>
        </div>
      )}
      {!short && bootstrapOpen && bootstrapForm}

      <WayBack />
      {asking && "anyway" in asking && (
        <Modal
          title={tr(firstUnsure ? "lovejoin.anyway.titleUnsure" : "lovejoin.anyway.title")}
          titleId="lovejoin-anyway-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.anyway.keep")}
              </button>
              <button type="button" className="danger" onClick={anyway} data-testid="lovejoin-anyway-confirm">
                {tr("lovejoin.anyway.confirm")}
              </button>
            </>
          }
        >
          <p className="note">{anywayWarning(pool)}</p>
        </Modal>
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
      {asking && "held" in asking && (
        <Modal
          title={tr("lovejoin.bootstrap.oneTitle")}
          titleId="lovejoin-held-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.bootstrap.keep")}
              </button>
              <button type="button" className="primary" onClick={bringHeld} data-testid="lovejoin-held-confirm">
                {tr("lovejoin.bootstrap.bringOne")}
              </button>
            </>
          }
        >
          <p className="note">{joinSentences([tr("lovejoin.bootstrap.privacy.one"), stuck && tr("lovejoin.stuck.privacy.ties")])}</p>
        </Modal>
      )}
      {/* The escape hatch's question: the public account pays, and that ties the box to it (chunk 34's §2). */}
      {asking && "paid" in asking && (
        <Modal
          title={tr("lovejoin.stuck.title")}
          titleId="lovejoin-paid-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.stuck.keep")}
              </button>
              <button type="button" className="danger" onClick={paid} data-testid="lovejoin-paid-confirm">
                {tr("lovejoin.stuck.confirm")}
              </button>
            </>
          }
        >
          <p className="note">{tr("lovejoin.stuck.privacy.ties")}</p>
        </Modal>
      )}
    </Screen>
  );
}

/** The most boxes one Bootstrap of a token pool puts in (the worker's MAX_TOKEN_DEPOSIT_BOXES). */
const MAX_TOKEN_BOOTSTRAP_BOXES = 64;

/** How many boxes of `token` (each `token.quantity` of it) a balance's tokens hold; none known, none. */
export function tokenBoxes(tokens: TokenAmount[] | undefined, token: TokenQuantity): number {
  const held = tokens?.find((t) => t.policyId === token.policyId && t.assetName === token.assetName);
  return held ? Number(BigInt(held.quantity) / BigInt(token.quantity)) : 0;
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
  const leaving = summary.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(summary.fee.total));
  // A token pool's token leaves with the boxes' ADA, said with it.
  const tokens = new Set(summary.payments.flatMap((p) => p.tokens.map((t) => `${t.policyId}.${t.assetName}`))).size;
  return <TotalRows side="private" leaving={leaving} before={before} tokens={tokens} />;
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
 * A mix from the private balance: the one-time account's funding, then what runs by itself. `box`: what each box in
 * its pool holds (the classic pool's 10 ₳ when none is given).
 */
export function PrivateReview({
  summary,
  before,
  box = CLASSIC_BOX,
}: {
  summary: SessionOutSummary & { mix: LovejoinFunding };
  before?: string;
  box?: BoxValue;
}) {
  const tr = useT();
  const network = useNetwork();
  const [boxesPart, collateral] = summary.payments;
  const { mix } = summary;
  if (mix.again) return <AgainReview summary={summary} before={before} />;
  return (
    <>
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="lovejoin-private-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row
          label={tr("lovejoin.review.forBoxes")}
          value={withToken(network, `${formatAda(boxesPart!.lovelace)}\u00a0₳`, boxesPart!.tokens[0])}
        />
        <Row label={tr("lovejoin.review.itsCollateral")} value={tr("swaps.review.comesBack", { ada: formatAda(collateral!.lovelace) })} />
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
        <FundingTotals summary={summary} before={before} />
      </ReviewRows>
      <h2>{tr("lovejoin.review.thenItself")}</h2>
      <ReviewRows testId="lovejoin-private-then">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOf", { count: mix.boxes, box: boxText(network, box) })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={mix.bootstrap ? tr("lovejoin.review.notAtAll") : mixedValue(mix)} />
        <Row
          label={tr("lovejoin.backLater")}
          value={mix.bootstrap ? tr("lovejoin.review.bootstrapBack") : tr("lovejoin.eachBoxAfter", { delay: delayText(mix.delay) })}
          stack
        />
      </ReviewRows>
      {mix.bootstrap ? (
        <Callout tone="warn" testId="lovejoin-bootstrap-warning">
          {tr("lovejoin.bootstrap.privacy.hidesNothing")}
        </Callout>
      ) : (
        <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.private"), lovejoinHides(mix.depth, mix.width)])}</Callout>
      )}
      <WidthNote fellBack={mix.fellBack} />
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-private-histories" />
      <GivemeNote funding />
    </>
  );
}

/** Mix my boxes again: the one-time account's funding, then the fan-out of the boxes in the pool. */
function AgainReview({ summary, before }: { summary: SessionOutSummary & { mix: LovejoinFunding }; before?: string }) {
  const tr = useT();
  const [mixesPart, collateral] = summary.payments;
  const { mix } = summary;
  return (
    <>
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="lovejoin-again-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label={tr("lovejoin.review.forMixes")} value={`${formatAda(mixesPart!.lovelace)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.itsCollateral")} value={tr("swaps.review.comesBack", { ada: formatAda(collateral!.lovelace) })} />
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
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
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfterMixes", { delay: delayText(mix.delay) })} stack />
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
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-again-histories" />
      <GivemeNote funding />
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

/** Whether a mix from the public account takes a token pool's token from it too: its deposit's, none mixing again. */
const publicTokens = (summary: LovejoinPublicSummary) => (summary.token && !summary.again ? 1 : 0);

/**
 * A mix from the public account: the deposit and every mix, sent now. `box`: what each box in its pool holds (the
 * classic pool's 10 ₳ when none is given).
 */
export function PublicReview({ summary, box = CLASSIC_BOX }: { summary: LovejoinPublicSummary; box?: BoxValue }) {
  const tr = useT();
  const network = useNetwork();
  if (summary.again) return <PublicAgainReview summary={summary} box={box} />;
  if (summary.bootstrap) return <PublicBootstrapReview summary={summary} box={box} />;
  return (
    <>
      <ReviewRows testId="lovejoin-public-review">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOf", { count: summary.boxes, box: boxText(network, box) })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={mixedValue(summary)} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <TotalRows side="public" leaving={publicLeaving(summary, box)} tokens={publicTokens(summary)} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfter", { delay: delayText(summary.delay) })} stack />
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
function PublicBootstrapReview({ summary, box }: { summary: LovejoinPublicSummary; box: BoxValue }) {
  const tr = useT();
  const network = useNetwork();
  return (
    <>
      <ReviewRows testId="lovejoin-bootstrap-review">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOf", { count: summary.boxes, box: boxText(network, box) })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={tr("lovejoin.review.notAtAll")} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <TotalRows side="public" leaving={publicLeaving(summary, box)} tokens={publicTokens(summary)} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.review.bootstrapBack")} stack />
      </ReviewRows>
      <Callout tone="warn" testId="lovejoin-bootstrap-warning">
        {tr("lovejoin.review.warn.bootstrap")}
      </Callout>
    </>
  );
}

/** Mix again from my public account: the boxes a mix from it put in, each mix paid by it, sent now (§2.10). */
function PublicAgainReview({ summary, box }: { summary: LovejoinPublicSummary; box: BoxValue }) {
  const tr = useT();
  return (
    <>
      <ReviewRows testId="lovejoin-public-again-review">
        <Row label={tr("lovejoin.review.mixedAgain")} value={tr("lovejoin.review.publicPutIn", { count: summary.boxes })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={mixedValue(summary)} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)}\u00a0₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <TotalRows side="public" leaving={publicLeaving(summary, box)} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfterMixes", { delay: delayText(summary.delay) })} stack />
      </ReviewRows>
      <WidthNote fellBack={summary.fellBack} />
      <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.publicAgain"), PUBLIC_MIX_WAY_BACK()])}</Callout>
    </>
  );
}
