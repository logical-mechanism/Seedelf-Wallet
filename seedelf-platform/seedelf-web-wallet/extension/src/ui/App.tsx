// The app shell. The worker owns the wallet state; the UI takes a snapshot
// (`status`) on open and refreshes it whenever the worker says it changed.
// Navigation is plain state switching, no router.

import { useCallback, useEffect, useState } from "react";

import { enabledNetworks, NETWORKS, serviceHosts } from "../networks";
import type { Status } from "../shared/rpc";
import { call, onStateChanged, reportActivity } from "./background";
import { Callout } from "./components/Callout";
import { ExpandIcon, LockIcon, SettingsIcon } from "./components/Icons";
import { DappApprovals } from "./screens/DappApprovals";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { Reset, Unlock } from "./screens/Unlock";
import { NetworkContext } from "./network";
import { PreferencesProvider } from "./preferences";
import { connectorWindow, openInTab, startFromHash, view } from "./view";

export function App() {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const [start, setStart] = useState(startFromHash);
  const [settings, setSettings] = useState(false);
  const reachable = useServiceAccess();

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
    setSettings(false);
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
          if (view === "panel") openInTab("restore");
          setStart("restore");
          setStatus(s);
        }}
      />
    );
  } else if (status.state === "locked") {
    screen = <Unlock retryAfterMs={status.retryAfterMs} onUnlocked={refresh} onForgot={() => setResetting(true)} />;
  } else if (connectorWindow) {
    screen = <DappApprovals />;
  } else if (settings) {
    screen = (
      <Settings
        status={status}
        onBack={() => setSettings(false)}
        onRemoved={(s) => {
          setSettings(false);
          setStatus(s);
        }}
      />
    );
  } else {
    screen = <Home />;
  }

  return (
    <div className={`app app--${view}`}>
      <header className="topbar">
        <img className="topbar__mark" src="/icons/icon-48.png" alt="" width={28} height={28} />
        <span className="wordmark">Seedelf</span>
        {network && (
          <span className={`badge badge--${network.name}`} data-testid="network">
            {network.label.toUpperCase()}
          </span>
        )}
        <span className="topbar__spacer" />
        {unlocked && !connectorWindow && (
          <button
            className="icon-button"
            onClick={() => setSettings(!settings)}
            aria-label="Settings"
            aria-pressed={settings}
            title="Settings"
          >
            <SettingsIcon />
          </button>
        )}
        {unlocked && !connectorWindow && (
          <button className="icon-button" onClick={lock} aria-label="Lock" title="Lock">
            <LockIcon />
          </button>
        )}
        {view === "panel" && !connectorWindow && (
          <button className="icon-button" onClick={() => openInTab()} aria-label="Open in tab" title="Open in a full tab">
            <ExpandIcon />
          </button>
        )}
      </header>

      <main>
        {reachable === false && <ServiceAccess />}
        <NetworkContext.Provider value={status?.network ?? "preprod"}>
          <PreferencesProvider unlocked={unlocked}>{screen}</PreferencesProvider>
        </NetworkContext.Provider>
      </main>

      <footer className="footer">
        Seedelf Wallet {status?.version ?? ""} · {network?.label ?? "…"}
      </footer>
    </div>
  );
}

/** The manifest's host permissions: the wallet's own services, Koios among them. */
const SERVICE_HOSTS = serviceHosts(enabledNetworks(__MAINNET_ENABLED__));

/**
 * Whether Chrome lets the wallet reach its services. Koios's public tier
 * sends browsers no CORS headers, so without Chrome's grant nothing loads.
 * The user can take it away with Chrome's own site-access controls, so it's
 * checked again whenever Chrome's grants change.
 */
function useServiceAccess(): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean>();
  useEffect(() => {
    const check = async () => {
      setAllowed(await chrome.permissions.contains({ origins: SERVICE_HOSTS }).catch(() => true));
    };
    void check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, []);
  return allowed;
}

/** Chrome took the wallet's access to its services away: say so, and ask Chrome again from the click. */
function ServiceAccess() {
  const [error, setError] = useState<string>();

  async function ask() {
    setError(undefined);
    try {
      // Called before anything is awaited: Chrome asks only straight from a click.
      const granted = await chrome.permissions.request({ origins: SERVICE_HOSTS });
      if (!granted) setError("Chrome still isn't letting the wallet reach Koios.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack service-access" role="alert" data-testid="service-access">
      <Callout tone="warn">
        Chrome isn't letting Seedelf Wallet reach Koios, where it reads Cardano, so your balances can't load and nothing
        can be sent. That happens when the wallet's site access is limited in Chrome's extension settings.
      </Callout>
      <button className="primary" onClick={ask}>
        Ask Chrome again
      </button>
      {error && <p className="error">{error}</p>}
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
