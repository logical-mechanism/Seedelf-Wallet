// Collateral, in Settings, after Lace's: 5 ₳ of the Cardano account set
// aside. A transaction that runs a script puts it up, and would lose it only
// if the script failed, which the wallet checks before sending; so it's kept
// out of payments. Creating a seedelf from the Cardano account uses it;
// Seedelf spends never do (giveme.my lends theirs).
//
// The status comes from the last reading. Setting it from a 5 ₳ UTxO the
// account already holds, or reclaiming it, sends nothing. Otherwise setting
// it pays 5 ₳ from the account to its own 0/0, reviewed first like a send.
//
// Settings opens it, and so do Home's Public tab and Lovejoin's mix from the
// public account while there's none (the owner, 2026-10-14). From those, the
// payment goes to Home's banner, as every payment sent from Home does, and
// Home's watch follows it: the page, opened again there while it waits, reads
// the status alone (lookAgain). From Settings it waits here, asking about it
// as Home would: Settings replaces Home, whose watch stops, and the last
// reading only gives way to a new one once the worker sees the payment land
// (pending.ts), so the page said "waiting" until Home was opened. A payment
// still waited for 10 minutes on may have been dropped: the page offers to pay
// it again anyway (WaitingFoot).

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";

import type { CollateralStatus, PendingTx, SendSummary } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { TxBanner } from "../components/TxBanner";
import { formatAda, shortHex } from "../format";
import { useNetwork } from "../network";

/** How often the page asks about its payment while it waits: Home's pace for a sent transaction. */
const WATCH_EVERY_MS = 15_000;

/**
 * One look at the payment the page waits for, `txHash`: the status read again, or nothing while it's on its way.
 * From Settings it asks about the payment first, as Home would. Opened in place (`inPlace`), Home stays under it and
 * its watch asks, then reads the balances again once it lands, so the page reads the status alone: the worker tells
 * only the first to ask of a landing, and when the page was first, Home held every payment for 10 minutes with its
 * banner on "sent" (1.6.0's release review, 309#0).
 */
export async function lookAgain(ask: typeof call, txHash: string, inPlace: boolean): Promise<CollateralStatus | undefined> {
  if (!inPlace) {
    const p = await ask("pending-tx", {});
    if (p?.txHash === txHash && p.confirmations === null && !p.dropped) return undefined;
  }
  return ask("collateral", {});
}

/**
 * The page's foot while its payment waits: Done, and once it's `late`, a payment again, the user's choice. A payment a
 * mempool dropped is still waited for while it can land, up to two hours, and Set collateral was gone all that while,
 * with public mixes and anything else a collateral backs (1.6.0's review of the fixes, 309#1's leftover). It pays what
 * Set collateral pays, and refuses nothing; `blocked` says why it can't now, as Set collateral's does. Exported for its
 * test.
 */
export function WaitingFoot({
  late,
  busy,
  blocked,
  onDone,
  onAgain,
}: {
  late?: boolean;
  busy: boolean;
  blocked?: string;
  onDone: () => void;
  onAgain: () => void;
}) {
  const t = useT();
  return (
    <>
      <button type="button" className="primary" onClick={onDone}>
        {t("common.done")}
      </button>
      {late && (
        <>
          <button type="button" className="secondary" onClick={onAgain} disabled={busy || !!blocked} data-testid="collateral-again">
            {busy ? t("common.building") : t("collateral.payAgain")}
          </button>
          <p className="note foot-note" data-testid="collateral-again-note">
            {blocked ?? t("collateral.warn.bothLand")}
          </p>
        </>
      )}
    </>
  );
}

export function Collateral({
  onBack,
  onSent,
  blocked,
}: {
  onBack: () => void;
  /**
   * Opened from Home or a dApp page: the payment, once sent, goes to Home's banner rather than waiting here, and Home's
   * watch, not the page, asks about one on its way.
   */
  onSent?: (pending: PendingTx) => void;
  /** Why no payment can be made now: Home's one at a time. Taking a 5 ₳ UTxO the account holds sends nothing. */
  blocked?: string;
}) {
  const t = useT();
  const network = useNetwork();
  const [status, setStatus] = useState<CollateralStatus>();
  const [summary, setSummary] = useState<SendSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // From the last reading, no request: an empty account has nothing to set aside.
  const [empty, setEmpty] = useState(false);

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
    call("balances", {}).then(
      (b) => setEmpty(b.cardano.utxos === 0),
      () => undefined,
    );
  }, []);

  // While its payment is on its way: asked about at once and every 15 s, the question Home asks, and the status read
  // again once it has landed or was let go, or once the worker watches another (the owner, 2026-10-14: it showed
  // "waiting" long after the payment was on chain). Opened in place, the status alone, as Home's watch asks.
  const waitingFor = status?.state === "waiting" ? status.txHash : undefined;
  const inPlace = !!onSent;
  useEffect(() => {
    if (!waitingFor) return;
    let live = true;
    const look = async () => {
      try {
        const now = await lookAgain(call, waitingFor, inPlace);
        if (live && now) setStatus(now);
      } catch {
        // Koios hiccup: asked again on the next tick.
      }
    };
    void look();
    const timer = setInterval(() => void look(), WATCH_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [waitingFor, inPlace]);

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
      const pending = await call("collateral-submit", { txHash: summary!.txHash });
      setSummary(undefined);
      if (onSent) onSent(pending);
      else setStatus(await call("collateral", {}));
    });

  if (summary) {
    return (
      <Screen
        title={t("collateral.review.title")}
        titleId="collateral-review"
        review
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
          <Row label={t("collateral.setAside")} value={`${formatAda(summary.payments[0]!.lovelace)}\u00a0₳`} strong />
          <Row label={t("review.fee")} value={`${formatAda(summary.fee)}\u00a0₳`} />
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
        {/* Status and purpose first, the details after: it led with the cost, and what collateral is sat behind the
            ⓘ (chunk 23's second review, CW-8). */}
        <p className="note" data-testid="collateral-status">
          {t("collateral.isSet", { ada: formatAda(status.utxo.lovelace) })}
        </p>
        <ReviewRows testId="collateral-set">
          <Row label={t("utxos.tag.collateral")} value={`${formatAda(status.utxo.lovelace)}\u00a0₳`} strong />
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
    foot = <WaitingFoot late={status.late} busy={busy} blocked={blocked} onDone={onBack} onAgain={set} />;
  } else {
    body = (
      <>
        <p className="note" data-testid="collateral-status">
          {t("collateral.notSet")}
        </p>
        {/* What setting it costs stays on the page, under what it's for. */}
        <p className="note" data-testid="collateral-none">
          {t(status.candidate ? "collateral.candidate" : "collateral.willPaySelf")}
        </p>
        {status.reclaimed && <p className="note">{t("collateral.reclaimed")}</p>}
      </>
    );
    // An empty account can't pay itself 5 ₳: said before it's tried, not after (chunk 23's review, SET-3).
    const why = status.candidate ? undefined : empty ? t("collateral.fundFirst") : blocked;
    foot = (
      <>
        <button type="button" className="primary" onClick={set} disabled={busy || !!why}>
          {busy ? t("common.building") : t("collateral.set")}
        </button>
        {why && (
          <p className="note foot-note" data-testid="collateral-why">
            {why}
          </p>
        )}
      </>
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
