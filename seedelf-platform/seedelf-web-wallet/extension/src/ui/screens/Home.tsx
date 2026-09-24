// Home: the Seedelf balance and seedelfs, the Cardano account, and the
// Seedelf identity. Balances come from the worker's last reading; it reads
// the chain again when that is over a minute old, or on Refresh.

import { useCallback, useEffect, useState } from "react";

import type { Account, Balances } from "../../shared/rpc";
import { call } from "../background";
import { CopyField } from "../components/CopyField";
import { QrCode } from "../components/QrCode";
import { TokenList } from "../components/TokenList";
import { formatAda, shortHex, timeAgo } from "../format";

/** Read again on open when the last reading is older than this. */
const STALE_MS = 60_000;

export function Home() {
  const [account, setAccount] = useState<Account>();
  const [balances, setBalances] = useState<Balances>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [showQr, setShowQr] = useState(false);
  const [now, setNow] = useState(Date.now);

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

  useEffect(() => {
    call("account", {}).then(setAccount, (e: Error) => setError(e.message));
    void load(false).then((b) => {
      if (b && Date.now() - b.updatedAt > STALE_MS) void load(true);
    });
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tick);
  }, [load]);

  return (
    <div className="stack">
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
        <p className="note">Anything that can pay a Cardano address can fund this wallet. Moving funds into Seedelf comes next.</p>
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

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
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
