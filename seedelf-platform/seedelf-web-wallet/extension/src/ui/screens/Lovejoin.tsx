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
import { joinSentences, sentenceGap, t, useT } from "../../i18n";

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
import { TxDetailButton, entryLabel } from "../components/TxDetail";
import { Tabs } from "../components/Tabs";
import { formatAda, shortHex, whenOf } from "../format";
import { useAmounts } from "../preferences";
import { withoutStop } from "../sentence";
import { SwapTag, type SwapTone } from "./Swaps";

/** The most boxes one mix takes (the worker's MAX_MIX_BOXES). */
const MAX_BOXES = 10;
/**
 * The most boxes one seed puts in (the worker's MAX_DEPOSIT_BOXES): a seed is
 * a single deposit with no mixes, so the transaction's size is the only limit,
 * not the handful of boxes a chain of mixes can send.
 */
const MAX_SEED_BOXES = 96;
/** A running mix's page asks the worker to move it on this often. */
const ADVANCE_EVERY_MS = 20_000;

type Source = "private" | "public";
type Review =
  | { source: "private"; summary: SessionOutSummary & { mix: LovejoinFunding } }
  | { source: "public"; summary: LovejoinPublicSummary };



/** A mix that's over: back, or never funded. */
const isOver = (s: SessionView) => s.stage === "closed" || s.stage === "failed";

/** A mix of the wallet's boxes again that may still spend them: no box comes back meanwhile. */
const isMixingAgain = (s: SessionView) => !!s.mix?.again && !isOver(s) && !s.txs.some((t) => t.kind === "back");

/** A mix whose funding the chain hasn't shown, but which may still land: it can be looked for again. */
const unseen = (s: SessionView) => s.stage === "failed" && !s.unsent;

/** A mix that runs and hasn't started its chain: Stop brings it back directly, with no box going in. */
const stoppable = (s: SessionView) => !isOver(s) && !s.chain && !s.auto?.stopping;

/** A mix whose next try can be had now: one waiting to retry, or a funding to look for again. */
const retryable = (s: SessionView) => (!!s.auto?.retry && !isOver(s) && !s.chain?.stopped) || unseen(s);

/** A mix's tag. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") {
    return unseen(s) ? { tone: "wait", label: t("lovejoin.tag.notSeen") } : { tone: "bad", label: t("lovejoin.tag.notFunded") };
  }
  if (s.stage === "closed") {
    return s.mix?.skipped ? { tone: "off", label: t("lovejoin.tag.notMixed") } : { tone: "done", label: t("lovejoin.tag.done") };
  }
  if (s.auto?.stopping) return { tone: "live", label: t("lovejoin.tag.stopping") };
  if (s.auto?.retry) return { tone: "wait", label: t("lovejoin.tag.retrying") };
  return { tone: "live", label: t("lovejoin.tag.running") };
}

/** What a mix is doing, in a line: its chain sent, then on chain. A reason in full goes under it (detailOf). */
export function subOf(s: SessionView, now: number): string {
  if (s.stage === "failed") return t(unseen(s) ? "lovejoin.sub.fundingUnseen" : "lovejoin.sub.fundingFailed");
  if (s.stage === "funding") return t("lovejoin.sub.funding");
  if (s.mix?.skipped) return t("lovejoin.sub.skipped");
  if (s.chain?.cut || s.chain?.stopped) return chainText(s.chain, !s.auto);
  if (s.stage === "closed") return t("lovejoin.sub.since", { when: whenOf(s.createdAt, new Date(now)) });
  if (s.chain) return chainText(s.chain, !s.auto);
  if (s.auto?.stopping) return t("lovejoin.sub.stopping");
  if (s.auto?.retry) return t("lovejoin.sub.retrying");
  // Found as the wallet unlocked, its next step waits a fresh draw of up to 20 minutes (privacy review §3.1).
  if (s.auto?.waitsUntil !== undefined && s.auto.waitsUntil > now) return t("lovejoin.sub.waiting");
  return t("lovejoin.sub.next");
}

