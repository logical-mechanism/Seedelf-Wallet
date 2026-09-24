// The app shell. The worker owns the wallet state; the UI takes a snapshot
// (`status`) on open and refreshes it whenever the worker says it changed.
// Navigation is plain state switching, no router.

import { useCallback, useEffect, useState } from "react";

import { NETWORKS } from "../networks";
import type { Status } from "../shared/rpc";
import { call, onStateChanged, reportActivity } from "./background";
import { Callout } from "./components/Callout";
import { ExpandIcon, LockIcon } from "./components/Icons";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Reset, Unlock } from "./screens/Unlock";
import { NetworkContext } from "./network";
import { openInTab, startFromHash, view } from "./view";

export function App() {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const [start, setStart] = useState(startFromHash);

  const refresh = useCallback(() => {
    call("status", {}).then(
      (s) => {
        setStatus(s);
        setError(undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    refresh();
    return onStateChanged(refresh);
  }, [refresh]);

  // While unlocked, user input pushes auto-lock back.
  const unlocked = status?.state === "unlocked";
  useEffect(() => {
    if (!unlocked) return;
    reportActivity();
    const events = ["pointerdown", "keydown"] as const;
    for (const e of events) window.addEventListener(e, reportActivity, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, reportActivity);
    };
  }, [unlocked]);

  async function lock() {
    setStatus(await call("lock", {}));
  }

  const network = status ? NETWORKS[status.network] : undefined;

  let screen;
  if (error) {
    screen = <StartupError message={error} onRetry={refresh} />;
  } else if (!status) {
    screen = null;
  } else if (status.state === "no-wallet") {
    screen = <Onboarding key={start ?? "welcome"} start={start} onDone={setStatus} />;
  } else if (status.state === "locked" && resetting) {
    screen = (
      <Reset
        onCancel={() => setResetting(false)}
        onReset={(s) => {
          setResetting(false);
          if (view === "popup") openInTab("restore");
          setStart("restore");
          setStatus(s);
        }}
      />
    );
  } else if (status.state === "locked") {
    screen = <Unlock retryAfterMs={status.retryAfterMs} onUnlocked={refresh} onForgot={() => setResetting(true)} />;
  } else {
    screen = <Home />;
  }

  return (
    <div className={`app app--${view}`}>
      <header className="topbar">
        <img className="topbar__mark" src="/icons/icon-48.png" alt="" width={28} height={28} />
        <span className="wordmark">seedelf</span>
        {network && (
          <span className={`badge badge--${network.name}`} data-testid="network">
            {network.label.toUpperCase()}
          </span>
        )}
        <span className="topbar__spacer" />
        {unlocked && (
          <button className="icon-button" onClick={lock} aria-label="Lock" title="Lock">
            <LockIcon />
          </button>
        )}
        {view === "popup" && (
          <button className="icon-button" onClick={() => openInTab()} aria-label="Open in tab" title="Open in a full tab">
            <ExpandIcon />
          </button>
        )}
      </header>

      <main>
        <NetworkContext.Provider value={status?.network ?? "preprod"}>{screen}</NetworkContext.Provider>
      </main>

      <footer className="footer">
        Seedelf Wallet {status?.version ?? ""} · {network?.label ?? "…"}
      </footer>
    </div>
  );
}

/** The wallet's background service failed: say what happened and offer a way out. */
function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="unlock" role="alert" aria-labelledby="startup-error">
      <img className="unlock__emblem" src="/brand/emblem.png" alt="" width={72} height={72} />
      <h1 id="startup-error">The wallet couldn't start</h1>
      <div className="stack unlock__form">
        <Callout tone="warn" testId="startup-error">
          {message}
        </Callout>
        <button className="primary" onClick={onRetry}>
          Try again
        </button>
        <button className="secondary" onClick={() => chrome.runtime.reload()}>
          Reload the extension
        </button>
        <p className="note center">
          Reloading closes the wallet's windows. Your wallet is kept; you unlock it again with your password.
        </p>
      </div>
    </section>
  );
}
