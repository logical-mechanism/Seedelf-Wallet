// The loading splash, after Lace's: the emblem on navy, breathing, with a
// teal arc circling it, over the whole app while Home has nothing to show yet
// (the first reading after an unlock, a restore or a create). A cached reading
// arrives before it would appear, so it never flashes; once shown it stays long
// enough to be seen, then fades out into the wallet.

import { useEffect, useRef, useState } from "react";

/** wait: not shown yet; show; leave: fading out; done. */
export type SplashPhase = "wait" | "show" | "leave" | "done";

/** Appear only after this long without data. */
const DELAY_MS = 150;
/** Once shown, stay at least this long. */
const MIN_MS = 600;
/** The fade out; matches `splash-out` in styles.css. */
const LEAVE_MS = 320;
/** Give up after this long, so a slow Koios can't hide Refresh or an error. */
const GIVE_UP_MS = 8000;

/** Where the splash is, given whether there's something to show yet. */
export function useSplash(ready: boolean): SplashPhase {
  const [phase, setPhase] = useState<SplashPhase>(ready ? "done" : "wait");
  const [gaveUp, setGaveUp] = useState(false);
  const shownAt = useRef(0);
  const over = ready || gaveUp;

  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (phase === "wait") {
      if (over) setPhase("done");
      else {
        timer = setTimeout(() => {
          shownAt.current = Date.now();
          setPhase("show");
        }, DELAY_MS);
      }
    } else if (phase === "show" && over) {
      timer = setTimeout(() => setPhase("leave"), Math.max(0, shownAt.current + MIN_MS - Date.now()));
    } else if (phase === "leave") {
      timer = setTimeout(() => setPhase("done"), LEAVE_MS);
    }
    return () => clearTimeout(timer);
  }, [phase, over]);

  return phase;
}

export function Splash({ phase }: { phase: SplashPhase }) {
  if (phase !== "show" && phase !== "leave") return null;
  return (
    <div
      className={phase === "leave" ? "splash splash--leave" : "splash"}
      role="status"
      aria-label="Loading your wallet"
      data-testid="splash"
    >
      <div className="splash__mark">
        <svg className="splash__ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="splash__track" cx="60" cy="60" r="57" />
          <circle className="splash__arc" cx="60" cy="60" r="57" pathLength="100" />
        </svg>
        <img className="splash__emblem" src="/brand/emblem.png" alt="" width={84} height={84} />
      </div>
    </div>
  );
}