/**
 * Why a mix stopped, was left out of Lovejoin (the pool below its floor, say),
 * or what went wrong and is tried again: in full, under its row. And what
 * stays at its account, if anything.
 */
export function detailOf(s: SessionView): string | undefined {
  const lines: string[] = [];
  if (s.mix?.skipped) lines.push(t("lj.leftOut", { reason: withoutStop(s.mix.skipped) }));
  if (s.chain?.stopped) lines.push(t("lovejoin.detail.whyStopped", { why: s.chain.stopped }));
  if (s.auto?.retry && !isOver(s)) {
    lines.push(t("lovejoin.detail.triesAgain", { at: new Date(s.auto.retry.at).toLocaleTimeString(), error: s.auto.retry.error }));
  }
  if (unseen(s)) lines.push(t("lovejoin.detail.mayLand"));
  if (s.leftBehind?.length) lines.push(t("lovejoin.detail.leftBehind", { count: s.leftBehind.length }));
  return lines.length ? joinSentences(lines) : undefined;
}

/** Whose a chain is: a session's, or the public account's mix. */
const chainName = (c: LovejoinChainView) =>
  c.session === undefined ? t("lovejoin.chain.fromPublic") : t("lovejoin.privateSession", { number: c.session + 1 });

/**
 * The wallet's chains through Lovejoin that aren't all sent: one being sent
 * holds every box back until it's done; one that stopped partway says why,
 * and the boxes it didn't mix wait for Mix my boxes again. One whose boxes
 * were all mixed again or brought back since isn't listed (lovejoin.ts
 * `shown`).
 */
