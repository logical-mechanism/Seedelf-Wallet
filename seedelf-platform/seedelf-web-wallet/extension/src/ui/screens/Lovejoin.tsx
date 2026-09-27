// Lovejoin's page in the dApp browser (roadmap chunk 16): the wallet's boxes
// in the mixer's pool, found by the Seedelf key wherever other people's mixes
// moved them, when each is due back, and a way to bring one back now. A
// private session's spare ADA goes in on its way back (Settings, Lovejoin).
//
// Mix puts ADA in from here, in boxes of 10 ₳:
//   from the private balance   a new one-time account is funded (one
//                              review), then it runs by itself: the deposit,
//                              the mixes, and the rest back, merged into the
//                              private UTxO its funding left.
//   from the public account    the deposit and every mix, paid by the account
//                              and put up against its collateral; the change
//                              stays in it.
// Either way, each box comes back into the private balance on its own, later.
//
// Mix my boxes again fans every box of the wallet's in the pool out once
// more (a chain cut short, or boxes nobody has mixed since), paid from the
// private balance through a one-time account, as a mix from it is, with no
// deposit. Its boxes wait again, a fresh delay each; none comes back while
// it runs.
//
// Every chain the wallet sends is recorded (launch review H2). A box one of
// them made and didn't finish mixing is "not mixed yet": it never comes back
// by itself, since it still shows where it went in. Mix my boxes again takes
// those first; Bring it back anyway takes one as it is, after a warning.
// The chains that aren't all sent are listed: being sent (no box comes back
// meanwhile), or stopped partway, and why. A mix from the private balance
// can be stopped before its boxes go in: it then comes back directly. What
// the wallet has in the pool is hidden with the balances (#56), and the page
// says Lovejoin has had no third-party audit.
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type {
  LovejoinChainView,
  LovejoinFunding,
  LovejoinPublicSummary,
  LovejoinStatus,
  PendingTx,
  SessionOutSummary,
  SessionView,
} from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ShieldIcon } from "../components/Icons";
import { chainText, delayText, LOVEJOIN_UNAUDITED, useSessionsWhile } from "../components/LovejoinReturn";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { Tabs } from "../components/Tabs";
import { formatAda, plural, shortHex, whenOf } from "../format";
import { useAmounts } from "../preferences";
import { SwapTag, type SwapTone } from "./Swaps";

/** The most boxes one mix takes (the worker's MAX_MIX_BOXES). */
const MAX_BOXES = 10;
/** A running mix's page asks the worker to move it on this often. */
const ADVANCE_EVERY_MS = 20_000;

type Source = "private" | "public";
type Review =
  | { source: "private"; summary: SessionOutSummary & { mix: LovejoinFunding } }
  | { source: "public"; summary: LovejoinPublicSummary };


const waves = (depth: number) => `${depth} ${depth === 1 ? "wave" : "waves"} deep`;

/** A mix that's over: back, or never funded. */
const isOver = (s: SessionView) => s.stage === "closed" || s.stage === "failed";

/** A mix of the wallet's boxes again that may still spend them: no box comes back meanwhile. */
const isMixingAgain = (s: SessionView) => !!s.mix?.again && !isOver(s) && !s.txs.some((t) => t.kind === "back");

/** A mix whose funding the chain hasn't shown, but which may still land: it can be looked for again. */
const unseen = (s: SessionView) => s.stage === "failed" && !s.unsent;

/** A mix that runs and hasn't started its chain: Stop brings it back directly, with no box going in. */
const stoppable = (s: SessionView) => !isOver(s) && !s.chain && !s.auto?.stopping;

