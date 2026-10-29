// What a session return's review says about where its money goes (roadmap
// chunk 16): into the private UTxO the session's funding made, or new ones;
// and, when its spare ADA goes through Lovejoin first, the boxes, the
// fan-out, when each comes back, and a switch to bring this one back directly.
// Then, as its chain goes, how far it has got: sent, then on chain; and,
// when a return left Lovejoin out, why (launch review #23). Wherever the
// user chooses Lovejoin, it says Lovejoin has had no third-party audit:
// Lovejoin's own docs say so, and no copy here may say otherwise.
import { useEffect, useRef, useState } from "react";
import { type I18nKey, joinSentences, t, useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { CollateralMix, LovejoinBoxValue, LovejoinTokenWay, SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { adaText, formatAda } from "../format";
import { boxText, CLASSIC_BOX } from "../lovejoin-pools";
import { useNetwork } from "../network";
import { withoutStop } from "../sentence";
import { BOX_BACK_ESTIMATE, SESSION_FEE_ESTIMATE } from "../swap";
import { tokenText } from "../tokens";
import { Callout } from "./Callout";
import { ArrowDownIcon } from "./Icons";
import { Modal } from "./Modal";
import { PoolAvatar } from "./PoolAvatar";
import { Row } from "./ReviewRows";

/**
 * Lovejoin's standing, said wherever the user chooses it, all from this one
 * source: the Lovejoin page and its mix reviews, a swap's approval (an
 * ADA→token swap's too, for what a stop or a refund sends through it), a
 * return's review, Bring everything back's review, and Settings. The
 * protocol's own review is the only one it has had: Lovejoin's own words
 * (its README and SECURITY.md); no copy may say otherwise.
 */
export const LOVEJOIN_UNAUDITED = () => t("lovejoin.warn.unaudited");

/**
 * Whom Lovejoin hides a box from (privacy review §2.4, §5.1, §5.2): people
 * reading the chain. Koios sends every transaction the wallet makes and
 * giveme.my lends every Seedelf spend its collateral, both from this
 * device's IP address, so each sees a box go in and come back. Said in
 * Settings (About, and Lovejoin's section) and on Lovejoin's page.
 */
export const LOVEJOIN_SEEN = () => t("lovejoin.privacy.seen");

/**
 * How many mixes fan one box out `depth` waves deep, `width` boxes a mix (lovejoin.ts mixesPerBox): 1, 4 or 13 three
 * wide; 1, 5 or 21 four wide (chunk 34's D3).
 */
export const mixesPerBox = (depth: number, width = 3) => (width ** depth - 1) / (width - 1);

/**
 * What the wallet plans a mix at, as WebAssembly prices a mix's funding and
 * a swap's way back (seedelf-core's MIX_FEE_ESTIMATE: 0.95 ₳, above the
 * 0.877 ₳ one measured on preprod and about 0.82 ₳ on mainnet). Settings
 * prices each depth at it too, so the Lovejoin page, its reviews and
 * Settings give one figure (chunk 23's second review, LJ-3): Settings said
 * "about 3.5 ₳" where the page said "about 3.8 ₳" for the same mixes. What
 * the mixes don't use comes back.
 */
const MIX_FEE_ESTIMATE = 950_000;

/**
 * And a mix four boxes wide (chunk 34's D3; seedelf-core's MIX_FEE_ESTIMATE_FOUR): 1.35 ₳, above the 1.214 ₳ one
 * measured on mainnet's classic pool and 1.227 ₳ on a token pool.
 */
const MIX_FEE_ESTIMATE_FOUR = 1_350_000;

/** What the wallet plans one mix at, `width` boxes a mix. */
export const mixFeeEstimate = (width = 3) => (width === 4 ? MIX_FEE_ESTIMATE_FOUR : MIX_FEE_ESTIMATE);

/** About what `mixes` mixes cost, in ₳, as every screen that prices Lovejoin says it; `width` boxes a mix. */
export const mixFeesText = (mixes: number, width = 3): string => formatAda(String(mixes * mixFeeEstimate(width)));

/**
 * About what one 10 ₳ box costs on a session's way back at `depth`: its
 * mixes, and bringing it back (BOX_BACK_ESTIMATE), in lovelace. What the
 * connector says a private session's return through Lovejoin adds (blind
 * test §9.8, T16: "adds Lovejoin's fees" gave no figure).
 */
export const boxCost = (depth: number, width = 3): bigint =>
  BigInt(mixesPerBox(depth, width) * mixFeeEstimate(width)) + BOX_BACK_ESTIMATE;

/**
 * How well Lovejoin hides a box at `depth`, said wherever the user chooses
 * it (privacy review §2.6): at best one of the fan-out's width^depth leaves
 * (`width` boxes a mix, chunk 34's D3), and fewer while few people bring
 * boxes back into a Seedelf (§5.3). Spending returned boxes together, or with
 * the session's funding change, narrows it.
 */
export function lovejoinHides(depth: number, width = 3): string {
  return t("lovejoin.privacy.hides", { count: depth, one: width ** depth });
}

/**
 * Why a mix asked four boxes wide goes three (chunk 34's D3, `fellBack`: the
 * worker's reason, a whole sentence), said where its review or its approval
 * shows the width. Nothing when it went at the width asked.
 */
export function WidthNote({ fellBack, testId = "lovejoin-width-fell-back" }: { fellBack?: string; testId?: string }) {
  if (!fellBack) return null;
  return (
    <p className="note" data-testid={testId}>
      {fellBack}
    </p>
  );
}

/**
 * How far a return's chain through Lovejoin has got, in words. `byHand`: a
 * session nothing brings back by itself (no `auto`: a site's, or one brought
 * back from Bring everything back), whose stopped chain's rest stays at its
 * account until the user brings it back (independent review L23).
 */
export function chainText(c: NonNullable<SessionView["chain"]>, byHand = false): string {
  if (c.cut) return t("lovejoin.chain.cut", { sent: c.sent, total: c.total });
  if (c.stopped && byHand) return t("lovejoin.chain.stoppedByHand", { sent: c.sent, total: c.total });
  if (c.stopped) return t("lovejoin.chain.stopped", { sent: c.sent, total: c.total });
  if (c.sent < c.total) return t("lovejoin.chain.sending", { sent: c.sent, total: c.total });
  if (c.confirmed < c.total) return t("lovejoin.chain.onChain", { confirmed: c.confirmed, total: c.total });
  return t("lovejoin.chain.allOnChain", { total: c.total });
}

/** How often a page reads a chain's progress: the device's record alone, no Koios. */
const WATCH_EVERY_MS = 2_000;

/**
 * Reads the sessions' record every few seconds while `active`. A chain being
 * sent moves on with every transaction, but the request that sends it
 * answers only at its end, and the runner's confirmations land in the record
 * as it reads them.
 */
export function useSessionsWhile(active: boolean, onRead: (sessions: SessionView[]) => void): void {
  const read = useRef(onRead);
  read.current = onRead;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      call("sessions", {}).then(
        (all) => read.current(all),
        () => undefined,
      );
    }, WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [active]);
}

