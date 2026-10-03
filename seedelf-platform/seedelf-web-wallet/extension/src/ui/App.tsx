// The app shell. The worker owns the wallet state; the UI takes a snapshot
// (`status`) on open and refreshes it whenever the worker says it changed.
// Navigation is plain state switching, no router.

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";

import { enabledNetworks, NETWORKS, serviceHosts } from "../networks";
import type { Status } from "../shared/rpc";
import { call, onStateChanged, reportActivity } from "./background";
import { Callout } from "./components/Callout";
import { ExpandIcon, LockIcon, SettingsIcon } from "./components/Icons";
import { AccountPicker } from "./components/AccountPicker";
import { LockCountdown } from "./components/LockCountdown";
import { NetworkBadge, TestNetworkStrip } from "./components/NetworkBadge";
import { DappApprovals } from "./screens/DappApprovals";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { Reset, Unlock } from "./screens/Unlock";
import { AccountsProvider, useAccounts } from "./accounts";
import { NetworkContext } from "./network";
import { PreferencesProvider } from "./preferences";
import { connectorWindow, openInTab, startFromHash, view } from "./view";

export function App() {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  // A Lock that failed: said over the screen, which stays as it is.
  const [lockError, setLockError] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const [start, setStart] = useState(startFromHash);
  const [settings, setSettings] = useState(false);
  // Counts presses of the top bar's mark: Home leaves whatever flow it's in.
  const [goHome, setGoHome] = useState(0);
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
  // Once it's locked, however that came about, a Lock that failed before is past.
  useEffect(() => {
    if (!unlocked) setLockError(undefined);
  }, [unlocked]);
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
    setLockError(undefined);
    try {
      setStatus(await call("lock", {}));
    } catch (e) {
      // Said over the screen as it is, never as "couldn't start": if the wallet did lock, the worker says so.
      setLockError((e as Error).message);
    }
  }

  const network = status ? NETWORKS[status.network] : undefined;

  let screen;
  if (error) {
    screen = <StartupError message={error} onRetry={refresh} />;
  } else if (!status) {
    screen = null;
  } else if (status.state === "no-wallet") {
    screen = <Onboarding key={start ?? "welcome"} status={status} start={start} onDone={setStatus} onNetwork={setStatus} />;
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
    screen = (
      <Unlock
        retryAfterMs={status.retryAfterMs}
        lockedBy={status.lockedBy}
        onUnlocked={refresh}
        onForgot={() => setResetting(true)}
      />
    );
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
        onNetwork={setStatus}
      />
    );
  } else {
    screen = <Home goHome={goHome} />;
  }

  const brand = (
    <>
      <img className="topbar__mark" src="/icons/icon-48.png" alt="" width={28} height={28} />
      <span className="wordmark">Seedelf</span>
    </>
  );

  return (
    // Above the top bar, not only the screens: the picker sits in the header.
    <AccountsProvider unlocked={unlocked}>
      <div className={`app app--${view}`}>
        <header className="topbar">
          {/* Unlocked, the mark is the way back to Home from any depth; locked, or in
              the connector's window, there's nowhere to go, so it's just the mark. */}
          {unlocked && !connectorWindow ? (
            <button
              type="button"
              className="topbar__brand"
              onClick={() => {
                setSettings(false);
                setGoHome((n) => n + 1);
              }}
              aria-label={t("app.home")}
              title={t("app.home")}
            >
              {brand}
            </button>
          ) : (
            brand
          )}
          {network && <NetworkBadge network={network.name} />}
          {unlocked && !connectorWindow && <AccountPicker />}
          <span className="topbar__spacer" />
          {unlocked && !connectorWindow && (
            <button
              className="icon-button"
              onClick={() => setSettings(!settings)}
              aria-label={t("app.settings")}
              aria-pressed={settings}
              title={t("app.settings")}
            >
              <SettingsIcon />
            </button>
          )}
          {unlocked && !connectorWindow && (
            <button className="icon-button" onClick={lock} aria-label={t("app.lock")} title={t("app.lock")}>
              <LockIcon />
            </button>
          )}
          {view === "panel" && !connectorWindow && (
            <button className="icon-button" onClick={() => openInTab()} aria-label={t("app.openInTab")} title={t("app.openInTabTitle")}>
              <ExpandIcon />
            </button>
          )}
        </header>
        {network && <TestNetworkStrip network={network.name} />}

        <main>
          {unlocked && <LockCountdown />}
          {lockError && unlocked && <LockFailed message={lockError} onRetry={lock} />}
          {reachable === false && <ServiceAccess />}
          <NetworkContext.Provider value={status?.network ?? "preprod"}>
            {/* A switch in Settings starts every screen afresh on the new network: nothing read or reviewed on the other stays. */}
            <PreferencesProvider unlocked={unlocked}>
              {/* And afresh on the new public account, for the same reason: a
                  balance, a review or a UTxO list read for one account says
                  nothing about another (chunk 18). */}
              <ScreenForAccount network={status?.network}>{screen}</ScreenForAccount>
            </PreferencesProvider>
          </NetworkContext.Provider>
        </main>

        <footer className="footer">
          {t("app.name")} {status?.version ?? ""} · {network?.label ?? "…"}
        </footer>
      </div>
    </AccountsProvider>
  );
}

/** Every screen afresh when the network or the public account changes. */
function ScreenForAccount({ network, children }: { network?: string; children: ReactNode }) {
  const { active } = useAccounts();
  return <Fragment key={`${network ?? ""}:${active}`}>{children}</Fragment>;
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
  const t = useT();
  const [error, setError] = useState<string>();

  async function ask() {
    setError(undefined);
    try {
      // Called before anything is awaited: Chrome asks only straight from a click.
      const granted = await chrome.permissions.request({ origins: SERVICE_HOSTS });
      if (!granted) setError(t("serviceAccess.stillRefused"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack service-access" role="alert" data-testid="service-access">
      <Callout tone="warn">{t("serviceAccess.warn.blocked")}</Callout>
      <button className="primary" onClick={ask}>
        {t("serviceAccess.askAgain")}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Lock didn't finish: say why, and how to be sure the wallet locks. */
export function LockFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="stack service-access" role="alert" data-testid="lock-error">
      <Callout tone="warn">{t("lockFailed.warn.message", { message })}</Callout>
      <button className="primary" onClick={onRetry}>
        {t("app.lock")}
      </button>
    </div>
  );
}

/** The wallet's background service failed: say what happened and offer a way out. */
function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <section className="unlock" role="alert" aria-labelledby="startup-error">
      <img className="unlock__emblem" src="/brand/emblem.png" alt="" width={72} height={72} />
      <h1 id="startup-error">{t("startup.title")}</h1>
      <div className="stack unlock__form">
        <Callout tone="warn" testId="startup-error">
          {message}
        </Callout>
        <button className="primary" onClick={onRetry}>
          {t("common.tryAgain")}
        </button>
        <button className="secondary" onClick={() => chrome.runtime.reload()}>
          {t("startup.reload")}
        </button>
        <p className="note center">{t("startup.reloadNote")}</p>
      </div>
    </section>
  );
}