/** A mix's tag. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") return unseen(s) ? { tone: "wait", label: "Not seen" } : { tone: "bad", label: "Not funded" };
  if (s.stage === "closed") return s.mix?.skipped ? { tone: "off", label: "Not mixed" } : { tone: "done", label: "Done" };
  if (s.auto?.stopping) return { tone: "live", label: "Stopping" };
  if (s.auto?.retry) return { tone: "wait", label: "Retrying" };
  return { tone: "live", label: "Running" };
}

/** What a mix is doing, in a line: its chain sent, then on chain. A reason in full goes under it (detailOf). */
export function subOf(s: SessionView, now: number): string {
  if (s.stage === "failed") return unseen(s) ? "The chain hasn't shown its funding yet" : "Its funding didn't go through";
  if (s.stage === "funding") return "Its one-time account is being funded";
  if (s.mix?.skipped) return "Came back without going into Lovejoin";
  if (s.chain?.cut || s.chain?.stopped) return chainText(s.chain);
  if (s.stage === "closed") return `In Lovejoin since ${whenOf(s.createdAt, new Date(now))}`;
  if (s.chain) return chainText(s.chain);
  if (s.auto?.stopping) return "Stopping: it all comes back directly";
  if (s.auto?.retry) return "Something went wrong: it tries again by itself";
  return "Funded: the mixes are built and sent next";
}

/**
 * Why a mix stopped, was left out of Lovejoin (the pool below its floor, say),
 * or what went wrong and is tried again: in full, under its row. And what
 * stays at its account, if anything.
 */
export function detailOf(s: SessionView): string | undefined {
  const lines: string[] = [];
  if (s.mix?.skipped) lines.push(`Lovejoin was left out: ${s.mix.skipped.trim().replace(/\.$/, "")}.`);
  if (s.chain?.stopped) lines.push(`Why it stopped: ${s.chain.stopped}`);
  if (s.auto?.retry && !isOver(s)) {
    lines.push(`It tries again at ${new Date(s.auto.retry.at).toLocaleTimeString()}. What went wrong: ${s.auto.retry.error}`);
  }
  if (unseen(s)) lines.push("Koios may have taken it, and it may still land: Try again looks for it again.");
  if (s.leftBehind?.length) {
    const n = s.leftBehind.length;
    lines.push(`${n === 1 ? "One UTxO stays" : `${n} UTxOs stay`} at its account: no return takes ${n === 1 ? "it" : "them"}.`);
  }
  return lines.length ? lines.join(" ") : undefined;
}

/** Whose a chain is: a session's, or the public account's mix. */
const chainName = (c: LovejoinChainView) => (c.session === undefined ? "From your public account" : `Private session ${c.session + 1}`);

/**
 * The wallet's chains through Lovejoin that aren't all sent: one being sent
 * holds every box back until it's done; one that stopped partway says why,
 * and the boxes it didn't mix wait for Mix my boxes again.
 */
