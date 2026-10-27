// Bring every box back now (the owner's test of 1.6.0, 2026-10-20: "a user has no way to do an emergency like get
// everything out of lovejoin"): Settings → Lovejoin's, every pool's, "the oh crap button"; and each pool's page's,
// that pool's alone ("on that pool mix page, something that allows that pool specific"). Behind its question
// (BringAllBackQuestion); then the worker brings the boxes back, one after another, while the wallet is unlocked
// (lovejoin.ts bringAllBackNow), and this says how it goes, read from the device alone, as Home reads it.

import { useEffect, useRef, useState } from "react";

import { type I18nKey, joinSentences, useT } from "../../i18n";
import type { NetworkName } from "../../networks";
import type { LovejoinBringWait, LovejoinHeld } from "../../shared/rpc";
import { call } from "../background";
import { adaText } from "../format";
import { CLASSIC_ID } from "../lovejoin-pools";
import { useAmounts } from "../preferences";
import { withStop } from "../sentence";
import { BOX_BACK_ESTIMATE } from "../swap";
import { Callout } from "./Callout";
import { Modal } from "./Modal";

/** How often its progress is read, from the device alone (lovejoin-held, as Home reads it). */
const BRING_READ_MS = 2_000;

type Bringing = LovejoinHeld["bringing"];

/**
 * What a run waits for before it can take what's left, or end (LovejoinHeld `bringing.waiting`), each in its own short
 * line: it waited with no word of why, for a day where a session's collateral's mix waited for giveme.my (1.6.0's
 * release review, 321-lj-worker#1).
 */
const BRING_WAIT: Record<LovejoinBringWait, I18nKey> = {
  again: "settings.lovejoin.bringWait.again",
  chain: "settings.lovejoin.bringWait.chain",
  landing: "settings.lovejoin.bringWait.landing",
  collateral: "settings.lovejoin.bringWait.collateral",
  withdraw: "settings.lovejoin.bringWait.withdraw",
  payment: "settings.lovejoin.bringWait.payment",
};

/**
 * What a run this page saw go says once it's over (`held`, the read that found it so): how many it sent; or, having
 * sent none, that none was left, unless the wallet still has boxes where it ran (its pool, or every pool), a mix's
 * sent since it was asked, which wait their turn: then nothing (1.6.0's review). Exported for its test.
 */
export function doneOf(last: NonNullable<Bringing>, held: LovejoinHeld): number | undefined {
  if (last.back) return last.back;
  const there = (p: Pick<LovejoinHeld, "boxes" | "notMixed" | "bootstrap">) => p.boxes + p.notMixed + (p.bootstrap ?? 0);
  const pools = [{ ...held, id: CLASSIC_ID }, ...(held.pools ?? [])].filter((p) => last.pool === undefined || p.id === last.pool);
  return pools.some((p) => there(p) > 0) ? undefined : 0;
}

/** Whether run `b` covers a page: every one does Settings' (no `pool`); a pool's page (`pool`), every pool's or its own. */
const coversRun = (pool: string | undefined, b: Bringing) => !!b && (pool === undefined || b.pool === undefined || b.pool === pool);

/**
 * How a page follows Bring every box back now (Settings', no `pool`; or a pool's page's): what each read of
 * lovejoin-held finds, and what each press asks. A run this page saw go, not stopped, that a read no longer finds is
 * over: said once (`done`), with how many it sent (doneOf) and, for a pool's run, its pool, which Settings words it by
 * (321-lj-screens#6); and `over` is called. Where the worker marks it stopped by Stop (`bringStopped`), pressed on this
 * page or another, it's said stopped (`stopped`), with the worker's count: a run Stop deleted read as over, so a page
 * that didn't press it said Done (1.6.0's release review, L2). A read sent before the last press's request answered
 * answers for before it, and is dropped, whether it answers before that request or after: the worker reads its record
 * outside the queue Stop writes it through, so a read sent while Stop went could come back after it, the run still
 * going, and the next read, Stop's done, said the run was over, "Done: 3 back" for a run the user stopped; and one sent
 * while the ask went, the run not there yet, said nothing was left before its first run (1.6.0's release review,
 * 321-lj-screens#0). Exported for its test.
 */
