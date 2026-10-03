// Settings, from the gear in the top bar: in a mainnet build, which network
// the wallet is on (mainnet, or preprod for testing); contacts, the Cardano account's
// collateral, where the wallet opens (a full tab or the side panel), ADA's
// value in a currency, whether sites can connect (the dApp connector: each
// to the public account or a private session) and which have, whether payments spend the staking rewards, how long
// it stays unlocked, the recovery phrase (the password again first, even
// while unlocked) and a check of a written copy, a new password, removing the
// wallet from this browser, and what this is. Nothing here asks Koios
// anything, except setting a collateral that needs a transaction, and
// disconnecting a site's private session, whose account the worker reads
// first.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { availableLanguages, currentLanguage, type LanguageCode, setLanguage, useT } from "../../i18n";

import { lovejoinOn, NETWORKS, type NetworkName } from "../../networks";
import { DAPP_ORIGINS } from "../../shared/dapp";
import { readOpenIn, type OpenIn } from "../../shared/open-in";
import {
  CURRENCIES,
  LOCK_AFTER_MINUTES,
  LOVEJOIN_DELAYS,
  LOVEJOIN_DEPTHS,
  type Currency,
  type LockAfterMinutes,
  type LovejoinDelay,
  type LovejoinDepth,
} from "../../shared/preferences";
import type { AtStake, DappSite, SessionView, Status } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ContactsPage, useContacts } from "../components/Contacts";
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalIcon,
  SearchIcon,
  EyeIcon,
  LockIcon,
  PlugIcon,
  TrashIcon,
  UsersIcon,
  VaultIcon,
  WalletIcon,
} from "../components/Icons";
import { PasswordField } from "../components/PasswordField";
import { PhraseGrid } from "../components/PhraseGrid";
import { PhraseInput, WORD_COUNTS, type WordCount } from "../components/PhraseInput";
import { delayText, LOVEJOIN_SEEN, LOVEJOIN_UNAUDITED, lovejoinHides } from "../components/LovejoinReturn";
import { Modal } from "../components/Modal";
import { NETWORK_NOTE } from "../components/NetworkPicker";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { SetPassword } from "../components/SetPassword";
import { plural } from "../format";
import { accountName, useAccounts } from "../accounts";
import { usePreferences } from "../preferences";
import { switchOpenIn, useWindowId, view } from "../view";
import { Collateral } from "./Collateral";
import { disconnectWait } from "./SiteSessions";

const SOURCE = "https://github.com/logical-mechanism/Seedelf-Wallet";
/** Where a wrong translation is reported: no native speaker has checked them (chunk 19). */
const ISSUES = "https://github.com/logical-mechanism/Seedelf-Wallet/issues";
const PRIVACY =
  "https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md";

type Page = "menu" | "accounts" | "contacts" | "collateral" | "sites" | "phrase" | "check-phrase" | "password" | "remove";

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
  onNetwork,
}: {
  status: Status;
  onBack: () => void;
  onRemoved: (status: Status) => void;
  /** The wallet moved to another network: the app starts afresh on it. */
  onNetwork: (status: Status) => void;
}) {
  const [page, setPage] = useState<Page>("menu");
  const { prefs } = usePreferences();
  const prices = !!NETWORKS[status.network].prices && prefs.currency !== "off";
  const menu = () => setPage("menu");
  if (page === "accounts") return <Accounts onBack={menu} network={status.network} />;
  if (page === "contacts") return <Contacts onBack={menu} />;
  if (page === "collateral") return <Collateral onBack={menu} />;
  if (page === "sites") return <ConnectedSites onBack={menu} />;
  if (page === "phrase") return <ShowPhrase onBack={menu} />;
  if (page === "check-phrase") return <CheckPhrase onBack={menu} />;
  if (page === "password") return <ChangePassword onBack={menu} />;
  if (page === "remove") return <RemoveWallet onBack={menu} onRemoved={onRemoved} />;

  return (
    <Screen title="Settings" titleId="settings-title" onBack={onBack}>
      <NetworkSection status={status} onMoved={onNetwork} />
      <section className="section" aria-labelledby="wallet-title">
        <h2 id="wallet-title">Wallet</h2>
        <ul className="list">
          <MenuRow icon={<WalletIcon size={16} />} label="Public accounts" onClick={() => setPage("accounts")} />
          <MenuRow icon={<UsersIcon size={16} />} label="Contacts" onClick={() => setPage("contacts")} />
          <MenuRow icon={<VaultIcon size={16} />} label="Collateral" onClick={() => setPage("collateral")} />
        </ul>
      </section>
      <PreferencesSection network={status.network} />
      <DappConnector blocked={status.connectorBlocked} onSites={() => setPage("sites")} />
      {lovejoinOn(status.network) && <LovejoinSettings network={status.network} />}
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
          {talksTo(prices, lovejoinOn(status.network))}
        </p>
      </section>
    </Screen>
  );
}


