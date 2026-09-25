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
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { LovejoinFunding, LovejoinPublicSummary, LovejoinStatus, PendingTx, SessionOutSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ShieldIcon } from "../components/Icons";
import { chainText, delayText, useSessionsWhile } from "../components/LovejoinReturn";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { Tabs } from "../components/Tabs";
import { formatAda, plural, shortHex, whenOf } from "../format";
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

/** A mix's tag. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") return { tone: "bad", label: "Not funded" };
  if (s.stage === "closed") return s.mix?.skipped ? { tone: "off", label: "Not mixed" } : { tone: "done", label: "Done" };
  if (s.auto?.retry) return { tone: "wait", label: "Retrying" };
  return { tone: "live", label: "Running" };
}

/** What a mix is doing, in a line: its chain sent, then on chain. */
function subOf(s: SessionView, now: number): string {
  if (s.stage === "failed") return "Its funding didn't go through";
  if (s.stage === "funding") return "Its one-time account is being funded";
  if (s.mix?.skipped) return `Lovejoin was left out: ${s.mix.skipped}`;
  if (s.chain?.cut) return chainText(s.chain);
  if (s.stage === "closed") return `In Lovejoin since ${whenOf(s.createdAt, new Date(now))}`;
  if (s.auto?.retry) return `Trying again: ${s.auto.retry.error}`;
  if (s.chain) return chainText(s.chain);
  return "Funded: the mixes are built and sent next";
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
  const [status, setStatus] = useState<LovejoinStatus>();
  const [mixes, setMixes] = useState<SessionView[]>([]);
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  /** Which of the page's buttons is working. */
  const [pressed, setPressed] = useState<"now" | "again">();
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

  // The public mix being sent: how many of its transactions are in so far.
  const [sending, setSending] = useState<{ total: number; sent: number } | null>(null);
  const sendingPublic = busy && review?.source === "public";
  useEffect(() => {
    if (!sendingPublic) {
      setSending(null);
      return;
    }
    const timer = setInterval(() => {
      call("lovejoin-mix-public-progress", {}).then(setSending, () => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [sendingPublic]);

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

  async function act(task: () => Promise<void>, button?: "now" | "again") {
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

  const now = () =>
    act(async () => {
      onPending(await call("lovejoin-withdraw-now", {}));
      await load();
    }, "now");

  const again = () =>
    act(async () => {
      setReview({ source: "private", summary: await call("lovejoin-again-build", {}) });
    }, "again");

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
      </Screen>
    );
  }

  const owned = status?.boxes.length ?? 0;
  const next = status?.due[0];
  const mixingAgain = mixes.some(isMixingAgain);
  const shown = [...mixes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  return (
    <Screen title="Lovejoin" titleId="lovejoin-title" onBack={onBack} backDisabled={busy} aside="A mixer for ADA, in 10 ₳ boxes" error={error}>
      {banner}
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load()} />
      {status && !status.available && <p className="note">Lovejoin isn't on this network yet.</p>}
      {status?.available && (
        <ReviewRows testId="lovejoin-status">
          <Row label="Your boxes in the pool" value={owned ? `${plural(owned, "box", "boxes")}, ${formatAda(status.lovelace)} ₳` : "None"} strong />
          {owned > 0 && next !== undefined && (
            <Row label="Next one back" value={next <= Date.now() ? "At the next unlock" : whenOf(next, new Date())} />
          )}
        </ReviewRows>
      )}
      {owned > 0 && (
        <div className="stack">
          <button type="button" className="secondary" disabled={busy || mixingAgain} onClick={() => void again()} data-testid="lovejoin-again">
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
