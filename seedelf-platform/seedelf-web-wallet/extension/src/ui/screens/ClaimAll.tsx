// Bring everything back: every private session that holds something and has
// nothing on its way, back into the private balance in one go. Each comes
// back in its own transaction, signed by its own key: one transaction
// spending several one-time accounts would show on chain that they share an
// owner. They're sent one after another, so their times tie them loosely.
// Swaps that run themselves come back by themselves and aren't here.
//
// The review says what each return leaves at its account (a token that
// comes with the next return, a UTxO no return takes: launch review H6),
// why a return leaves Lovejoin out (another's chain may have taken the
// pool's boxes: #23), and warns before an ADA Handle comes into the private
// balance (#57). Returns that go through Lovejoin can all be built again to
// come back directly instead, by a switch first on the review, as a single
// return's review has (privacy review §4.1; blind test §9.8: it was a link
// under the costs).

import { useEffect, useState } from "react";
import { joinSentences, t, useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { HandleWarning } from "../components/HandleWarning";
import { BoxesBackRow, delayText, LOVEJOIN_UNAUDITED } from "../components/LovejoinReturn";
import { CheckIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { LeftBehindNote, ReturnLeftOut } from "../components/SessionLeft";
import { formatAda } from "../format";
import { useNetwork } from "../network";
import { withoutStop } from "../sentence";
import { pairOf } from "./Swaps";

/** A session Bring everything back can take: it holds something, and nothing of it is on its way or runs by itself. */
export const isClaimable = (s: SessionView) => s.stage === "open" && !s.auto && (s.holding?.utxos ?? 0) > 0;

/** A session by name: its site, or its swap. */
const nameOf = (network: NetworkName, s?: SessionView) => (s?.site ? new URL(s.site.origin).host : s ? pairOf(s, network) : t("claim.aSession"));

type Built = { returns: SessionBackSummary[]; skipped: Array<{ index: number; reason: string }> };
type Result = { sent: Array<{ index: number; txHash: string }>; failed: Array<{ index: number; error: string }> };

export function ClaimAll({
  sessions,
  onBack,
  onDone,
}: {
  /** The claimable sessions, as the dApps page read them. */
  sessions: SessionView[];
  onBack: () => void;
  /** Sent: the dApps page reads the sessions again. */
  onDone: () => void;
}) {
  const t = useT();
  const [built, setBuilt] = useState<Built>();
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  // Built again to come back directly: none of them goes through Lovejoin.
  const [direct, setDirect] = useState(false);
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const network = useNetwork();
  const byIndex = new Map(sessions.map((s) => [s.index, s]));

  // Each return built and signed up front; the review shows what each brings, and its fee.
  useEffect(() => {
    let live = true;
    call("session-claim-build", { indexes: sessions.map((s) => s.index) }).then(
      (b) => {
        if (!live) return;
        setBuilt(b);
        setChosen(new Set(b.returns.map((r) => r.index)));
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
    // Built once, for the list it opened with: building again would sign again.
  }, []);

  /** Builds them all again, straight back (`direct`) or through Lovejoin again: signed afresh, and any chain's boxes let go. */
  async function rebuild(straight: boolean) {
    if (!built || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const again = await call("session-claim-build", { indexes: sessions.map((s) => s.index), ...(straight ? { direct: true } : {}) });
      setBuilt(again);
      setChosen(new Set(again.returns.map((r) => r.index).filter((i) => chosen.has(i))));
      setDirect(straight);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!built || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const txHashes = built.returns.filter((r) => chosen.has(r.index)).map((r) => r.txHash);
      setResult(await call("session-claim-submit", { txHashes }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Screen
        title={t("claim.result.title")}
        titleId="claim-result-title"
        aside={t("claim.result.sentCount", { count: result.sent.length })}
        error={error}
        foot={
          <button type="button" className="primary" onClick={onDone}>
            {t("common.done")}
          </button>
        }
      >
        {result.sent.length > 0 && (
          <section className="section" aria-label={t("claim.sent")}>
            <h2>{t("claim.sent")}</h2>
            <ul className="list" data-testid="claim-sent">
              {result.sent.map((x) => (
                <li key={x.index} className="list__row">
                  <span className="list__name">{nameOf(network, byIndex.get(x.index))}</span>
                  <span className="list__value note">{t("claim.session", { number: x.index + 1 })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {result.failed.length > 0 && (
          <Callout tone="warn" testId="claim-failed">
            <ul className="dapp-points">
              {result.failed.map((x) => (
                <li key={x.index}>
                  {nameOf(network, byIndex.get(x.index))}: {x.error}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        <p className="note">
          {t("claim.result.note")}
        </p>
      </Screen>
    );
  }

  const picked = built?.returns.filter((r) => chosen.has(r.index)) ?? [];
  const toggle = (index: number) =>
    setChosen((was) => {
      const next = new Set(was);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <Screen
      title={t("claim.title")}
      titleId="claim-title"
      review
      onBack={onBack}
      backDisabled={busy}
      aside={t("review.nothingSent")}
      error={error}
      foot={
        <button type="button" className="primary" onClick={() => void send()} disabled={!built || busy || !picked.length}>
          {busy ? t("common.sending") : picked.length ? t("claim.sendReturns", { count: picked.length }) : t("claim.chooseSession")}
        </button>
      }
    >
      {!built && !error && <p className="note center empty">{t("claim.building")}</p>}
      {built && (
        <ClaimReview
          built={built}
          chosen={chosen}
          sessions={sessions}
          direct={direct}
          busy={busy}
          onToggle={toggle}
          onDirect={(straight) => void rebuild(straight)}
        />
      )}
    </Screen>
  );
}

/**
 * Bring everything back's review, once its returns are built: each return,
 * which to leave out, why a session was left out, what each leaves behind,
 * and the totals. Through Lovejoin, that it has had no audit, and, first, a
 * switch to build them all again to come back directly, or through Lovejoin
 * again (`onDirect`; `direct` once they were).
 */
/**
 * What the button says: whose return it is, where more than one is going, and
 * which transaction of a chain it opens. A chain's is its first, so saying
 * "transaction" of it would be saying one of twelve.
 */
function claimLabel(r: SessionBackSummary, several: boolean): string | undefined {
  const which = r.lovejoin && r.lovejoin.txs > 1 ? t(r.lovejoin.again ? "claim.firstMix" : "claim.deposit") : undefined;
  if (several) return t("claim.sessionsTx", { number: r.index + 1, which: which ?? t("claim.transaction") });
  // One return coming back directly is one transaction: the button's own words do.
  return which && t("claim.whichTx", { which });
}

export function ClaimReview({
  built,
  chosen,
  sessions,
  direct,
  busy,
  onToggle,
  onDirect,
}: {
  built: Built;
  chosen: ReadonlySet<number>;
  sessions: SessionView[];
  direct: boolean;
  busy: boolean;
  onToggle: (index: number) => void;
  onDirect: (direct: boolean) => void;
}) {
  const t = useT();
  const network = useNetwork();
  const byIndex = new Map(sessions.map((s) => [s.index, s]));
  const picked = built.returns.filter((r) => chosen.has(r.index));
  const total = picked.reduce((sum, r) => sum + BigInt(r.lovelace), 0n);
  const fees = picked.reduce((sum, r) => sum + BigInt(r.fee), 0n);
  const tokens = picked.reduce((sum, r) => sum + r.tokens.length, 0);
  const boxes = picked.reduce((sum, r) => sum + (r.lovejoin?.boxes ?? 0), 0);
  const txs = picked.reduce((sum, r) => sum + (r.lovejoin?.txs ?? 1), 0);
  const delay = picked.find((r) => r.lovejoin)?.lovejoin?.delay;

  return (
    <>
      {/* The way back first, a switch, where it can't be missed: it was a link, "Bring them back directly instead",
          under the costs (blind test §9.8; Stop's, 5289dcf). The private way stays the default. */}
      {(boxes > 0 || direct) && (
        <div className="setting-row" data-testid="claim-way">
          <span className="stack-tight">
            <span id="claim-way-label">{t("claim.lovejoin.label")}</span>
            <span className="note" id="claim-way-note">
              {t(direct ? "claim.privacy.directly" : "claim.lovejoin.privacy.on")}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={!direct}
            aria-labelledby="claim-way-label"
            aria-describedby="claim-way-note"
            onClick={() => onDirect(!direct)}
            disabled={busy}
            data-testid="claim-way-switch"
          />
        </div>
      )}
      {built.returns.length > 0 && (
        <section className="section" aria-label={t("claim.sessions")}>
          <h2>{t("claim.tapToLeaveOut")}</h2>
          <ul className="list" data-testid="claim-returns">
            {built.returns.map((r) => {
              const on = chosen.has(r.index);
              return (
                <li key={r.index}>
                  <button
                    type="button"
                    className={on ? "token-row claim-row claim-row--on" : "token-row claim-row"}
                    aria-pressed={on}
                    onClick={() => onToggle(r.index)}
                  >
                    <span className="claim-check" aria-hidden="true">
                      {on && <CheckIcon size={14} />}
                    </span>
                    <span className="token-row__label">{nameOf(network, byIndex.get(r.index))}</span>
                    <span className="token-row__amount">{formatAda(r.lovelace)}{"\u00a0₳"}</span>
                    <span className="token-row__sub">
                      {t("claim.session", { number: r.index + 1 })}
                      {r.tokens.length ? ` · ${t("claim.andTokens", { count: r.tokens.length })}` : ""}
                      {r.lovejoin ? ` · ${t("claim.andBoxes", { count: r.lovejoin.boxes })}` : ""}
                      {r.lovejoinSkipped ? ` · ${t("claim.lovejoinLeftOut")}` : ""}
                      {r.leftOut?.length ? ` · ${t("claim.leaves", { count: r.leftOut.length })}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {built.skipped.length > 0 && (
        <section className="section" aria-label={t("claim.leftOut")}>
          <h2>{t("claim.leftOut")}</h2>
          <ul className="list" data-testid="claim-skipped">
            {built.skipped.map((x) => (
              <li key={x.index} className="list__row">
                <span className="stack-tight">
                  <span className="list__name">{nameOf(network, byIndex.get(x.index))}</span>
                  <span className="note">{x.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {picked.some((r) => r.lovejoinSkipped) && (
        <Callout tone="warn" testId="claim-lovejoin-skipped">
          {t("claim.warn.lovejoinSkipped", { count: picked.filter((r) => r.lovejoinSkipped).length })}
          <ul className="dapp-points">
            {picked
              .filter((r) => r.lovejoinSkipped)
              .map((r) => (
                <li key={r.index}>
                  {t("claim.warn.skippedItem", { name: nameOf(network, byIndex.get(r.index)), why: withoutStop(r.lovejoinSkipped!) })}
                </li>
              ))}
          </ul>
        </Callout>
      )}
      {picked.map((r) => (
        <ReturnLeftOut key={r.index} leftOut={r.leftOut} name={t("claim.sessionLower", { number: r.index + 1 })} />
      ))}
      {sessions.map((s) => (
        <LeftBehindNote key={s.index} leftBehind={s.leftBehind} name={t("claim.sessionLower", { number: s.index + 1 })} />
      ))}
      <HandleWarning tokens={picked.flatMap((r) => r.tokens)} returning />
      <ReviewRows testId="claim-total">
        <Row label={t(boxes ? "claim.backNow" : "moveIn.review.into")} value={`${formatAda(total.toString())}\u00a0₳`} strong />
        {tokens > 0 && <Row label="" value={t("claim.andTokens", { count: tokens })} />}
        {boxes > 0 && delay && (
          <Row label={t("claim.throughLovejoin")} value={t("claim.boxesBackAfter", { count: boxes, delay: delayText(delay) })} />
        )}
        {/* Paid from each box as it comes back, which the network fees here leave out (pass two of the fix round). */}
        {boxes > 0 && <BoxesBackRow boxes={boxes} />}
        <Row label={t("claim.fees")} value={`${formatAda(fees.toString())}\u00a0₳`} />
        <Row label={t("claim.transactions")} value={String(txs)} />
      </ReviewRows>
      {/* Each session comes back in its own transaction, so each is its own
          view — and where one goes through Lovejoin, the one shown is its
          chain's first, not the return it ends with. */}
      {picked.map((r) => (
        <TxDetailButton
          key={r.index}
          txHash={r.lovejoin?.entry ?? r.txHash}
          label={claimLabel(r, picked.length > 1)}
          testId={`claim-tx-${r.index}`}
        />
      ))}
      {/* Coming back directly, the switch's own note says what that ties: once. */}
      <Callout tone="privacy">
        {joinSentences([t("claim.privacy.ownTransactions"), boxes > 0 && t("claim.privacy.throughLovejoin")])}
      </Callout>
      {boxes > 0 && (
        <p className="note" data-testid="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED()}
        </p>
      )}
    </>
  );
}