/** Past this many accounts the list gets a filter: it scrolls from about eight. */
const FILTER_FROM = 8;

/**
 * The phrase's public accounts: which one the wallet works on, what each is
 * called, and a look for one more.
 *
 * **What "check for another account" costs:** one Koios
 * `account_addresses` request, for the next account after the highest the
 * wallet knows. It asks about one account at a time on purpose — a single
 * request for twenty stake addresses would tell Koios those twenty are one
 * wallet's, which is the opposite of what several accounts are for.
 */
function Accounts({ onBack, network }: { onBack: () => void; network: NetworkName }) {
  const { accounts, active, reload } = useAccounts();
  const [busy, setBusy] = useState<"switch" | "check" | "name" | "look">();
  const [error, setError] = useState<string>();
  const [found, setFound] = useState<string>();
  const [naming, setNaming] = useState<number>();
  const [draft, setDraft] = useState("");
  // The account number to look up or add. Any CIP-1852 index: a custom or
  // non-sequential one (1337, say) is unreachable otherwise, since the
  // sequential look stops at the first unused account (the owner, 2026-10-02).
  const [number, setNumber] = useState("");
  // Set when a checked account has never been used, so Add can be offered for it.
  const [unused, setUnused] = useState<number>();
  // A filter, once the list is long enough to scroll past: by number or by
  // the name the user gave it (the owner, 2026-10-02).
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? accounts.filter((a) => accountName(a).toLowerCase().includes(q) || String(a.index + 1).includes(q))
    : accounts;

  const run = async (what: "switch" | "check" | "name" | "look", task: () => Promise<void>) => {
    setBusy(what);
    setError(undefined);
    setFound(undefined);
    setUnused(undefined);
    try {
      await task();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  /** The next account in the sequential run, which is what most wallets have. */
  const look = () =>
    run("look", async () => {
      const { found: indexes } = await call("account-discover", { limit: 1 });
      setFound(
        indexes.length
          ? `Found Account ${indexes[0]! + 1}. It's in the list now.`
          : `The next account in order has never been used on ${NETWORKS[network].label}. A custom number may still have been: check one below.`,
      );
    });

  /** The number typed, as an index from 0; undefined when it isn't a number a person would mean. */
  const typed = () => {
    const shown = Number(number.trim());
    return Number.isInteger(shown) && shown >= 1 ? shown - 1 : undefined;
  };

  const checkOne = () => {
    const index = typed();
    if (index === undefined) return;
    void run("check", async () => {
      const { used } = await call("account-check", { index });
      setFound(
        used
          ? `Account ${index + 1} has been used on ${NETWORKS[network].label}. It's in the list now.`
          : `Account ${index + 1} has never been used on ${NETWORKS[network].label}. You can still add it and start using it.`,
      );
      if (!used) setUnused(index);
    });
  };

  const addOne = (index: number) =>
    run("check", async () => {
      await call("account-add", { index });
      setFound(`Account ${index + 1} is in the list now.`);
      setNumber("");
    });

  return (
    <Screen title="Public accounts" titleId="accounts-title" onBack={onBack}>
      <section className="section" aria-labelledby="accounts-list-title">
        {/* The count, because the list scrolls: a row cut off at the bottom
            edge otherwise reads as clipped rather than as more below. */}
        <h2 id="accounts-list-title">
          Accounts
          {accounts.length > 1 && (
            <span className="section__count">
              {" · "}
              {shown.length === accounts.length ? accounts.length : `${shown.length} of ${accounts.length}`}
            </span>
          )}
        </h2>
        {accounts.length > FILTER_FROM && (
          <label className="search" data-testid="accounts-filter">
            <SearchIcon size={16} />
            <input
              type="search"
              aria-label="Find an account"
              placeholder="Number or name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          </label>
        )}
        <ul className="list accounts-list" data-testid="accounts-list">
          {shown.map((a) => (
            <li key={a.index} className={a.index === active ? "account-row account-row--active" : "account-row"}>
              {naming === a.index ? (
                <form
                  className="account-row__name"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void run("name", async () => {
                      await call("account-rename", { index: a.index, name: draft });
                      setNaming(undefined);
                    });
                  }}
                >
                  <label className="sr-only" htmlFor={`account-name-${a.index}`}>
                    What to call Account {a.index + 1}
                  </label>
                  <input
                    id={`account-name-${a.index}`}
                    value={draft}
                    maxLength={24}
                    autoFocus
                    placeholder={`Account ${a.index + 1}`}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button type="submit" className="secondary" disabled={busy !== undefined}>
                    Save
                  </button>
                  <button type="button" className="link" onClick={() => setNaming(undefined)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="account-row__name">
                  <span>
                    {accountName(a)}
                    {a.index === active && (
                      <span className="account-row__active" data-testid={`account-active-${a.index}`}>
                        {" "}
                        · working on this one
                      </span>
                    )}
                  </span>
                  <span className="account-row__actions">
                    {/* A chip, as Copy and Max are: one row an account, so a
                        full-height button next to each name is far too heavy. */}
                    {a.index !== active && (
                      <button
                        type="button"
                        className="chip"
                        disabled={busy !== undefined}
                        onClick={() => void run("switch", () => call("account-use", { index: a.index }).then(() => undefined))}
                      >
                        {busy === "switch" ? "Switching…" : "Switch to it"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setNaming(a.index);
                        setDraft(a.name ?? "");
                      }}
                    >
                      {a.name ? "Rename" : "Name it"}
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!shown.length && (
          <p className="note center empty" data-testid="accounts-none">
            No account matches “{query.trim()}”.
          </p>
        )}
        <p className="note" data-testid="accounts-note">
          Each account is a separate Cardano wallet from the same recovery phrase, with its own addresses, its own staking and
          its own collateral. Other wallets call these accounts too, and show the same ones for this phrase.
        </p>
        <p className="note" data-testid="accounts-private-note">
          Your private balance is shared: there's one of it for the whole phrase, whichever account you're on. Nothing on chain
          links money you make private from one account to money you make private from another — but spending both in one
          private payment would, so the wallet keeps them apart and says so when it can't.
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => void look()} disabled={busy !== undefined}>
            {busy === "look" ? "Looking…" : "Look for the next account"}
          </button>
        </div>
        <form
          className="account-number"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            checkOne();
          }}
        >
          <label htmlFor="account-number">Account number</label>
          <input
            id="account-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={2147483648}
            step={1}
            value={number}
            placeholder="1338"
            onChange={(e) => {
              setNumber(e.target.value);
              setUnused(undefined);
              setFound(undefined);
            }}
          />
          {/* Chips, like Switch to it and Name it in the list above: these sit
              inline with a field, not at the foot of a form. */}
          <button type="submit" className="chip" disabled={busy !== undefined || typed() === undefined}>
            {busy === "check" ? "Looking…" : "Check it"}
          </button>
          <button
            type="button"
            className="chip"
            disabled={busy !== undefined || typed() === undefined}
            onClick={() => {
              const index = typed();
              if (index !== undefined) void addOne(index);
            }}
          >
            Add it
          </button>
        </form>
        <p className="note" data-testid="accounts-cost-note">
          <strong>Look for the next account</strong> and <strong>Check it</strong> each ask Koios about one account, and the
          wallet only ever asks about one at a time: asking about twenty at once would tell Koios those twenty accounts are one
          wallet's. <strong>Add it</strong> asks nobody anything.
        </p>
        <p className="note" data-testid="accounts-custom-note">
          A number of your own works too — 1338, say. The look above goes in order and stops at the first account never used, so
          it can't find one out on its own; checking it by number can. You can add an account that has never been used and start
          using it: it exists in your recovery phrase either way, and holds nothing until you put something there.
        </p>
        {unused !== undefined && (
          <div className="actions" data-testid="accounts-add-unused">
            <button type="button" className="primary" onClick={() => void addOne(unused)} disabled={busy !== undefined}>
              Add Account {unused + 1} anyway
            </button>
          </div>
        )}
        {found && (
          <p className="note" role="status" data-testid="accounts-found">
            {found}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Screen>
  );
}

/**
 * Whom the wallet talks to, and what each sees, under About (privacy review
 * §2.4, §2.5): `prices` when it asks CoinGecko for ADA's price, `lovejoin`
 * where Lovejoin is. giveme.my is the makers' own service, and Koios sends
 * every transaction from the IP address that reads the public account.
 */
export function talksTo(prices: boolean, lovejoin: boolean): string {
  return [
    `The wallet only ever talks to Koios and giveme.my, ${prices ? "to CoinGecko for ADA's price, " : ""}and to Minswap when you swap. It has no accounts, analytics or tracking.`,
    "Each of them sees your IP address. Koios sends every transaction, from the same IP address that reads your public account.",
    "giveme.my is run by Logical Mechanism, who make Seedelf Wallet: to lend its collateral, it sees each payment from your private balance.",
    ...(lovejoin ? [LOVEJOIN_SEEN] : []),
  ].join(" ");
}

/** What moving to each network says first, before the wallet moves. */
export const MOVE_TO: Record<NetworkName, string> = {
  preprod:
    "Preprod is Cardano's test network. ADA there is test ADA, with no value: it can't pay for anything, and real ADA sent to a preprod address is lost. " +
    "Your wallet is the same there, with its own balances, history and connected sites, and the same keys: anyone comparing the two networks can tell they're one wallet's. " +
    "To keep them apart, test with a recovery phrase you don't use on mainnet.",
  mainnet: "Mainnet is Cardano's real network: ADA there is real money. Check every address and amount before you send.",
};

/**
 * Which network the wallet is on, in a build that has both (the store's:
 * mainnet, and preprod for testing). Moving asks first, and says plainly what
 * the other network is. The worker takes the choice at its next request, and
 * every page starts afresh on it; swaps, Lovejoin and payments on their way
 * carry on, on their own network.
 */
export function NetworkSection({ status, onMoved }: { status: Status; onMoved: (status: Status) => void }) {
  const [asking, setAsking] = useState<NetworkName>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (status.networks.length < 2) return null;
  const current = NETWORKS[status.network];

  async function move(network: NetworkName) {
    setBusy(true);
    setError(undefined);
    try {
      onMoved(await call("network-set", { network }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setAsking(undefined);
    }
  }

  return (
    <section className="section" aria-labelledby="network-title">
      <h2 id="network-title">Network</h2>
      <Choice<NetworkName>
        label="Cardano network"
        id="network-label"
        options={status.networks.map((n) => ({ value: n, label: NETWORKS[n].label, disabled: busy }))}
        value={asking ?? status.network}
        onChange={(n) => {
          setError(undefined);
          setAsking(n === status.network ? undefined : n);
        }}
      />
      {!asking && (
        <p className="note" data-testid="network-note">
          {NETWORK_NOTE[status.network]}
        </p>
      )}
      {asking && (
        <div className="stack" data-testid="network-confirm">
          <Callout tone="warn">{MOVE_TO[asking]}</Callout>
          <p className="note">
            Anything on its way on {current.label} (a swap, Lovejoin, a payment) carries on there. A site asking something now
            is declined.
          </p>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setAsking(undefined)} disabled={busy}>
              Stay on {current.label}
            </button>
            <button type="button" className="primary" onClick={() => void move(asking)} disabled={busy}>
              {busy ? "Switching…" : `Switch to ${NETWORKS[asking].label}`}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Where the toolbar button opens the wallet, and ADA's value in a currency.
 * Switching where it opens opens it that way at once, as in Lace.
 */
function PreferencesSection({ network }: { network: Status["network"] }) {
  const t = useT();
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
      <div className="field">
        <label htmlFor="language">{t("settings.language.label")}</label>
        <select
          id="language"
          value={currentLanguage()}
          onChange={(e) => void setLanguage(e.target.value as LanguageCode).catch((err: Error) => setError(err.message))}
        >
          {availableLanguages.map((l) => (
            // Each language under its own name, from its own bundle: never
            // "Japanese" in English.
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <p className="note" data-testid="language-note">
          {t("settings.language.warn.unchecked")}{" "}
          <a className="link" href={ISSUES} target="_blank" rel="noreferrer">
            {t("settings.language.report")}
          </a>
        </p>
      </div>
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

/**
 * About what a box's fan-out costs on `network`: its mixes (1, 4 or 13, three
 * wide), at what a mix measured there (networks.ts: 0.877 ₳ on preprod, about
 * 0.82 ₳ on mainnet).
 */
export function depthCost(network: NetworkName, depth: LovejoinDepth): string {
  const mixes = (3 ** depth - 1) / 2;
  const lovelace = mixes * (NETWORKS[network].lovejoin?.mixCost ?? 0);
  return `${mixes} ${mixes === 1 ? "mix" : "mixes"}, about ${(lovelace / 1_000_000).toFixed(1)} ₳`;
}

/**
 * Lovejoin, for a private session's return: whether it goes through Lovejoin
 * at all (on by default; off, the section says what's lost), how deep each
 * box fans out, and how long each waits before it comes back (roadmap chunk
 * 16, privacy review §4.1). Shown where Lovejoin is deployed (networks.ts),
 * as the worker uses it.
 */
export function LovejoinSettings({ network }: { network: NetworkName }) {
  const { prefs, loaded, set } = usePreferences();
  const [error, setError] = useState<string>();
  const fail = (err: Error) => setError(err.message);
  const floor = NETWORKS[network].lovejoin?.poolFloor ?? 0;
  const on = prefs.lovejoinReturns;
  return (
    <section className="section" aria-labelledby="lovejoin-settings-title">
      <h2 id="lovejoin-settings-title">Lovejoin</h2>
      <p className="note">
        When a private session comes back with ADA to spare (a token→ADA swap's proceeds count), that ADA goes through
        Lovejoin first, in boxes of 10 ₳ mixed with other people's, so what comes back is harder to tie to the session on
        chain. The session pays for the mixes, and about 0.3 ₳ brings each box back. Its mixes are sent only while the
        wallet is unlocked: locking partway stops them, and what's left comes back directly. A swap or a mix brings it back
        by itself; a site's session, or a return you sent from Bring everything back, keeps it at its account until you
        bring it back.
        {floor > 0 &&
          ` The wallet mixes only once Lovejoin's pool holds ${floor} boxes that aren't yours; until then a return comes back directly, and says so.`}{" "}
        {LOVEJOIN_SEEN}
      </p>
      <Callout tone="warn" testId="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED}
      </Callout>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="lovejoin-returns-label">Bring private sessions back through Lovejoin</span>
          <span className="note" id="lovejoin-returns-note" data-testid="lovejoin-returns-note">
            {on
              ? "A swap's approval, its Stop and each return you review can still bring that one back directly."
              : `Off, a session's ADA comes back directly: anyone can tie it on chain to the session, and through its funding to the private UTxOs that paid for it. Your public account stays out either way. It saves each box's mixes (${depthCost(network, prefs.lovejoinDepth)}), about 0.3 ₳ to bring it back, and the hours of waiting. A mix from the Lovejoin tile still mixes, and a swap comes back as its approval said.`}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={on}
          aria-labelledby="lovejoin-returns-label"
          aria-describedby="lovejoin-returns-note"
          onClick={() => void set({ lovejoinReturns: !on }).catch(fail)}
          disabled={!loaded}
        />
      </div>
      <div className="field">
        <label htmlFor="lovejoin-depth">Mixing, for each box</label>
        <select
          id="lovejoin-depth"
          value={prefs.lovejoinDepth}
          disabled={!loaded || !on}
          onChange={(e) => void set({ lovejoinDepth: Number(e.target.value) as LovejoinDepth }).catch(fail)}
        >
          {LOVEJOIN_DEPTHS.map((d) => (
            <option key={d} value={d}>
              {d} {d === 1 ? "wave" : "waves"} deep: {depthCost(network, d)} (up to 1 in {3 ** d})
            </option>
          ))}
        </select>
        <p className="note" data-testid="lovejoin-hides">
          {lovejoinHides(prefs.lovejoinDepth)}
        </p>
      </div>
      <div className="field">
        <label htmlFor="lovejoin-delay">Each box comes back after</label>
        <select
          id="lovejoin-delay"
          value={prefs.lovejoinDelay}
          disabled={!loaded || !on}
          onChange={(e) => void set({ lovejoinDelay: e.target.value as LovejoinDelay }).catch(fail)}
        >
          {LOVEJOIN_DELAYS.map((d) => (
            <option key={d} value={d}>
              {delayText(d)}, at random
            </option>
          ))}
        </select>
        <p className="note">
          A box comes back some minutes into the first time the wallet is unlocked after its wait: never the moment you
          unlock, nor right after the wallet sends something else.
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
 * Whether sites can find the wallet (CIP-30) and connect, to the public
 * account or a private session. Turning it on asks Chrome to let the wallet
 * onto sites, from the click itself (Chrome asks only then); off removes the
 * scripts but keeps Chrome's access (background/connector.ts says why). Its
 * note says what it shows every https site, connected or not (privacy review
 * §2.20). Under it, whether a site's signature needs the password too (on by
 * default).
 *
 * `blocked` (the status's `connectorBlocked`): this Chrome won't keep sites'
 * scripts out of the wallet's local storage, where the sealed vault is, so
 * the worker keeps the connector off (launch review #60). The switch is off
 * and can't be turned on, and the note says why.
 */
export function DappConnector({ blocked, onSites }: { blocked?: Status["connectorBlocked"]; onSites: () => void }) {
  const accounts = useAccounts();
  const { prefs, loaded, set } = usePreferences();
  const [allowed, setAllowed] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    chrome.permissions.contains({ origins: DAPP_ORIGINS }).then(setAllowed, () => setAllowed(false));
  }, [prefs.dappConnector]);
  const on = !blocked && loaded && prefs.dappConnector && allowed === true;

  function toggle() {
    if (blocked || !loaded || allowed === undefined) return;
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
            {blocked
              ? CONNECTOR_BLOCKED
              : on
                ? "Sites find Seedelf Wallet as a Cardano wallet (CIP-30) and can ask to connect. When one asks, you choose what it sees: your public account, or a private session. Nothing is signed without you. Every https site you open, and scripts on it, can see that you use Seedelf Wallet, even one you never connect: not your addresses or balance until you connect it."
                : "Off: sites can't see Seedelf Wallet. Turning it on asks Chrome to let the wallet add itself to https sites, as other Cardano wallets do. Then every https site you open, and scripts on it, can see that you use Seedelf Wallet, even sites you never connect (not your addresses or balance until you connect)."}
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
          disabled={!!blocked || !loaded || allowed === undefined}
        />
      </div>
      {/* Which account sites use, where there is more than one to choose
          between: one account is the dApp account, and it does not follow the
          picker (Eternl's model; the owner, 2026-10-02). */}
      {accounts.several && (
        <div className="stack-tight" data-testid="dapp-account">
          {/* A select, not a segmented Choice: a wallet may hold a lot of
              accounts, and ten buttons in a row would not fit. */}
          <div className="field">
            <label className="label" htmlFor="dapp-account-select">
              The account sites use
            </label>
            <select
              id="dapp-account-select"
              value={String(loaded ? prefs.dappAccount : 0)}
              disabled={!loaded}
              onChange={(e) => {
                setError(undefined);
                set({ dappAccount: Number(e.target.value) }).catch((err: Error) => setError(err.message));
              }}
            >
              {accounts.accounts.map((a) => (
                <option key={a.index} value={a.index}>
                  {accountName(a)}
                </option>
              ))}
            </select>
          </div>
          <p className="note" data-testid="dapp-account-note">
            Connected sites always use this account, whichever one you're working on, so switching accounts never shows a site a
            second account of yours. Changing it here shows every connected site the new account instead — which anyone watching
            both can see is the same wallet.
          </p>
        </div>
      )}
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

/** Why the connector stays off on a Chrome that won't protect the wallet's storage from sites (`connectorBlocked: "storage"`). */
export const CONNECTOR_BLOCKED =
  "Off, and it stays off in this version of Chrome: it can't keep websites away from the wallet's storage, where your encrypted wallet is. Update Chrome to let sites connect.";

/**
 * The sites connected on this network, each with Disconnect. A site's
 * private session ends with it, so its Disconnect waits while anything is on
 * its way to the session's account or from it, says why, and asks first, as
 * the session's page on the dApps page does (launch review H7). The worker
 * checks again, reading the account, and its refusal shows here. The list is
 * sealed on the device; the sessions are read from the device's record, not
 * Koios.
 */
function ConnectedSites({ onBack }: { onBack: () => void }) {
  const [sites, setSites] = useState<DappSite[]>();
  const [sessions, setSessions] = useState<SessionView[]>();
  const [asking, setAsking] = useState<DappSite>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const readSessions = () =>
    call("sessions", {}).then(setSessions, (e: Error) => {
      // The worker's own check still stands between Disconnect and a session on its way.
      setSessions([]);
      // A refusal from the worker, shown already, stays.
      setError((shown) => shown ?? e.message);
    });
  useEffect(() => {
    call("dapp-sites", {}).then(setSites, (e: Error) => setError(e.message));
    void readSessions();
  }, []);

  async function forget(origin: string) {
    setAsking(undefined);
    setBusy(true);
    setError(undefined);
    try {
      setSites(await call("dapp-forget", { origin }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void readSessions();
    }
  }

  return (
    <Screen title="Connected sites" titleId="sites-title" onBack={onBack} aside="Encrypted on this device" error={error}>
      {sites?.length === 0 && (
        <p className="note center" data-testid="sites-empty">
          No site is connected. A site asks when it wants to, and you choose.
        </p>
      )}
      {!!sites?.length && <SiteRows sites={sites} sessions={sessions} busy={busy} onDisconnect={setAsking} />}
      <p className="note">
        A disconnected site has to ask again before it sees anything more, and it keeps what it already saw. A private
        session is disconnected once everything in it is brought back, from the dApps page.
      </p>
      {asking && (
        <Modal
          title={`Disconnect ${host(asking)}?`}
          titleId="sites-disconnect-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                Keep it
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void forget(asking.origin)}
                data-testid="sites-disconnect-confirm"
              >
                Disconnect the site
              </button>
            </>
          }
        >
          <p className="note">{disconnectText(host(asking), asking.session)}</p>
        </Modal>
      )}
    </Screen>
  );
}

const host = (site: DappSite) => new URL(site.origin).host;

/**
 * The connected sites' rows. A site's Disconnect is off while its private
 * session has something on its way, or holds something (as last read), with
 * why; and until the sessions are read.
 */
export function SiteRows({
  sites,
  sessions,
  busy,
  onDisconnect,
}: {
  sites: DappSite[];
  /** The sessions on this network, from the device's record; undefined until read. */
  sessions?: SessionView[];
  busy: boolean;
  onDisconnect: (site: DappSite) => void;
}) {
  return (
    <ul className="list section" data-testid="sites">
      {sites.map((s) => {
        const session = s.session === undefined ? undefined : sessions?.find((x) => x.index === s.session);
        const wait = session && disconnectWait(session, { canRefresh: false });
        const unread = s.session !== undefined && !sessions;
        return (
          <li key={s.origin} className="list__row">
            <span className="stack-tight">
              <strong>{host(s)}</strong>
              <span className="note">
                {s.session === undefined ? "Your public account" : `Private session ${s.session + 1}`} · since{" "}
                {new Date(s.connectedAt).toLocaleDateString()}
              </span>
              {wait && (
                <span className="note" data-testid="site-wait">
                  {wait}.
                </span>
              )}
            </span>
            <button
              type="button"
              className="chip"
              disabled={busy || unread || !!wait}
              title={wait}
              onClick={() => onDisconnect(s)}
              data-testid="sites-disconnect"
            >
              Disconnect
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What disconnecting a site does, said before it's done: to the public account, or ending its private session `session`. */
export function disconnectText(site: string, session?: number): string {
  return session === undefined
    ? `${site} has to ask again before it sees anything more. It keeps what it already saw.`
    : `Private session ${session + 1} ends, and ${site} has to ask again before it sees anything more. It keeps what it already saw. The wallet stops reading the session's account: anything the site pays it later, or leaves open on it, isn't looked for again.`;
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

/** A private session as Remove wallet's list names it: by its number, from 1, and a site's by its host. */
function sessionName(s: AtStake["sessions"][number]): string {
  const name = `private session ${s.index + 1}`;
  if (s.kind === "site" && s.origin) return `${name} (${new URL(s.origin).host})`;
  return s.kind === "mix" ? `${name} (a mix)` : s.kind === "swap" ? `${name} (a swap)` : name;
}

/**
 * What removing the wallet would leave behind, in plain words: a line for
 * each thing on each network (independent review M2, M5). A restore finds
 * the public account, the private balance and Lovejoin's boxes; it doesn't
 * find what private sessions' one-time accounts hold yet, and nothing
 * watches a payment that may still go through, or a mix from the public
 * account that may have, until the same phrase is restored here, before any
 * other wallet is made here: that deletes its record (pending.ts and
 * lovejoin.ts adoptKept).
 */
export function atStakeLines(stake: AtStake[]): string[] {
  return stake.flatMap((s) => {
    const on = NETWORKS[s.network].label;
    const lines: string[] = [];
    if (s.unreadable) lines.push(`${on}: Seedelf Wallet couldn't read what's still open there.`);
    if (s.maybeSent) {
      lines.push(
        `${on}: a payment Koios didn't answer may still go through. An encrypted record of it stays in this browser: restoring this same recovery phrase here watches it again, but making or restoring another wallet here first deletes that record. While nothing watches it, a payment made here or elsewhere could pay twice.`,
      );
    }
    const open = s.sessions.filter((x) => !x.leftBehind);
    if (open.length) {
      lines.push(
        `${on}: ${plural(open.length, "private session")} still open: ${open.map(sessionName).join(", ")}. What ${open.length === 1 ? "its one-time account holds" : "their one-time accounts hold"} doesn't show after a restore yet: bring it back first, with Bring everything back on the dApps page, or a running swap's Stop.`,
      );
    }
    const left = s.sessions.filter((x) => x.leftBehind);
    if (left.length) {
      lines.push(
        `${on}: something no return takes is left at the account of ${left.map(sessionName).join(", ")}, and it doesn't show after a restore yet.`,
      );
    }
    if (s.chainSending) {
      lines.push(`${on}: a chain through Lovejoin is still being sent. Removing the wallet stops it partway, its boxes less mixed.`);
    }
    if (s.mixMaybeSent) {
      lines.push(
        `${on}: a mix from your public account stopped at a transaction that may have gone through. An encrypted record of it stays in this browser: restoring this same recovery phrase here looks for it again before another mix from the account is built, but making or restoring another wallet here first deletes that record. While nothing looks for it, the account could pay for a mix twice.`,
      );
    }
    return lines;
  });
}

export function RemoveWallet({ onBack, onRemoved }: { onBack: () => void; onRemoved: (status: Status) => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // What removing it would leave behind, as the worker reads it: undefined while it reads, null when it couldn't.
  const [stake, setStake] = useState<AtStake[] | null>();
  const [anyway, setAnyway] = useState(false);
  const confirmed = typed.trim().toLowerCase() === CONFIRM_TEXT;
  const held = stake === null || !!stake?.length;

  const check = () => {
    setStake(undefined);
    setAnyway(false);
    call("reset-check", {}).then(setStake, (e: Error) => {
      setStake(null);
      setError(e.message);
    });
  };
  useEffect(check, []);

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      // Anything listed stays behind only when the user said so a second time; the worker checks again.
      onRemoved(await call("reset-wallet", { force: held && anyway }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      // Something may have opened since the list was read.
      check();
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
        <button
          type="button"
          className="danger"
          onClick={remove}
          disabled={busy || !confirmed || stake === undefined || (held && !anyway)}
        >
          {busy ? "Removing…" : stake === undefined ? "Checking…" : "Remove wallet"}
        </button>
      }
    >
      <p className="note" data-testid="remove-wallet-note">
        This deletes the wallet from this browser. Your funds stay on the chain: your recovery phrase brings back your
        public account, your private balance and your Lovejoin boxes, here or in Seedelf Wallet on another device. What
        private sessions' one-time accounts hold doesn't show after a restore yet: bring it back first.
      </p>
      {held && (
        <Callout tone="warn" testId="remove-at-stake">
          {stake === null
            ? "Seedelf Wallet couldn't check what's still open, which removing it would leave behind."
            : "Still open, which removing the wallet leaves behind:"}
          {!!stake?.length && (
            <ul className="dapp-points">
              {atStakeLines(stake).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {held && (
        <div className="setting-row">
          <span id="remove-anyway-label">Remove it anyway, leaving that behind</span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={anyway}
            aria-labelledby="remove-anyway-label"
            onClick={() => setAnyway(!anyway)}
            disabled={busy}
          />
        </div>
      )}
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
