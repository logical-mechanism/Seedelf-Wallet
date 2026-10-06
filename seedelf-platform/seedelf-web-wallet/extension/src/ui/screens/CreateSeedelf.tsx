// Create a seedelf. A mint links the seedelf to whatever pays for it, so the
// Cardano account pays by default: minted before any move-in, the seedelf is
// linked to the account openly, and money moved in afterwards isn't tied to
// it. The Seedelf balance can pay instead (a stealth mint), which only hides
// the payer when that balance came from other people's Seedelf payments. The
// worker builds it at review. An account-paid mint's draft goes to Koios's
// Ogmios then, to measure the policy, so Koios sees the tag and the account's
// inputs even for a review that's never sent (privacy review §3.10); a
// stealth mint is measured in the wallet. Nothing is submitted until the
// user has reviewed it and pressed Send. With nothing to pay with, Review
// waits and says to fund the account, with its address a tap away
// (chunk 23's second review, GS-2).

import { useState, type FormEvent } from "react";
import { type I18nKey, Rich, useT } from "../../i18n";

import { LABEL_MAX, labelProblem, tokenNamePrefix } from "../../shared/label";
import type { Balances, MintSource, MintSummary, PendingTx } from "../../shared/rpc";
import { call, isStale } from "../background";
import { BuildStage } from "../components/BuildStage";
import { Callout } from "../components/Callout";
import { GivemeNote } from "../components/GivemeNote";
import { ShieldIcon, WalletIcon } from "../components/Icons";
import { RadioCards } from "../components/RadioCards";
import { HistoriesNote } from "../components/HistoriesNote";
import { ReviewRows, Row } from "../components/ReviewRows";
import { RenewedNote, StaleFoot, useStale } from "../components/StaleReview";
import { RewardsRow, TotalRows } from "../components/ReviewTotals";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { formatAda } from "../format";

/**
 * What pays for the mint. Keys, not words: the review and the aside used to
 * build "Back to your public account" by lowercasing this, which is English
 * grammar — a language may not lowercase, and may not put the noun there at
 * all. Those two sentences are whole keys of their own below.
 */
const SOURCES = { account: "mint.source.account", seedelf: "mint.source.seedelf" } as const satisfies Record<MintSource, I18nKey>;

export function CreateSeedelf({
  balances,
  totals,
  blocked,
  onFund,
  onCancel,
  onSent,
}: {
  balances: Balances;
  /** Both balances as Home shows them (locked UTxOs and rewards in), for the review's balance after. */
  totals?: { public: string; private: string };
  /** Why nothing can pay for one now, if so: Review waits, and says why. */
  blocked?: string;
  /** Neither side holds anything: where the public account's address is, to fund it. */
  onFund?: () => void;
  onCancel: () => void;
  /** `from`: the side that paid, which Home goes back to. */
  onSent: (pending: PendingTx, from: MintSource) => void;
}) {
  const t = useT();
  // The public account unless only the private balance can pay: with both empty it was Private, whose reason then
  // sent a new wallet to make ADA private first (chunk 23's second review, GS-2).
  const [from, setFrom] = useState<MintSource>(balances.cardano.utxos === 0 && balances.seedelf.utxos > 0 ? "seedelf" : "account");
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState<MintSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The worker's words for a review that can't go as it is: Create gives way to building it again.
  const stale = useStale();

  const tag = label.trim();
  const problem = labelProblem(label);

  function review(e: FormEvent) {
    e.preventDefault();
    void build();
  }

  async function build() {
    if (problem || busy) return;
    setBusy(true);
    setError(undefined);
    // A refusal stays, its foot saying it's building, until the new review is in (chunk 23's second review, PY-1).
    try {
      setSummary(await call("mint-build", { label: tag, from }));
      stale.built();
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
      onSent(await call("mint-submit", { txHash: summary.txHash }), summary.from);
    } catch (err) {
      if (isStale(err)) stale.refused(err);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title={t("mint.review.title")}
        titleId="mint-review"
        review
        onBack={() => {
          // The review's error is the review's: the form it goes back to starts clean, as a swap's does.
          setSummary(undefined);
          setError(undefined);
          stale.clear();
        }}
        backDisabled={busy}
        aside={t("review.nothingUntil", { action: t("mint.review.button") })}
        error={error}
        foot={
          stale.detail !== undefined ? (
            <StaleFoot detail={stale.detail} by={stale.by} busy={busy} onAgain={() => void build()} />
          ) : (
            <>
              <RenewedNote renewed={stale.renewed} />
              {/* The screen's own verb: every review's button used to say Send (chunk 23's review, S-7). */}
              <button type="button" className="primary" onClick={send} disabled={busy}>
                {busy ? t("common.sending") : t("mint.review.button")}
              </button>
            </>
          )
        }
      >
        <ReviewRows testId="mint-review">
          {summary.label && <Row label={t("activity.row.seedelf")} value={summary.label} strong />}
          <Row label={t("mint.review.paidFrom")} value={t(SOURCES[summary.from])} />
          <Row label={t("mint.review.locked")} value={`${formatAda(summary.lovelace)}\u00a0₳`} />
          {/* Its name, whole, as Receive will show it to share: not the token's (chunk 23's review, SE-1). After what
              pays and what's locked, not first: 64 hex characters were the review's opening line (chunk 23's second
              review, PY-11). */}
          <Row label={t("utxos.seedelfName")} value={summary.tokenName} whole />
          <Row label={t("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
          <RewardsRow withdrawal={summary.withdrawal} />
          <TotalRows
            side={summary.from === "account" ? "public" : "private"}
            leaving={BigInt(summary.lovelace) + BigInt(summary.fee.total)}
            before={summary.from === "account" ? totals?.public : totals?.private}
          />
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="mint-tx" />
        <HistoriesNote histories={summary.histories} testId="mint-histories" />
        <p className="note">
          {t(summary.from === "seedelf" ? "mint.review.notePrivate" : "mint.review.noteAccount")}
        </p>
        {/* Paid from the private balance, giveme.my lends the collateral; from the account, the account's own. */}
        {summary.from === "seedelf" && <GivemeNote />}
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
          <BuildStage busy={busy} />
          <button type="submit" className="primary" disabled={!!problem || busy || !!blocked}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          {/* Why Review waits, and with nothing to pay, the way to fund the account: it built for seconds, then said
              to make ADA private first (chunk 23's second review, GS-2). */}
          {blocked && (
            <p className="note foot-note" data-testid="mint-blocked">
              {blocked}
            </p>
          )}
          {blocked && onFund && (
            <button type="button" className="secondary" onClick={onFund}>
              {t("receive.seedelfs.showPublic")}
            </button>
          )}
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

      {/* Cards, not the pill switch Home's tabs use: who pays decides what the Seedelf is linked to (chunk 23's
          review, SE-5). */}
      <RadioCards
        label={t("mint.payWith")}
        id="mint-from"
        value={from}
        onChange={setFrom}
        options={(["account", "seedelf"] as const).map((source) => ({
          value: source,
          label: t(SOURCES[source]),
          icon: source === "account" ? <WalletIcon size={16} /> : <ShieldIcon size={16} />,
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
