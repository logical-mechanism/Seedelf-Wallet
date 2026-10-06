// The sites connected to the wallet, each with Disconnect, and the sites the
// user declined that are still turned away, with Let it ask now. Settings →
// Sites → Connected sites shows them all; the dApps page shows the same rows
// under its Sites, where users look for them first (blind test §9.2: E03,
// T17 and T17r opened dApps, and T17r never found Settings' list).
//
// A row names the site by its address, as Chrome reported it, then its page's
// title as it asked to connect: the site's own words, so second, as the
// connector's window shows them (blind test E03). A site on the public account
// says which account when the wallet has more than one (blind test T15:
// "your public account" alone could be one the screen isn't showing).
//
// CIP-30 gives a wallet no way to tell an open page it was disconnected: its
// next call is refused, and a page that reads nothing more keeps showing what
// it read. So the wallet says so as it disconnects (blind test E03).

import { useEffect, useState } from "react";
import { t, useT } from "../../i18n";

import type { DappDeclined, DappSite, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Modal } from "../components/Modal";
import { Screen } from "../components/Screen";
import { useDeclined, useSiteAccount, waitText } from "../sites";
import { disconnectWait } from "./SiteSessions";

/** A site's address, as the lists show it. */
export const hostOf = (origin: string) => new URL(origin).host;

/** Who it is: the address Chrome reported, then the page's own title when it says something else. */
function SiteName({ origin, title }: { origin: string; title?: string }) {
  const host = hostOf(origin);
  return (
    <>
      <strong>{host}</strong>
      {title && title !== host && (
        <span className="note" data-testid="site-title">
          {title}
        </span>
      )}
    </>
  );
}

/** What a site on the public account sees, by the account's number and name when there's more than one (`useSiteAccount`). */
export const publicAccountText = (account?: string) =>
  account ? t("dappUi.publicAccountNamed", { account }) : t("collateral.yourPublicAccount");

/**
 * One connected site: who it is, what it sees, since when, and Disconnect. A
 * site's Disconnect is off while its private session has something on its
 * way, or holds something (as last read), with why; and until the sessions
 * are read.
 */
export function SiteItem({
  site: s,
  sessions,
  account,
  busy,
  onDisconnect,
}: {
  site: DappSite;
  /** The sessions on this network, from the device's record; undefined until read. */
  sessions?: SessionView[];
  /** The account a site on the public account gets, when there's more than one (`useSiteAccount`). */
  account?: string;
  busy: boolean;
  onDisconnect: (site: DappSite) => void;
}) {
  const session = s.session === undefined ? undefined : sessions?.find((x) => x.index === s.session);
  const wait = session && disconnectWait(session, { canRefresh: false });
  const unread = s.session !== undefined && !sessions;
  return (
    <li className="list__row">
      <span className="stack-tight">
        <SiteName origin={s.origin} title={s.title} />
        <span className="note">
          {s.session === undefined ? publicAccountText(account) : t("claim.session", { number: s.session + 1 })} ·{" "}
          {t("sites.since", { date: new Date(s.connectedAt).toLocaleDateString() })}
        </span>
        {s.cip95 && (
          <span className="note" data-testid="site-governance">
            {t("sites.governance")}
          </span>
        )}
        {s.cip95Declined && (
          <span className="note" data-testid="site-governance-declined">
            {t("sites.governanceDeclined")}
          </span>
        )}
        {wait && (
          <span className="note" data-testid="site-wait">
            {/* The button's own title elsewhere, a sentence here: its full stop is the language's. */}
            {t("common.sentence", { text: wait })}
          </span>
        )}
      </span>
      <button
        type="button"
        className="chip"
        disabled={busy || unread || !!wait}
        title={wait}
        onClick={() => onDisconnect(s)}
        data-testid="sites-disconnect"
      >
        {t("sites.disconnect")}
      </button>
    </li>
  );
}

/** The connected sites' rows (`SiteItem`), in a card of their own. */
export function SiteRows({
  sites,
  sessions,
  account,
  busy,
  onDisconnect,
}: {
  sites: DappSite[];
  /** The sessions on this network, from the device's record; undefined until read. */
  sessions?: SessionView[];
  account?: string;
  busy: boolean;
  onDisconnect: (site: DappSite) => void;
}) {
  // In a section, not a section itself: the list's own padding took the card's, and the rows touched its border
  // (blind test E03, verifier).
  return (
    <div className="section">
      <ul className="list" data-testid="sites">
        {sites.map((s) => (
          <SiteItem key={s.origin} site={s} sessions={sessions} account={account} busy={busy} onDisconnect={onDisconnect} />
        ))}
      </ul>
    </div>
  );
}

/** What disconnecting a site does, said before it's done: to the public account, or ending its private session `session`. */
export function disconnectText(site: string, session?: number): string {
  return session === undefined
    ? t("sites.disconnectText", { site })
    : t("sites.disconnectTextSession", { number: session + 1, site });
}

