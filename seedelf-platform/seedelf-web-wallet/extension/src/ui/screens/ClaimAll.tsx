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
// come back directly instead, as a single return's review can (privacy
// review §4.1).

import { useEffect, useState } from "react";

import type { NetworkName } from "../../networks";
import type { SessionBackSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { HandleWarning } from "../components/HandleWarning";
import { delayText, LOVEJOIN_UNAUDITED } from "../components/LovejoinReturn";
import { CheckIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { LeftBehindNote, ReturnLeftOut } from "../components/SessionLeft";
import { formatAda, plural } from "../format";
import { useNetwork } from "../network";
import { pairOf } from "./Swaps";

/** A session Bring everything back can take: it holds something, and nothing of it is on its way or runs by itself. */
export const isClaimable = (s: SessionView) => s.stage === "open" && !s.auto && (s.holding?.utxos ?? 0) > 0;

/** A session by name: its site, or its swap. */
const nameOf = (network: NetworkName, s?: SessionView) => (s?.site ? new URL(s.site.origin).host : s ? pairOf(s, network) : "A session");

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

  /** Builds them all again, straight back: signed afresh, and any chain's boxes let go. */
  async function bringDirectly() {
    if (!built || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const again = await call("session-claim-build", { indexes: sessions.map((s) => s.index), direct: true });
      setBuilt(again);
      setChosen(new Set(again.returns.map((r) => r.index).filter((i) => chosen.has(i))));
      setDirect(true);
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
                  <span className="list__name">{nameOf(network, byIndex.get(x.index))}</span>
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
                  {nameOf(network, byIndex.get(x.index))}: {x.error}
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
      {built && (
        <ClaimReview
          built={built}
          chosen={chosen}
          sessions={sessions}
          direct={direct}
          busy={busy}
          onToggle={toggle}
          onDirect={() => void bringDirectly()}
        />
      )}
    </Screen>
  );
}

/**
 * Bring everything back's review, once its returns are built: each return,
 * which to leave out, why a session was left out, what each leaves behind,
 * and the totals. Through Lovejoin, that it has had no audit, and the way to
 * build them all again to come back directly (`onDirect`; `direct` once
 * they were).
 */
/**
 * What the button says: whose return it is, where more than one is going, and
 * which transaction of a chain it opens. A chain's is its first, so saying
 * "transaction" of it would be saying one of twelve.
 */
function claimLabel(r: SessionBackSummary, several: boolean): string | undefined {
  const which = r.lovejoin && r.lovejoin.txs > 1 ? (r.lovejoin.again ? "first mix" : "deposit") : undefined;
  if (several) return `Private session ${r.index + 1}'s ${which ?? "transaction"}`;
  // One return coming back directly is one transaction: the button's own words do.
  return which && `The ${which}'s transaction`;
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
  onDirect: () => void;
}) {
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
      {built.returns.length > 0 && (
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
                    onClick={() => onToggle(r.index)}
                  >
                    <span className="claim-check" aria-hidden="true">
                      {on && <CheckIcon size={14} />}
                    </span>
                    <span className="token-row__label">{nameOf(network, byIndex.get(r.index))}</span>
                    <span className="token-row__amount">{formatAda(r.lovelace)} ₳</span>
                    <span className="token-row__sub">
                      Private session {r.index + 1}
                      {r.tokens.length ? ` · and ${plural(r.tokens.length, "token")}` : ""}
                      {r.lovejoin ? ` · and ${plural(r.lovejoin.boxes, "box", "boxes")} of 10 ₳ through Lovejoin` : ""}
                      {r.lovejoinSkipped ? " · Lovejoin left out" : ""}
                      {r.leftOut?.length ? ` · leaves ${plural(r.leftOut.length, "UTxO")}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {built.skipped.length > 0 && (
        <section className="section" aria-label="Left out">
          <h2>Left out</h2>
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
          Lovejoin is left out of{" "}
          {picked.filter((r) => r.lovejoinSkipped).length === 1 ? "one return" : "some returns"}, which come back directly:
          <ul className="dapp-points">
            {picked
              .filter((r) => r.lovejoinSkipped)
              .map((r) => (
                <li key={r.index}>
                  {nameOf(network, byIndex.get(r.index))}: {r.lovejoinSkipped!.trim().replace(/\.$/, "")}.
                </li>
              ))}
          </ul>
        </Callout>
      )}
      {picked.map((r) => (
        <ReturnLeftOut key={r.index} leftOut={r.leftOut} name={`private session ${r.index + 1}`} />
      ))}
      {sessions.map((s) => (
        <LeftBehindNote key={s.index} leftBehind={s.leftBehind} name={`private session ${s.index + 1}`} />
      ))}
      <HandleWarning tokens={picked.flatMap((r) => r.tokens)} returning />
      <ReviewRows testId="claim-total">
        <Row label={boxes ? "Back now" : "Into your private balance"} value={`${formatAda(total.toString())} ₳`} strong />
        {tokens > 0 && <Row label="" value={`and ${plural(tokens, "token")}`} />}
        {boxes > 0 && delay && (
          <Row label="Through Lovejoin" value={`${plural(boxes, "box", "boxes")} of 10 ₳, each back after ${delayText(delay)}`} />
        )}
        <Row label="Network fees" value={`${formatAda(fees.toString())} ₳`} />
        <Row label="Transactions" value={String(txs)} />
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
      <Callout tone="privacy">
        Each session comes back in its own transaction, so nothing in them ties the sessions together. They're sent one
        after another, though, and returns that land together hint that they're one person's.
        {boxes > 0 &&
          " A session's spare ADA goes through Lovejoin first, paid by that session, and each box comes back on its own, later. But their deposits land in the same block or two and their mixes share blocks, and a pool with few boxes serves the first sessions while the rest come back directly. Bringing each back from its own page, hours apart, avoids both."}
        {direct && " They come back directly, as you chose: anyone can tie each on chain to its session and its funding."}
      </Callout>
      {boxes > 0 && (
        <>
          <p className="note" data-testid="lovejoin-unaudited">
            {LOVEJOIN_UNAUDITED}
          </p>
          <button type="button" className="link" disabled={busy} onClick={onDirect} data-testid="claim-direct">
            Bring them back directly instead
          </button>
        </>
      )}
    </>
  );
}
