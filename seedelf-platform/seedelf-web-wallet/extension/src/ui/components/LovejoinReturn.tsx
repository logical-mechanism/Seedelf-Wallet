// What a session return's review says about where its money goes (roadmap
// chunk 16): into the private UTxO the session's funding made, or new ones;
// and, when its spare ADA goes through Lovejoin first, the boxes, the
// fan-out, when each comes back, and a way to bring this one back directly.
// Then, as its chain goes, how far it has got: sent, then on chain; and,
// when a return left Lovejoin out, why (launch review #23). Wherever the
// user chooses Lovejoin, it says Lovejoin has had no third-party audit:
// Lovejoin's own docs say so, and no copy here may say otherwise.
import { useEffect, useRef, useState } from "react";
import { joinSentences, t, useT } from "../../i18n";

import type { SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { formatAda } from "../format";
import { withoutStop } from "../sentence";
import { Callout } from "./Callout";
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
 * How well Lovejoin hides a box at `depth`, said wherever the user chooses
 * it (privacy review §2.6): at best one of the fan-out's 3^depth leaves, and
 * fewer while few people bring boxes back into a Seedelf (§5.3). Spending
 * returned boxes together, or with the session's funding change, narrows it.
 */
export function lovejoinHides(depth: number): string {
  return t("lovejoin.privacy.hides", { count: depth, one: 3 ** depth });
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

/** The review's rows for the part that goes through Lovejoin; nothing for a plain return. */
export function LovejoinRows({ back }: { back: SessionBackSummary }) {
  const tr = useT();
  const l = back.lovejoin;
  if (!l) return null;
  return (
    <>
      <Row label={tr("claim.throughLovejoin")} value={tr("lovejoin.boxesOfTen", { count: l.boxes })} strong />
      <Row label={tr("lovejoin.mixedLabel")} value={tr("lovejoin.mixedValue", { count: l.depth, mixes: l.mixes })} />
      <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachAfter", { delay: delayText(l.delay) })} />
    </>
  );
}

/** Why, and the way out: `onDirect` rebuilds the return without Lovejoin. Or why Lovejoin was left out this time. */
export function LovejoinNote({ back, busy, onDirect }: { back: SessionBackSummary; busy: boolean; onDirect: () => void }) {
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
          boxes: tr("lovejoin.boxesOfTen", { count: l.boxes }),
          hides: lovejoinHides(l.depth),
          fees: formatAda(l.fees),
          txs: l.txs,
          delay: delayText(l.delay),
        })}
      </Callout>
      <p className="note" data-testid="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED()}
      </p>
      <button type="button" className="link" disabled={busy} onClick={onDirect} data-testid="lovejoin-direct">
        {tr("lovejoin.directInstead")}
      </button>
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