export function Chains({ chains }: { chains: LovejoinChainView[] }) {
  const amounts = useAmounts();
  const tr = useT();
  if (!chains.length) return null;
  return (
    <section className="section" aria-labelledby="lovejoin-chains-title">
      <h2 id="lovejoin-chains-title">{tr("lovejoin.chains.title")}</h2>
      <ul className="list" data-testid="lovejoin-chains">
        {chains.map((c) => (
          <li key={`${c.session ?? "public"}.${c.at}`} className="token-row swap-row">
            <span className="avatar avatar--contact" aria-hidden="true">
              <ShieldIcon size={16} />
            </span>
            <span className="token-row__label">
              {tr("lovejoin.chains.label", { whose: chainName(c), boxes: amounts.count(c.boxes, "amount.boxes") })}
            </span>
            <SwapTag
              {...(c.stopped
                ? { tone: "off" as const, label: tr("lovejoin.chains.stopped") }
                : { tone: "live" as const, label: tr("lovejoin.chains.sending") })}
            />
            {/* One stopped at a transaction that may have gone through says so (independent review L5). */}
            <span className="token-row__sub">
              {c.stopped
                ? tr(c.maybeSent ? "lovejoin.chains.afterMaybe" : "lovejoin.chains.after", { sent: c.sent, total: c.total })
                : tr("lovejoin.chains.sent", { sent: c.sent, total: c.total })}
            </span>
            <p className="token-row__detail" data-testid="lovejoin-chain-detail">
              {c.stopped
                ? tr("lovejoin.chains.whyStopped", { why: withoutStop(c.stopped) })
                : tr("lovejoin.chains.waitAll")}
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
  if (has(status?.unsure)) return t("lovejoin.anyway.privacy.untold");
  if (has(status?.fromPublic)) {
    return t(found ? "lovejoin.anyway.privacy.publicDeposit" : "lovejoin.anyway.privacy.publicStopped");
  }
  return t(found ? "lovejoin.anyway.privacy.deposit" : "lovejoin.anyway.privacy.stopped");
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
  const tr = useT();
  if (!count) return null;
  // Those known not to be mixed, said first; the others (`unsure`) may be, and are said apart (independent review M14).
  const known = count - Math.min(unsure, count);
  const first = known || count;
  // How many is an amount too: while balances are hidden, it's "some" (privacy review §2.16).
  const many = amounts.hidden || first > 1;
  // What the sentences agree with: a hidden amount reads as several, however many it is.
  const agree = many ? 2 : 1;
  // After a restore, those a deposit made: as Koios said, never a stopped chain's or the user's deposit (M14).
  const found = Math.min(deposits, known);
  const stopped = known - found;
  const why = !found
    ? tr("lovejoin.warn.notMixed.why.stopped", { count: agree })
    : !stopped
      ? tr("lovejoin.warn.notMixed.why.deposit", { count: agree })
      : tr("lovejoin.warn.notMixed.why.both", {
          stopped: amounts.hidden ? tr("lovejoin.warn.notMixed.some") : tr("lovejoin.warn.notMixed.number", { count: stopped }),
          others: tr("lovejoin.warn.notMixed.theOther", { count: amounts.hidden || found > 1 ? 2 : 1 }),
        });
  // A mix from the public account made them: the account pays to mix them again, and the private balance stays out of it (§2.10).
  const takes =
    fromPublic >= known
      ? tr("lovejoin.warn.notMixed.takes.public", { count: agree })
      : fromPublic > 0
        ? tr("lovejoin.warn.notMixed.takes.both")
        : tr("lovejoin.warn.notMixed.takes.private", { count: agree });
  const asks = tr("lovejoin.warn.notMixed.asks");
  // Koios hasn't said how these went in: said as they are, without the number while balances are hidden.
  const tail = amounts.hidden ? tr("lovejoin.warn.notMixed.unsureTailHidden") : tr("lovejoin.warn.notMixed.unsureTail", { count: unsure });
  const lead = !known
    ? amounts.hidden
      ? tr("lovejoin.warn.notMixed.unsureAllHidden")
      : tr("lovejoin.warn.notMixed.unsureAll", { count: first })
    : amounts.hidden
      ? tr("lovejoin.warn.notMixed.leadHidden", { why })
      : tr("lovejoin.warn.notMixed.lead", { count: first, why });
  return (
    <Callout tone="warn" testId="lovejoin-not-mixed">
      <div className="stack-tight">
        <span>{!known ? joinSentences([lead, asks]) : joinSentences([lead, takes, unsure > 0 && tail, unsure > 0 && asks])}</span>
        <button type="button" className="link align-start" onClick={onAnyway} disabled={busy} data-testid="lovejoin-anyway">
          {tr("lovejoin.notMixed.anyway")}
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
  const tr = useT();
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
  /** How many a seed puts in, its own count: typed, so 30 isn't 30 presses. */
  const [seedBoxes, setSeedBoxes] = useState<number>();
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

  const reviewTitle = (r: Review) => {
    if (r.source === "public" && r.summary.seed) return tr("lovejoin.review.seed");
    return tr((r.source === "private" ? r.summary.mix.again : r.summary.again) ? "lovejoin.review.again" : "lovejoin.review.mix");
  };

  const build = () =>
    act(async () => {
      setReview(
        source === "private"
          ? { source, summary: await call("lovejoin-mix-private-build", { boxes }) }
          : { source, summary: await call("lovejoin-mix-public-build", { boxes }) },
      );
    });

  /**
   * Puts boxes in with no mixes, from the public account. A mix needs two
   * other people's boxes for each of its own, and the wallet's own never
   * count towards the floor, so an empty pool can only be started by someone
   * depositing into it for nothing.
   */
  /**
   * Seeds from whichever side is chosen, as a mix does. From the public
   * account it's one deposit, which spends no script and so needs no
   * collateral; from the private balance it's a one-time account funded by a
   * Seedelf spend, which puts up giveme.my's collateral as every Seedelf
   * spend does, and deposits from there.
   */
  const seed = () =>
    act(async () => {
      setReview(
        source === "private"
          ? { source, summary: await call("lovejoin-mix-private-build", { boxes: seeding, seed: true }) }
          : { source, summary: await call("lovejoin-mix-public-build", { boxes: seeding, seed: true }) },
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
        title={reviewTitle(review)}
        titleId="lovejoin-review-title"
        onBack={() => setReview(undefined)}
        backDisabled={busy}
        aside={tr("review.nothingSent")}
        error={error}
        foot={
          <button type="button" className="primary" disabled={busy} onClick={() => void send()} data-testid="lovejoin-send">
            {!busy
              ? tr("common.send")
              : sending
                ? tr("lovejoin.sendingOf", { sent: sending.sent, total: sending.total })
                : tr("common.sending")}
          </button>
        }
      >
        {review.source === "private" ? <PrivateReview summary={review.summary} /> : <PublicReview summary={review.summary} />}
        {/* The chain's first transaction, not the one Send names: the account's
            money goes in there, and every mix after it only moves what that put
            in the pool, under rules nothing here could change (the owner,
            2026-10-01). A mix from the private balance is this one transaction —
            its chain is built later, when the session runs, against the pool as
            it is then. */}
        {review.source === "private" ? (
          <TxDetailButton txHash={review.summary.txHash} testId="lovejoin-tx" />
        ) : (
          <TxDetailButton
            txHash={review.summary.entry}
            label={entryLabel(review.summary)}
            testId="lovejoin-tx"
          />
        )}
        <p className="note" data-testid="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED()}
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
  // The pool can't be mixed in yet: seeding is the only thing that starts one.
  const short = !!status?.available && status.others < status.floor;
  // What it still needs, which is what a seed defaults to: one transaction's
  // worth at most, and the user can type any of it.
  const needed = short ? Math.min(status!.floor - status!.others, MAX_SEED_BOXES) : 0;
  const seeding = Math.min(Math.max(seedBoxes ?? needed, 1), MAX_SEED_BOXES);
  return (
    <Screen
      title="Lovejoin"
      titleId="lovejoin-title"
      onBack={onBack}
      backDisabled={busy}
      aside={tr("lovejoin.aside")}
      error={error}
    >
      {banner}
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load()} />
      {status && !status.available && <p className="note">{tr("lj.notOnNetwork")}</p>}
      {status?.available && (
        <ReviewRows testId="lovejoin-status">
          {/* What the wallet has in the pool is a balance, and so is how many boxes: hidden while balances are (launch review #56, privacy review §2.16). */}
          <Row
            label={tr("lovejoin.row.yours")}
            value={
              owned
                ? tr("lovejoin.row.yoursValue", { boxes: amounts.count(owned, "amount.boxes"), ada: amounts.ada(status.lovelace) })
                : tr("lovejoin.row.none")
            }
            strong
          />
          {notMixed > unsure.size && (
            <Row label={tr("lovejoin.row.notMixed")} value={amounts.count(notMixed - unsure.size, "amount.boxes")} />
          )}
          {unsure.size > 0 && <Row label={tr("lovejoin.row.notKnown")} value={amounts.count(unsure.size, "amount.boxes")} />}
          {owned > notMixed && next !== undefined && (
            <Row
              label={tr("lovejoin.row.nextBack")}
              value={next <= Date.now() ? tr("lovejoin.row.soon") : whenOf(next, new Date())}
            />
          )}
        </ReviewRows>
      )}
      {short && (
        <div className="stack" data-testid="lovejoin-seed-offer">
          <Callout tone="warn">
            {tr("lovejoin.seed.warn.floor", { count: status!.others, floor: status!.floor })}
          </Callout>
          <Callout tone="privacy">
            {joinSentences([
              tr("lovejoin.seed.privacy.hidesNothing"),
              tr(source === "private" ? "lovejoin.seed.privacy.fromPrivate" : "lovejoin.seed.privacy.fromPublic"),
            ])}
          </Callout>
          <div className="field">
            <label htmlFor="lovejoin-seed-boxes">{tr("lovejoin.seed.boxesLabel")}</label>
            <input
              id="lovejoin-seed-boxes"
              type="number"
              min={1}
              max={MAX_SEED_BOXES}
              step={1}
              inputMode="numeric"
              value={seedBoxes ?? needed}
              disabled={busy}
              onChange={(e) => setSeedBoxes(e.target.value === "" ? undefined : Math.floor(Number(e.target.value)))}
              data-testid="lovejoin-seed-boxes"
            />
            <p className="note" data-testid="lovejoin-seed-cost">
              {joinSentences([
                tr(source === "private" ? "lovejoin.seed.costPrivate" : "lovejoin.seed.costPublic", {
                  count: seeding,
                  ada: formatAda((BigInt(seeding) * 10_000_000n).toString()),
                }),
                tr("lovejoin.seed.needs", { count: needed }),
                tr("lovejoin.seed.atMost", { most: MAX_SEED_BOXES }),
              ])}
            </p>
          </div>
          <button type="button" className="secondary" disabled={busy} onClick={() => void seed()} data-testid="lovejoin-seed">
            {tr("lovejoin.seed.button", { count: seeding })}
          </button>
        </div>
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
              {pressed === "again-public" ? tr("common.building") : tr("lovejoin.againPublic")}
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
              {pressed === "again" ? tr("common.building") : tr("lovejoin.again")}
            </button>
          )}
          <button type="button" className="secondary" disabled={busy || mixingAgain} onClick={() => void now()} data-testid="lovejoin-now">
            {pressed === "now" ? tr("lovejoin.working") : tr("lovejoin.bringBackNow")}
          </button>
          {publicBoxes > 0 && (
            <button
              type="button"
              className="link align-start"
              disabled={busy || mixingAgain}
              onClick={() => setAsking({ privateAnyway: true })}
              data-testid="lovejoin-again-anyway"
            >
              {tr("lovejoin.payPrivateAnyway")}
            </button>
          )}
          {mixingAgain && (
            <p className="note" data-testid="lovejoin-again-running">
              {tr("lovejoin.againRunning")}
            </p>
          )}
        </div>
      )}

      <Chains chains={chains} />

      {sending && (
        <div className="stack" data-testid="lovejoin-public-sending">
          <p className="note">
            {tr("lovejoin.sending.lead")}{" "}
            {sending.stopped
              ? tr(sending.maybeSent ? "lovejoin.sending.stoppedMaybe" : "lovejoin.sending.stopped", {
                  sent: sending.sent,
                  total: sending.total,
                })
              : tr("lovejoin.sending.sent", { sent: sending.sent, total: sending.total })}
          </p>
          {sending.stopped && (
            <p className="token-row__detail">{tr("lovejoin.detail.whyStopped", { why: sending.stopped })}</p>
          )}
        </div>
      )}

      {status?.available && (
        <section className="section stack" aria-labelledby="lovejoin-mix-title">
          <h2 id="lovejoin-mix-title">{tr("lovejoin.mix.title")}</h2>
          <Tabs
            label={tr("lovejoin.mix.from")}
            prefix="lovejoin-"
            tabs={[
              { value: "private", label: tr("lovejoin.mix.private") },
              { value: "public", label: tr("lovejoin.mix.public") },
            ]}
            value={source}
            onChange={setSource}
          />
          <div className="field" role="tabpanel" id={`lovejoin-panel-${source}`} aria-labelledby={`lovejoin-tab-${source}`}>
            <label htmlFor="lovejoin-boxes">{tr("lovejoin.mix.boxesLabel")}</label>
            <div className="stepper">
              <button type="button" className="icon-button" aria-label={tr("lovejoin.mix.fewer")} disabled={boxes <= 1} onClick={() => setBoxes((b) => b - 1)}>
                −
              </button>
              <output id="lovejoin-boxes" className="stepper__value" data-testid="lovejoin-boxes">
                {tr("lovejoin.mix.boxesAda", { count: boxes, ada: formatAda((BigInt(boxes) * 10_000_000n).toString()) })}
              </output>
              <button
                type="button"
                className="icon-button"
                aria-label={tr("lovejoin.mix.more")}
                disabled={boxes >= MAX_BOXES}
                onClick={() => setBoxes((b) => b + 1)}
              >
                +
              </button>
            </div>
          </div>
          {funding && (
            <ReviewRows testId="lovejoin-mix-cost">
              <Row
                label={tr("lovejoin.mixedLabel")}
                value={tr("lovejoin.mix.depthAndMixes", {
                  count: funding.depth,
                  mixes: tr("amount.mixes", { count: funding.mixes }),
                })}
              />
              <Row label={tr("lovejoin.mix.feesLabel")} value={`${formatAda(funding.mixFees)} ₳`} />
              {source === "private" && (
                <Row label={tr("lovejoin.mix.intoOneTime")} value={tr("lovejoin.mix.andCollateral", { ada: formatAda(funding.lovelace) })} />
              )}
              {source === "public" && (
                <Row label={tr("lovejoin.mix.fromPublic")} value={tr("lovejoin.mix.collateralBacks", { ada: formatAda(funding.lovelace) })} />
              )}
              <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfter", { delay: delayText(funding.delay) })} />
            </ReviewRows>
          )}
          <p className="note">{tr(source === "private" ? "lovejoin.mix.restPrivate" : "lovejoin.mix.restPublic")}</p>
          <button type="button" className="primary" disabled={busy || !funding} onClick={() => void build()} data-testid="lovejoin-mix">
            {busy ? tr("common.building") : tr("common.review")}
          </button>
        </section>
      )}

      {shown.length > 0 && (
        <section className="section" aria-labelledby="lovejoin-mixes-title">
          <h2 id="lovejoin-mixes-title">{tr("lovejoin.mixes.title")}</h2>
          <ul className="list" data-testid="lovejoin-mixes">
            {shown.map((m) => (
              <li key={m.index} className="token-row swap-row">
                <span className="avatar avatar--contact" aria-hidden="true">
                  <ShieldIcon size={16} />
                </span>
                <span className="token-row__label">
                  {tr(m.mix!.again ? "lovejoin.mixes.again" : "lovejoin.mixes.ofTen", {
                    boxes: amounts.count(m.mix!.boxes, "amount.boxes"),
                  })}
                </span>
                <SwapTag {...tagOf(m)} />
                <span className="token-row__sub">{subOf(m, Date.now())}</span>
                {(detailOf(m) || stoppable(m)) && (
                  <p className="token-row__detail" data-testid="lovejoin-mix-detail">
                    {detailOf(m)}
                    {/* After the detail's sentences, the language's gap; between two links, a space. */}
                    {retryable(m) && (
                      <>
                        {sentenceGap()}
                        <button type="button" className="link" disabled={busy} onClick={() => void retry(m.index)}>
                          {tr(unseen(m) ? "common.tryAgain" : "lovejoin.mixes.tryNow")}
                        </button>
                      </>
                    )}
                    {stoppable(m) && (
                      <>
                        {retryable(m) ? " " : sentenceGap()}
                        <button
                          type="button"
                          className="link"
                          disabled={busy}
                          onClick={() => setAsking({ stop: m.index })}
                          data-testid="lovejoin-mix-stop"
                        >
                          {tr("lovejoin.mixes.stop")}
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
          {LOVEJOIN_UNAUDITED()}
        </Callout>
      )}
      {asking && "anyway" in asking && (
        <Modal
          title={tr(firstUnsure ? "lovejoin.anyway.titleUnsure" : "lovejoin.anyway.title")}
          titleId="lovejoin-anyway-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.anyway.keep")}
              </button>
              <button type="button" className="danger" onClick={anyway} data-testid="lovejoin-anyway-confirm">
                {tr("lovejoin.anyway.confirm")}
              </button>
            </>
          }
        >
          <p className="note">{anywayWarning(status)}</p>
        </Modal>
      )}
      {asking && "privateAnyway" in asking && (
        <Modal
          title={tr("lovejoin.privateAnyway.title")}
          titleId="lovejoin-again-anyway-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.privateAnyway.keep")}
              </button>
              <button type="button" className="danger" onClick={() => void again(true)} data-testid="lovejoin-again-anyway-confirm">
                {tr("lovejoin.payPrivateAnyway")}
              </button>
            </>
          }
        >
          <p className="note">{tr("lovejoin.privateAnyway.privacy.ties")}</p>
        </Modal>
      )}
      {asking && "stop" in asking && (
        <Modal
          title={tr("lovejoin.stop.title")}
          titleId="lovejoin-stop-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {tr("lovejoin.stop.keep")}
              </button>
              <button type="button" className="danger" onClick={() => stop(asking.stop)} data-testid="lovejoin-stop-confirm">
                {tr("lovejoin.stop.confirm")}
              </button>
            </>
          }
        >
          <p className="note">{tr("lovejoin.stop.note")}</p>
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
  const tr = useT();
  return (
    <Callout tone="privacy" testId="lovejoin-way-back">
      {joinSentences([tr("lovejoin.privacy.wayBack"), LOVEJOIN_SEEN()])}
    </Callout>
  );
}

/**
 * What a mix from the public account hides (privacy review §2.6, §5.3): the
 * account paid its mixes in the open, and while few people bring Lovejoin
 * boxes back into a Seedelf, the wallet's way back stands out among the
 * boxes those mixes made.
 */
const PUBLIC_MIX_WAY_BACK = () => t("lovejoin.privacy.publicWayBack");

/** A mix from the private balance: the one-time account's funding, then what runs by itself. */
export function PrivateReview({ summary }: { summary: SessionOutSummary & { mix: LovejoinFunding } }) {
  const tr = useT();
  const [boxesPart, collateral] = summary.payments;
  const { mix } = summary;
  if (mix.again) return <AgainReview summary={summary} />;
  return (
    <>
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="lovejoin-private-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label={tr("lovejoin.review.forBoxes")} value={`${formatAda(boxesPart!.lovelace)} ₳`} strong />
        <Row label={tr("lovejoin.review.itsCollateral")} value={`${formatAda(collateral!.lovelace)} ₳`} />
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)} ₳`} />
        <Row label={tr("review.backToPrivate")} value={`${formatAda(summary.changeLovelace)} ₳`} />
      </ReviewRows>
      <h2>{tr("lovejoin.review.thenItself")}</h2>
      <ReviewRows testId="lovejoin-private-then">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOfTen", { count: mix.boxes })} strong />
        <Row
          label={tr("lovejoin.mixedLabel")}
          value={tr("lovejoin.review.depthMixesCost", {
            count: mix.depth,
            mixes: tr("amount.mixes", { count: mix.mixes }),
            ada: formatAda(mix.mixFees),
          })}
        />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfter", { delay: delayText(mix.delay) })} />
      </ReviewRows>
      <p className="note">{tr("lovejoin.review.privateNote")}</p>
      <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.private"), lovejoinHides(mix.depth)])}</Callout>
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-private-histories" />
      <p className="note">{tr("lovejoin.review.givemeNote")}</p>
    </>
  );
}

/** Mix my boxes again: the one-time account's funding, then the fan-out of the boxes in the pool. */
function AgainReview({ summary }: { summary: SessionOutSummary & { mix: LovejoinFunding } }) {
  const tr = useT();
  const [mixesPart, collateral] = summary.payments;
  const { mix } = summary;
  return (
    <>
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="lovejoin-again-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label={tr("lovejoin.review.forMixes")} value={`${formatAda(mixesPart!.lovelace)} ₳`} strong />
        <Row label={tr("lovejoin.review.itsCollateral")} value={`${formatAda(collateral!.lovelace)} ₳`} />
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)} ₳`} />
        <Row label={tr("review.backToPrivate")} value={`${formatAda(summary.changeLovelace)} ₳`} />
      </ReviewRows>
      <h2>{tr("lovejoin.review.thenItself")}</h2>
      <ReviewRows testId="lovejoin-again-then">
        <Row
          label={tr("lovejoin.review.mixedAgain")}
          value={
            mix.owned && mix.owned > mix.boxes
              ? tr("lovejoin.review.someOfYours", { boxes: mix.boxes, owned: mix.owned })
              : tr("lovejoin.review.allOfYours", { count: mix.boxes })
          }
          strong
        />
        <Row
          label={tr("lovejoin.mixedLabel")}
          value={tr("lovejoin.review.depthMixesCost", {
            count: mix.depth,
            mixes: tr("amount.mixes", { count: mix.mixes }),
            ada: formatAda(mix.mixFees),
          })}
        />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfterMixes", { delay: delayText(mix.delay) })} />
      </ReviewRows>
      <p className="note">{tr("lovejoin.review.againNote")}</p>
      {mix.owned && mix.owned > mix.boxes && (
        <p className="note" data-testid="lovejoin-again-rest">
          {tr("lovejoin.review.asManyAsOneGo", { count: mix.boxes })}
        </p>
      )}
      <Callout tone="privacy">
        {joinSentences([
          tr("lovejoin.review.privacy.again"),
          lovejoinHides(mix.depth),
          mix.publicToo && tr("lovejoin.review.privacy.publicToo"),
        ])}
      </Callout>
      <HistoriesNote histories={summary.histories} session={summary.index} testId="lovejoin-again-histories" />
      <p className="note">{tr("lovejoin.review.givemeNote")}</p>
    </>
  );
}

/** A mix from the public account: the deposit and every mix, sent now. */
export function PublicReview({ summary }: { summary: LovejoinPublicSummary }) {
  const tr = useT();
  if (summary.again) return <PublicAgainReview summary={summary} />;
  if (summary.seed) return <PublicSeedReview summary={summary} />;
  return (
    <>
      <ReviewRows testId="lovejoin-public-review">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOfTen", { count: summary.boxes })} strong />
        <Row
          label={tr("lovejoin.mixedLabel")}
          value={tr("lovejoin.mix.depthAndMixes", { count: summary.depth, mixes: tr("amount.mixes", { count: summary.mixes }) })}
        />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)} ₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <Row label={tr("lovejoin.review.staysPublic")} value={`${formatAda(summary.change)} ₳`} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfter", { delay: delayText(summary.delay) })} />
      </ReviewRows>
      <p className="note">{tr("lovejoin.review.publicNote")}</p>
      <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.public"), PUBLIC_MIX_WAY_BACK()])}</Callout>
    </>
  );
}

/**
 * Seed the pool: the deposit alone, no mixes. It buys the seeder nothing, so
 * the review says that plainly rather than borrowing the mix's words.
 */
function PublicSeedReview({ summary }: { summary: LovejoinPublicSummary }) {
  const tr = useT();
  return (
    <>
      <ReviewRows testId="lovejoin-seed-review">
        <Row label={tr("lovejoin.review.intoLovejoin")} value={tr("lovejoin.boxesOfTen", { count: summary.boxes })} strong />
        <Row label={tr("lovejoin.mixedLabel")} value={tr("lovejoin.review.notAtAll")} />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)} ₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <Row label={tr("lovejoin.review.staysPublic")} value={`${formatAda(summary.change)} ₳`} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.review.onlyWhenAsked")} />
      </ReviewRows>
      <p className="note">{tr("lovejoin.review.seedNote")}</p>
      <Callout tone="warn" testId="lovejoin-seed-warning">
        {tr("lovejoin.review.warn.seed")}
      </Callout>
    </>
  );
}

/** Mix again from my public account: the boxes a mix from it put in, each mix paid by it, sent now (§2.10). */
function PublicAgainReview({ summary }: { summary: LovejoinPublicSummary }) {
  const tr = useT();
  return (
    <>
      <ReviewRows testId="lovejoin-public-again-review">
        <Row label={tr("lovejoin.review.mixedAgain")} value={tr("lovejoin.review.publicPutIn", { count: summary.boxes })} strong />
        <Row
          label={tr("lovejoin.mixedLabel")}
          value={tr("lovejoin.mix.depthAndMixes", { count: summary.depth, mixes: tr("amount.mixes", { count: summary.mixes }) })}
        />
        <Row label={tr("lovejoin.review.fees")} value={`${formatAda(summary.fees)} ₳`} />
        <Row label={tr("lovejoin.review.transactions")} value={String(summary.txs)} />
        <Row label={tr("lovejoin.review.staysPublic")} value={`${formatAda(summary.change)} ₳`} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfterMixes", { delay: delayText(summary.delay) })} />
      </ReviewRows>
      <p className="note">{tr("lovejoin.review.publicAgainNote")}</p>
      <Callout tone="privacy">{joinSentences([tr("lovejoin.review.privacy.publicAgain"), PUBLIC_MIX_WAY_BACK()])}</Callout>
    </>
  );
}
