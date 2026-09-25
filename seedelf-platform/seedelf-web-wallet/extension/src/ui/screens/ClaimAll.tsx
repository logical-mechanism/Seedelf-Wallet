// Bring everything back: every private session that holds something and has
// nothing on its way, back into the private balance in one go. Each comes
// back in its own transaction, signed by its own key: one transaction
// spending several one-time accounts would show on chain that they share an
// owner. They're sent one after another, so their times tie them loosely.
// Swaps that run themselves come back by themselves and aren't here.

import { useEffect, useState } from "react";

import type { SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CheckIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { formatAda, plural } from "../format";
import { pairOf } from "./Swaps";

/** A session Bring everything back can take: it holds something, and nothing of it is on its way or runs by itself. */
export const isClaimable = (s: SessionView) => s.stage === "open" && !s.auto && (s.holding?.utxos ?? 0) > 0;

/** A session by name: its site, or its swap. */
const nameOf = (s?: SessionView) => (s?.site ? new URL(s.site.origin).host : s ? pairOf(s) : "A session");

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
  const [built, setBuilt] = useState<Built>();
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
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
        title="Coming back"
        titleId="claim-result-title"
        aside={`${plural(result.sent.length, "return")} sent`}
        error={error}
        foot={
          <button type="button" className="primary" onClick={onDone}>
            Done
          </button>
        }
      >
        {result.sent.length > 0 && (
          <section className="section" aria-label="Sent">
            <h2>Sent</h2>
            <ul className="list" data-testid="claim-sent">
              {result.sent.map((x) => (
                <li key={x.index} className="list__row">
                  <span className="list__name">{nameOf(byIndex.get(x.index))}</span>
                  <span className="list__value note">Private session {x.index + 1}</span>
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
                  {nameOf(byIndex.get(x.index))}: {x.error}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        <p className="note">
          Each lands within a minute or two. A site's session stays connected, to an empty account, until you disconnect it.
        </p>
      </Screen>
    );
  }

  const picked = built?.returns.filter((r) => chosen.has(r.index)) ?? [];
  const total = picked.reduce((sum, r) => sum + BigInt(r.lovelace), 0n);
  const fees = picked.reduce((sum, r) => sum + BigInt(r.fee), 0n);
  const tokens = picked.reduce((sum, r) => sum + r.tokens.length, 0);
  const toggle = (index: number) =>
    setChosen((was) => {
      const next = new Set(was);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <Screen
      title="Bring everything back"
      titleId="claim-title"
      onBack={onBack}
      backDisabled={busy}
      aside="Each session in its own transaction. Nothing is sent until you press Send"
      error={error}
      foot={
        <button type="button" className="primary" onClick={() => void send()} disabled={!built || busy || !picked.length}>
          {busy ? "Sending…" : picked.length ? `Send ${plural(picked.length, "return")}` : "Choose a session"}
        </button>
      }
    >
      {!built && !error && <p className="note center empty">Building each session's return…</p>}
      {built && built.returns.length > 0 && (
        <section className="section" aria-label="Sessions">
          <h2>Tap a session to leave it out</h2>
          <ul className="list" data-testid="claim-returns">
            {built.returns.map((r) => {
              const on = chosen.has(r.index);
              return (
                <li key={r.index}>
                  <button
                    type="button"
                    className={on ? "token-row claim-row claim-row--on" : "token-row claim-row"}
                    aria-pressed={on}
                    onClick={() => toggle(r.index)}
                  >
                    <span className="claim-check" aria-hidden="true">
                      {on && <CheckIcon size={14} />}
                    </span>
                    <span className="token-row__label">{nameOf(byIndex.get(r.index))}</span>
                    <span className="token-row__amount">{formatAda(r.lovelace)} ₳</span>
                    <span className="token-row__sub">
                      Private session {r.index + 1}
                      {r.tokens.length ? ` · and ${plural(r.tokens.length, "token")}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {built && built.skipped.length > 0 && (
        <section className="section" aria-label="Left out">
          <h2>Left out</h2>
          <ul className="list" data-testid="claim-skipped">
            {built.skipped.map((x) => (
              <li key={x.index} className="list__row">
                <span className="stack-tight">
                  <span className="list__name">{nameOf(byIndex.get(x.index))}</span>
                  <span className="note">{x.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {built && (
        <ReviewRows testId="claim-total">
          <Row label="Into your private balance" value={`${formatAda(total.toString())} ₳`} strong />
          {tokens > 0 && <Row label="" value={`and ${plural(tokens, "token")}`} />}
          <Row label="Network fees" value={`${formatAda(fees.toString())} ₳`} />
          <Row label="Transactions" value={String(picked.length)} />
        </ReviewRows>
      )}
      <Callout tone="privacy">
        Each session comes back in its own transaction, so nothing in them ties the sessions together. They're sent one
        after another, though, and returns that land together hint that they're one person's.
      </Callout>
    </Screen>
  );
}
