// Settings, from the gear in the top bar: contacts, the Cardano account's
// collateral, where the wallet opens (a full tab or the side panel), ADA's
// value in a currency, whether sites can connect (the dApp connector: each
// to the public account or a private session) and which have, whether payments spend the staking rewards, how long
// it stays unlocked, the recovery phrase (the password again first, even
// while unlocked) and a check of a written copy, a new password, removing the
// wallet from this browser, and what this is. Nothing here asks Koios
// anything, except setting a collateral that needs a transaction.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { NETWORKS } from "../../networks";
import { DAPP_ORIGINS } from "../../shared/dapp";
import { readOpenIn, type OpenIn } from "../../shared/open-in";
import { CURRENCIES, LOCK_AFTER_MINUTES, type Currency, type LockAfterMinutes } from "../../shared/preferences";
import type { DappSite, Status } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ContactsPage, useContacts } from "../components/Contacts";
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalIcon,
  EyeIcon,
  LockIcon,
  PlugIcon,
  TrashIcon,
  UsersIcon,
  VaultIcon,
} from "../components/Icons";
import { PasswordField } from "../components/PasswordField";
import { PhraseGrid } from "../components/PhraseGrid";
import { PhraseInput, WORD_COUNTS, type WordCount } from "../components/PhraseInput";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { SetPassword } from "../components/SetPassword";
import { usePreferences } from "../preferences";
import { switchOpenIn, useWindowId, view } from "../view";
import { Collateral } from "./Collateral";

const SOURCE = "https://github.com/logical-mechanism/Seedelf-Wallet";
const PRIVACY =
  "https://github.com/logical-mechanism/Seedelf-Wallet/blob/seedelf-web-wallet/seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md";

type Page = "menu" | "contacts" | "collateral" | "sites" | "phrase" | "check-phrase" | "password" | "remove";

/** The currencies ADA's value can be shown in, by name. */
const CURRENCY_NAMES: Record<(typeof CURRENCIES)[number], string> = {
  usd: "US dollar (USD)",
  eur: "Euro (EUR)",
  gbp: "Pound sterling (GBP)",
  jpy: "Japanese yen (JPY)",
  cad: "Canadian dollar (CAD)",
  aud: "Australian dollar (AUD)",
  chf: "Swiss franc (CHF)",
  brl: "Brazilian real (BRL)",
};

const lockLabel = (m: LockAfterMinutes) => (m === 60 ? "1 hour" : m === 1 ? "1 minute" : `${m} minutes`);

