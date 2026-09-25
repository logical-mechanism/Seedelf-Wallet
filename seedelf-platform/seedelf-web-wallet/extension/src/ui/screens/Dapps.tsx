// The dApp browser (roadmap chunk 15, step 3): the dApps the wallet can use
// privately, as a grid of tiles. Each runs inside the wallet from one-time
// accounts funded from the private balance, never the public account.
// Minswap is the first: its tile opens its swaps (Swaps.tsx). The next
// contract gets a tile of its own.
//
// Under the tiles, Sites: each site connected to a private session (chunk
// 15c, private CIP-30), which opens its page (SiteSessions.tsx). Above them,
// when sessions hold money and nothing of theirs is on its way, Bring
// everything back (ClaimAll.tsx): each in its own transaction.

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { Balances, PendingTx, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { SwapIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { Screen } from "../components/Screen";
import { formatAda, plural } from "../format";
import { ClaimAll, isClaimable } from "./ClaimAll";
import { isSiteSession, SiteRow, SiteSession } from "./SiteSessions";
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
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [site, setSite] = useState<number>();
  const [claiming, setClaiming] = useState(false);
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [error, setError] = useState<string>();

  // From the device's own record; `refresh` reads the sessions' accounts too (a site's page asks for it).
  const load = useCallback(async (refresh: boolean) => {
    setReading(refresh);
    try {
      setSessions(await call("sessions", { refresh }));
      if (refresh) setUpdatedAt(Date.now());
      setError(undefined);
    } catch (e) {
      if (refresh) setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  // The device's record at once, then the sessions' accounts: what each holds decides what can come back.
  useEffect(() => {
    if (!open) void load(false).then(() => load(true));
  }, [open, load]);

  // A site's page reads what its account holds when it opens.
  useEffect(() => {
    if (site !== undefined) void load(true);
  }, [site, load]);

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

  const claimable = sessions.filter(isClaimable);
  if (claiming) {
    return (
      <ClaimAll
        sessions={claimable}
        onBack={() => setClaiming(false)}
        onDone={() => {
          setClaiming(false);
          void load(true);
        }}
      />
    );
  }

  const opened = site === undefined ? undefined : sessions.find((s) => s.index === site);
  if (opened) {
    return (
      <SiteSession
        session={opened}
        seedelf={seedelf}
        reading={reading}
        updatedAt={updatedAt}
        onRefresh={() => void load(true)}
        onBack={() => setSite(undefined)}
        onPending={onPending}
        onDisconnected={() => {
          setSite(undefined);
          void load(false);
        }}
      />
    );
  }

  const running = sessions.filter(isRunningSwap);
  const waiting = running.filter((s) => s.auto?.paused).length;
  const sites = sessions.filter(isSiteSession);

  return (
    <Screen title="dApps" titleId="dapps-title" onBack={onBack} aside="Used privately, from one-time accounts" error={error}>
      {sessions.some((s) => s.stage !== "closed") && (
        <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load(true)} />
      )}
      {claimable.length > 0 && <ClaimCard sessions={claimable} onOpen={() => setClaiming(true)} />}
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
      {sites.length > 0 && (
        <section className="section" aria-label="Sites">
          <h2>Sites</h2>
          <ul className="list" data-testid="dapp-sites">
            {sites.map((s) => (
              <li key={s.index}>
                <SiteRow session={s} onOpen={() => setSite(s.index)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <Callout tone="privacy">
        A dApp here never sees your public account or your private balance: each use runs from a new one-time account,
        funded from your private balance and brought back into it. Anyone can follow the money through that account,
        though.
      </Callout>
      {sites.length === 0 && (
        <p className="note" data-testid="dapp-sites-hint">
          On a dApp's own site, connect Seedelf Wallet and choose a private session: the site then sees a one-time account,
          and it's listed here.
        </p>
      )}
    </Screen>
  );
}

/** Money waiting in private sessions, and Bring everything back. */
function ClaimCard({ sessions, onOpen }: { sessions: SessionView[]; onOpen: () => void }) {
  const lovelace = sessions.reduce((sum, s) => sum + BigInt(s.holding?.lovelace ?? "0"), 0n);
  const tokens = new Set(sessions.flatMap((s) => (s.holding?.tokens ?? []).map((t) => t.policyId + t.assetName))).size;
  return (
    <section className="section claim-card" aria-labelledby="claim-card-title" data-testid="claim-card">
      <h2 id="claim-card-title">In private sessions</h2>
      <p className="claim-card__amount">
        {formatAda(lovelace.toString())} ₳{tokens ? ` and ${plural(tokens, "token")}` : ""}
      </p>
      <p className="note">
        {plural(sessions.length, "session")} {sessions.length === 1 ? "holds" : "hold"} it, with nothing of theirs on its way.
      </p>
      <button type="button" className="secondary" onClick={onOpen}>
        Bring everything back
      </button>
    </section>
  );
}

