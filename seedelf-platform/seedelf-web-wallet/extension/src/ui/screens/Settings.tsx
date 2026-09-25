// Settings, from the gear in the top bar: contacts, the Cardano account's
// collateral, whether payments spend the staking rewards, the recovery phrase
// (the password again first, even while unlocked), a new password, removing
// the wallet from this browser, and what this is. Nothing here asks Koios
// anything, except setting a collateral that needs a transaction.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { NETWORKS } from "../../networks";
import type { Preferences, Status } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ContactsPage, useContacts } from "../components/Contacts";
import { ChevronRightIcon, ExternalIcon, EyeIcon, LockIcon, TrashIcon, UsersIcon, VaultIcon } from "../components/Icons";
import { PasswordField } from "../components/PasswordField";
import { PhraseGrid } from "../components/PhraseGrid";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { SetPassword } from "../components/SetPassword";
import { Collateral } from "./Collateral";

const SOURCE = "https://github.com/logical-mechanism/Seedelf-Wallet";
const PRIVACY =
  "https://github.com/logical-mechanism/Seedelf-Wallet/blob/seedelf-web-wallet/seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md";

type Page = "menu" | "contacts" | "collateral" | "phrase" | "password" | "remove";

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
  const menu = () => setPage("menu");
  if (page === "contacts") return <Contacts onBack={menu} />;
  if (page === "collateral") return <Collateral onBack={menu} />;
  if (page === "phrase") return <ShowPhrase onBack={menu} />;
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
      <SpendRewards />
      <section className="section" aria-labelledby="security-title">
        <h2 id="security-title">Security</h2>
        <ul className="list">
          <MenuRow icon={<EyeIcon size={16} />} label="Show recovery phrase" onClick={() => setPage("phrase")} />
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
        <p className="note">
          The wallet only ever talks to Koios and giveme.my. It has no accounts, analytics or tracking.
        </p>
      </section>
    </Screen>
  );
}

/** Whether a payment from the Cardano account withdraws the staking rewards too. */
function SpendRewards() {
  const [prefs, setPrefs] = useState<Preferences>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call("preferences", {}).then(setPrefs, (e: Error) => setError(e.message));
  }, []);

  async function toggle() {
    if (!prefs) return;
    try {
      setPrefs(await call("preferences-set", { spendRewards: !prefs.spendRewards }));
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
