// Lovejoin's page in the dApp browser (roadmap chunk 16): the wallet's boxes
// in the mixer's pool, found by the Seedelf key wherever other people's mixes
// moved them, when each is due back, and a way to bring one back now. A
// private session's spare ADA goes in on its way back (Settings, Lovejoin);
// mixing from here directly comes next.
import { useCallback, useEffect, useState } from "react";

import type { LovejoinStatus, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { formatAda, plural, whenOf } from "../format";

export function Lovejoin({ onBack, onPending }: { onBack: () => void; onPending: (pending: PendingTx) => void }) {
  const [status, setStatus] = useState<LovejoinStatus>();
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // One pool read on open, and on Refresh.
  const load = useCallback(async () => {
    setReading(true);
    try {
      setStatus(await call("lovejoin-status", {}));
      setUpdatedAt(Date.now());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function now() {
    setBusy(true);
    try {
      onPending(await call("lovejoin-withdraw-now", {}));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const boxes = status?.boxes.length ?? 0;
  const next = status?.due[0];
  return (
    <Screen title="Lovejoin" titleId="lovejoin-title" onBack={onBack} backDisabled={busy} aside="A mixer for ADA, in 10 ₳ boxes" error={error}>
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load()} />
      {status && !status.available && <p className="note">Lovejoin isn't on this network yet.</p>}
      {status?.available && (
        <ReviewRows testId="lovejoin-status">
          <Row label="Your boxes in the pool" value={boxes ? `${plural(boxes, "box", "boxes")}, ${formatAda(status.lovelace)} ₳` : "None"} strong />
          {boxes > 0 && next !== undefined && (
            <Row label="Next one back" value={next <= Date.now() ? "At the next unlock" : whenOf(next, new Date())} />
          )}
        </ReviewRows>
      )}
      {boxes > 0 && (
        <button type="button" className="secondary" disabled={busy} onClick={() => void now()} data-testid="lovejoin-now">
          {busy ? "Bringing one back…" : "Bring one back now"}
        </button>
      )}
      <Callout tone="privacy">
        A box waits in the pool while other people's mixes move it, and comes back into your private balance on its own,
        paid from itself, with giveme.my's collateral: nothing ties it to the session it came from. Bringing one back
        early shortens that wait, which makes it easier to match by its timing.
      </Callout>
    </Screen>
  );
}