export function bringFollower(
  pool: string | undefined,
  show: { bringing: (b: Bringing) => void; done: (count: number | undefined, pool?: string, stopped?: true) => void; over: () => void },
) {
  let last: Bringing;
  // The run this page's Stop stopped, until the first read sent after its request answered says how many it sent.
  let halted: Bringing;
  let presses = 0;
  return {
    /** A read about to be sent: what to do with its answer. */
    read() {
      const sent = presses;
      return (held: LovejoinHeld) => {
        if (sent !== presses) return;
        if (!held.bringing) {
          const ran = coversRun(pool, last) && !last!.stopped ? last : coversRun(pool, halted) ? halted : undefined;
          // Stopped, here or on another page: as many as the worker counted when it stopped.
          if (ran && held.bringStopped) {
            show.done(held.bringStopped.back, ran.pool, true);
            show.over();
          } else if (ran && ran === last) {
            // Over since the last read, not stopped: every box it found went.
            show.done(doneOf(ran, held), ran.pool);
            show.over();
          }
        }
        halted = undefined;
        last = held.bringing;
        show.bringing(held.bringing);
      };
    },
    /** A press: Stop (`stop`), or the ask, whose request `send` makes; then the run as the worker has it. */
    async press(stop: boolean, send: () => Promise<unknown>) {
      presses++;
      show.done(undefined);
      try {
        await send();
      } finally {
        // Every read sent while it went is dropped too: only one sent once it's answered speaks for after it.
        presses++;
      }
      // As the worker has it now: every pool's widens one pool's that goes; a pool's joins every pool's, or starts.
      const was = last && !last.stopped ? last : undefined;
      const widened = (b: NonNullable<Bringing>) => {
        const { pool: _one, ...every } = b;
        return every;
      };
      const now: Bringing = stop ? undefined : was ? (pool === undefined ? widened(was) : was) : { back: 0, ...(pool !== undefined ? { pool } : {}) };
      // Stopped here: the next read says so, with the worker's count, as every other page that saw it go does (L2).
      halted = stop ? was : undefined;
      last = now;
      show.bringing(now);
    },
  };
}

/**
 * Settings' (no `pool`), or a pool's page's (`pool`, its id, `classic` for the classic pool's). A pool's page shows a
 * run that covers it, every pool's or its own, and says when another pool's goes, which it can't join; its button
 * shows only while the wallet has something there (`shown`). Settings shows any run, and every pool's stopped. A run
 * this page saw go on until it was over says so once, with how many it sent (doneOf), and calls `onOver`.
 */
