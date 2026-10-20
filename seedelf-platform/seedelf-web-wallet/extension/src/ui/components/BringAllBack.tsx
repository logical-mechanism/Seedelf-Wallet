// Bring every box back now (the owner's test of 1.6.0, 2026-10-20: "a user has no way to do an emergency like get
// everything out of lovejoin"): Settings → Lovejoin's, every pool's, "the oh crap button"; and each pool's page's,
// that pool's alone ("on that pool mix page, something that allows that pool specific"). Behind its question
// (BringAllBackQuestion); then the worker brings the boxes back, one after another, while the wallet is unlocked
// (lovejoin.ts bringAllBackNow), and this says how it goes, read from the device alone, as Home reads it.

import { useEffect, useRef, useState } from "react";

import { joinSentences, useT } from "../../i18n";
import type { NetworkName } from "../../networks";
import type { LovejoinHeld } from "../../shared/rpc";
import { call } from "../background";
import { adaText } from "../format";
import { useAmounts } from "../preferences";
import { BOX_BACK_ESTIMATE } from "../swap";
import { Callout } from "./Callout";
import { Modal } from "./Modal";

/** How often its progress is read, from the device alone (lovejoin-held, as Home reads it). */
const BRING_READ_MS = 2_000;

type Bringing = LovejoinHeld["bringing"];

/**
 * Settings' (no `pool`), or a pool's page's (`pool`, its id, `classic` for the classic pool's). A pool's page shows a
 * run that covers it, every pool's or its own, and says when another pool's goes, which it can't join; its button
 * shows only while the wallet has something there (`shown`). Settings shows any run, and every pool's stopped. A run
 * this page saw go on until it was over says so once, with how many it sent, and calls `onOver`.
 */
export function BringAllBack({ network, pool, shown = true, onOver }: { network: NetworkName; pool?: string; shown?: boolean; onOver?: () => void }) {
  const [bringing, setBringing] = useState<Bringing>();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<number>();
  const last = useRef<Bringing>(undefined);
  // A read sent before the last press answers for before it: it's dropped, or one sent just before the press would say
  // it was over before its first run.
  const presses = useRef(0);
  const over = useRef(onOver);
  over.current = onOver;
  // Whether a run covers this page: every one does Settings'; a pool's page, every pool's or its own.
  const covers = (b: Bringing) => !!b && (pool === undefined || b.pool === undefined || b.pool === pool);
  useEffect(() => {
    let live = true;
    const read = () => {
      const sent = presses.current;
      void call("lovejoin-held", {}).then(
        (held) => {
          if (!live || sent !== presses.current) return;
          // Over since the last read, not stopped: every box it found went.
          if (covers(last.current) && !last.current!.stopped && !held.bringing) {
            setDone(last.current!.back);
            over.current?.();
          }
          last.current = held.bringing;
          setBringing(held.bringing);
        },
        () => undefined,
      );
    };
    read();
    const timer = setInterval(read, BRING_READ_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [network, pool]);
  const ask = async (stop: boolean) => {
    presses.current++;
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    try {
      if (stop) await call("lovejoin-bring-all-back-stop", {});
      else await call("lovejoin-bring-all-back", pool !== undefined ? { pool } : {});
      // As the worker has it now: every pool's widens one pool's that goes; a pool's joins every pool's, or starts.
      const was = last.current && !last.current.stopped ? last.current : undefined;
      const widened = (b: NonNullable<Bringing>) => {
        const { pool: _one, ...every } = b;
        return every;
      };
      const now: Bringing = stop ? undefined : was ? (pool === undefined ? widened(was) : was) : { back: 0, ...(pool !== undefined ? { pool } : {}) };
      last.current = now;
      setBringing(now);
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
        done={done}
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
 * wallet unlocked, why the last box that didn't go didn't, and Stop; once it stopped, why, and Try again. On a pool's
 * page (`pool`), in that pool's words, and `other` while another pool's goes. In Settings, one pool's that goes says
 * so, and its button stays, to make it every pool's. Every count hides with the balances (privacy review §2.16).
 */
export function BringAllBackView({
  bringing,
  pool = false,
  other = false,
  done,
  busy,
  onAsk,
  onStop,
}: {
  bringing: Bringing;
  pool?: boolean;
  other?: boolean;
  done?: number;
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
  // All sent, and the chain not done with them yet: said, then Done once it is (the owner: "when it hits zero it
  // becomes a, confirming on chain then the final done update"). Nothing to stop.
  const confirming = !!going && going.left === 0 && going.back > 0;
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
            : joinSentences([goingText(going), going.left !== undefined && tr("settings.lovejoin.bringLeft", boxes(going.left))])}
        </span>
        <span className="note">{tr("settings.lovejoin.bringUnlocked")}</span>
        {going.why && <span className="note">{tr("settings.lovejoin.bringWhy", { why: going.why })}</span>}
        {!confirming && (
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
          {tr("settings.lovejoin.warn.bringStopped", { why: stopped })}
        </Callout>
      )}
      {done !== undefined && (
        <p className="note" data-testid="lovejoin-bring-done">
          {done ? tr("settings.lovejoin.bringDone", boxes(done)) : tr(pool ? "lovejoin.bring.none" : "settings.lovejoin.bringNone")}
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
