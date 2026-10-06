// The dApp browser (roadmap chunk 15, step 3): the dApps the wallet can use
// privately, as a grid of tiles. Each runs inside the wallet from one-time
// accounts funded from the private balance, never the public account.
// Minswap is the first: its tile opens its swaps (Swaps.tsx). The next
// contract gets a tile of its own.
//
// Under the tiles, Sites: whether sites can see the wallet at all, with Let
// sites connect while they can't; the sites declined just now, with Let it
// ask now; and every connected site: one on the public account with its
// Disconnect, as Settings' Connected sites has it, and one on a private
// session (chunk 15c, private CIP-30), which opens its page (SiteSessions.tsx)
// and says when its site talks to something else. Users look for sites here
// first, not in Settings (blind test §9.2: T15, T17, T17r, E03). Home's dApps
// row says the same in a line (`DappsRow`). Above the tiles, when sessions hold
// money and nothing of theirs is on its way, Bring everything back
// (ClaimAll.tsx): each in its own transaction. What they hold is hidden with
// the balances (launch review #56).

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { type I18nKey, useT } from "../../i18n";

import { lovejoinOn } from "../../networks";
import type { Balances, DappSite, PendingTx, SessionView, Status } from "../../shared/rpc";
import { call, onDappChanged } from "../background";
import { Callout } from "../components/Callout";
import { ChevronRightIcon, GridIcon, ShieldIcon, SwapIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { Screen } from "../components/Screen";

import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { ClaimAll, isClaimable } from "./ClaimAll";
import { connectorBlockedText, useConnectorSwitch, useDeclined, useSiteAccount, useSitesSummary } from "../sites";
import { DeclinedSites, Disconnected, DisconnectModal, hostOf, SiteItem } from "./ConnectedSites";
import { Lovejoin } from "./Lovejoin";
import { attachedTo, type ConnectedSites, isSiteSession, SiteRow, SiteSession, siteConnected } from "./SiteSessions";
import { fundingUnseen, isRunningSwap, Swaps, SwapTag } from "./Swaps";

type DappId = "minswap" | "lovejoin";

interface Dapp {
  id: DappId;
  name: string;
  /** What it's for, in a few words: a key, read as the tile is drawn. */
  what: I18nKey;
  icon: ReactNode;
}

const DAPPS: Dapp[] = [
  { id: "minswap", name: "Minswap", what: "dapps.minswap.what", icon: <SwapIcon size={20} /> },
  { id: "lovejoin", name: "Lovejoin", what: "dapps.lovejoin.what", icon: <ShieldIcon size={20} /> },
];

/** Where the browser opens: a dApp, and one of its sessions. */
export interface DappStart {
  dapp: DappId;
  session?: number;
}

export function Dapps({
  seedelf,
  blocked,
  start,
  banner,
  onBack,
  onPending,
}: {
  seedelf: Balances["seedelf"];
  /** Why a dApp can't start something now: a transaction still waiting, say. */
  blocked?: string;
  start?: DappStart;
  /** Home's banner for the transaction it's watching, shown on a dApp's page too. */
  banner?: ReactNode;
  onBack: () => void;
  onPending: (pending: PendingTx) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<DappId | undefined>(start?.dapp);
  const [session, setSession] = useState(start?.session);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  // The connected sites, from the device's record: which session each talks to.
  const [connected, setConnected] = useState<ConnectedSites>();
  const [site, setSite] = useState<number>();
  // A site on the public account, asked about before it's disconnected; then which one went.
  const [asking, setAsking] = useState<DappSite>();
  const [gone, setGone] = useState<string>();
  const [forgetting, setForgetting] = useState(false);
  const account = useSiteAccount();
  const declined = useDeclined();
  const [claiming, setClaiming] = useState(false);
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [error, setError] = useState<string>();
  const network = useNetwork();

  // From the device's own record; `refresh` reads the sessions' accounts too (a site's page asks for it).
  const load = useCallback(async (refresh: boolean) => {
    setReading(refresh);
    try {
      setSessions(await call("sessions", { refresh }));
      setConnected(await call("dapp-sites", {}).catch(() => undefined));
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

  // A site connected or disconnected meanwhile, from its window or Settings: the device's record again, no Koios, and
  // nothing else. Every site request broadcasts, so this mustn't clear the page's error or end its Refresh, or drop
  // what the last read of the accounts found for a session still listed (the cross-area review).
  const reread = useCallback(async () => {
    const [list, sites] = await Promise.all([
      call("sessions", {}).catch(() => undefined),
      call("dapp-sites", {}).catch(() => undefined),
    ]);
    if (list) {
      setSessions((before) =>
        list.map((s) => (s.holding ? s : { ...s, holding: before.find((b) => b.index === s.index)?.holding ?? null })),
      );
    }
    if (sites) setConnected(sites);
  }, []);
  useEffect(() => (open ? undefined : onDappChanged(() => void reread())), [open, reread]);

  // A site's page reads what its account holds when it opens.
  useEffect(() => {
    if (site !== undefined) void load(true);
  }, [site, load]);

  /** Disconnects a site on the public account, as Settings' Connected sites does; a session's goes from its page. */
  async function forget(origin: string) {
    setAsking(undefined);
    setForgetting(true);
    setError(undefined);
    setGone(undefined);
    try {
      setConnected(await call("dapp-forget", { origin }));
      setGone(hostOf(origin));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setForgetting(false);
    }
  }

  if (open === "lovejoin") {
    return <Lovejoin seedelf={seedelf} banner={banner} onBack={() => setOpen(undefined)} onPending={onPending} />;
  }

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
        attached={attachedTo(opened, connected)}
        connected={siteConnected(opened, connected)}
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
  // Paused, or a funding the chain hasn't shown yet: either waits on the user.
  const waiting = running.filter((s) => s.auto?.paused || fundingUnseen(s)).length;
  const sites = sessions.filter(isSiteSession);
  // Sites on the public account: a private session's are listed by their session, which ends with them.
  const publicSites = connected?.filter((s) => s.session === undefined) ?? [];

  return (
    <Screen title={t("dapps.title")} titleId="dapps-title" onBack={onBack} aside={t("dapps.aside")} error={error ?? declined.error}>
      {sessions.some((s) => s.stage !== "closed") && (
        <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load(true)} />
      )}
      {claimable.length > 0 && <ClaimCard sessions={claimable} onOpen={() => setClaiming(true)} />}
      <div className="dapp-grid" data-testid="dapps">
        {DAPPS.filter((d) => d.id !== "lovejoin" || lovejoinOn(network)).map((d) => (
          <button key={d.id} type="button" className="dapp-tile" onClick={() => setOpen(d.id)}>
            <span className="dapp-tile__logo">{d.icon}</span>
            <span className="dapp-tile__name">{d.name}</span>
            <span className="dapp-tile__what">{t(d.what)}</span>
            {d.id === "minswap" && running.length > 0 && (
              <span className="dapp-tile__badge">
                {waiting ? (
                  <SwapTag tone="wait" label={t("dapps.needYou", { count: waiting })} />
                ) : (
                  <SwapTag tone="live" label={t("dapps.running", { count: running.length })} />
                )}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* A line, not a tile: as a tile it took a slot and looked like a dApp that wouldn't open (chunk 23's review,
          D-4). */}
      <p className="note center">{t("dapps.moreSoon")}</p>
      <Callout tone="privacy">
        {t("dapps.privacy.oneTime")}
      </Callout>
      <section className="section" aria-labelledby="dapp-sites-title">
        <h2 id="dapp-sites-title">{t("settings.sites")}</h2>
        <SitesState />
        <Disconnected host={gone} />
        <DeclinedSites declined={declined.declined} now={declined.now} onLetAsk={declined.letAsk} />
        {publicSites.length + sites.length > 0 ? (
          <ul className="list" data-testid="dapp-sites">
            {publicSites.map((s) => (
              <SiteItem key={s.origin} site={s} account={account} busy={forgetting} onDisconnect={setAsking} />
            ))}
            {sites.map((s) => (
              <li key={s.index}>
                <SiteRow session={s} attached={attachedTo(s, connected)} onOpen={() => setSite(s.index)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="note" data-testid="dapp-sites-hint">
            {t("dapps.privacy.sitesHint")}
          </p>
        )}
      </section>
      {asking && <DisconnectModal site={asking} onKeep={() => setAsking(undefined)} onDisconnect={() => void forget(asking.origin)} />}
    </Screen>
  );
}

/**
 * Whether sites can see the wallet. Off by default (a privacy decision, which
 * stays): said here, with the same disclosure Settings → Sites shows, and the
 * switch's own way to turn it on (chunk 23's review, D-1). On, it says so, and
 * that pages open already see it too (blind test §9.2, T15).
 */
function SitesState() {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    call("status", {}).then(setStatus, () => undefined);
  }, []);
  const blocked = status?.connectorBlocked;
  const sites = useConnectorSwitch(blocked);
  if (!status || !sites.ready) return null;
  if (sites.on) {
    return (
      <div className="stack-tight" data-testid="dapp-sites-on">
        <span>{t("settings.sites.stateOn")}</span>
        <span className="note">{t("settings.sites.privacy.openPages")}</span>
      </div>
    );
  }
  return (
    <div className="stack-tight" data-testid="dapp-sites-off">
      <Callout tone="privacy">{blocked ? connectorBlockedText() : t("settings.sites.privacy.off")}</Callout>
      {!blocked && (
        <button type="button" className="secondary align-center" onClick={sites.toggle}>
          {t("dapps.letSitesConnect")}
        </button>
      )}
      {sites.error && (
        <p className="error" role="alert">
          {sites.error}
        </p>
      )}
    </div>
  );
}

/**
 * Home's dApps row, with what sites can do under it: they can't see the
 * wallet, or how many are connected, or that they can ask. Users start at a
 * site, and the switch was 850 px into Settings (blind test §9.2, T15). Its
 * name stays "dApps"; the line under it is its description.
 */
export function DappsRow({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const { on, connected } = useSitesSummary();
  const id = useId();
  const sub =
    on === undefined
      ? undefined
      : !on
        ? t("home.dapps.sitesOff")
        : connected
          ? t("home.dapps.sitesConnected", { count: connected })
          : t("home.dapps.sitesOn");
  return (
    <button
      type="button"
      className="menu-row"
      onClick={onOpen}
      aria-label={t("home.dapps")}
      aria-describedby={sub ? id : undefined}
      data-testid="home-dapps"
    >
      <span className="menu-row__icon">
        <GridIcon size={16} />
      </span>
      {sub ? (
        <span className="menu-row__text">
          <span>{t("home.dapps")}</span>
          <span className="menu-row__sub menu-row__sub--wrap" id={id} data-testid="home-dapps-sites">
            {sub}
          </span>
        </span>
      ) : (
        <span>{t("home.dapps")}</span>
      )}
      <ChevronRightIcon size={16} />
    </button>
  );
}

/** Money waiting in private sessions, and Bring everything back. A balance: hidden while balances are. */
export function ClaimCard({ sessions, onOpen }: { sessions: SessionView[]; onOpen: () => void }) {
  const t = useT();
  const amounts = useAmounts();
  const lovelace = sessions.reduce((sum, s) => sum + BigInt(s.holding?.lovelace ?? "0"), 0n);
  const tokens = new Set(sessions.flatMap((s) => (s.holding?.tokens ?? []).map((t) => t.policyId + t.assetName))).size;
  return (
    <section className="section claim-card" aria-labelledby="claim-card-title" data-testid="claim-card">
      <h2 id="claim-card-title">{t("dapps.inSessions")}</h2>
      <p className="claim-card__amount">
        {amounts.ada(lovelace.toString())}{"\u00a0₳"}{tokens ? ` ${t("claim.andTokens", { count: tokens })}` : ""}
      </p>
      <p className="note">
        {t("dapps.sessionsHold", { count: sessions.length })}
      </p>
      <button type="button" className="secondary" onClick={onOpen}>
        {t("claim.title")}
      </button>
    </section>
  );
}

