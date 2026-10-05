// Create a seedelf. A mint links the seedelf to whatever pays for it, so the
// Cardano account pays by default: minted before any move-in, the seedelf is
// linked to the account openly, and money moved in afterwards isn't tied to
// it. The Seedelf balance can pay instead (a stealth mint), which only hides
// the payer when that balance came from other people's Seedelf payments. The
// worker builds it at review. An account-paid mint's draft goes to Koios's
// Ogmios then, to measure the policy, so Koios sees the tag and the account's
// inputs even for a review that's never sent (privacy review §3.10); a
// stealth mint is measured in the wallet. Nothing is submitted until the
// user has reviewed it and pressed Send.

import { useState, type FormEvent } from "react";
import { type I18nKey, Rich, useT } from "../../i18n";

import { LABEL_MAX, labelProblem, tokenNamePrefix } from "../../shared/label";
import type { Balances, MintSource, MintSummary, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { HistoriesNote } from "../components/HistoriesNote";
import { ReviewRows, Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { adaWithTokens, formatAda, shortHex } from "../format";
import { WithdrawalRow } from "./CardanoSend";

/**
 * What pays for the mint. Keys, not words: the review and the aside used to
 * build "Back to your public account" by lowercasing this, which is English
 * grammar — a language may not lowercase, and may not put the noun there at
 * all. Those two sentences are whole keys of their own below.
 */
const SOURCES = { account: "mint.source.account", seedelf: "mint.source.seedelf" } as const satisfies Record<MintSource, I18nKey>;

export function CreateSeedelf({
  balances,
  onCancel,
  onSent,
}: {
  balances: Balances;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  const [from, setFrom] = useState<MintSource>(balances.cardano.utxos > 0 ? "account" : "seedelf");
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState<MintSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const tag = label.trim();
  const problem = labelProblem(label);

  async function review(e: FormEvent) {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("mint-build", { label: tag, from }));
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
      onSent(await call("mint-submit", { txHash: summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title={t("mint.review.title")}
        titleId="mint-review"
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
        <ReviewRows testId="mint-review">
          {summary.label && <Row label={t("activity.row.seedelf")} value={summary.label} strong />}
          <Row label={t("mint.review.tokenName")} value={shortHex(summary.tokenName, 16, 8)} title={summary.tokenName} strong={!summary.label} />
          <Row label={t("mint.review.paidFrom")} value={t(SOURCES[summary.from])} />
          <Row label={t("mint.review.locked")} value={`${formatAda(summary.lovelace)} ₳`} />
          <Row label={t("review.fee")} value={`${formatAda(summary.fee.total)} ₳`} />
          <WithdrawalRow withdrawal={summary.withdrawal} />
          <Row label={t(summary.from === "account" ? "review.backToPublic" : "review.backToPrivate")} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="mint-tx" />
        <HistoriesNote histories={summary.histories} testId="mint-histories" />
        <p className="note">
          {t(summary.from === "seedelf" ? "mint.review.notePrivate" : "mint.review.noteAccount")}
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.createSeedelf")}
      titleId="mint-title"
      hint={t("mint.note")}
      hintTestId="mint-note"
      onBack={onCancel}
      aside={t(from === "account" ? "mint.asideAccount" : "mint.asidePrivate", {
        amount: formatAda(from === "account" ? balances.cardano.lovelace : balances.seedelf.lovelace),
      })}
      error={error}
      foot={
        <>
          <button type="submit" className="primary" disabled={!!problem || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          <BuildStage busy={busy} />
        </>
      }
    >
      <div className="field">
        <label htmlFor="mint-label">{t("mint.tagLabel")}</label>
        <input
          id="mint-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={LABEL_MAX}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby="mint-label-note"
        />
        {problem ? (
          <p className="field-note" id="mint-label-note" role="alert">
            {problem}
          </p>
        ) : (
          <p className="note" id="mint-label-note" data-testid="mint-preview">
            {tag ? (
              <Rich k="mint.listedAs" parts={{ tag: <strong>{tag}</strong> }} />
            ) : (
              t("mint.listedNoTag")
            )}{" "}
            <code>{tokenNamePrefix(tag)}…</code>
            {t("mint.tagRules", { max: LABEL_MAX })}
          </p>
        )}
      </div>

      <Choice
        label={t("mint.payWith")}
        id="mint-from"
        value={from}
        onChange={setFrom}
        options={(["account", "seedelf"] as const).map((source) => ({
          value: source,
          label: t(SOURCES[source]),
          disabled: (source === "account" ? balances.cardano.utxos : balances.seedelf.utxos) === 0,
        }))}
      />
      <Callout tone="privacy" testId="mint-from-note">
        {t(from === "account" ? "mint.privacy.fromAccount" : "mint.privacy.fromPrivate")}
      </Callout>
      <p className="note">{t("mint.costNote")}</p>
    </Screen>
  );
}
