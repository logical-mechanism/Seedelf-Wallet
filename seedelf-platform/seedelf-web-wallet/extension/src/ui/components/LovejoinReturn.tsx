// What a return's review says when the session's spare ADA goes through
// Lovejoin first (roadmap chunk 16): the boxes, the fan-out, when each comes
// back, and a way to bring this one back directly instead.
import type { SessionBackSummary } from "../../shared/rpc";
import { formatAda, plural } from "../format";
import { Callout } from "./Callout";
import { Row } from "./ReviewRows";

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

/** Why, and the way out: `onDirect` rebuilds the return without Lovejoin. */
export function LovejoinNote({ back, busy, onDirect }: { back: SessionBackSummary; busy: boolean; onDirect: () => void }) {
  const l = back.lovejoin;
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