export function Settings({
  status,
  onBack,
  onRemoved,
}: {
  status: Status;
  onBack: () => void;
  onRemoved: (status: Status) => void;
}) {
  const [page, setPage] = useState<Page>("menu");
  const { prefs } = usePreferences();
  const prices = !!NETWORKS[status.network].prices && prefs.currency !== "off";
  const menu = () => setPage("menu");
  if (page === "contacts") return <Contacts onBack={menu} />;
  if (page === "collateral") return <Collateral onBack={menu} />;
  if (page === "sites") return <ConnectedSites onBack={menu} />;
  if (page === "phrase") return <ShowPhrase onBack={menu} />;
  if (page === "check-phrase") return <CheckPhrase onBack={menu} />;
  if (page === "password") return <ChangePassword onBack={menu} />;
  if (page === "remove") return <RemoveWallet onBack={menu} onRemoved={onRemoved} />;

  return (
    <Screen title="Settings" titleId="settings-title" onBack={onBack}>
      <section className="section" aria-labelledby="wallet-title">
        <h2 id="wallet-title">Wallet</h2>
        <ul className="list">
          <MenuRow icon={<UsersIcon size={16} />} label="Contacts" onClick={() => setPage("contacts")} />
          <MenuRow icon={<VaultIcon size={16} />} label="Collateral" onClick={() => setPage("collateral")} />
        </ul>
      </section>
      <PreferencesSection network={status.network} />
      <DappConnector onSites={() => setPage("sites")} />
      <SpendRewards />
      <section className="section" aria-labelledby="security-title">
        <h2 id="security-title">Security</h2>
        <LockAfter />
        <ul className="list">
          <MenuRow icon={<EyeIcon size={16} />} label="Show recovery phrase" onClick={() => setPage("phrase")} />
          <MenuRow icon={<CheckIcon size={16} />} label="Check recovery phrase" onClick={() => setPage("check-phrase")} />
          <MenuRow icon={<LockIcon size={16} />} label="Change password" onClick={() => setPage("password")} />
          <MenuRow icon={<TrashIcon size={16} />} label="Remove wallet" onClick={() => setPage("remove")} danger />
        </ul>
      </section>
      <section className="section" aria-labelledby="about-title">
        <h2 id="about-title">About</h2>
        <ReviewRows testId="about">
          <Row label="Version" value={status.version} />
          <Row label="Network" value={NETWORKS[status.network].label} />
        </ReviewRows>
        <a className="menu-link" href={SOURCE} target="_blank" rel="noreferrer">
          Source code <ExternalIcon size={12} />
        </a>
        <a className="menu-link" href={PRIVACY} target="_blank" rel="noreferrer">
          Privacy policy <ExternalIcon size={12} />
        </a>
        <p className="note" data-testid="talks-to">
          {prices
            ? "The wallet only ever talks to Koios and giveme.my, to CoinGecko for ADA's price, and to Minswap when you swap. It has no accounts, analytics or tracking."
            : "The wallet only ever talks to Koios and giveme.my, and to Minswap when you swap. It has no accounts, analytics or tracking."}
        </p>
      </section>
    </Screen>
  );
}

/**
 * Where the toolbar button opens the wallet, and ADA's value in a currency.
 * Switching where it opens opens it that way at once, as in Lace.
 */
