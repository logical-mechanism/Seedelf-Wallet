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
import {
  availableLanguages,
  currentLanguage,
  type I18nKey,
  joinList,
  joinSentences,
  type LanguageCode,
  Rich,
  sentenceGap,
  setLanguage,
  t,
  useT,
} from "../../i18n";

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
import {  } from "../format";
import { accountName, useAccounts } from "../accounts";
import { confirmsDelete, deletePhrase } from "../delete-phrase";
import { usePreferences } from "../preferences";
import { asSentence } from "../sentence";
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
const CURRENCY_NAMES = {
  usd: "settings.currency.usd",
  eur: "settings.currency.eur",
  gbp: "settings.currency.gbp",
  jpy: "settings.currency.jpy",
  cad: "settings.currency.cad",
  aud: "settings.currency.aud",
  chf: "settings.currency.chf",
  brl: "settings.currency.brl",
} as const satisfies Record<(typeof CURRENCIES)[number], I18nKey>;

const lockLabel = (m: LockAfterMinutes) =>
  t(m === 60 ? "settings.lock.hour" : m === 1 ? "settings.lock.minute" : "settings.lock.minutes", { count: m });

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
    <Screen title={t("app.settings")} titleId="settings-title" onBack={onBack}>
      <NetworkSection status={status} onMoved={onNetwork} />
      <section className="section" aria-labelledby="wallet-title">
        <h2 id="wallet-title">{t("settings.wallet")}</h2>
        <ul className="list">
          <MenuRow icon={<WalletIcon size={16} />} label={t("accounts.title")} onClick={() => setPage("accounts")} />
          <MenuRow icon={<UsersIcon size={16} />} label={t("contacts.title")} onClick={() => setPage("contacts")} />
          <MenuRow icon={<VaultIcon size={16} />} label={t("utxos.tag.collateral")} onClick={() => setPage("collateral")} />
        </ul>
      </section>
      <PreferencesSection network={status.network} />
      <DappConnector blocked={status.connectorBlocked} onSites={() => setPage("sites")} />
      {lovejoinOn(status.network) && <LovejoinSettings network={status.network} />}
      <SpendRewards />
      <section className="section" aria-labelledby="security-title">
        <h2 id="security-title">{t("settings.security")}</h2>
        <LockAfter />
        <ul className="list">
          <MenuRow icon={<EyeIcon size={16} />} label={t("settings.showPhrase")} onClick={() => setPage("phrase")} />
          <MenuRow icon={<CheckIcon size={16} />} label={t("settings.checkPhrase")} onClick={() => setPage("check-phrase")} />
          <MenuRow icon={<LockIcon size={16} />} label={t("settings.changePassword")} onClick={() => setPage("password")} />
          <MenuRow icon={<TrashIcon size={16} />} label={t("settings.removeWallet")} onClick={() => setPage("remove")} danger />
        </ul>
      </section>
      <section className="section" aria-labelledby="about-title">
        <h2 id="about-title">{t("settings.about")}</h2>
        <ReviewRows testId="about">
          <Row label={t("settings.version")} value={status.version} />
          <Row label={t("network.label")} value={NETWORKS[status.network].label} />
        </ReviewRows>
        <a className="menu-link" href={SOURCE} target="_blank" rel="noreferrer">
          {t("settings.sourceCode")} <ExternalIcon size={12} />
        </a>
        <a className="menu-link" href={PRIVACY} target="_blank" rel="noreferrer">
          {t("settings.privacyPolicy")} <ExternalIcon size={12} />
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
          ? t("accounts.foundAccount", { number: indexes[0]! + 1 })
          : t("accounts.nextNeverUsed", { network: NETWORKS[network].label }),
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
          ? t("accounts.hasBeenUsed", { number: index + 1, network: NETWORKS[network].label })
          : t("accounts.neverUsed", { number: index + 1, network: NETWORKS[network].label }),
      );
      if (!used) setUnused(index);
    });
  };

  const addOne = (index: number) =>
    run("check", async () => {
      await call("account-add", { index });
      setFound(t("accounts.inListNow", { number: index + 1 }));
      setNumber("");
    });

  return (
    <Screen title={t("accounts.title")} titleId="accounts-title" onBack={onBack}>
      <section className="section" aria-labelledby="accounts-list-title">
        {/* The count, because the list scrolls: a row cut off at the bottom
            edge otherwise reads as clipped rather than as more below. */}
        <h2 id="accounts-list-title">
          {t("accounts.heading")}
          {accounts.length > 1 && (
            <span className="section__count">
              {" · "}
              {shown.length === accounts.length ? accounts.length : t("accounts.shownOf", { shown: shown.length, total: accounts.length })}
            </span>
          )}
        </h2>
        {accounts.length > FILTER_FROM && (
          <label className="search" data-testid="accounts-filter">
            <SearchIcon size={16} />
            <input
              type="search"
              aria-label={t("accounts.find")}
              placeholder={t("accounts.findPlaceholder")}
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
                    {t("accounts.whatToCall", { number: a.index + 1 })}
                  </label>
                  <input
                    id={`account-name-${a.index}`}
                    value={draft}
                    maxLength={24}
                    autoFocus
                    placeholder={t("accountPicker.numbered", { number: a.index + 1 })}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button type="submit" className="secondary" disabled={busy !== undefined}>
                    {t("contacts.save")}
                  </button>
                  <button type="button" className="link" onClick={() => setNaming(undefined)}>
                    {t("common.cancel")}
                  </button>
                </form>
              ) : (
                <div className="account-row__name">
                  <span>
                    {accountName(a)}
                    {a.index === active && (
                      <span className="account-row__active" data-testid={`account-active-${a.index}`}>
                        {" "}
                        · {t("accounts.workingOnThis")}
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
                        {busy === "switch" ? t("accounts.switching") : t("accounts.switchTo")}
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
                      {t(a.name ? "accounts.rename" : "accounts.nameIt")}
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!shown.length && (
          <p className="note center empty" data-testid="accounts-none">
            {t("accounts.noneMatch", { query: query.trim() })}
          </p>
        )}
        <p className="note" data-testid="accounts-note">
          {t("accounts.note")}
        </p>
        <p className="note" data-testid="accounts-private-note">
          {t("accounts.privacy.sharedBalance")}
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => void look()} disabled={busy !== undefined}>
            {busy === "look" ? t("vote.looking") : t("accounts.lookForNext")}
          </button>
        </div>
        <form
          className="account-number"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            checkOne();
          }}
        >
          <label htmlFor="account-number">{t("accounts.numberLabel")}</label>
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
            {busy === "check" ? t("vote.looking") : t("accounts.checkIt")}
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
            {t("accounts.addIt")}
          </button>
        </form>
        <p className="note" data-testid="accounts-cost-note">
          <Rich
            k="accounts.privacy.koiosCost"
            parts={{
              look: <strong>{t("accounts.lookForNext")}</strong>,
              check: <strong>{t("accounts.checkIt")}</strong>,
              add: <strong>{t("accounts.addIt")}</strong>,
            }}
          />
        </p>
        <p className="note" data-testid="accounts-custom-note">
          {t("accounts.customNote")}
        </p>
        {unused !== undefined && (
          <div className="actions" data-testid="accounts-add-unused">
            <button type="button" className="primary" onClick={() => void addOne(unused)} disabled={busy !== undefined}>
              {t("accounts.addAnyway", { number: unused + 1 })}
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
  return joinSentences([
    t(prices ? "settings.privacy.talksToPrices" : "settings.privacy.talksTo"),
    t("settings.privacy.eachSeesIp"),
    t("settings.privacy.giveme"),
    lovejoin && LOVEJOIN_SEEN(),
  ]);
}

/**
 * What moving to each network says first, before the wallet moves, in a
 * warning callout. Both keys say so in their names (`.privacy.`, `.warn.`):
 * the callout shows `MOVE_TO[asking]`, which the critical-set deriver can't
 * read through.
 */
export const MOVE_TO: Record<NetworkName, string> = {
  // Getters, as NETWORK_NOTE's are, so the shape everything reads stays a
  // Record<NetworkName, string> while the words come from the current language.
  get preprod() {
    return t("settings.privacy.moveToPreprod");
  },
  get mainnet() {
    return t("settings.warn.moveToMainnet");
  },
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
      <h2 id="network-title">{t("network.label")}</h2>
      <Choice<NetworkName>
        label={t("network.ariaLabel")}
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
            {t("settings.network.carriesOn", { network: current.label })}
          </p>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setAsking(undefined)} disabled={busy}>
              {t("settings.network.stayOn", { network: current.label })}
            </button>
            <button type="button" className="primary" onClick={() => void move(asking)} disabled={busy}>
              {busy ? t("accounts.switching") : t("settings.network.switchTo", { network: NETWORKS[asking].label })}
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
      <h2 id="preferences-title">{t("settings.preferences")}</h2>
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
          {t("settings.language.warn.unchecked")}
          {sentenceGap()}
          <a className="link" href={ISSUES} target="_blank" rel="noreferrer">
            {t("settings.language.report")}
          </a>
        </p>
      </div>
      {openIn && (
        <div className="stack-tight">
          <Choice<OpenIn>
            label={t("settings.openIn")}
            id="open-in-label"
            options={[
              { value: "tab", label: t("settings.openIn.tab") },
              { value: "panel", label: t("settings.openIn.panel") },
            ]}
            value={openIn}
            onChange={chooseOpenIn}
          />
          <p className="note" data-testid="open-in-note">
            {joinSentences([
              t(openIn === "panel" ? "settings.openIn.panelNote" : "settings.openIn.tabNote"),
              openIn === "panel" && view === "tab" && t("settings.openIn.useButton"),
            ])}
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="currency">{t("settings.currency.label")}</label>
        <select
          id="currency"
          value={prefs.currency}
          disabled={!loaded}
          onChange={(e) => void set({ currency: e.target.value as Currency }).catch((err: Error) => setError(err.message))}
        >
          <option value="off">{t("settings.currency.off")}</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {t(CURRENCY_NAMES[c])}
            </option>
          ))}
        </select>
        <p className="note" data-testid="currency-note">
          {t(
            priced
              ? prefs.currency === "off"
                ? "settings.currency.privacy.none"
                : "settings.currency.privacy.coingecko"
              : "settings.currency.mainnetOnly",
          )}
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
  return t("settings.lovejoin.depthCost", { count: mixes, ada: (lovelace / 1_000_000).toFixed(1) });
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
      <h2 id="lovejoin-settings-title">{t("settings.lovejoin")}</h2>
      <p className="note">
        {joinSentences([t("settings.lovejoin.note"), floor > 0 && t("settings.lovejoin.floor", { count: floor }), LOVEJOIN_SEEN()])}
      </p>
      <Callout tone="warn" testId="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED()}
      </Callout>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="lovejoin-returns-label">{t("settings.lovejoin.returns")}</span>
          <span className="note" id="lovejoin-returns-note" data-testid="lovejoin-returns-note">
            {on
              ? t("settings.lovejoin.returnsOn")
              : t("settings.lovejoin.privacy.returnsOff", { cost: depthCost(network, prefs.lovejoinDepth) })}
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
        <label htmlFor="lovejoin-depth">{t("settings.lovejoin.depth")}</label>
        <select
          id="lovejoin-depth"
          value={prefs.lovejoinDepth}
          disabled={!loaded || !on}
          onChange={(e) => void set({ lovejoinDepth: Number(e.target.value) as LovejoinDepth }).catch(fail)}
        >
          {LOVEJOIN_DEPTHS.map((d) => (
            <option key={d} value={d}>
              {t("settings.lovejoin.depthOption", { count: d, cost: depthCost(network, d), one: 3 ** d })}
            </option>
          ))}
        </select>
        <p className="note" data-testid="lovejoin-hides">
          {lovejoinHides(prefs.lovejoinDepth)}
        </p>
      </div>
      <div className="field">
        <label htmlFor="lovejoin-delay">{t("settings.lovejoin.delay")}</label>
        <select
          id="lovejoin-delay"
          value={prefs.lovejoinDelay}
          disabled={!loaded || !on}
          onChange={(e) => void set({ lovejoinDelay: e.target.value as LovejoinDelay }).catch(fail)}
        >
          {LOVEJOIN_DELAYS.map((d) => (
            <option key={d} value={d}>
              {t("settings.lovejoin.delayOption", { delay: delayText(d) })}
            </option>
          ))}
        </select>
        <p className="note">
          {t("settings.lovejoin.delayNote")}
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
      <label htmlFor="lock-after">{t("settings.lockAfter")}</label>
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
            {t("settings.lockAfterOption", { time: lockLabel(m) })}
          </option>
        ))}
      </select>
      <p className="note">{t("settings.closingLocks")}</p>
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
          setError(t("settings.sites.warn.notGranted"));
          return;
        }
        await set({ dappConnector: true });
      },
      (e: Error) => setError(e.message),
    );
  }

  return (
    <section className="section" aria-labelledby="dapp-settings-title">
      <h2 id="dapp-settings-title">{t("settings.sites")}</h2>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="dapp-connector-label">{t("settings.sites.connector")}</span>
          <span className="note" id="dapp-connector-note" data-testid="dapp-connector-note">
            {blocked
              ? connectorBlockedText()
              : t(on ? "settings.sites.privacy.on" : "settings.sites.privacy.off")}
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
              {t("settings.sites.account")}
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
            {t("settings.sites.privacy.account")}
          </p>
        </div>
      )}
      <div className="setting-row">
        <span className="stack-tight">
          <span id="dapp-password-label">{t("settings.sites.password")}</span>
          <span className="note" id="dapp-password-note" data-testid="dapp-password-note">
            {t(!loaded || prefs.dappPassword ? "settings.sites.passwordOn" : "settings.sites.warn.passwordOff")}
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
        <MenuRow icon={<PlugIcon size={16} />} label={t("sites.title")} onClick={onSites} />
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
export const connectorBlockedText = () => t("settings.sites.warn.blocked");

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
    <Screen title={t("sites.title")} titleId="sites-title" onBack={onBack} aside={t("settings.encryptedHere")} error={error}>
      {sites?.length === 0 && (
        <p className="note center" data-testid="sites-empty">
          {t("sites.empty")}
        </p>
      )}
      {!!sites?.length && <SiteRows sites={sites} sessions={sessions} busy={busy} onDisconnect={setAsking} />}
      <p className="note">
        {t("sites.note")}
      </p>
      {asking && (
        <Modal
          title={t("sites.disconnectAsk", { site: host(asking) })}
          titleId="sites-disconnect-title"
          onClose={() => setAsking(undefined)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setAsking(undefined)}>
                {t("sites.keepIt")}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void forget(asking.origin)}
                data-testid="sites-disconnect-confirm"
              >
                {t("sites.disconnectIt")}
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
                {s.session === undefined ? t("collateral.yourPublicAccount") : t("claim.session", { number: s.session + 1 })} ·{" "}
                {t("sites.since", { date: new Date(s.connectedAt).toLocaleDateString() })}
              </span>
              {s.cip95 && (
                <span className="note" data-testid="site-governance">
                  {t("sites.governance")}
                </span>
              )}
              {s.cip95Declined && (
                <span className="note" data-testid="site-governance-declined">
                  {t("sites.governanceDeclined")}
                </span>
              )}
              {wait && (
                <span className="note" data-testid="site-wait">
                  {/* The button's own title elsewhere, a sentence here: its full stop is the language's. */}
                  {t("common.sentence", { text: wait })}
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
              {t("sites.disconnect")}
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
    ? t("sites.disconnectText", { site })
    : t("sites.disconnectTextSession", { number: session + 1, site });
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
      <h2 id="staking-settings-title">{t("settings.staking")}</h2>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="spend-rewards-label">{t("settings.staking.useRewards")}</span>
          <span className="note" id="spend-rewards-note">
            {t(prefs?.spendRewards === false ? "settings.staking.rewardsWait" : "settings.staking.rewardsSpend")}
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
    <Screen title={t("contacts.title")} titleId="contacts-title" onBack={onBack} aside={t("settings.encryptedHere")}>
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
        title={t("settings.phrase.title")}
        titleId="phrase-title"
        onBack={onBack}
        foot={
          <button type="button" className="primary" onClick={onBack}>
            {t("common.done")}
          </button>
        }
      >
        <Callout tone="warn">
          {t("settings.phrase.warn.anyone")}
        </Callout>
        <PhraseGrid words={words} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t("settings.showPhrase")}
      titleId="phrase-title"
      onBack={onBack}
      backDisabled={busy}
      onSubmit={reveal}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!password || busy}>
          {busy ? t("settings.phrase.checking") : t("settings.phrase.show")}
        </button>
      }
    >
      <p className="note">{t("settings.phrase.enterPassword")}</p>
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
      setError(asSentence((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t("settings.checkPhrase")}
      titleId="check-phrase-title"
      onBack={onBack}
      backDisabled={busy}
      error={error}
      foot={
        <button type="button" className="primary" disabled={busy || words.some((w) => !w)} onClick={check}>
          {busy ? t("settings.phrase.checking") : t("settings.check.button")}
        </button>
      }
    >
      <p className="note">
        {t("settings.check.note")}
      </p>
      <div className="segmented" role="radiogroup" aria-label={t("restore.wordCount")}>
        {WORD_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === count}
            className={n === count ? "segmented__item segmented__item--on" : "segmented__item"}
            onClick={() => changeCount(n)}
          >
            {t("restore.words", { number: n })}
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
          {t("settings.check.match")}
        </Callout>
      )}
      {result === false && (
        <Callout tone="warn" testId="phrase-differs">
          {t("settings.check.warn.noMatch")}
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
      setError(t("settings.password.warn.currentFirst"));
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
        title={t("settings.changePassword")}
        titleId="password-title"
        onBack={onBack}
        foot={
          <button type="button" className="primary" onClick={onBack}>
            {t("common.done")}
          </button>
        }
      >
        <Callout tone="info" testId="password-changed">
          {t("settings.password.changed")}
        </Callout>
      </Screen>
    );
  }

  return (
    <Screen title={t("settings.changePassword")} titleId="password-title" onBack={onBack} backDisabled={busy} error={error}>
      <PasswordField id="current-password" label={t("settings.password.current")} value={current} onChange={setCurrent} />
      <SetPassword label={t("settings.password.new")} submitLabel={t("settings.changePassword")} busy={busy} onSubmit={change} />
    </Screen>
  );
}