/** A return's Send button while it's sent (`active`): "Sending 7 of 13…" once its chain is on its way. */
export function useSendingLabel(index: number, active: boolean): string {
  const [chain, setChain] = useState<SessionView["chain"]>();
  useSessionsWhile(active, (all) => setChain(all.find((s) => s.index === index)?.chain));
  useEffect(() => {
    if (!active) setChain(undefined);
  }, [active]);
  return active && chain && !chain.cut && chain.sent < chain.total
    ? t("lovejoin.sendingOf", { sent: chain.sent, total: chain.total })
    : t("common.sending");
}

/** "1-6" as "1 to 6 hours". */
export function delayText(delay: string): string {
  const [low, high] = delay.split("-");
  return t("lovejoin.delayHours", { low, high });
}

/**
 * What a return puts through Lovejoin, in words: "3 boxes of 10 ₳" into the classic pool, as it said before; across
 * pools (chunk 34's 34e), each pool's, "2 boxes of 10 ₳, 1 box of 100 NIGHT + 4.5 ₳". A pool the summary didn't
 * value is named by its boxes alone.
 */
export function partsText(network: NetworkName, l: NonNullable<SessionBackSummary["lovejoin"]>): string {
  const boxOf = (pool?: string) => (pool === undefined ? CLASSIC_BOX : l.values?.[pool]);
  const one = (pool: string | undefined, boxes: number) => {
    const box = boxOf(pool);
    return box ? t("lovejoin.boxesOf", { count: boxes, box: boxText(network, box) }) : t("amount.boxes", { count: boxes, n: boxes });
  };
  if (l.parts?.length) return l.parts.map((p) => one(p.pool, p.boxes)).join(t("histories.list.comma"));
  return one(l.pool, l.boxes);
}

