// Move in: ADA (an amount, or Max) and any amounts of tokens from the Cardano
// account into the Seedelf balance. With tokens, the amount may stay empty:
// only the ADA they need moves. The worker builds and signs; nothing is sent
// until the user has reviewed the result and pressed Send.

import { useState, type FormEvent } from "react";
import { useT } from "../../i18n";

import type { Balances, MoveInSummary, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, amountText, lovelaceToSend, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { ReviewWait, waitingFor } from "../components/Recipients";
import { ReviewRows, Row } from "../components/ReviewRows";
import { AfterRow, RewardsRow, RewardsSetting, TotalRows } from "../components/ReviewTotals";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { HandleWarning } from "../components/HandleWarning";
import { LeftOutNote } from "../components/LeftOut";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaText, formatAda, lockedAside, rewardsAside, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { tokenQuantity } from "../tokens";

export function MoveIn({
  cardano,
  rewards,
  totals,
  picked,
  onCancel,
  onSent,
}: {
  /** What can pay: `lovelace` includes `rewards`. */
  cardano: Balances["cardano"];
  /** Staking rewards that ride along (lovelace), when any do. */
  rewards?: string;
  /** Both balances as Home shows them, for the review's after rows. */
  totals?: { public: string; private: string };
  /** Tokens picked already, from a token's details: each asks for its amount. */
  picked?: Record<string, string>;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>(picked ?? {});
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
  const waiting = waitingFor({ amount, tokensPicked: Object.keys(tokenAmounts).length > 0, tokensOk: tokens.ok, max });
  // The form's balance lines, hidden with the balances; the review shows what moves in full (HM-9).
  const shown = useAmounts();

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
    // The screen's own verb, with the amount and any tokens that move with it: "Make 2.21103 ₳ private" left out
    // the four tokens going too (chunk 23's second review, PY-5).
    const action = summary.tokens.length
      ? t("moveIn.review.buttonTokens", { amount: formatAda(summary.lovelace), count: summary.tokens.length })
      : t("moveIn.review.button", { amount: formatAda(summary.lovelace) });
    return (
      <Screen
        title={t("moveIn.review.title")}
        titleId="move-in-review"
        review
        hint={t("moveIn.review.note")}
        hintTestId="move-in-review-note"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside={t("review.nothingUntil", { action })}
        error={error}
        foot={
          // The screen's own verb, with the amount: every review's button used to say Send (chunk 23's review, S-7).
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? t("common.sending") : action}
          </button>
        }
      >
        <ReviewRows testId="move-in-review">
          <Row label={t("moveIn.review.into")} value={amountText(summary.lovelace, summary.minimum, lovelace ?? "0")} strong />
          {summary.tokens.map((tk, n) => {
            const known = cardano.tokens.find((c) => key(c) === key(tk));
            return (
              <TokenAmountRow
                key={key(tk)}
                label={n === 0 ? t("review.tokens") : ""}
                token={known ?? tk}
                amount={tokenQuantity(network, { ...known, ...tk })}
              />
            );
          })}
          <Row label={t("review.fee")} value={adaText(summary.fee)} />
          <RewardsRow withdrawal={summary.withdrawal} />
          <TotalRows
            side="public"
            leaving={BigInt(summary.lovelace) + BigInt(summary.fee)}
            before={totals?.public}
            tokens={summary.tokens.length}
          />
          {totals && <AfterRow side="private" lovelace={BigInt(totals.private) + BigInt(summary.lovelace)} />}
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="move-in-tx" />
        <RewardsSetting withdrawal={summary.withdrawal} />
        <MinimumNote lovelace={summary.lovelace} minimum={summary.minimum} asked={lovelace ?? "0"} tokens={summary.tokens.length} />
        <LeftOutNote leftOut={summary.leftOut} testId="move-in-left-out" />
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.makePrivate")}
      titleId="move-in-title"
      hint={t("moveIn.note")}
      hintTestId="move-in-note"
      onBack={onCancel}
      aside={`${t("withdraw.asideAvailable", { amount: shown.ada(cardano.lovelace) })}${rewardsAside(rewards, shown.ada)}${lockedAside(cardano, shown.ada)}`}
      error={error}
      foot={
        <>
          <BuildStage busy={busy} />
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          {!ready && <ReviewWait reasons={[waiting]} tooMuch={tooMuch} busy={busy} />}
        </>
      }
    >
      <div className="field">
        <label htmlFor="move-in-amount">{t("common.amount")}</label>
        <AdaInput
          id="move-in-amount"
          value={amount}
          onChange={setAmount}
          disabled={max}
          shown={t("common.maxUpTo", { amount: shown.ada(cardano.lovelace) })}
          placeholder={withTokens ? t("common.minimum") : "0"}
        >
          <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
            {t("common.max")}
          </button>
        </AdaInput>
        {tooMuch && (
          <p className="field-note" data-testid="move-in-too-much">
            {t("moveIn.tooMuch", { amount: shown.ada(cardano.lovelace) })}
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
