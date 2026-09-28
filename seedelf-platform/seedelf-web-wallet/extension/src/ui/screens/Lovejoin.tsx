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
// it runs. A box a mix from the public account put in is the account's: the
// private balance paying for its mixes would tie the two (privacy review
// §2.10). So Mix my boxes again leaves those out, and Mix again from my
// public account mixes them, paid by the account, which ties nothing new;
// Pay from my private balance anyway takes them all, after a warning.
//
// Every chain the wallet sends is recorded (launch review H2). A box one of
// them made and didn't finish mixing is "not mixed yet": it never comes back
// by itself, since it still shows where it went in. Mixing again takes
// those first; Bring it back anyway takes one as it is, after a warning.
// After a restore, with no records, the worker asks Koios what made each
// box: one a deposit made is not mixed yet too, said as Koios said it (whose
// deposit, and why no mix followed, the wallet can't know), and one Koios
// hasn't said of waits the same way until it has (independent review M14).
// The chains that aren't all sent are listed: being sent (no box comes back
// meanwhile), or stopped partway, and why. A mix from the private balance
// can be stopped before its boxes go in: it then comes back directly. What
// the wallet has in the pool is hidden with the balances (#56), and so is
// how many boxes, since every box is 10 ₳ (privacy review §2.16); the Mix
// form and the reviews show what's being sent. The page says Lovejoin has
// had no third-party audit.
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
import { HistoriesNote } from "../components/HistoriesNote";
import { ShieldIcon } from "../components/Icons";
import { chainText, delayText, LOVEJOIN_SEEN, LOVEJOIN_UNAUDITED, lovejoinHides, useSessionsWhile } from "../components/LovejoinReturn";
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
  if (s.chain?.cut || s.chain?.stopped) return chainText(s.chain, !s.auto);
  if (s.stage === "closed") return `In Lovejoin since ${whenOf(s.createdAt, new Date(now))}`;
  if (s.chain) return chainText(s.chain, !s.auto);
  if (s.auto?.stopping) return "Stopping: it all comes back directly";
  if (s.auto?.retry) return "Something went wrong: it tries again by itself";
  // Found as the wallet unlocked, its next step waits a fresh draw of up to 20 minutes (privacy review §3.1).
  if (s.auto?.waitsUntil !== undefined && s.auto.waitsUntil > now) return "Funded: it goes on within 20 minutes of the unlock";
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
  const amounts = useAmounts();
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
              {chainName(c)}, {amounts.count(c.boxes, "box", "boxes")}
            </span>
            <SwapTag {...(c.stopped ? { tone: "off" as const, label: "Stopped" } : { tone: "live" as const, label: "Sending" })} />
            {/* One stopped at a transaction that may have gone through says so (independent review L5). */}
            <span className="token-row__sub">
              {c.stopped
                ? `Stopped after ${c.sent} of ${c.total} transactions${c.maybeSent ? ", and the next may have gone through" : ""}`
                : `${c.sent} of ${c.total} transactions sent`}
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
 * The box Bring one back anyway takes: one whose making Koios hasn't said of
 * yet first, after a restore, since it may well be mixed, while the others
 * surely aren't (independent review M14).
 */
export const anywayBox = (status?: Pick<LovejoinStatus, "notMixed" | "unsure">) => status?.unsure?.[0] ?? status?.notMixed[0];

/**
 * What Bring it back anyway's warning says of the box it takes (anywayBox).
 * After a restore, one a deposit made (`deposits`) is said as Koios said it,
 * never as the user's deposit or a stopped chain's: whose deposit it was,
 * and why no mix followed it, the wallet can't know (independent review M14).
 */
export function anywayWarning(status?: Pick<LovejoinStatus, "notMixed" | "unsure" | "deposits" | "fromPublic">): string {
  const box = anywayBox(status);
  const has = (list?: Array<{ txHash: string; txIndex: number }>) =>
    !!box && !!list?.some((b) => b.txHash === box.txHash && b.txIndex === box.txIndex);
  const found = has(status?.deposits);
  if (has(status?.unsure)) {
    return "Koios hasn't said how it went into the pool, so the wallet can't tell whether it was mixed. If a deposit made it, bringing it back now shows where it went in: anyone can tie that deposit to your private balance. Refresh in a minute to ask Koios again.";
  }
  if (has(status?.fromPublic)) {
    return found
      ? "Koios says your public account paid the deposit that put it into the pool, and no mix has moved it since. Brought back now, it shows where it went in: anyone can tie your public account to your private balance. Mix again from my public account hides it first, and ties nothing new."
      : "Its mix from your public account stopped before mixing it, so it's still the box that deposit made. Brought back now, it shows where it went in: anyone can tie your public account to your private balance. Mix again from my public account hides it first, and ties nothing new.";
  }
  return found
    ? "Koios says a deposit put it into the pool, and no mix has moved it since, so it's still that deposit's box. Brought back now, it shows where it went in: anyone can tie that deposit to your private balance. Mix my boxes again hides it first."
    : "Its chain stopped before mixing it, so it's still the box your deposit made. Brought back now, it shows where it went in: anyone can tie that deposit to your private balance. Mix my boxes again hides it first.";
}