export function Chains({ chains }: { chains: LovejoinChainView[] }) {
  if (!chains.length) return null;
  return (
    <section className="section" aria-labelledby="lovejoin-chains-title">
      <h2 id="lovejoin-chains-title">Chains</h2>
      <ul className="list" data-testid="lovejoin-chains">
        {chains.map((c) => (
          <li key={`${c.session ?? "public"}.${c.at}`} className="token-row swap-row">
            <span className="avatar avatar--contact" aria-hidden="true">
              <ShieldIcon size={16} />
            </span>
            <span className="token-row__label">
              {chainName(c)}, {plural(c.boxes, "box", "boxes")}
            </span>
            <SwapTag {...(c.stopped ? { tone: "off" as const, label: "Stopped" } : { tone: "live" as const, label: "Sending" })} />
            <span className="token-row__sub">
              {c.stopped ? `Stopped after ${c.sent} of ${c.total} transactions` : `${c.sent} of ${c.total} transactions sent`}
            </span>
            <p className="token-row__detail" data-testid="lovejoin-chain-detail">
              {c.stopped
                ? `Why it stopped: ${c.stopped.trim().replace(/\.$/, "")}. The boxes it didn't mix wait, not mixed yet, for Mix my boxes again.`
                : "Withdraws wait until it's all sent."}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The wallet's boxes that a chain of its made and didn't finish mixing: they
 * never come back by themselves. Mix my boxes again takes them first; Bring
 * it back anyway takes one as it is.
 */
export function NotMixed({ count, busy, onAnyway }: { count: number; busy: boolean; onAnyway: () => void }) {
  if (!count) return null;
  return (
    <Callout tone="warn" testId="lovejoin-not-mixed">
      <div className="stack-tight">
        <span>
          {count === 1 ? "One of your boxes isn't" : `${count} of your boxes aren't`} mixed yet: a chain stopped before
          mixing {count === 1 ? "it" : "them"}. {count === 1 ? "It never comes" : "They never come"} back by{" "}
          {count === 1 ? "itself" : "themselves"}, since each still shows where it went in. Mix my boxes again takes{" "}
          {count === 1 ? "it" : "them"} first.
        </span>
        <button type="button" className="link align-start" onClick={onAnyway} disabled={busy} data-testid="lovejoin-anyway">
          Bring one back anyway
        </button>
      </div>
    </Callout>
  );
}

export function Lovejoin({
  banner,
  onBack,
  onPending,
}: {
  /** Home's banner for the transaction it's watching: a withdraw or a mix sent from here shows in it. */
  banner?: ReactNode;
  onBack: () => void;
  onPending: (pending: PendingTx) => void;
}) {
  const amounts = useAmounts();
  const [status, setStatus] = useState<LovejoinStatus>();
  const [mixes, setMixes] = useState<SessionView[]>([]);
  // Asked first: bringing back a box not mixed yet, or stopping a mix.
  const [asking, setAsking] = useState<{ anyway: true } | { stop: number }>();
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  /** Which of the page's buttons is working. */
  const [pressed, setPressed] = useState<"now" | "again" | "anyway">();
  const [error, setError] = useState<string>();
  const [source, setSource] = useState<Source>("private");
  const [boxes, setBoxes] = useState(1);
  const [funding, setFunding] = useState<LovejoinFunding>();
  const [review, setReview] = useState<Review>();

  // One pool read on open, and on Refresh; the mixes from the device's record.
  const load = useCallback(async () => {
    setReading(true);
    try {
      const [s, all] = await Promise.all([call("lovejoin-status", {}), call("sessions", {})]);
      setStatus(s);
      setMixes(all.filter((x) => x.mix));
      setUpdatedAt(Date.now());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A mix that runs takes its next step while the page is open, as the alarm would.
  useEffect(() => {
    const running = mixes.filter((m) => !isOver(m));
    if (!running.length) return;
    const timer = setInterval(() => {
      void Promise.all(running.map((m) => call("session-advance", { index: m.index }))).then(
        (moved) => setMixes((was) => was.map((m) => moved.find((x) => x.index === m.index) ?? m)),
        () => undefined,
      );
    }, ADVANCE_EVERY_MS);
    return () => clearInterval(timer);
  }, [mixes]);

  // Its chain's progress, as it's sent and confirmed: the record alone, every few seconds.
  useSessionsWhile(
    mixes.some((m) => !isOver(m)),
    (all) => setMixes(all.filter((x) => x.mix)),
  );

  // The public mix being sent: how many of its transactions are in so far. Its Send sends the first few;
  // while the page is open, it sends the rest as blocks make room (the alarm does too, once a minute).
  const [sending, setSending] = useState<{ total: number; sent: number; stopped?: string } | null>(null);
  const sendingPublic = busy && review?.source === "public";
  const publicRunning = !!sending && !sending.stopped;
  useEffect(() => {
    void call("lovejoin-mix-public-progress", {}).then(setSending, () => undefined);
  }, []);
  useEffect(() => {
    if (!sendingPublic && !publicRunning) return;
    const timer = setInterval(() => {
      call("lovejoin-mix-public-progress", { advance: !sendingPublic }).then(setSending, () => undefined);
    }, sendingPublic ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [sendingPublic, publicRunning]);

  // What the chosen number of boxes takes: WebAssembly and the settings, no Koios.
  useEffect(() => {
    let live = true;
    call("lovejoin-funding", { boxes }).then(
      (f) => live && setFunding(f),
      () => live && setFunding(undefined),
    );
    return () => {
      live = false;
    };
  }, [boxes]);

  async function act(task: () => Promise<void>, button?: "now" | "again" | "anyway") {
    setBusy(true);
    setPressed(button);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPressed(undefined);
    }
  }

  // The worker may say no, and why: a chain being sent, the last withdraw maybe on its way, boxes not mixed yet.
  const now = () =>
    act(async () => {
      onPending(await call("lovejoin-withdraw-now", {}));
      await load();
    }, "now");

  /** Brings back a box its chain didn't mix, as it is: it shows where it went in. */
  const anyway = () => {
    const box = status?.notMixed[0];
    setAsking(undefined);
    if (!box) return;
    void act(async () => {
      onPending(await call("lovejoin-withdraw-now", { box, anyway: true }));
      await load();
    }, "anyway");
  };

  /** Stops a mix before its boxes go in: everything at its account comes back directly. */
  const stop = (index: number) => {
    setAsking(undefined);
    void act(async () => {
      const moved = await call("session-stop", { index });
      setMixes((was) => was.map((m) => (m.index === index ? moved : m)));
    });
  };

  const again = () =>
    act(async () => {
      setReview({ source: "private", summary: await call("lovejoin-again-build", {}) });
    }, "again");

  /** A mix waiting to try again: now. */
  const retry = (index: number) =>
    act(async () => {
      const moved = await call("session-resume", { index });
      setMixes((was) => was.map((m) => (m.index === index ? moved : m)));
    });

  const build = () =>
    act(async () => {
      setReview(
        source === "private"
          ? { source, summary: await call("lovejoin-mix-private-build", { boxes }) }
          : { source, summary: await call("lovejoin-mix-public-build", { boxes }) },
      );
    });

  const send = () =>
    act(async () => {
      if (!review) return;
      if (review.source === "private") {
        const { pending } = await call("lovejoin-mix-private-submit", { txHash: review.summary.txHash });
        onPending(pending);
      } else {
        onPending(await call("lovejoin-mix-public-submit", { txHash: review.summary.txHash }));
        setSending(await call("lovejoin-mix-public-progress", {}));
      }
      setReview(undefined);
      await load();
    });

  if (review) {
    return (
      <Screen
        title={review.source === "private" && review.summary.mix.again ? "Review mixing again" : "Review the mix"}
        titleId="lovejoin-review-title"
        onBack={() => setReview(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button type="button" className="primary" disabled={busy} onClick={() => void send()} data-testid="lovejoin-send">
            {!busy ? "Send" : sending ? `Sending ${sending.sent} of ${sending.total}…` : "Sending…"}
          </button>
        }
      >
        {review.source === "private" ? <PrivateReview summary={review.summary} /> : <PublicReview summary={review.summary} />}
        <p className="note" data-testid="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED}
        </p>
      </Screen>
    );
  }

  const owned = status?.boxes.length ?? 0;
  const notMixed = status?.notMixed.length ?? 0;
  const next = status?.due[0];
  const mixingAgain = mixes.some(isMixingAgain);
  const shown = [...mixes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  // The public mix being sent shows its own progress below: the list takes the others.
  const chains = (status?.chains ?? []).filter((c) => !(sending && c.session === undefined));
  return (
    <Screen title="Lovejoin" titleId="lovejoin-title" onBack={onBack} backDisabled={busy} aside="A mixer for ADA, in 10 ₳ boxes" error={error}>
      {banner}
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load()} />
      {status && !status.available && <p className="note">Lovejoin isn't on this network yet.</p>}
      {status?.available && (
        <ReviewRows testId="lovejoin-status">
          {/* What the wallet has in the pool is a balance: hidden while balances are (launch review #56). */}
          <Row label="Your boxes in the pool" value={owned ? `${plural(owned, "box", "boxes")}, ${amounts.ada(status.lovelace)} ₳` : "None"} strong />
          {notMixed > 0 && <Row label="Not mixed yet" value={plural(notMixed, "box", "boxes")} />}
          {owned > notMixed && next !== undefined && (
            <Row label="Next one back" value={next <= Date.now() ? "At the next unlock" : whenOf(next, new Date())} />
          )}
        </ReviewRows>
      )}
      <NotMixed count={notMixed} busy={busy || mixingAgain} onAnyway={() => setAsking({ anyway: true })} />
      {owned > 0 && (
        <div className="stack">
          <button
            type="button"
            className={notMixed ? "primary" : "secondary"}
            disabled={busy || mixingAgain}
            onClick={() => void again()}
            data-testid="lovejoin-again"
          >
            {pressed === "again" ? "Building…" : "Mix my boxes again"}
          </button>
          <button type="button" className="secondary" disabled={busy || mixingAgain} onClick={() => void now()} data-testid="lovejoin-now">
            {pressed === "now" ? "Working…" : "Bring one back now"}
          </button>
          {mixingAgain && (
            <p className="note" data-testid="lovejoin-again-running">
              Your boxes are being mixed again. None comes back until that's sent; then each waits again.
            </p>
          )}
        </div>
      )}

      <Chains chains={chains} />

      {sending && (
        <div className="stack" data-testid="lovejoin-public-sending">
          <p className="note">
            Your mix from the public account:{" "}
            {sending.stopped
              ? `stopped after ${sending.sent} of ${sending.total} transactions.`
              : `${sending.sent} of ${sending.total} transactions sent. The rest go as blocks make room.`}
          </p>
          {sending.stopped && <p className="token-row__detail">Why it stopped: {sending.stopped}</p>}
        </div>
      )}

      {status?.available && (
        <section className="section stack" aria-labelledby="lovejoin-mix-title">
          <h2 id="lovejoin-mix-title">Mix</h2>
          <Tabs
            label="Mix from"
            prefix="lovejoin-"
            tabs={[
              { value: "private", label: "Private balance" },
              { value: "public", label: "Public account" },
            ]}
            value={source}
            onChange={setSource}
          />
          <div className="field" role="tabpanel" id={`lovejoin-panel-${source}`} aria-labelledby={`lovejoin-tab-${source}`}>
            <label htmlFor="lovejoin-boxes">Boxes of 10 ₳</label>
            <div className="stepper">
              <button type="button" className="icon-button" aria-label="One box fewer" disabled={boxes <= 1} onClick={() => setBoxes((b) => b - 1)}>
                −
              </button>
              <output id="lovejoin-boxes" className="stepper__value" data-testid="lovejoin-boxes">
                {plural(boxes, "box", "boxes")}, {formatAda((BigInt(boxes) * 10_000_000n).toString())} ₳
              </output>
              <button
                type="button"
                className="icon-button"
                aria-label="One box more"
                disabled={boxes >= MAX_BOXES}
                onClick={() => setBoxes((b) => b + 1)}
              >
                +
              </button>
            </div>
          </div>
          {funding && (
            <ReviewRows testId="lovejoin-mix-cost">
              <Row label="Mixed" value={`${waves(funding.depth)}, ${plural(funding.mixes, "mix", "mixes")}`} />
              <Row label="Mix fees, about" value={`${formatAda(funding.mixFees)} ₳`} />
              {source === "private" && <Row label="Into a one-time account" value={`${formatAda(funding.lovelace)} ₳, and 5 ₳ of collateral`} />}
              {source === "public" && <Row label="From your public account" value={`${formatAda(funding.lovelace)} ₳, its collateral backing the mixes`} />}
              <Row label="Back later" value={`Each box on its own, after ${delayText(funding.delay)}`} />
            </ReviewRows>
          )}
          <p className="note">What the mixes don't use comes back{source === "private" ? " into your private balance" : " to your public account"}.</p>
          <button type="button" className="primary" disabled={busy || !funding} onClick={() => void build()} data-testid="lovejoin-mix">
            {busy ? "Building…" : "Review"}
          </button>
        </section>
      )}

      {shown.length > 0 && (
        <section className="section" aria-labelledby="lovejoin-mixes-title">
          <h2 id="lovejoin-mixes-title">Mixes from your private balance</h2>
          <ul className="list" data-testid="lovejoin-mixes">
            {shown.map((m) => (
              <li key={m.index} className="token-row swap-row">
                <span className="avatar avatar--contact" aria-hidden="true">
                  <ShieldIcon size={16} />
                </span>
                <span className="token-row__label">
                  {plural(m.mix!.boxes, "box", "boxes")} {m.mix!.again ? "mixed again" : "of 10 ₳"}
                </span>
                <SwapTag {...tagOf(m)} />
                <span className="token-row__sub">{subOf(m, Date.now())}</span>
                {(detailOf(m) || stoppable(m)) && (
                  <p className="token-row__detail" data-testid="lovejoin-mix-detail">
                    {detailOf(m)}
                    {((m.auto?.retry && !isOver(m) && !m.chain?.stopped) || unseen(m)) && (
                      <>
                        {" "}
                        <button type="button" className="link" disabled={busy} onClick={() => void retry(m.index)}>
                          {unseen(m) ? "Try again" : "Try now"}
                        </button>
                      </>
                    )}
                    {stoppable(m) && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link"
                          disabled={busy}
                          onClick={() => setAsking({ stop: m.index })}
                          data-testid="lovejoin-mix-stop"
                        >
                          Stop
                        </button>
                      </>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Callout tone="privacy">
        A box waits in the pool while other people's mixes move it, and comes back into your private balance on its own,
        paid from itself, with giveme.my's collateral: nothing ties it to where it came from. Bringing one back early
        shortens that wait, which makes it easier to match by its timing.
      </Callout>
      {status?.available && (
        <Callout tone="warn" testId="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED}
        </Callout>
      )}
      {asking && "anyway" in asking && (
        <Modal
          title="Bring back a box that wasn't mixed?"
          titleId="lovejoin-anyway-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                Keep it
              </button>
              <button type="button" className="danger" onClick={anyway} data-testid="lovejoin-anyway-confirm">
                Bring it back anyway
              </button>
            </>
          }
        >
          <p className="note">
            Its chain stopped before mixing it, so it's still the box your deposit made. Brought back now, it shows where it
            went in: anyone can tie that deposit to your private balance. Mix my boxes again hides it first.
          </p>
        </Modal>
      )}
      {asking && "stop" in asking && (
        <Modal
          title="Stop this mix?"
          titleId="lovejoin-stop-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                Keep going
              </button>
              <button type="button" className="danger" onClick={() => stop(asking.stop)} data-testid="lovejoin-stop-confirm">
                Stop the mix
              </button>
            </>
          }
        >
          <p className="note">
            Its boxes don't go into Lovejoin: everything at its one-time account comes back directly into your private
            balance, less the return's network fee. A mix whose chain has begun goes on.
          </p>
        </Modal>
      )}
    </Screen>
  );
}

/** A mix from the private balance: the one-time account's funding, then what runs by itself. */
function PrivateReview({ summary }: { summary: SessionOutSummary & { mix: LovejoinFunding } }) {
  const [boxesPart, collateral] = summary.payments;
  const { mix } = summary;
  if (mix.again) return <AgainReview summary={summary} />;
  return (
    <>
      <h2>First, a one-time account is funded</h2>
      <ReviewRows testId="lovejoin-private-review">
        <Row label="To" value={`Private session ${summary.index + 1}`} strong />
        <Row label="Account" value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label="For the boxes and their mixes" value={`${formatAda(boxesPart!.lovelace)} ₳`} strong />
        <Row label="Its collateral" value={`${formatAda(collateral!.lovelace)} ₳`} />
        <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
        <Row label="Back to your private balance" value={`${formatAda(summary.changeLovelace)} ₳`} />
      </ReviewRows>
      <h2>Then it runs by itself</h2>
      <ReviewRows testId="lovejoin-private-then">
        <Row label="Into Lovejoin" value={`${plural(mix.boxes, "box", "boxes")} of 10 ₳`} strong />
        <Row label="Mixed" value={`${waves(mix.depth)}, ${plural(mix.mixes, "mix", "mixes")}, about ${formatAda(mix.mixFees)} ₳`} />
        <Row label="Back later" value={`Each box on its own, after ${delayText(mix.delay)}`} />
      </ReviewRows>
      <p className="note">
        Once the funding lands, the account deposits the boxes and pays every mix, all in one go, and what the mixes
        don't use comes back with its collateral into the private UTxO this payment leaves. Each box comes back the first
        time the wallet is unlocked after its wait.
      </p>
      <Callout tone="privacy">
        This payment links the private UTxOs it spends to the one-time account, and the account to the boxes going in. The
        mixes hide which boxes coming out are yours: each comes back into a new private UTxO of its own.
      </Callout>
      <p className="note">Send asks giveme.my to lend the funding's collateral, then submits.</p>
    </>
  );
}

/** Mix my boxes again: the one-time account's funding, then the fan-out of the boxes in the pool. */
function AgainReview({ summary }: { summary: SessionOutSummary & { mix: LovejoinFunding } }) {
  const [mixesPart, collateral] = summary.payments;
  const { mix } = summary;
  return (
    <>
      <h2>First, a one-time account is funded</h2>
      <ReviewRows testId="lovejoin-again-review">
        <Row label="To" value={`Private session ${summary.index + 1}`} strong />
        <Row label="Account" value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label="For the mixes" value={`${formatAda(mixesPart!.lovelace)} ₳`} strong />
        <Row label="Its collateral" value={`${formatAda(collateral!.lovelace)} ₳`} />
        <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
        <Row label="Back to your private balance" value={`${formatAda(summary.changeLovelace)} ₳`} />
      </ReviewRows>
      <h2>Then it runs by itself</h2>
      <ReviewRows testId="lovejoin-again-then">
        <Row
          label="Mixed again"
          value={mix.owned && mix.owned > mix.boxes ? `${mix.boxes} of your ${mix.owned} boxes in the pool` : `${plural(mix.boxes, "box", "boxes")} of yours in the pool`}
          strong
        />
        <Row label="Mixed" value={`${waves(mix.depth)}, ${plural(mix.mixes, "mix", "mixes")}, about ${formatAda(mix.mixFees)} ₳`} />
        <Row label="Back later" value={`Each box on its own, after ${delayText(mix.delay)} from the mixes`} />
      </ReviewRows>
      <p className="note">
        Once the funding lands, the account pays for every mix, all in one go: each box of yours is mixed with two others,
        and every box coming out is mixed again, as deep as Settings says. What the mixes don't use comes back with the
        collateral into the private UTxO this payment leaves. Until then no box comes back; after, each waits again.
      </p>
      {mix.owned && mix.owned > mix.boxes && (
        <p className="note" data-testid="lovejoin-again-rest">
          That's as many as one go mixes now: the pool has enough other boxes for {plural(mix.boxes, "box", "boxes")} at this depth.
          Mix the rest again once this is done.
        </p>
      )}
      <Callout tone="privacy">
        This payment links the private UTxOs it spends to the one-time account, and the account to the mixes it pays for:
        one of the three boxes going into each first mix is likely yours. The mixes after hide which boxes coming out are
        yours, and each still comes back into a new private UTxO of its own.
      </Callout>
      <p className="note">Send asks giveme.my to lend the funding's collateral, then submits.</p>
    </>
  );
}

/** A mix from the public account: the deposit and every mix, sent now. */
function PublicReview({ summary }: { summary: LovejoinPublicSummary }) {
  return (
    <>
      <ReviewRows testId="lovejoin-public-review">
        <Row label="Into Lovejoin" value={`${plural(summary.boxes, "box", "boxes")} of 10 ₳`} strong />
        <Row label="Mixed" value={`${waves(summary.depth)}, ${plural(summary.mixes, "mix", "mixes")}`} />
        <Row label="Network fees" value={`${formatAda(summary.fees)} ₳`} />
        <Row label="Transactions" value={String(summary.txs)} />
        <Row label="Stays in your public account" value={`${formatAda(summary.change)} ₳`} />
        <Row label="Back later" value={`Each box on its own, after ${delayText(summary.delay)}`} />
      </ReviewRows>
      <p className="note">
        Send sends the deposit and every mix, one after another, each on the one before's change. Your public account
        pays them, and its collateral backs every mix. Each box comes back into your private balance the first time the
        wallet is unlocked after its wait.
      </p>
      <Callout tone="privacy">
        The deposit comes from your public account, so the boxes going in are tied to it. The mixes hide which boxes coming
        out are yours: each comes back into a new private UTxO of its own.
      </Callout>
    </>
  );
}
