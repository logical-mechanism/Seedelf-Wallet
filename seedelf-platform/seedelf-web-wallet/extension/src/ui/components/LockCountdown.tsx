// The last minutes before auto-lock, on every screen: "Locking in 1:30", and
// Stay unlocked. The worker says when it locks (lock-deadline), and asking
// isn't activity. While it shows, any click or key puts the lock off at once,
// as Stay unlocked does; nothing else counts (mouse movement doesn't).
// Asked again every few seconds, and when the page comes back into view,
// since the wallet's other page (the side panel and a tab) may have put it
// off; at 0:00, asking locks it.

import { useCallback, useEffect, useRef, useState } from "react";

import { call, stayUnlocked } from "../background";
import { LockIcon } from "./Icons";

/** It shows this long before the lock, or for the last half of a shorter lock time (a minute's). */
export const WARN_MS = 2 * 60_000;
/** How often the page asks the worker when the lock is further off. */
const ASK_EVERY_MS = 15_000;
/** And while the countdown shows. */
const ASK_NEAR_MS = 5_000;

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function LockCountdown() {
  const [deadline, setDeadline] = useState<{ at: number | null; lockAfterMs: number }>();
  const [now, setNow] = useState(Date.now);
  const staying = useRef(false);

  const ask = useCallback(() => {
    call("lock-deadline", {}).then(
      (d) => {
        setDeadline(d);
        setNow(Date.now());
      },
      () => undefined,
    );
  }, []);

  const left = deadline?.at != null ? deadline.at - now : undefined;
  const warn = deadline ? Math.min(WARN_MS, deadline.lockAfterMs / 2) : WARN_MS;
  const near = left !== undefined && left <= warn;

  // Asked on open, then every few seconds: more often while the countdown shows.
  useEffect(() => {
    ask();
    const timer = setInterval(ask, near ? ASK_NEAR_MS : ASK_EVERY_MS);
    return () => clearInterval(timer);
  }, [ask, near]);

  // Back in view (the panel reopened, the tab chosen): asked straight away.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") ask();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [ask]);

  // The countdown, each second; at 0:00 the worker is asked, which locks.
  useEffect(() => {
    if (!near) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [near]);
  useEffect(() => {
    if (left !== undefined && left <= 0) ask();
  }, [ask, left]);

  const stay = useCallback(() => {
    if (staying.current) return;
    staying.current = true;
    stayUnlocked()
      .catch(() => undefined)
      .finally(() => {
        staying.current = false;
        ask();
      });
  }, [ask]);

  // While it shows, a click or a key anywhere puts the lock off straight away.
  useEffect(() => {
    if (!near) return;
    const events = ["pointerdown", "keydown"] as const;
    for (const e of events) window.addEventListener(e, stay, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, stay);
    };
  }, [near, stay]);

  if (!near || left === undefined) return null;
  return (
    <section className="callout callout--warn lock-countdown" role="timer" aria-label="Auto-lock" data-testid="lock-countdown">
      <span className="callout__icon">
        <LockIcon size={16} />
      </span>
      <div className="callout__body">
        <strong className="lock-countdown__time">Locking in {clock(left)}</strong>
        <div>Nothing has been clicked or typed for a while.</div>
      </div>
      <button type="button" className="chip lock-countdown__stay" onClick={stay} data-testid="lock-stay">
        Stay unlocked
      </button>
    </section>
  );
}