/** A private session as Remove wallet's list names it: by its number, from 1, and a site's by its host. */
function sessionName(s: AtStake["sessions"][number]): string {
  const name = t("claim.sessionLower", { number: s.index + 1 });
  if (s.kind === "site" && s.origin) {
    return t("settings.remove.warn.sessionNamed", { name, host: new URL(s.origin).host });
  }
  if (s.kind === "mix") return t("settings.remove.warn.sessionNamed", { name, host: t("settings.remove.warn.aMix") });
  if (s.kind === "swap") return t("settings.remove.warn.sessionNamed", { name, host: t("settings.remove.warn.aSwap") });
  return name;
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
 *
 * Each line shows in the warning callout, built here rather than in its JSX,
 * so its key is named `.warn.`, and so are sessionName's: the critical-set
 * deriver reads only the JSX, and the name is what keeps them checked.
 */
export function atStakeLines(stake: AtStake[]): string[] {
  return stake.flatMap((s) => {
    const on = NETWORKS[s.network].label;
    const lines: string[] = [];
    if (s.unreadable) lines.push(t("settings.remove.warn.unreadable", { network: on }));
    if (s.maybeSent) {
      lines.push(t("settings.remove.warn.maybeSent", { network: on }));
    }
    const open = s.sessions.filter((x) => !x.leftBehind);
    if (open.length) {
      const names = joinList(open.map(sessionName));
      lines.push(t("settings.remove.warn.sessionsOpen", { network: on, count: open.length, names }));
    }
    const left = s.sessions.filter((x) => x.leftBehind);
    if (left.length) {
      lines.push(t("settings.remove.warn.leftBehind", { network: on, names: joinList(left.map(sessionName)) }));
    }
    if (s.chainSending) {
      lines.push(t("settings.remove.warn.chainSending", { network: on }));
    }
    if (s.mixMaybeSent) {
      lines.push(t("settings.remove.warn.mixMaybeSent", { network: on }));
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
  const confirmed = confirmsDelete(typed);
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
      title={t("settings.removeWallet")}
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
          {busy ? t("settings.remove.removing") : stake === undefined ? t("settings.phrase.checking") : t("settings.removeWallet")}
        </button>
      }
    >
      <p className="note" data-testid="remove-wallet-note">
        {t("settings.remove.note")}
      </p>
      {held && (
        <Callout tone="warn" testId="remove-at-stake">
          {t(stake === null ? "settings.remove.warn.cannotCheck" : "settings.remove.warn.stillOpen")}
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
          <span id="remove-anyway-label">{t("settings.remove.anyway")}</span>
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
        {t("settings.remove.warn.havePhrase")}
      </Callout>
      <div className="field">
        <label htmlFor="confirm-remove">
          <Rich k="reset.confirmLabel" parts={{ text: <strong>{deletePhrase()}</strong> }} />
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