/** Disconnect's question: what it does, Keep it, and Disconnect the site. */
export function DisconnectModal({ site, onKeep, onDisconnect }: { site: DappSite; onKeep: () => void; onDisconnect: () => void }) {
  const tr = useT();
  return (
    <Modal
      title={tr("sites.disconnectAsk", { site: hostOf(site.origin) })}
      titleId="sites-disconnect-title"
      onClose={onKeep}
      foot={
        <>
          <button type="button" className="secondary" onClick={onKeep}>
            {tr("sites.keepIt")}
          </button>
          <button type="button" className="danger" onClick={onDisconnect} data-testid="sites-disconnect-confirm">
            {tr("sites.disconnectIt")}
          </button>
        </>
      }
    >
      <p className="note">{disconnectText(hostOf(site.origin), site.session)}</p>
    </Modal>
  );
}

/**
 * Said once a site is disconnected: it can't use the wallet until it asks
 * again, and an open page of it may still look connected, since CIP-30 has
 * no way to tell it (blind test E03: the page still showed "Connected" and
 * the balance, and the tester doubted the disconnect had worked).
 */
export function Disconnected({ host }: { host?: string }) {
  const tr = useT();
  if (!host) return null;
  return (
    <p className="note" role="status" data-testid="sites-disconnected">
      {tr("sites.privacy.disconnected", { site: host })}
    </p>
  );
}

/**
 * The sites the user declined, still turned away: how long each has left,
 * whether it asked again meanwhile, and Let it ask now, which ends the wait.
 * Only the user can end it, so a site still can't bring the window back by
 * asking (blind test §9.2, T17r: the wallet itself showed nothing).
 */
export function DeclinedSites({
  declined,
  now,
  onLetAsk,
}: {
  declined: DappDeclined[];
  now: number;
  onLetAsk: (origin: string) => void;
}) {
  const tr = useT();
  if (!declined.length) return null;
  return (
    <ul className="list" data-testid="sites-declined" aria-label={tr("sites.declined.title")}>
      {declined.map((d) => (
        <li key={d.origin} className="list__row">
          <span className="stack-tight">
            <SiteName origin={d.origin} title={d.title} />
            <span className="note">
              {tr(d.retried ? "sites.declined.askedAgain" : "sites.declined.wait", { wait: waitText(d.until - now) })}
            </span>
          </span>
          <button type="button" className="chip" onClick={() => onLetAsk(d.origin)} data-testid="sites-let-ask">
            {tr("sites.declined.letAsk")}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Settings → Sites → Connected sites: every site connected on this network,
 * each with Disconnect, and the sites declined just now. A site's private
 * session ends with it, so its Disconnect waits while anything is on its way
 * to the session's account or from it, says why, and asks first, as the
 * session's page on the dApps page does (launch review H7). The worker checks
 * again, reading the account, and its refusal shows here. The list is sealed
 * on the device; the sessions are read from the device's record, not Koios.
 */
export function ConnectedSites({ onBack }: { onBack: () => void }) {
  const account = useSiteAccount();
  const declined = useDeclined();
  const [sites, setSites] = useState<DappSite[]>();
  const [sessions, setSessions] = useState<SessionView[]>();
  const [asking, setAsking] = useState<DappSite>();
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<string>();
  const [error, setError] = useState<string>();
  const readSessions = () =>
    call("sessions", {}).then(setSessions, (e: Error) => {
      // The worker's own check still stands between Disconnect and a session on its way.
      setSessions([]);
      // A refusal from the worker, shown already, stays.
      setError((shown) => shown ?? e.message);
    });
  useEffect(() => {
    call("dapp-sites", {}).then(setSites, (e: Error) => setError(e.message));
    void readSessions();
  }, []);

  async function forget(origin: string) {
    setAsking(undefined);
    setBusy(true);
    setError(undefined);
    setGone(undefined);
    try {
      setSites(await call("dapp-forget", { origin }));
      setGone(hostOf(origin));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void readSessions();
    }
  }

  return (
    <Screen
      title={t("sites.title")}
      titleId="sites-title"
      onBack={onBack}
      aside={t("settings.encryptedHere")}
      error={error ?? declined.error}
    >
      <Disconnected host={gone} />
      {declined.declined.length > 0 && (
        <div className="section">
          <DeclinedSites declined={declined.declined} now={declined.now} onLetAsk={declined.letAsk} />
        </div>
      )}
      {sites?.length === 0 && (
        <p className="note center" data-testid="sites-empty">
          {t("sites.empty")}
        </p>
      )}
      {!!sites?.length && <SiteRows sites={sites} sessions={sessions} account={account} busy={busy} onDisconnect={setAsking} />}
      <p className="note">{t("sites.note")}</p>
      {asking && <DisconnectModal site={asking} onKeep={() => setAsking(undefined)} onDisconnect={() => void forget(asking.origin)} />}
    </Screen>
  );
}
