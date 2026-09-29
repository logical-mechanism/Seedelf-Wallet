// What a session return's review says about where its money goes (roadmap
// chunk 16): into the private UTxO the session's funding made, or new ones;
// and, when its spare ADA goes through Lovejoin first, the boxes, the
// fan-out, when each comes back, and a way to bring this one back directly.
// Then, as its chain goes, how far it has got: sent, then on chain; and,
// when a return left Lovejoin out, why (launch review #23). Wherever the
// user chooses Lovejoin, it says Lovejoin has had no third-party audit:
// Lovejoin's own docs say so, and no copy here may say otherwise.
import { useEffect, useRef, useState } from "react";

import type { SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { formatAda, plural } from "../format";
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
export const LOVEJOIN_UNAUDITED =
  "Lovejoin hasn't had a third-party audit: its makers' own review is the only one it has had. Use it knowing that.";

/**
 * Whom Lovejoin hides a box from (privacy review §2.4, §5.1, §5.2): people
 * reading the chain. Koios sends every transaction the wallet makes and
 * giveme.my lends every Seedelf spend its collateral, both from this
 * device's IP address, so each sees a box go in and come back. Said in
 * Settings (About, and Lovejoin's section) and on Lovejoin's page.
 */
export const LOVEJOIN_SEEN =
  "Lovejoin hides your boxes from people reading the chain, not from Koios or giveme.my, which see your device send both ends.";

/**
 * How well Lovejoin hides a box at `depth`, said wherever the user chooses
 * it (privacy review §2.6): at best one of the fan-out's 3^depth leaves, and
 * fewer while few people bring boxes back into a Seedelf (§5.3). Spending
 * returned boxes together, or with the session's funding change, narrows it.
 */
export function lovejoinHides(depth: number): string {
  return `Which box coming out is yours stays one of up to ${3 ** depth} (at ${depth} ${depth === 1 ? "wave" : "waves"} deep), fewer while few people use Lovejoin. Spending boxes that came back together, or with the change the session's funding left, narrows it.`;
}

/**
 * How far a return's chain through Lovejoin has got, in words. `byHand`: a
 * session nothing brings back by itself (no `auto`: a site's, or one brought
 * back from Bring everything back), whose stopped chain's rest stays at its
 * account until the user brings it back (independent review L23).
 */
export function chainText(c: NonNullable<SessionView["chain"]>, byHand = false): string {
  if (c.cut) return `Stopped after ${c.sent} of ${c.total} transactions; what was left came back directly`;
  if (c.stopped && byHand) {
    return `Stopped after ${c.sent} of ${c.total} transactions; once those are on chain, what's left stays at the account until you bring it back`;
  }
  if (c.stopped) return `Stopped after ${c.sent} of ${c.total} transactions; once those are on chain, what's left comes back directly`;
  if (c.sent < c.total) return `Sending ${c.sent} of ${c.total} transactions`;
  if (c.confirmed < c.total) return `${c.confirmed} of ${c.total} transactions on chain`;
  return `All ${c.total} transactions on chain`;
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
  return active && chain && !chain.cut && chain.sent < chain.total ? `Sending ${chain.sent} of ${chain.total}…` : "Sending…";
}

/** "1-6" as "1 to 6 hours". */
export function delayText(delay: string): string {
  const [low, high] = delay.split("-");
  return `${low} to ${high} hours`;
}

/** The review's rows for the part that goes through Lovejoin; nothing for a plain return. */
export function LovejoinRows({ back }: { back: SessionBackSummary }) {
  const l = back.lovejoin;
  if (!l) return null;
  return (
    <>
      <Row label="Through Lovejoin" value={`${plural(l.boxes, "box", "boxes")} of 10 ₳`} strong />
      <Row label="Mixed" value={`${l.depth} ${l.depth === 1 ? "wave" : "waves"} deep, ${plural(l.mixes, "mix", "mixes")}`} />
      <Row label="Back later" value={`Each on its own, after ${delayText(l.delay)}`} />
    </>
  );
}

/** A reason from the worker as part of a sentence: without its full stop. */
const clause = (reason: string) => reason.trim().replace(/\.$/, "");

/** Why, and the way out: `onDirect` rebuilds the return without Lovejoin. Or why Lovejoin was left out this time. */
export function LovejoinNote({ back, busy, onDirect }: { back: SessionBackSummary; busy: boolean; onDirect: () => void }) {
  const l = back.lovejoin;
  if (back.lovejoinSkipped) {
    return (
      <Callout tone="warn" testId="lovejoin-skipped">
        Lovejoin is left out of this return: {clause(back.lovejoinSkipped)}. So the chain doesn't start, and everything comes
        back directly, as it would without Lovejoin.
      </Callout>
    );
  }
  if (!l) return null;
  return (
    <>
      <Callout tone="privacy">
        The spare ADA goes through Lovejoin first, so what comes back is harder to tie to this session on chain:{" "}
        {plural(l.boxes, "box", "boxes")} of 10 ₳, each mixed with other people's, {l.depth}{" "}
        {l.depth === 1 ? "wave" : "waves"} deep. {lovejoinHides(l.depth)} This session pays every mix ({formatAda(l.fees)} ₳
        over {l.txs} transactions). Each box comes back on its own after a random {delayText(l.delay)}, at the first unlock
        after that. The rest comes back now.
      </Callout>
      <p className="note" data-testid="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED}
      </p>
      <button type="button" className="link" disabled={busy} onClick={onDirect} data-testid="lovejoin-direct">
        Bring it back directly instead
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
  if (!reason) return null;
  return (
    <Callout tone="warn" testId="session-lovejoin-skipped">
      Lovejoin was left out of its return: {clause(reason)}. So it comes back directly, without mixing: what comes back is
      tied to the session on chain.
    </Callout>
  );
}

/** Where what comes back lands: the private UTxO the session's funding made, or new ones. */
export function IntoRow({ back }: { back: SessionBackSummary }) {
  return <Row label="Into" value={back.merged ? "The private UTxO its funding made" : "New private UTxOs"} />;
}

/** What the return ties to the session on chain. `after` follows it, for the page's own words. */
export function ReturnLinks({ back, after }: { back: SessionBackSummary; after?: string }) {
  return (
    <Callout tone="privacy">
      {back.merged
        ? "What comes back joins the private UTxO this session's funding made, which is tied to the session on chain already, so no new private UTxO is."
        : "This links the one-time account to the new private UTxOs, as Make private does."}
      {after ? ` ${after}` : ""}
    </Callout>
  );
}