export function BringAllBack({ network, pool, shown = true, onOver }: { network: NetworkName; pool?: string; shown?: boolean; onOver?: () => void }) {
  const [bringing, setBringing] = useState<Bringing>();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ count: number; pool?: string; stopped?: true }>();
  const over = useRef(onOver);
  over.current = onOver;
  // What this page follows of the runs, and of its presses (bringFollower): one for each network and pool it shows.
  const follow = useRef<ReturnType<typeof bringFollower>>(undefined);
  const covers = (b: Bringing) => coversRun(pool, b);
  useEffect(() => {
    let live = true;
    const follower = bringFollower(pool, {
      bringing: (b) => live && setBringing(b),
      done: (count, of, stopped) =>
        live && setDone(count === undefined ? undefined : { count, ...(of !== undefined ? { pool: of } : {}), ...(stopped ? { stopped } : {}) }),
      over: () => live && over.current?.(),
    });
    follow.current = follower;
    const read = () => void call("lovejoin-held", {}).then(follower.read(), () => undefined);
    read();
    const timer = setInterval(read, BRING_READ_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [network, pool]);
  const ask = async (stop: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await follow.current?.press(stop, () =>
        stop ? call("lovejoin-bring-all-back-stop", {}) : call("lovejoin-bring-all-back", pool !== undefined ? { pool } : {}),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const going = bringing && !bringing.stopped ? bringing : undefined;
  // On a pool's page: another pool's goes, which this can't join; or one that stopped, which wasn't for this pool.
  const other = pool !== undefined && !!going && !covers(going);
  const mine = covers(bringing) ? bringing : undefined;
  if (pool !== undefined && !shown && !covers(going) && done === undefined) return null;
  return (
    <>
      <BringAllBackView
        bringing={mine}
        pool={pool !== undefined}
        other={other}
        done={done?.count}
        donePool={done?.pool !== undefined}
        doneStopped={done?.stopped === true}
        busy={busy}
        onAsk={() => setAsking(true)}
        onStop={() => void ask(true)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {asking && (
        <BringAllBackQuestion
          pool={pool !== undefined}
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void ask(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Its part of the page: the button and what it does, or, while it goes, how many went and are left, to keep the
 * wallet unlocked, what it waits for or why the last box that didn't go didn't, and Stop, which waits out the chain's
 * confirming until one is late; late, one line says what happens to it either way, staying unlocked included (the
 * owner: one short line beside a button); once it stopped, why, and Try again. On a pool's
 * page (`pool`), in that pool's words, and `other` while another pool's goes. In Settings, one pool's that goes says
 * so, and its button stays, to make it every pool's; one pool's that's over (`donePool`), having sent none, says that
 * pool held nothing of the wallet's, never Lovejoin (1.6.0's release review, 321-lj-screens#6). One that Stop stopped,
 * here or on another page (`doneStopped`), says so and how many it sent, never Done (L2). Every count hides with the
 * balances (privacy review §2.16).
 */
export function BringAllBackView({
  bringing,
  pool = false,
  other = false,
  done,
  donePool = false,
  doneStopped = false,
  busy,
  onAsk,
  onStop,
}: {
  bringing: Bringing;
  pool?: boolean;
  other?: boolean;
  done?: number;
  donePool?: boolean;
  doneStopped?: boolean;
  busy: boolean;
  onAsk: () => void;
  onStop: () => void;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const boxes = (n: number) => ({ count: amounts.hidden ? 2 : n, boxes: amounts.count(n, "amount.boxes") });
  const going = bringing && !bringing.stopped ? bringing : undefined;
  // Settings says a stopped run only when it was every pool's: one pool's is that pool's page's to say.
  const stopped = bringing?.stopped !== undefined && (pool || bringing.pool === undefined) ? bringing.stopped : undefined;
  const label = tr(pool ? "lovejoin.bring.button" : "settings.lovejoin.bring");
  const goingText = (b: NonNullable<Bringing>) =>
    b.pool === undefined
      ? tr("settings.lovejoin.bringing", boxes(b.back))
      : tr(pool ? "lovejoin.bring.going" : "settings.lovejoin.bringingPool", boxes(b.back));
  // A bar, as Bootstrap's progress has: how far through what was there it is, once a run has counted it.
  const total = going && going.left !== undefined ? going.back + going.left : 0;
  // What else it waits for, in a word of the worker's (321-lj-worker#1): never the chain confirming, though all it
  // found went, and none said left.
  const waiting = going?.waiting;
  // All sent, and the chain not done with them yet: said, then Done once it is (the owner: "when it hits zero it
  // becomes a, confirming on chain then the final done update"). Nothing to stop, until a withdraw it waits for is late:
  // a node may have dropped it, its box held as spent for two hours (1.6.0's release review, 321-lj-worker#4).
  const confirming = !!going && going.left === 0 && going.back > 0 && !waiting;
  const progress = going && (
    <Callout tone="info" testId="lovejoin-bringing">
      <div className="stack-tight">
        {total > 0 && (
          <span className="meter" aria-hidden="true" data-testid="lovejoin-bring-meter">
            <span className="meter__fill" style={{ width: `${Math.round((100 * going.back) / total)}%` }} />
          </span>
        )}
        <span>
          {confirming
            ? tr("settings.lovejoin.bringConfirming", boxes(going.back))
            : joinSentences([
                goingText(going),
                going.left !== undefined && (going.left > 0 || !waiting) && tr("settings.lovejoin.bringLeft", boxes(going.left)),
              ])}
        </span>
        {/* Late, its own line says to stay unlocked, with what comes of the late withdraw either way: one line beside Stop
            (the owner), where three stacked up (1.6.0's release review, the review's questions). */}
        {!going.late && <span className="note">{tr("settings.lovejoin.bringUnlocked")}</span>}
        {/* What it waits for, in place of an older run's reason: a withdraw late, a word of the worker's, a mix kept for
            Send; or the worker's reason, as it caught it: the node's own words may end with no full stop. */}
        {going.late ? (
          <span className="note" data-testid="lovejoin-bring-late">
            {tr("settings.lovejoin.bringLate")}
          </span>
        ) : waiting ? (
          <span className="note" data-testid="lovejoin-bring-waiting">
            {tr(BRING_WAIT[waiting])}
          </span>
        ) : going.held ? (
          <span className="note">{tr("settings.lovejoin.bringHeld")}</span>
        ) : (
          going.why && <span className="note">{tr("settings.lovejoin.bringWhy", { why: withStop(going.why) })}</span>
        )}
        {(!confirming || going.late) && (
          <span>
            <button type="button" className="secondary" onClick={onStop} disabled={busy} data-testid="lovejoin-bring-stop">
              {tr("lovejoin.mixes.stop")}
            </button>
          </span>
        )}
      </div>
    </Callout>
  );
  // Settings keeps its button while one pool's goes: pressed, it's every pool's.
  const asks = !going || (!pool && going.pool !== undefined);
  const before = asks && (
    <>
      {other && (
        <p className="note" data-testid="lovejoin-bring-other">
          {tr("lovejoin.bring.other")}
        </p>
      )}
      {stopped !== undefined && (
        <Callout tone="warn" testId="lovejoin-bring-stopped">
          {tr("settings.lovejoin.warn.bringStopped", { why: withStop(stopped) })}
        </Callout>
      )}
      {done !== undefined && (
        <p className="note" data-testid="lovejoin-bring-done">
          {doneStopped
            ? tr("settings.lovejoin.bringStoppedSent", boxes(done))
            : done
              ? tr("settings.lovejoin.bringDone", boxes(done))
              : tr(pool ? "lovejoin.bring.none" : donePool ? "settings.lovejoin.bringNonePool" : "settings.lovejoin.bringNone")}
        </p>
      )}
    </>
  );
  const button = (className: string) => (
    <button type="button" className={className} onClick={onAsk} disabled={busy || other} data-testid="lovejoin-bring-ask">
      {stopped !== undefined ? tr("common.tryAgain") : label}
    </button>
  );
  // A pool's page: a link, as Help start the pool is (the owner, 2026-10-20: rare, it costs privacy, and its question
  // guards it), its words saying what it does. Settings: the lever, a button, one short line under it. No more: the
  // owner, the same day, "the button take up a fraction of the screen and the rest is text".
  return (
    <div className="stack-tight" data-testid="lovejoin-bring">
      {progress}
      {before}
      {/* Settings: its line above its button, setting it apart from the wait's selector above (the owner). */}
      {asks && !pool && <p className="note">{tr("settings.lovejoin.bringNote")}</p>}
      {asks && (pool ? button("link align-start") : <span>{button("secondary")}</span>)}
    </div>
  );
}

/**
 * The question before the boxes come back: what each box's way back ties when they all go one after another (the
 * timing says they're one person's, and makes them easier to match to their deposits; a box nobody mixed since its
 * deposit ties that deposit), what it costs, and that it goes only while the wallet is unlocked. A pool's page asks it
 * of that pool's boxes (`pool`).
 */
export function BringAllBackQuestion({ pool = false, onKeep, onConfirm }: { pool?: boolean; onKeep: () => void; onConfirm: () => void }) {
  const tr = useT();
  return (
    <Modal
      title={tr(pool ? "lovejoin.bring.title" : "settings.lovejoin.bringTitle")}
      titleId="lovejoin-bring-title"
      onClose={onKeep}
      foot={
        <>
          <button type="button" className="secondary" onClick={onKeep} data-testid="lovejoin-bring-keep">
            {tr("settings.lovejoin.bringKeep")}
          </button>
          <button type="button" className="primary" onClick={onConfirm} data-testid="lovejoin-bring-confirm">
            {tr("settings.lovejoin.bringConfirm")}
          </button>
        </>
      }
    >
      <p className="note">{tr("settings.lovejoin.privacy.bring")}</p>
      <p className="note">
        {joinSentences([tr("settings.lovejoin.privacy.bringCost", { ada: adaText(BOX_BACK_ESTIMATE.toString()) }), tr("settings.lovejoin.bringUnlocked")])}
      </p>
    </Modal>
  );
}