/**
 * The wallet's boxes that a chain of its made and didn't finish mixing, or,
 * after a restore, that a deposit made (`deposits` of them): they never
 * come back by themselves. Those a deposit made are said as Koios said it,
 * never as a stopped chain's: the wallet can't know whose deposit it was,
 * or why no mix followed it. Mixing again takes them first: Mix again from
 * my public account those a mix from it made (`fromPublic` of them), Mix my
 * boxes again the rest. Bring it back anyway takes one as it is. After a
 * restore, a box whose making Koios hasn't said of yet (`unsure` of them)
 * waits too, until it has, and Mix my boxes again refuses meanwhile
 * (independent review M14).
 */
export function NotMixed({
  count,
  fromPublic = 0,
  unsure = 0,
  deposits = 0,
  busy,
  onAnyway,
}: {
  count: number;
  fromPublic?: number;
  unsure?: number;
  deposits?: number;
  busy: boolean;
  onAnyway: () => void;
}) {
  const amounts = useAmounts();
  if (!count) return null;
  // Those known not to be mixed, said first; the others (`unsure`) may be, and are said apart (independent review M14).
  const known = count - Math.min(unsure, count);
  const first = known || count;
  // How many is an amount too: while balances are hidden, it's "some" (privacy review §2.16).
  const many = amounts.hidden || first > 1;
  const which = amounts.hidden ? "Some of your boxes aren't" : first === 1 ? "One of your boxes isn't" : `${first} of your boxes aren't`;
  const them = many ? "them" : "it";
  // After a restore, those a deposit made: as Koios said, never a stopped chain's or the user's deposit (M14).
  const found = Math.min(deposits, known);
  const stopped = known - found;
  const why = !found
    ? `a chain stopped before mixing ${them}`
    : !stopped
      ? `Koios says a deposit put ${them} into the pool, and no mix has moved ${them} since`
      : `a chain stopped before mixing ${amounts.hidden ? "some" : stopped === 1 ? "one" : stopped}, and Koios says a deposit put ${amounts.hidden || found > 1 ? "the others" : "the other"} into the pool, with no mix since`;
  // A mix from the public account made them: the account pays to mix them again, and the private balance stays out of it (§2.10).
  const takes =
    fromPublic >= known
      ? `${many ? "They" : "It"} came from your public account, so Mix again from my public account takes ${them} first: paid by the account, which ties nothing new.`
      : fromPublic > 0
        ? "Mix again from my public account takes those your public account put in first, and Mix my boxes again the others."
        : `Mix my boxes again takes ${them} first.`;
  const asks = "The wallet asks Koios again at the next read, and Mix my boxes again can't be used until it has.";
  // Koios hasn't said how these went in: said as they are, without the number while balances are hidden.
  const unsureMany = amounts.hidden || unsure > 1;
  const more = amounts.hidden ? "some more" : unsure === 1 ? "one more" : `${unsure} more`;
  const waits = `${unsureMany ? "they don't come" : "it doesn't come"} back by ${unsureMany ? "themselves" : "itself"} meanwhile.`;
  return (
    <Callout tone="warn" testId="lovejoin-not-mixed">
      <div className="stack-tight">
        <span>
          {!known
            ? `${which} known to be mixed yet: Koios hasn't said how ${many ? "they" : "it"} went into the pool. ${many ? "They don't come" : "It doesn't come"} back by ${many ? "themselves" : "itself"} meanwhile. ${asks}`
            : `${which} mixed yet: ${why}. ${many ? "They never come" : "It never comes"} back by ${many ? "themselves" : "itself"}, since each still shows where it went in. ${takes}${unsure > 0 ? ` Koios hasn't said yet how ${more} went in: ${waits} ${asks}` : ""}`}
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
  // Asked first: bringing back a box not mixed yet, stopping a mix, or mixing a public mix's boxes again from the private balance.
  const [asking, setAsking] = useState<{ anyway: true } | { stop: number } | { privateAnyway: true }>();
  const [reading, setReading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  /** Which of the page's buttons is working. */
  const [pressed, setPressed] = useState<"now" | "again" | "again-public" | "anyway">();
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
  const [sending, setSending] = useState<{ total: number; sent: number; stopped?: string; maybeSent?: true } | null>(null);
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

  async function act(task: () => Promise<void>, button?: "now" | "again" | "again-public" | "anyway") {
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

  /** Brings back a box not mixed yet, as it is: it shows where it went in (anywayBox, anywayWarning). */
  const anyway = () => {
    const box = anywayBox(status);
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

  /** Mixes the boxes again from the private balance: `anyway`, those a mix from the public account put in too. */
  const again = (anyway = false) => {
    setAsking(undefined);
    return act(async () => {
      setReview({ source: "private", summary: await call("lovejoin-again-build", anyway ? { anyway: true } : {}) });
    }, "again");
  };

  /** Mixes the boxes a mix from the public account put in again, paid by the account (§2.10). */
  const againPublic = () =>
    act(async () => {
      setReview({ source: "public", summary: await call("lovejoin-again-public-build", {}) });
    }, "again-public");

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
        title={(review.source === "private" ? review.summary.mix.again : review.summary.again) ? "Review mixing again" : "Review the mix"}
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
  // The boxes a mix from the public account put in, and how many of those aren't mixed yet (§2.10).
  const theirs = new Set((status?.fromPublic ?? []).map((b) => `${b.txHash}#${b.txIndex}`));
  const publicBoxes = theirs.size;
  const publicNotMixed = (status?.notMixed ?? []).filter((b) => theirs.has(`${b.txHash}#${b.txIndex}`)).length;
  // After a restore, those whose making Koios hasn't said of yet (independent review M14).
  const unsure = new Set((status?.unsure ?? []).map((b) => `${b.txHash}#${b.txIndex}`));
  // The box Bring one back anyway takes, which its warning is about.
  const taken = anywayBox(status);
  const firstUnsure = !!taken && unsure.has(`${taken.txHash}#${taken.txIndex}`);
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
          {/* What the wallet has in the pool is a balance, and so is how many boxes: hidden while balances are (launch review #56, privacy review §2.16). */}
          <Row label="Your boxes in the pool" value={owned ? `${amounts.count(owned, "box", "boxes")}, ${amounts.ada(status.lovelace)} ₳` : "None"} strong />
          {notMixed > unsure.size && <Row label="Not mixed yet" value={amounts.count(notMixed - unsure.size, "box", "boxes")} />}
          {unsure.size > 0 && <Row label="Not known to be mixed yet" value={amounts.count(unsure.size, "box", "boxes")} />}
          {owned > notMixed && next !== undefined && (
            <Row label="Next one back" value={next <= Date.now() ? "In a few minutes" : whenOf(next, new Date())} />
          )}
        </ReviewRows>
      )}
      <NotMixed
        count={notMixed}
        fromPublic={publicNotMixed}
        unsure={unsure.size}
        deposits={status?.deposits?.length ?? 0}
        busy={busy || mixingAgain}
        onAnyway={() => setAsking({ anyway: true })}
      />
      {owned > 0 && (
        <div className="stack">
          {publicBoxes > 0 && (
            <button
              type="button"
              className={publicNotMixed ? "primary" : "secondary"}
              disabled={busy || mixingAgain || publicRunning}
              onClick={() => void againPublic()}
              data-testid="lovejoin-again-public"
            >
              {pressed === "again-public" ? "Building…" : "Mix again from my public account"}
            </button>
          )}
          {owned > publicBoxes && (
            <button
              type="button"
              className={notMixed > publicNotMixed ? "primary" : "secondary"}
              disabled={busy || mixingAgain}
              onClick={() => void again()}
              data-testid="lovejoin-again"
            >
              {pressed === "again" ? "Building…" : "Mix my boxes again"}
            </button>
          )}
          <button type="button" className="secondary" disabled={busy || mixingAgain} onClick={() => void now()} data-testid="lovejoin-now">
            {pressed === "now" ? "Working…" : "Bring one back now"}
          </button>
          {publicBoxes > 0 && (
            <button
              type="button"
              className="link align-start"
              disabled={busy || mixingAgain}
              onClick={() => setAsking({ privateAnyway: true })}
              data-testid="lovejoin-again-anyway"
            >
              Pay from my private balance anyway
            </button>
          )}
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
              ? `stopped after ${sending.sent} of ${sending.total} transactions${sending.maybeSent ? ", and the next may have gone through" : ""}.`
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
                  {amounts.count(m.mix!.boxes, "box", "boxes")} {m.mix!.again ? "mixed again" : "of 10 ₳"}
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

      <WayBack />
      {status?.available && (
        <Callout tone="warn" testId="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED}
        </Callout>
      )}
      {asking && "anyway" in asking && (
        <Modal
          title={firstUnsure ? "Bring back a box that may not be mixed?" : "Bring back a box that wasn't mixed?"}
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
          <p className="note">{anywayWarning(status)}</p>
        </Modal>
      )}
      {asking && "privateAnyway" in asking && (
        <Modal
          title="Pay from your private balance?"
          titleId="lovejoin-again-anyway-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                Keep them apart
              </button>
              <button type="button" className="danger" onClick={() => void again(true)} data-testid="lovejoin-again-anyway-confirm">
                Pay from my private balance anyway
              </button>
            </>
          }
        >
          <p className="note">
            Some of your boxes came from a mix from your public account, which paid for it in the open. Paying for their mixes
            from your private balance ties the private UTxOs it spends to your public account. Mix again from my public
            account mixes them without that.
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

/**
 * How a box comes back, on Lovejoin's page (privacy review §2.4, §2.6): into
 * a private UTxO of its own, with nothing on the way back naming where it
 * went in, and hidden from people reading the chain, not from the services
 * that carry both ends. Exported for its test.
 */
export function WayBack() {
  return (
    <Callout tone="privacy" testId="lovejoin-way-back">
      A box waits in the pool while other people's mixes move it, and comes back into your private balance on its own,
      paid from itself, with giveme.my's collateral: nothing on its way back names a session or an account. Bringing one
      back early shortens that wait, which makes it easier to match by its timing. {LOVEJOIN_SEEN}
    </Callout>
  );
}

/**
 * What a mix from the public account hides (privacy review §2.6, §5.3): the
 * account paid its mixes in the open, and while few people bring Lovejoin
 * boxes back into a Seedelf, the wallet's way back stands out among the
 * boxes those mixes made.
 */
const PUBLIC_MIX_WAY_BACK =
  "Each box comes back into a new private UTxO of its own, but while few people bring Lovejoin boxes into a Seedelf, the box coming back can be picked out among those your account's mixes made.";

/** A mix from the private balance: the one-time account's funding, then what runs by itself. */
export function PrivateReview({ summary }: { summary: SessionOutSummary & { mix: LovejoinFunding } }) {
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
        don't use comes back with its collateral into the private UTxO this payment leaves. Each box comes back a few
        minutes into the first time the wallet is unlocked after its wait.
      </p>
      <Callout tone="privacy">
        This payment links the private UTxOs it spends to the one-time account, and the account to the boxes going in.
        Each box comes back into a new private UTxO of its own. {lovejoinHides(mix.depth)}
      </Callout>
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-private-histories" />
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
        one of the three boxes going into each first mix is likely yours. Each still comes back into a new private UTxO of
        its own. {lovejoinHides(mix.depth)}
        {mix.publicToo &&
          " Some of these boxes came from a mix from your public account: paying for their mixes from here ties the private UTxOs this payment spends to your public account."}
      </Callout>
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-again-histories" />
      <p className="note">Send asks giveme.my to lend the funding's collateral, then submits.</p>
    </>
  );
}

/** A mix from the public account: the deposit and every mix, sent now. */
export function PublicReview({ summary }: { summary: LovejoinPublicSummary }) {
  if (summary.again) return <PublicAgainReview summary={summary} />;
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
        pays them, and its collateral backs every mix. Each box comes back into your private balance some minutes into
        the first time the wallet is unlocked after its wait.
      </p>
      <Callout tone="privacy">
        The deposit comes from your public account, so the boxes going in are tied to it, and anyone can see your account
        paid for these mixes. {PUBLIC_MIX_WAY_BACK}
      </Callout>
    </>
  );
}

/** Mix again from my public account: the boxes a mix from it put in, each mix paid by it, sent now (§2.10). */
function PublicAgainReview({ summary }: { summary: LovejoinPublicSummary }) {
  return (
    <>
      <ReviewRows testId="lovejoin-public-again-review">
        <Row label="Mixed again" value={`${plural(summary.boxes, "box", "boxes")} your public account put in`} strong />
        <Row label="Mixed" value={`${waves(summary.depth)}, ${plural(summary.mixes, "mix", "mixes")}`} />
        <Row label="Network fees" value={`${formatAda(summary.fees)} ₳`} />
        <Row label="Transactions" value={String(summary.txs)} />
        <Row label="Stays in your public account" value={`${formatAda(summary.change)} ₳`} />
        <Row label="Back later" value={`Each box on its own, after ${delayText(summary.delay)} from the mixes`} />
      </ReviewRows>
      <p className="note">
        Send sends every mix, one after another, each on the one before's change: each box of yours is mixed with two
        others, and every box coming out is mixed again, as deep as Settings says. Your public account pays them, and its
        collateral backs every mix. Until they're all sent no box comes back; after, each waits again.
      </p>
      <Callout tone="privacy">
        These boxes came from a mix from your public account, which paid for it in the open, so paying for their mixes from
        it ties nothing new, and your private balance stays out of it. {PUBLIC_MIX_WAY_BACK}
      </Callout>
    </>
  );
}
