// Home, a placeholder until balances arrive (roadmap chunk 6): the Cardano
// receive address, the stake address and the Seedelf identity.

import { useEffect, useState } from "react";

import type { Account } from "../../shared/rpc";
import { call } from "../background";
import { CopyField } from "../components/CopyField";

/** First and last 10 hex characters of the public value. */
function shortPublicValue(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-10)}`;
}

export function Home() {
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    call("account", {}).then(setAccount, (e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!account) return <p className="note">Loading…</p>;

  return (
    <div className="stack">
      <section className="card stack">
        <h1>Cardano account</h1>
        <p className="note">Anything that can pay a Cardano address can fund this wallet.</p>
        <CopyField label="Receive address" value={account.receiveAddress} testId="receive-address" />
        <CopyField label="Stake address" value={account.stakeAddress} testId="stake-address" />
      </section>
      <section className="card stack">
        <h1>Seedelf identity</h1>
        <p className="note">
          Your Seedelf key's public value. Payments to your seedelfs use re-randomized copies of it, so they can't be
          linked back here.
        </p>
        <CopyField
          label="Public value"
          value={account.seedelfPublicValue}
          display={shortPublicValue(account.seedelfPublicValue)}
          testId="seedelf-public-value"
        />
      </section>
      <p className="note center">Balances and seedelfs arrive in the next update.</p>
    </div>
  );
}
