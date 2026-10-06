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
import { useOpensAtTop } from "./components/Screen";
import { DappApprovals } from "./screens/DappApprovals";
import { forgetHomeTab, Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { Reset, Unlock } from "./screens/Unlock";
import { AccountsProvider, useAccounts } from "./accounts";
import { NetworkContext } from "./network";
import { forgetImages } from "./nft-images";
import { PreferencesProvider } from "./preferences";
import { withoutStop } from "./sentence";
import { connectorWindow, openInTab, startFromHash, view } from "./view";

export function App() {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  // A Lock that failed: said over the screen, which stays as it is.
  const [lockError, setLockError] = useState<string>();
  const [resetting, setResetting] = useState(false);
  // Removed from Settings: the welcome screen says it's done, rather than appearing with no word (chunk 23's
  // review, SET-6).
  const [removed, setRemoved] = useState(false);
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

  // Once a wallet exists, the start screen a tab was opened on (`#create`, `#restore`, or Forgot password's restore)
  // is spent: kept, removing the wallet later opened Create's first step on a new phrase instead of the welcome and
  // its "Wallet removed" (chunk 23's second review, FR-8). The URL loses it too, in place: history.ts's own entry
  // and its state stay as they are. Again on every popstate meanwhile: history.ts takes its entry away once the
  // flow's last screen goes, which lands on the entry the tab was opened at, hash and all.
  const walletExists = status !== undefined && status.state !== "no-wallet";
  useEffect(() => {
    if (!walletExists) return;
    setStart(undefined);
    const drop = () => {
      if (startFromHash()) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    };
    drop();
    window.addEventListener("popstate", drop);
    return () => window.removeEventListener("popstate", drop);
  }, [walletExists]);

  // While unlocked, user input pushes auto-lock back.
  const unlocked = status?.state === "unlocked";
  // Once it's locked, however that came about, a Lock that failed before is
  // past, and the NFT images the user asked to see are forgotten: a locked
  // wallet shows nothing of what it holds.
  useEffect(() => {
    if (unlocked) return;
    setLockError(undefined);
    forgetImages();
  }, [unlocked]);
  // Locked, or no wallet any more: the next Home starts over on Private. Only a reload, or a trip to Settings, keeps
  // the tab last chosen (chunk 23's second review, HM-6).
  const lockedOrGone = status !== undefined && status.state !== "unlocked";
  useEffect(() => {
    if (lockedOrGone) forgetHomeTab();
  }, [lockedOrGone]);
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
    screen = (
      <Onboarding
        key={start ?? "welcome"}
        status={status}
        start={start}
        removed={removed}
        onDone={(s) => {
          setRemoved(false);
          setStatus(s);
        }}
        onNetwork={setStatus}
      />
    );
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
          setRemoved(true);
          setStatus(s);
        }}
        onNetwork={setStatus}
      />
    );
  } else {
    screen = <Home goHome={goHome} />;
  }
  // Each of these opens at its top, as every screen does (blind test §9.10): Unlock, the welcome and the startup
  // error aren't a `Screen`, which does it for the rest.
  useOpensAtTop(
    error
      ? "error"
      : !status
        ? "starting"
        : status.state === "no-wallet"
          ? `welcome:${start ?? ""}`
          : status.state === "locked"
            ? resetting
              ? "reset"
              : "unlock"
            : connectorWindow
              ? "connector"
              : settings
                ? "settings"
                : "home",
  );

  const brand = (
    <>
      <img className="topbar__mark" src="/icons/icon-48.png" alt="" width={28} height={28} />
      <span className="wordmark">Seedelf</span>
    </>
  );

  return (
    // Above the top bar, not only the screens: the picker sits under it.
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
          {/* The connector's window has no buttons up here, so the test network's line takes their room rather than
              a row of its own: that row put the end of a signature's privacy note under the fold at 400×605 (blind
              test T18). */}
          {connectorWindow && network ? (
            <TestNetworkStrip network={network.name} inBar />
          ) : (
            <span className="topbar__spacer" />
          )}
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
        {/* A row of its own, not in the top bar: there it pushed Lock and Open in tab off a 360 px side panel, and
            had room for "Account" only, not which one (chunk 23's review, HD-1). */}
        {unlocked && !connectorWindow && <AccountPicker />}
        {network && !connectorWindow && <TestNetworkStrip network={network.name} />}

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
      if (!granted) setError(t("serviceAccess.warn.stillRefused"));
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

/**
 * Lock didn't finish: say why, and how to be sure the wallet locks. The reason comes as it was thrown, the
 * browser's English as often as the worker's words: its sentence ends with the language's own stop, so it never
 * runs into "Try again" in Japanese, nor doubles one it brought.
 */
export function LockFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="stack service-access" role="alert" data-testid="lock-error">
      <Callout tone="warn">{t("lockFailed.warn.message", { message: withoutStop(message) })}</Callout>
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
