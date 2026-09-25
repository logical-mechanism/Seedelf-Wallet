// What a session return's review says about where its money goes (roadmap
// chunk 16): into the private UTxO the session's funding made, or new ones;
// and, when its spare ADA goes through Lovejoin first, the boxes, the
// fan-out, when each comes back, and a way to bring this one back directly.
// Then, as its chain goes, how far it has got: sent, then on chain.
import { useEffect, useRef, useState } from "react";

import type { SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { formatAda, plural } from "../format";
import { Callout } from "./Callout";
import { Row } from "./ReviewRows";

/** How far a return's chain through Lovejoin has got, in words. */
export function chainText(c: NonNullable<SessionView["chain"]>): string {
  if (c.cut) return `Stopped after ${c.sent} of ${c.total} transactions; what was left came back directly`;
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

/** Why, and the way out: `onDirect` rebuilds the return without Lovejoin. Or why Lovejoin was left out this time. */
export function LovejoinNote({ back, busy, onDirect }: { back: SessionBackSummary; busy: boolean; onDirect: () => void }) {
  const l = back.lovejoin;
  if (back.lovejoinSkipped) {
    return (
      <Callout tone="warn" testId="lovejoin-skipped">
        Lovejoin is left out of this return: {back.lovejoinSkipped}. So the chain doesn't start, and everything comes back
        directly, as it would without Lovejoin.
      </Callout>
    );
  }
  if (!l) return null;
  return (
    <>
      <Callout tone="privacy">
        The spare ADA goes through Lovejoin first, so what comes back isn't tied to this session: {plural(l.boxes, "box", "boxes")} of
        10 ₳, each mixed with other people's boxes, {l.depth} {l.depth === 1 ? "wave" : "waves"} deep. This session pays every mix ({formatAda(l.fees)} ₳
        in fees, all {l.txs} transactions together). Each box comes back into your private balance on its own, after a random{" "}
        {delayText(l.delay)}, the first time the wallet is unlocked after that. The rest comes back now.
      </Callout>
      <button type="button" className="link" disabled={busy} onClick={onDirect} data-testid="lovejoin-direct">
        Bring it back directly instead
      </button>
    </>
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
