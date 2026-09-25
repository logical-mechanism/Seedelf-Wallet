// Collateral, in Settings, after Lace's: 5 ₳ of the Cardano account set
// aside. A transaction that runs a script puts it up, and would lose it only
// if the script failed, which the wallet checks before sending; so it's kept
// out of payments. Creating a seedelf from the Cardano account uses it;
// Seedelf spends never do (giveme.my lends theirs).
//
// The status comes from the last reading. Setting it from a 5 ₳ UTxO the
// account already holds, or reclaiming it, sends nothing. Otherwise setting
// it pays 5 ₳ from the account to its own 0/0, reviewed first like a send.

import { useCallback, useEffect, useState } from "react";

import type { CollateralStatus, SendSummary } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TxBanner } from "../components/TxBanner";
import { formatAda, shortHex } from "../format";
import { useNetwork } from "../network";

export function Collateral({ onBack }: { onBack: () => void }) {
  const network = useNetwork();
  const [status, setStatus] = useState<CollateralStatus>();
  const [summary, setSummary] = useState<SendSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    call("collateral", {}).then(setStatus, (e: Error) => setError(e.message));
  }, []);

  const set = () =>
    run(async () => {
      if (status?.state === "none" && status.candidate) {
        const { txHash, index } = status.candidate;
        setStatus(await call("collateral-use", { utxo: `${txHash}#${index}` }));
      } else {
        setSummary(await call("collateral-build", {}));
      }
    });
  const reclaim = () => run(async () => setStatus(await call("collateral-reclaim", {})));
  const send = () =>
    run(async () => {
      await call("collateral-submit", { txHash: summary!.txHash });
      setSummary(undefined);
      setStatus(await call("collateral", {}));
    });

  if (summary) {
    return (
      <Screen
        title="Review the collateral"
        titleId="collateral-review"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRows testId="collateral-review">
          <Row label="To" value="Your Cardano account" strong />
          <Row label="Address" value={shortHex(summary.payments[0]!.address, 16, 8)} title={summary.payments[0]!.address} />
          <Row label="Set aside" value={`${formatAda(summary.payments[0]!.lovelace)} ₳`} strong />
          <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
          <Row label="UTxOs spent" value={String(summary.inputs)} />
        </ReviewRows>
        <p className="note">
          Once the network confirms it, in about a minute, this 5 ₳ is your collateral. Only the fee leaves your account.
        </p>
      </Screen>
    );
  }

  let body;
  let foot;
  if (!status) {
    body = <p className="note center empty">{error ? "" : "Reading…"}</p>;
  } else if (status.state === "set") {
    body = (
      <>
        <ReviewRows testId="collateral-set">
          <Row label="Collateral" value={`${formatAda(status.utxo.lovelace)} ₳`} strong />
          <Row
            label="UTxO"
            value={`${shortHex(status.utxo.txHash, 8, 4)}#${status.utxo.index}`}
            title={`${status.utxo.txHash}#${status.utxo.index}`}
          />
          <Row label="Set by" value={status.by === "you" ? "You" : "The wallet: a 5 ₳ UTxO your account held"} />
        </ReviewRows>
        <Callout tone="warn">
          Reclaiming returns it to your balance. The wallet then won't set one by itself: set it again here when you
          want one.
        </Callout>
      </>
    );
    foot = (
      <button type="button" className="secondary" onClick={reclaim} disabled={busy}>
        {busy ? "Reclaiming…" : "Reclaim collateral"}
      </button>
    );
  } else if (status.state === "waiting") {
    body = (
      <TxBanner
        state="waiting"
        title="Waiting for the network to confirm the payment that sets it"
        network={network}
        txHash={status.txHash}
        testId="collateral-waiting"
      />
    );
    foot = (
      <button type="button" className="primary" onClick={onBack}>
        Done
      </button>
    );
  } else {
    body = (
      <>
        <p className="note" data-testid="collateral-none">
          {status.candidate
            ? "Your account holds a UTxO of exactly 5 ₳, which can be the collateral with no transaction."
            : "Setting it pays 5 ₳ from your Cardano account to itself: only the network fee leaves it."}
        </p>
        {status.reclaimed && <p className="note">You reclaimed it, so the wallet doesn't set one by itself.</p>}
      </>
    );
    foot = (
      <button type="button" className="primary" onClick={set} disabled={busy}>
        {busy ? "Building…" : "Set collateral"}
      </button>
    );
  }

  return (
    <Screen title="Collateral" titleId="collateral-title" onBack={onBack} backDisabled={busy} error={error} foot={foot}>
      <p className="note">
        Collateral is 5 ₳ of your Cardano account set aside for transactions that run a smart contract, such as creating
        a Seedelf from your account. It's only taken if the contract fails, which the wallet checks before sending, and
        it's kept out of your payments.
      </p>
      {body}
      <Callout tone="privacy">
        Seedelf spends never put it up: giveme.my lends theirs, so nothing ties a private payment to your account.
      </Callout>
    </Screen>
  );
}
