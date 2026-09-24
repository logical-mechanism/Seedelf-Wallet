// Home: the Seedelf balance and seedelfs, the Cardano account, and the
// Seedelf identity. Balances come from the worker's last reading; it reads
// the chain again when that is over a minute old, or on Refresh. A sent
// move-in shows as a banner until the network confirms it.

import { useCallback, useEffect, useState } from "react";

import type { Account, Balances, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { CopyField } from "../components/CopyField";
import { QrCode } from "../components/QrCode";
import { TokenList } from "../components/TokenList";
import { explorerUrl, formatAda, shortHex, timeAgo } from "../format";
import { MoveIn } from "./MoveIn";

/** Read again on open when the last reading is older than this. */
const STALE_MS = 60_000;
/** How often to ask about a sent transaction. */
const WATCH_EVERY_MS = 15_000;

export function Home() {
  const [account, setAccount] = useState<Account>();
  const [balances, setBalances] = useState<Balances>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [showQr, setShowQr] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [screen, setScreen] = useState<"home" | "move-in">("home");
  const [pending, setPending] = useState<PendingTx | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setReading(true);
    try {
      const b = await call("balances", { refresh });
      setBalances(b);
      setError(undefined);
      return b;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setReading(false);
      setNow(Date.now());
    }
  }, []);

  // Ask about the sent transaction; once it's confirmed, read the balances again.
  const watch = useCallback(async () => {
    try {
      const p = await call("pending-tx", {});
      if (!p) return;
      setPending(p);
      if (p.confirmations !== null) void load(true);
    } catch {
      // Koios hiccup: try again on the next tick.
    }
  }, [load]);

  useEffect(() => {
    call("account", {}).then(setAccount, (e: Error) => setError(e.message));
    void load(false).then((b) => {
      if (b && Date.now() - b.updatedAt > STALE_MS) void load(true);
    });
    void watch();
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tick);
  }, [load, watch]);

  const watching = pending !== null && pending.confirmations === null && now - pending.submittedAt < 10 * 60_000;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void watch(), WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [watching, watch]);

  if (screen === "move-in" && balances) {
    return (
      <MoveIn
        cardano={balances.cardano}
        onCancel={() => setScreen("home")}
        onSent={(p) => {
          setPending(p);
          setScreen("home");
        }}
      />
    );
  }

  return (
    <div className="stack">
      {error && (
        <section className="callout callout--warn stack-tight" role="alert">
          <strong>Couldn't read your balances</strong>
          <span>{error}</span>
          <button type="button" className="link align-start" onClick={() => void load(true)} disabled={reading}>
            {reading ? "Trying…" : "Try again"}
          </button>
        </section>
      )}
      {pending && (
        <section className="callout banner" role="status" data-testid="pending-tx">
          <strong>
            {pending.confirmations !== null
              ? "Move-in confirmed"
              : watching
                ? "Move-in sent. Waiting for the network…"
                : "Move-in not confirmed yet"}
          </strong>
          <a href={explorerUrl(pending.network, pending.txHash)} target="_blank" rel="noreferrer" className="banner__link">
            {shortHex(pending.txHash, 10, 6)} on Cardanoscan
          </a>
          {!watching && (
            <button type="button" className="link" onClick={() => setPending(null)}>
              Dismiss
            </button>
          )}
        </section>
      )}
      <section className="card stack" aria-labelledby="seedelf-balance">
        <div className="card__head">
          <h1 id="seedelf-balance">Seedelf balance</h1>
          {balances && <span className="note">{plural(balances.seedelf.utxos, "UTxO")}</span>}
        </div>
        <Amount lovelace={balances?.seedelf.lovelace} testId="seedelf-lovelace" />
        {balances && <TokenList tokens={balances.seedelf.tokens} testId="seedelf-tokens" />}
        <div className="subsection">
          <h2>Your seedelfs</h2>
          {balances && balances.seedelf.seedelfs.length === 0 && (
            <p className="note">No seedelfs yet. Creating one arrives in a later update.</p>
          )}
          {balances && balances.seedelf.seedelfs.length > 0 && (
            <ul className="seedelfs" data-testid="seedelfs">
              {balances.seedelf.seedelfs.map((s) => (
                <li key={s.assetName} className="seedelfs__row" title={s.assetName}>
                  <span className="seedelfs__label">{s.label ?? "Unnamed"}</span>
                  <code className="seedelfs__id">{shortHex(s.assetName, 12, 6)}</code>
                  <span className="seedelfs__ada">{formatAda(s.lovelace)} ₳</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card stack" aria-labelledby="cardano-account">
        <div className="card__head">
          <h1 id="cardano-account">Cardano account</h1>
          {balances && <span className="note">{plural(balances.cardano.addressesUsed, "address", "addresses")} used</span>}
        </div>
        <Amount lovelace={balances?.cardano.lovelace} testId="cardano-lovelace" />
        {balances && <TokenList tokens={balances.cardano.tokens} testId="cardano-tokens" />}
        {account && (
          <>
            <CopyField label="Receive address" value={account.receiveAddress} testId="receive-address" />
            <button type="button" className="link align-start" onClick={() => setShowQr(!showQr)}>
              {showQr ? "Hide QR code" : "Show QR code"}
            </button>
            {showQr && (
              <div className="qr-wrap">
                <QrCode text={account.receiveAddress} label="QR code of the receive address" />
                <p className="note">Scan this from a phone wallet to pay this account.</p>
              </div>
            )}
            <CopyField label="Stake address" value={account.stakeAddress} testId="stake-address" />
          </>
        )}
        <p className="note">Anything that can pay a Cardano address can fund this wallet.</p>
        <button
          type="button"
          className="primary"
          onClick={() => setScreen("move-in")}
          disabled={!balances || balances.cardano.utxos === 0 || watching}
          title={watching ? "Wait for the last move-in to confirm" : undefined}
        >
          Move in
        </button>
      </section>

      {account && (
        <section className="card stack" aria-labelledby="seedelf-identity">
          <h1 id="seedelf-identity">Seedelf identity</h1>
          <p className="note">
            Your Seedelf key's public value. Payments to your seedelfs use re-randomized copies of it, so they can't be
            linked back here.
          </p>
          <CopyField
            label="Public value"
            value={account.seedelfPublicValue}
            display={shortHex(account.seedelfPublicValue, 10, 10)}
            testId="seedelf-public-value"
          />
        </section>
      )}

      <div className="refresh-row">
        <span className="note" data-testid="updated">
          {reading ? "Reading the chain…" : balances ? `Updated ${timeAgo(balances.updatedAt, now)}` : ""}
        </span>
        <button type="button" className="link" onClick={() => void load(true)} disabled={reading}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function Amount({ lovelace, testId }: { lovelace?: string; testId: string }) {
  return (
    <p className="amount" data-testid={testId}>
      {lovelace === undefined ? <span className="amount__placeholder">—</span> : formatAda(lovelace)}
      <span className="amount__unit"> ₳</span>
    </p>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