/** "2 waves deep, 8 mixes", and four boxes a mix where it goes four (chunk 34's D3). */
function mixedText(l: { depth: number; mixes: number; width?: number }): string {
  const value = t("lovejoin.mixedValue", { count: l.depth, mixes: l.mixes });
  return l.width === 4 ? t("lovejoin.review.fourWide", { value }) : value;
}

/**
 * The review's rows for the part that goes through Lovejoin; nothing for a plain return. Its tokens, each through
 * its own pool or back directly, are TokenWays' (with Change), under the rows.
 */
export function LovejoinRows({ back }: { back: SessionBackSummary }) {
  const tr = useT();
  const network = useNetwork();
  const l = back.lovejoin;
  if (!l) return null;
  return (
    <>
      <Row label={tr("claim.throughLovejoin")} value={partsText(network, l)} strong />
      <Row label={tr("lovejoin.mixedLabel")} value={mixedText(l)} />
      <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachAfter", { delay: delayText(l.delay) })} stack />
      <BoxesBackRow boxes={l.boxes} />
    </>
  );
}

/**
 * A return's or a swap's tokens on their way back (chunk 34's 34e and 34f): each through its own pool, its boxes
 * and what a box holds there, or back directly and why; a pool whose boxes can't pay their own way back today, under
 * its row (`stuck`, the owner's call 34). Change, where there's a choice, picks another of its pools
 * that can take a box now, or back directly (`onChange`, by the token's unit, null for directly), and the review is
 * built again. `values`: what a box holds in each pool, by id. `funded`: a swap's, whose boxes are as many as the
 * least it asks for makes, funded at Send.
 */
