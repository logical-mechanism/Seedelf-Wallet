// Move in: ADA (an amount, or Max) and any amounts of tokens from the Cardano
// account into the Seedelf balance. With tokens, the amount may stay empty:
// only the ADA they need moves. The worker builds and signs; nothing is sent
// until the user has reviewed the result and pressed Send.

import { useState, type FormEvent } from "react";
import { useT } from "../../i18n";

import type { Balances, MoveInSummary, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, lovelaceToSend, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { HandleWarning } from "../components/HandleWarning";
import { LeftOutNote } from "../components/LeftOut";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaWithTokens, formatAda, lockedAside, rewardsAside, tokenKey as key } from "../format";
import { WithdrawalRow } from "./CardanoSend";
import { useNetwork } from "../network";
import { tokenQuantity } from "../tokens";

export function MoveIn({
  cardano,
  rewards,
  onCancel,
  onSent,
}: {
  /** What can pay: `lovelace` includes `rewards`. */
  cardano: Balances["cardano"];
  /** Staking rewards that ride along (lovelace), when any do. */
  rewards?: string;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<MoveInSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const network = useNetwork();

  const tokens = tokenChoices(network, cardano.tokens, tokenAmounts);
  const withTokens = tokens.sent.length > 0;
  const lovelace = max ? null : lovelaceToSend(amount, withTokens);
  // The builder decides exactly (fee, change, collateral UTxOs); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(cardano.lovelace);
  const ready = tokens.ok && (max || (typeof lovelace === "string" && !tooMuch));

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("move-in-build", { lovelace: lovelace ?? null, tokens: tokens.sent }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!summary || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSent(await call("move-in-submit", { txHash: summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title={t("moveIn.review.title")}
        titleId="move-in-review"
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
        <ReviewRows testId="move-in-review">
          <Row label={t("moveIn.review.into")} value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const known = cardano.tokens.find((c) => key(c) === key(t));
            return <TokenAmountRow key={key(t)} label="" token={known ?? t} amount={tokenQuantity(network, { ...known, ...t })} />;
          })}
          <Row label={t("review.fee")} value={`${formatAda(summary.fee)} ₳`} />
          <WithdrawalRow withdrawal={summary.withdrawal} />
          <Row label={t("review.backToPublic")} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label={t("moveIn.review.newUtxos")} value={String(summary.depositOutputs)} />
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="move-in-tx" />
        <MinimumNote lovelace={summary.lovelace} minimum={summary.minimum} asked={lovelace ?? "0"} tokens={summary.tokens.length} />
        <LeftOutNote leftOut={summary.leftOut} testId="move-in-left-out" />
        <p className="note">{t("moveIn.review.note")}</p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.makePrivate")}
      titleId="move-in-title"
      onBack={onCancel}
      aside={`${formatAda(cardano.lovelace)} ₳ available${rewardsAside(rewards)}${lockedAside(cardano)}`}
      error={error}
      foot={
        <>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          <BuildStage busy={busy} />
        </>
      }
    >
      <p className="note">{t("moveIn.note")}</p>

      <div className="field">
        <label htmlFor="move-in-amount">{t("common.amount")}</label>
        <AdaInput
          id="move-in-amount"
          value={amount}
          onChange={setAmount}
          disabled={max}
          shown={t("common.max")}
          placeholder={withTokens ? t("common.minimum") : "0"}
        >
          <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
            {t("common.max")}
          </button>
        </AdaInput>
        {tooMuch && (
          <p className="field-note" data-testid="move-in-too-much">
            {t("moveIn.tooMuch", { amount: formatAda(cardano.lovelace) })}
          </p>
        )}
      </div>
      {max ? (
        <p className="note">
          {t(rewards ? "moveIn.maxNoteRewards" : "moveIn.maxNote")}
        </p>
      ) : (
        <>
          {withTokens && <MinimumHint />}
        </>
      )}

      <TokenAmounts
        held={cardano.tokens}
        typed={tokenAmounts}
        onChange={setTokenAmounts}
        legend={t("moveIn.bringTokens")}
      />
      <HandleWarning tokens={tokens.sent} />

      <Callout tone="privacy">{t("moveIn.privacy.links")}</Callout>
    </Screen>
  );
}