function PreferencesSection({ network }: { network: Status["network"] }) {
  const { prefs, loaded, set } = usePreferences();
  const [openIn, setOpenIn] = useState<OpenIn>();
  const [error, setError] = useState<string>();
  const windowId = useWindowId();
  useEffect(() => {
    readOpenIn().then(setOpenIn, () => setOpenIn("tab"));
  }, []);
  const priced = !!NETWORKS[network].prices;

  function chooseOpenIn(mode: OpenIn) {
    if (mode === openIn) return;
    setOpenIn(mode);
    switchOpenIn(mode, windowId).catch((e: Error) => setError(e.message));
  }

  return (
    <section className="section" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Preferences</h2>
      {openIn && (
        <div className="stack-tight">
          <Choice<OpenIn>
            label="Open Seedelf Wallet in"
            id="open-in-label"
            options={[
              { value: "tab", label: "A full tab" },
              { value: "panel", label: "The side panel" },
            ]}
            value={openIn}
            onChange={chooseOpenIn}
          />
          <p className="note" data-testid="open-in-note">
            {openIn === "panel"
              ? "The toolbar button opens the wallet beside the page you're on, and it stays open as you browse."
              : "The toolbar button opens the wallet in a tab, or brings back the one already open."}
            {openIn === "panel" && view === "tab" ? " Open it with the toolbar button." : ""}
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="currency">Show ADA's value in</label>
        <select
          id="currency"
          value={prefs.currency}
          disabled={!loaded}
          onChange={(e) => void set({ currency: e.target.value as Currency }).catch((err: Error) => setError(err.message))}
        >
          <option value="off">Nothing (don't ask for prices)</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {CURRENCY_NAMES[c]}
            </option>
          ))}
        </select>
        <p className="note" data-testid="currency-note">
          {priced
            ? prefs.currency === "off"
              ? "No prices: the wallet asks CoinGecko nothing."
              : "From CoinGecko, read when Home opens, at most every five minutes. It learns only that someone at your IP address uses the wallet: nothing about what you hold."
            : "Values show on mainnet only: test ADA has no price, so nothing is asked on preprod."}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** How long the wallet stays unlocked without anything done in it. */
function LockAfter() {
  const { prefs, loaded, set } = usePreferences();
  const [error, setError] = useState<string>();
  return (
    <div className="field">
      <label htmlFor="lock-after">Lock after</label>
      <select
        id="lock-after"
        value={prefs.lockAfterMinutes}
        disabled={!loaded}
        onChange={(e) =>
          void set({ lockAfterMinutes: Number(e.target.value) as LockAfterMinutes }).catch((err: Error) => setError(err.message))
        }
      >
        {LOCK_AFTER_MINUTES.map((m) => (
          <option key={m} value={m}>
            {lockLabel(m)} without activity
          </option>
        ))}
      </select>
      <p className="note">Closing the browser always locks it.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Whether sites can find the wallet (CIP-30) and connect to the public
 * account. Turning it on asks Chrome to let the wallet onto sites, from the
 * click itself (Chrome asks only then); off removes the scripts but keeps
 * Chrome's access (background/connector.ts says why). Under it, whether a
 * site's signature needs the password too (on by default).
 */
function DappConnector({ onSites }: { onSites: () => void }) {
  const { prefs, loaded, set } = usePreferences();
  const [allowed, setAllowed] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    chrome.permissions.contains({ origins: DAPP_ORIGINS }).then(setAllowed, () => setAllowed(false));
  }, [prefs.dappConnector]);
  const on = loaded && prefs.dappConnector && allowed === true;

  function toggle() {
    if (!loaded || allowed === undefined) return;
    setError(undefined);
    if (on) {
      set({ dappConnector: false }).then(
        () => setAllowed(false),
        (e: Error) => setError(e.message),
      );
      return;
    }
    // Before anything is awaited: Chrome asks only straight from a click.
    chrome.permissions.request({ origins: DAPP_ORIGINS }).then(
      async (granted) => {
        setAllowed(granted);
        if (!granted) {
          setError("Chrome wasn't allowed to let the wallet onto sites, so sites still can't connect.");
          return;
        }
        await set({ dappConnector: true });
      },
      (e: Error) => setError(e.message),
    );
  }

  return (
    <section className="section" aria-labelledby="dapp-settings-title">
      <h2 id="dapp-settings-title">Sites</h2>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="dapp-connector-label">Let sites connect to Seedelf Wallet</span>
          <span className="note" id="dapp-connector-note" data-testid="dapp-connector-note">
            {on
              ? "Sites find Seedelf Wallet as a Cardano wallet (CIP-30) and can ask to connect. When one asks, you choose what it sees: your public account, or a private session. Nothing is signed without you."
              : "Off: sites can't see Seedelf Wallet. Turning it on asks Chrome to let the wallet add itself to https sites, as other Cardano wallets do. That's all it adds."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={on}
          aria-labelledby="dapp-connector-label"
          aria-describedby="dapp-connector-note"
          onClick={toggle}
          disabled={!loaded || allowed === undefined}
        />
      </div>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="dapp-password-label">Ask for your password to sign for a site</span>
          <span className="note" id="dapp-password-note" data-testid="dapp-password-note">
            {!loaded || prefs.dappPassword
              ? "A site's transaction or message is signed only once you type your password, even while the wallet is unlocked."
              : "Sign is enough while the wallet is unlocked, so anyone at your unlocked browser could sign for a site."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={loaded && prefs.dappPassword}
          aria-labelledby="dapp-password-label"
          aria-describedby="dapp-password-note"
          onClick={() => {
            setError(undefined);
            set({ dappPassword: !prefs.dappPassword }).catch((e: Error) => setError(e.message));
          }}
          disabled={!loaded}
        />
      </div>
      <ul className="list">
        <MenuRow icon={<PlugIcon size={16} />} label="Connected sites" onClick={onSites} />
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The sites connected to the public account, each with Disconnect. The list is sealed on the device. */
function ConnectedSites({ onBack }: { onBack: () => void }) {
  const [sites, setSites] = useState<DappSite[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call("dapp-sites", {}).then(setSites, (e: Error) => setError(e.message));
  }, []);

  async function forget(origin: string) {
    try {
      setSites(await call("dapp-forget", { origin }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen title="Connected sites" titleId="sites-title" onBack={onBack} aside="Encrypted on this device" error={error}>
      {sites?.length === 0 && (
        <p className="note center" data-testid="sites-empty">
          No site is connected. A site asks when it wants to, and you choose.
        </p>
      )}
      {!!sites?.length && (
        <ul className="list section" data-testid="sites">
          {sites.map((s) => (
            <li key={s.origin} className="list__row">
              <span className="stack-tight">
                <strong>{new URL(s.origin).host}</strong>
                <span className="note">
                  {s.session === undefined ? "Your public account" : `Private session ${s.session + 1}`} · since{" "}
                  {new Date(s.connectedAt).toLocaleDateString()}
                </span>
              </span>
              <button type="button" className="chip" onClick={() => forget(s.origin)}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        A disconnected site has to ask again before it sees anything. A private session is disconnected once everything in
        it is brought back, from the dApps page.
      </p>
    </Screen>
  );
}

/** Whether a payment from the Cardano account withdraws the staking rewards too. */
function SpendRewards() {
  const { prefs: all, loaded, set } = usePreferences();
  const prefs = loaded ? all : undefined;
  const [error, setError] = useState<string>();

  async function toggle() {
    if (!prefs) return;
    try {
      await set({ spendRewards: !prefs.spendRewards });
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="section" aria-labelledby="staking-settings-title">
      <h2 id="staking-settings-title">Staking</h2>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="spend-rewards-label">Use staking rewards when spending</span>
          <span className="note" id="spend-rewards-note">
            {prefs?.spendRewards === false
              ? "Rewards wait until you withdraw them on the Staking page."
              : "Anything your public account pays (a send, making money private, a Seedelf) withdraws the rewards too."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={prefs?.spendRewards ?? false}
          aria-labelledby="spend-rewards-label"
          aria-describedby="spend-rewards-note"
          onClick={toggle}
          disabled={!prefs}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <li>
      <button type="button" className={danger ? "menu-row menu-row--danger" : "menu-row"} onClick={onClick}>
        <span className="menu-row__icon">{icon}</span>
        <span>{label}</span>
        <ChevronRightIcon size={16} />
      </button>
    </li>
  );
}

function Contacts({ onBack }: { onBack: () => void }) {
  const [contacts, reload] = useContacts();
  return (
    <Screen title="Contacts" titleId="contacts-title" onBack={onBack} aside="Encrypted on this device">
      <ContactsPage contacts={contacts} onChange={reload} />
    </Screen>
  );
}

/** The phrase, only after the password: anyone at an unlocked browser could otherwise read it. */
function ShowPhrase({ onBack }: { onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [words, setWords] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function reveal(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setWords((await call("reveal-phrase", { password })).words);
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (words) {
    return (
      <Screen
        title="Your recovery phrase"
        titleId="phrase-title"
        onBack={onBack}
        foot={
          <button type="button" className="primary" onClick={onBack}>
            Done
          </button>
        }
      >
        <Callout tone="warn">
          Anyone who has these words can take your funds. Don't copy them into a screenshot, a chat, an email or a cloud
          note, and never type them into a website.
        </Callout>
        <PhraseGrid words={words} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Show recovery phrase"
      titleId="phrase-title"
      onBack={onBack}
      backDisabled={busy}
      onSubmit={reveal}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!password || busy}>
          {busy ? "Checking…" : "Show phrase"}
        </button>
      }
    >
      <p className="note">Enter your password to see the words that restore this wallet. Check nobody can see your screen.</p>
      <PasswordField id="phrase-password" value={password} onChange={setPassword} autoFocus />
    </Screen>
  );
}

const blank = (n: number) => Array<string>(n).fill("");

/**
 * A check of the phrase as written down: type it, and the wallet says whether
 * it's this wallet's, never which words differ. Nothing is kept.
 */
function CheckPhrase({ onBack }: { onBack: () => void }) {
  const [count, setCount] = useState<WordCount>(24);
  const [words, setWords] = useState<string[]>(blank(24));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<boolean>();
  const [error, setError] = useState<string>();

  function changeCount(n: WordCount) {
    setCount(n);
    setWords((w) => Array.from({ length: n }, (_, i) => w[i] ?? ""));
    setResult(undefined);
    setError(undefined);
  }

  async function check() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const { matches } = await call("check-phrase", { phrase: words.join(" ") });
      setResult(matches);
      if (matches) setWords(blank(count));
    } catch (e) {
      const text = (e as Error).message;
      setError(`${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Check recovery phrase"
      titleId="check-phrase-title"
      onBack={onBack}
      backDisabled={busy}
      error={error}
      foot={
        <button type="button" className="primary" disabled={busy || words.some((w) => !w)} onClick={check}>
          {busy ? "Checking…" : "Check"}
        </button>
      }
    >
      <p className="note">
        Type the words from where you wrote them down, to make sure that copy restores this wallet. The wallet only says
        whether they match. Nothing is saved.
      </p>
      <div className="segmented" role="radiogroup" aria-label="Number of words">
        {WORD_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === count}
            className={n === count ? "segmented__item segmented__item--on" : "segmented__item"}
            onClick={() => changeCount(n)}
          >
            {n} words
          </button>
        ))}
      </div>
      <PhraseInput
        words={words}
        onChange={(w) => {
          setWords(w);
          setResult(undefined);
        }}
        onCountChange={changeCount}
      />
      {result === true && (
        <Callout tone="info" testId="phrase-matches">
          That's this wallet's recovery phrase. Keep that copy somewhere safe and offline.
        </Callout>
      )}
      {result === false && (
        <Callout tone="warn" testId="phrase-differs">
          That isn't this wallet's recovery phrase. Check each word against your copy; if it's wrong, write the phrase down
          again from Show recovery phrase.
        </Callout>
      )}
    </Screen>
  );
}

function ChangePassword({ onBack }: { onBack: () => void }) {
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  async function change(next: string) {
    if (busy) return;
    if (!current) {
      setError("Enter your current password first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await call("change-password", { current, next });
      setCurrent("");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen
        title="Change password"
        titleId="password-title"
        onBack={onBack}
        foot={
          <button type="button" className="primary" onClick={onBack}>
            Done
          </button>
        }
      >
        <Callout tone="info" testId="password-changed">
          Password changed. Use the new one to unlock from now on.
        </Callout>
      </Screen>
    );
  }

  return (
    <Screen title="Change password" titleId="password-title" onBack={onBack} backDisabled={busy} error={error}>
      <PasswordField id="current-password" label="Current password" value={current} onChange={setCurrent} />
      <SetPassword label="New password" submitLabel="Change password" busy={busy} onSubmit={change} />
    </Screen>
  );
}

const CONFIRM_TEXT = "delete wallet";

function RemoveWallet({ onBack, onRemoved }: { onBack: () => void; onRemoved: (status: Status) => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const confirmed = typed.trim().toLowerCase() === CONFIRM_TEXT;

  async function remove() {
    setBusy(true);
    try {
      onRemoved(await call("reset-wallet", {}));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Remove wallet"
      titleId="remove-wallet-title"
      onBack={onBack}
      backDisabled={busy}
      error={error}
      foot={
        <button type="button" className="danger" onClick={remove} disabled={busy || !confirmed}>
          {busy ? "Removing…" : "Remove wallet"}
        </button>
      }
    >
      <p className="note">
        This deletes the wallet from this browser. Your funds stay on the chain: your recovery phrase brings them back,
        here or in Seedelf Wallet on another device.
      </p>
      <Callout tone="warn">
        Make sure you have your recovery phrase first (Show recovery phrase). Without it, removing the wallet loses your
        funds for good.
      </Callout>
      <div className="field">
        <label htmlFor="confirm-remove">
          Type <strong>{CONFIRM_TEXT}</strong> to confirm
        </label>
        <input
          id="confirm-remove"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
    </Screen>
  );
}
