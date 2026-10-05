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
import { useT } from "../../i18n";

import type { CollateralStatus, SendSummary } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { TxBanner } from "../components/TxBanner";
import { formatAda, shortHex } from "../format";
import { useNetwork } from "../network";

export function Collateral({ onBack }: { onBack: () => void }) {
  const t = useT();
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
        title={t("collateral.review.title")}
        titleId="collateral-review"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside={t("review.nothingSent")}
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? t("common.sending") : t("common.send")}
          </button>
        }
      >
        <ReviewRows testId="collateral-review">
          <Row label={t("destination.to")} value={t("collateral.yourPublicAccount")} strong />
          <Row label={t("utxos.address")} value={shortHex(summary.payments[0]!.address, 16, 8)} title={summary.payments[0]!.address} />
          <Row label={t("collateral.setAside")} value={`${formatAda(summary.payments[0]!.lovelace)} ₳`} strong />
          <Row label={t("review.fee")} value={`${formatAda(summary.fee)} ₳`} />
          <Row label={t("send.review.spent")} value={String(summary.inputs)} />
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="collateral-tx" />
        <p className="note">
          {t("collateral.review.note")}
        </p>
      </Screen>
    );
  }

  let body;
  let foot;
  if (!status) {
    body = <p className="note center empty">{error ? "" : t("activity.reading")}</p>;
  } else if (status.state === "set") {
    body = (
      <>
        <ReviewRows testId="collateral-set">
          <Row label={t("utxos.tag.collateral")} value={`${formatAda(status.utxo.lovelace)} ₳`} strong />
          <Row
            label={t("collateral.utxo")}
            value={`${shortHex(status.utxo.txHash, 8, 4)}#${status.utxo.index}`}
            title={`${status.utxo.txHash}#${status.utxo.index}`}
          />
          <Row label={t("collateral.setBy")} value={t(status.by === "you" ? "collateral.setBy.you" : "collateral.setBy.wallet")} />
        </ReviewRows>
        <Callout tone="warn">
          {t("collateral.warn.reclaiming")}
        </Callout>
      </>
    );
    foot = (
      <button type="button" className="secondary" onClick={reclaim} disabled={busy}>
        {busy ? t("collateral.reclaiming") : t("collateral.reclaim")}
      </button>
    );
  } else if (status.state === "waiting") {
    body = (
      <TxBanner
        state="waiting"
        title={t("collateral.waiting")}
        network={network}
        txHash={status.txHash}
        testId="collateral-waiting"
      />
    );
    foot = (
      <button type="button" className="primary" onClick={onBack}>
        {t("common.done")}
      </button>
    );
  } else {
    body = (
      <>
        <p className="note" data-testid="collateral-none">
          {t(status.candidate ? "collateral.candidate" : "collateral.willPaySelf")}
        </p>
        {status.reclaimed && <p className="note">{t("collateral.reclaimed")}</p>}
      </>
    );
    foot = (
      <button type="button" className="primary" onClick={set} disabled={busy}>
        {busy ? t("common.building") : t("collateral.set")}
      </button>
    );
  }

  return (
    <Screen
      title={t("utxos.tag.collateral")}
      titleId="collateral-title"
      onBack={onBack}
      backDisabled={busy}
      error={error}
      foot={foot}
      hint={t("collateral.note")}
      hintTestId="collateral-note"
    >
      {body}
      <Callout tone="privacy">
        {t("collateral.privacy.giveme")}
      </Callout>
    </Screen>
  );
}