export function TokenWays({
  ways,
  values,
  busy,
  onChange,
  funded = false,
}: {
  ways: LovejoinTokenWay[];
  values?: Record<string, LovejoinBoxValue>;
  busy: boolean;
  onChange?: (unit: string, pool: string | null) => void;
  funded?: boolean;
}) {
  const tr = useT();
  const network = useNetwork();
  const [changing, setChanging] = useState<LovejoinTokenWay>();
  if (!ways.length) return null;
  const valueOf = (pool?: string) => (pool ? values?.[pool] : undefined);
  return (
    <div className="stack-tight">
      <h2 id="lovejoin-ways-title">{tr(funded ? "lovejoin.ways.titleSwap" : "lovejoin.ways.title")}</h2>
      <ul className="list" data-testid="lovejoin-token-ways">
        {ways.map((w) => {
          const name = tokenText(network, w).label;
          const box = valueOf(w.pool);
          const into = w.pool && w.boxes > 0;
          const text = into
            ? tr(funded ? "lovejoin.ways.fundedInto" : "lovejoin.ways.into", {
                boxes: box ? t("lovejoin.boxesOf", { count: w.boxes, box: boxText(network, box) }) : t("amount.boxes", { count: w.boxes, n: w.boxes }),
              })
            : w.direct
              ? tr("lovejoin.ways.directChosen")
              : w.skipped
                ? tr("lovejoin.ways.warn.direct", { why: withoutStop(w.skipped) })
                : tr("lovejoin.ways.direct");
          // A choice to make: another pool that takes a box, or back directly, or back into one after choosing directly.
          const choice = !!onChange && (w.pools.length > (w.pool ? 1 : 0) || (!!w.pool && !w.direct) || (!!w.direct && w.pools.length > 0));
          return (
            <li key={`${w.policyId}.${w.assetName}`} className="token-row swap-row mix-card" data-testid="lovejoin-token-way">
              <PoolAvatar token={w} />
              <span className="token-row__label">{name}</span>
              {choice && (
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => setChanging(w)}
                  data-testid="lovejoin-token-way-change"
                >
                  {tr("lovejoin.ways.change")}
                </button>
              )}
              <span className={`token-row__sub wrap${!into && !w.direct ? " token-row__sub--warn" : ""}`}>{text}</span>
              {/* Its pool's boxes can't pay their own way back today: chosen as any pool, and said (the owner's
                  call 34). */}
              {into && w.stuck && (
                <span className="token-row__sub wrap token-row__sub--warn" data-testid="lovejoin-token-way-stuck">
                  {tr("lovejoin.ways.warn.stuck")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {changing && onChange && (
        <Modal
          title={tr("lovejoin.ways.changeTitle", { token: tokenText(network, changing).label })}
          titleId="lovejoin-way-change-title"
          onClose={() => setChanging(undefined)}
          foot={
            <button type="button" className="secondary" onClick={() => setChanging(undefined)}>
              {tr("common.cancel")}
            </button>
          }
        >
          <ul className="list" data-testid="lovejoin-way-options">
            {changing.pools.map((id) => {
              const box = valueOf(id);
              const chosen = id === changing.pool && !changing.direct;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="token-row"
                    aria-pressed={chosen}
                    disabled={busy || chosen}
                    onClick={() => {
                      setChanging(undefined);
                      onChange(`${changing.policyId}${changing.assetName}`, id);
                    }}
                    data-testid={`lovejoin-way-option-${id}`}
                  >
                    <PoolAvatar token={box?.token} />
                    <span className="token-row__label">{box ? boxText(network, box) : id.slice(0, 8)}</span>
                    <span className="token-row__sub">{chosen ? tr("lovejoin.ways.chosen") : tr("lovejoin.ways.intoThis")}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className="token-row"
                aria-pressed={!!changing.direct}
                disabled={busy || !!changing.direct}
                onClick={() => {
                  setChanging(undefined);
                  onChange(`${changing.policyId}${changing.assetName}`, null);
                }}
                data-testid="lovejoin-way-option-direct"
              >
                <span className="avatar avatar--contact" aria-hidden="true">
                  <ArrowDownIcon size={16} />
                </span>
                <span className="token-row__label">{tr("lovejoin.ways.directOption")}</span>
                <span className="token-row__sub wrap">{tr("lovejoin.ways.privacy.direct")}</span>
              </button>
            </li>
          </ul>
        </Modal>
      )}
    </div>
  );
}

/**
 * About what bringing `boxes` Lovejoin boxes back costs, in lovelace, each paid from its box as it comes back
 * (BOX_BACK_ESTIMATE). A return's review counted its chain's fees and not these, so a 10 ₳ box came back as about
 * 9.7 ₳ with nothing to say so (pass two of the blind test's fix round); the Lovejoin page's costs and a swap's say it.
 */
export const boxesBackCost = (boxes: number): bigint => BigInt(boxes) * BOX_BACK_ESTIMATE;

/** "Bringing them back, about 0.6 ₳", in the Lovejoin page's words: a return's review, and Bring everything back's. */
export function BoxesBackRow({ boxes }: { boxes: number }) {
  const tr = useT();
  return <Row label={tr("lovejoin.mix.backLabel", { count: boxes })} value={adaText(boxesBackCost(boxes).toString())} />;
}

/**
 * A return's way back, first on its review, as a swap's approval and Stop's
 * dialog have it: the switch, on through Lovejoin as built, off directly.
 * Bringing it back directly was a link under the costs ("Bring it back
 * directly instead"), and the owner, stopping a real swap after a price
 * drop, never saw Stop's (5289dcf): a cheaper, less private way is a switch
 * seen first, the private way still the default. `through`: which way the
 * review shown was built; `onThrough` builds it the other way. Shown only
 * where Lovejoin took the return, or was turned off here: with no box to
 * take, there's no choice to make.
 */
export function LovejoinSwitch({
  back,
  through,
  busy,
  onThrough,
}: {
  back: SessionBackSummary;
  through: boolean;
  busy: boolean;
  onThrough: (through: boolean) => void;
}) {
  const tr = useT();
  if (!back.lovejoin && through) return null;
  // A return whose boxes are all a token pool's mixes no spare ADA (the token legs are paid first, and its ADA may pay
  // for none of the classic pool's): it says its tokens go into their pools instead (1.6.0's release review, UI-12).
  const l = back.lovejoin;
  const classic = !l || (l.parts?.length ? l.parts.some((p) => p.pool === undefined && p.boxes > 0) : l.pool === undefined);
  return (
    <div className="setting-row" data-testid="lovejoin-way">
      <span className="stack-tight">
        <span id="lovejoin-way-label">{tr("swaps.lovejoin.label")}</span>
        <span className="note" id="lovejoin-way-note">
          {tr(!through ? "swaps.lovejoin.privacy.off" : classic ? "swaps.lovejoin.privacy.on" : "swaps.lovejoin.privacy.onTokens")}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={through}
        aria-labelledby="lovejoin-way-label"
        aria-describedby="lovejoin-way-note"
        onClick={() => onThrough(!through)}
        disabled={busy}
        data-testid="lovejoin-way-switch"
      />
    </div>
  );
}

/**
 * What going through Lovejoin takes and hides, under a return's rows (LovejoinSwitch chooses it), and why four boxes a
 * mix went three where it did (D3: "the review says so"; it was said on every mix's review but a return's: 1.6.0's
 * release review, UI-4). Or why it was left out this time.
 */
export function LovejoinNote({ back }: { back: SessionBackSummary }) {
  const tr = useT();
  const l = back.lovejoin;
  if (back.lovejoinSkipped) {
    return (
      <Callout tone="warn" testId="lovejoin-skipped">
        {tr("lovejoin.warn.skippedThis", { why: withoutStop(back.lovejoinSkipped) })}
      </Callout>
    );
  }
  if (!l) return null;
  return (
    <>
      <Callout tone="privacy">
        {tr("lovejoin.privacy.spare", {
          count: l.depth,
          hides: lovejoinHides(l.depth, l.width),
          fees: formatAda(l.fees),
          txs: l.txs,
          delay: delayText(l.delay),
        })}
      </Callout>
      <WidthNote fellBack={l.fellBack} />
      <p className="note" data-testid="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED()}
      </p>
    </>
  );
}

/**
 * Why a session's return came back directly, leaving Lovejoin out, though
 * its spare ADA would have paid for a box: the pool below its floor, too
 * few boxes free, or a chain the wallet couldn't build (launch review #23).
 */
export function LovejoinSkipped({ reason }: { reason?: string }) {
  const tr = useT();
  if (!reason) return null;
  return (
    <Callout tone="warn" testId="session-lovejoin-skipped">
      {tr("lovejoin.warn.skippedIts", { why: withoutStop(reason) })}
    </Callout>
  );
}

/**
 * Where the session's 5 ₳ collateral goes when its return mixes it once on its way into Lovejoin's 5 ₳ pool (the
 * owner, 2026-10-22 and 2026-10-23): not back with the rest, and what that costs. Nothing otherwise.
 * CollateralTailNote says how it comes back.
 */
export function CollateralTailRow({ back }: { back: SessionBackSummary }) {
  const tr = useT();
  if (!back.collateralTail) return null;
  return (
    <Row
      label={tr("lovejoin.collateralBox.label")}
      value={tr("lovejoin.collateralBox.value", { fee: formatAda(back.collateralTail.fee) })}
    />
  );
}

/** That the collateral is mixed once, giveme.my backing that mix, then comes back by itself; tied to the session until then. */
export function CollateralTailNote({ back }: { back: SessionBackSummary }) {
  const tr = useT();
  if (!back.collateralTail) return null;
  return (
    <Callout tone="privacy" testId="collateral-box-note">
      {tr("lovejoin.collateralBox.privacy.note", { count: 1 })}
    </Callout>
  );
}

/**
 * What a review or Stop's dialog says of giveme.my and the session's collateral's mix that runs by itself as the session
 * comes back, by the one rule the worker decides it by (`mix`, CollateralMix; 1.6.0's review of the fixes, fx-promise):
 * mixed, in the screen's own words (`mixed`: the approval's, which follow GivemeNote, or Stop's); mixed only if enough
 * is left, where it may not be, its giveme.my part said so it holds either way; nothing where no mix can go. A return
 * reviewed by hand says it as it's built (CollateralTailNote).
 */
export function CollateralMixLine({ mix, mixed, testId }: { mix?: CollateralMix; mixed: I18nKey; testId: string }) {
  const tr = useT();
  if (!mix) return null;
  return (
    <p className="note" data-testid={testId}>
      {tr(mix === "mixed" ? mixed : "lovejoin.collateralMix.privacy.ifLeft")}
    </p>
  );
}

/**
 * What a session's funding pays beside its 5 ₳ collateral for that collateral to be mixed as the session comes back
 * (SessionOutSummary `collateralReserve`): what that mix doesn't spend comes back. Nothing where it won't be.
 */
export function CollateralReserveRow({ reserve }: { reserve?: string }) {
  const tr = useT();
  if (!reserve) return null;
  return <Row label={tr("lovejoin.collateralReserve.label")} value={tr("lovejoin.collateralReserve.value", { ada: formatAda(reserve) })} />;
}

/**
 * About what a session's collateral's mix costs where its funding pays for it (CollateralReserveRow), in lovelace: its
 * deposit (SESSION_FEE_ESTIMATE) and the mix under giveme.my's collateral, three boxes wide, from what was paid for it,
 * then its box's way back (BOX_BACK_ESTIMATE), from the box. Measured on preprod: 0.17, 0.83 and 0.29 ₳. A swap's
 * costs and a site's way back count it, which counted what pays for that mix as coming back (1.6.0's release review,
 * 323-worker#1).
 */
export const COLLATERAL_MIX_COST = SESSION_FEE_ESTIMATE + BigInt(MIX_FEE_ESTIMATE) + BOX_BACK_ESTIMATE;

/** Where what comes back lands: the private UTxO the session's funding made, or new ones. */
export function IntoRow({ back }: { back: SessionBackSummary }) {
  const tr = useT();
  return <Row label={tr("lovejoin.intoLabel")} value={tr(back.merged ? "lovejoin.intoMerged" : "lovejoin.intoNew")} />;
}

/** What the return ties to the session on chain. `after` follows it, for the page's own words. */
export function ReturnLinks({ back, after }: { back: SessionBackSummary; after?: string }) {
  const tr = useT();
  return (
    <Callout tone="privacy">{joinSentences([tr(back.merged ? "lovejoin.privacy.merged" : "lovejoin.privacy.newUtxos"), after])}</Callout>
  );
}

/** Whether a return held at its collateral's mix is offered the way out at `now`: from the worker's `offerAt` on. */
export const wayOutOffered = (held: SessionView["collateralHeld"], now = Date.now()): boolean => !!held && now >= held.offerAt;

/**
 * Whether a page opens its return's review once the way out took effect, by the press's answer (`after`): a session
 * brought back by hand, nothing held now, its rest at the account as last read (the page's own reading, `read`, where a
 * worker started afresh since has none). Nothing else brings that rest back, so Bring the rest back now goes on to it,
 * as Bring it back does; a swap or a mix that runs itself sent its return in the press's own request (1.7.0's release
 * review, pr337#1). Never while its chain is still being sent, as Swaps' `chainGoing` reads it: that chain's own return
 * brings the rest back, and the worker refuses another till it's sent. The press's own stop, or a lock's cut, leaves
 * none going (1.7.0's fixes' review, screens#3).
 */
export function reviewAfterSkip(after: SessionView, read: SessionView["holding"] = null): boolean {
  const holding = after.holding ?? read;
  const going = !!after.chain && !after.chain.cut && !after.chain.stopped && after.chain.sent < after.chain.total;
  return !after.auto && !after.collateralHeld && after.stage === "open" && !going && !!holding && holding.utxos > 0;
}

/**
 * A session's return held at its collateral's mix (SessionView `collateralHeld`), once its page offers the way out (an
 * hour after the mix's deposit went in, the worker's `offerAt`): what's still waiting, that bringing the rest back
 * without it leaves the 5 ₳ box in the pool unmixed and tied to the session, and the button (session-skip-collateral-mix;
 * the owner, 2026-10-28; 1.6.0's release review, 323-worker#3). Nothing before then, nor once it's over. `now`: for tests.
 */
export function CollateralHeldWayOut({
  held,
  busy,
  onSkip,
  now = Date.now(),
}: {
  held?: SessionView["collateralHeld"];
  busy: boolean;
  onSkip: () => void;
  now?: number;
}) {
  const tr = useT();
  if (!wayOutOffered(held, now)) return null;
  return (
    <div className="stack" data-testid="collateral-held">
      <Callout tone="privacy">{tr("lj.tail.privacy.wayOut")}</Callout>
      <button type="button" className="secondary" disabled={busy} onClick={onSkip} data-testid="collateral-held-skip">
        {tr("lj.tail.wayOut")}
      </button>
    </div>
  );
}
