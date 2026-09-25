// The dApp browser (roadmap chunk 15, step 3): the dApps the wallet can use
// privately, as a grid of tiles. Each runs inside the wallet from one-time
// accounts funded from the private balance, never the public account.
// Minswap is the first: its tile opens its swaps (Swaps.tsx). The next
// contract gets a tile of its own.

import { useEffect, useState, type ReactNode } from "react";

import type { Balances, PendingTx, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { SwapIcon } from "../components/Icons";
import { Screen } from "../components/Screen";
import { isRunningSwap, Swaps, SwapTag } from "./Swaps";

type DappId = "minswap";

interface Dapp {
  id: DappId;
  name: string;
  /** What it's for, in a few words. */
  what: string;
  icon: ReactNode;
}

const DAPPS: Dapp[] = [{ id: "minswap", name: "Minswap", what: "Swap tokens, routed across Cardano's DEXes", icon: <SwapIcon size={20} /> }];

/** Where the browser opens: a dApp, and one of its sessions. */
export interface DappStart {
  dapp: DappId;
  session?: number;
}

export function Dapps({
  seedelf,
  blocked,
  start,
  onBack,
  onPending,
}: {
  seedelf: Balances["seedelf"];
  /** Why a dApp can't start something now: a transaction still waiting, say. */
  blocked?: string;
  start?: DappStart;
  onBack: () => void;
  onPending: (pending: PendingTx) => void;
}) {
  const [open, setOpen] = useState<DappId | undefined>(start?.dapp);
  const [session, setSession] = useState(start?.session);
  const [running, setRunning] = useState<SessionView[]>([]);

  // What's running, from the device's own record: no request leaves the wallet.
  useEffect(() => {
    if (open) return;
    call("sessions", {}).then(
      (all) => setRunning(all.filter(isRunningSwap)),
      () => undefined,
    );
  }, [open]);

  const waiting = running.filter((s) => s.auto?.paused).length;

  if (open === "minswap") {
    return (
      <Swaps
        seedelf={seedelf}
        blocked={blocked}
        start={session}
        onBack={() => {
          setOpen(undefined);
          setSession(undefined);
        }}
        onPending={onPending}
      />
    );
  }

  return (
    <Screen title="dApps" titleId="dapps-title" onBack={onBack} aside="Used privately, from one-time accounts">
      <div className="dapp-grid" data-testid="dapps">
        {DAPPS.map((d) => (
          <button key={d.id} type="button" className="dapp-tile" onClick={() => setOpen(d.id)}>
            <span className="dapp-tile__logo">{d.icon}</span>
            <span className="dapp-tile__name">{d.name}</span>
            <span className="dapp-tile__what">{d.what}</span>
            {running.length > 0 && (
              <span className="dapp-tile__badge">
                {waiting ? (
                  <SwapTag tone="wait" label={`${waiting} ${waiting === 1 ? "needs" : "need"} you`} />
                ) : (
                  <SwapTag tone="live" label={`${running.length} running`} />
                )}
              </span>
            )}
          </button>
        ))}
        <div className="dapp-tile dapp-tile--soon">
          <span className="dapp-tile__what">More dApps come here as the wallet learns to use them privately.</span>
        </div>
      </div>
      <Callout tone="privacy">
        A dApp here never sees your public account or your private balance: each use runs from a new one-time account,
        funded from your private balance and brought back into it. Anyone can follow the money through that account,
        though.
      </Callout>
    </Screen>
  );
}
