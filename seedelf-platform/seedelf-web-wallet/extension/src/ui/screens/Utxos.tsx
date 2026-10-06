// UTxOs: one balance's UTxOs, kept ones first, then largest first, from the
// last reading (no requests; Refresh reads the chain again). The lock at the
// end of a row locks or unlocks it at once; the row opens its details, which
// have Lock too. A locked UTxO is left out of every payment on its side, Max
// included, and a site's transaction can't spend one either. The Cardano
// account's collateral is listed too, and reclaimed in Settings; a seedelf's
// UTxO only ever moves when the seedelf is removed. A UTxO no transaction of
// the wallet can take (a reference script) is marked so, never offered.
// Each private UTxO says where its money came from, as the sealed history
// has it, so locking one to keep a history apart is an informed choice
// (privacy review §2.3).
//
// Chunk 23's second review, AC-4: a row's toggle is a pin, not the top bar's
// padlock, which locks the wallet; locking or unlocking one says it's done;
// and a public UTxO's details say whose its address is.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentLanguage, joinList, joinSentences, Rich, sentenceGap, t, useT } from "../../i18n";

import { historyTags } from "../../shared/histories";
import type { Incoming, UtxoInfo, UtxoLists, UtxoSide } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyField } from "../components/CopyField";
import { CoinsIcon, PinIcon, PinOffIcon, SearchIcon, SproutIcon, VaultIcon, WarnIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { shortHex, tokenKey } from "../format";
import { useAmounts } from "../preferences";
import { useNetwork } from "../network";
import { searchTokens, sortTokens, viewToken } from "../tokens";

const ref = (u: UtxoInfo) => `${u.txHash}#${u.index}`;

/** What a UTxO is kept for, if anything, or that no payment can take it. */
export function utxoTag(u: UtxoInfo): string | undefined {
  if (u.seedelf) return t("utxos.tag.seedelf");
  if (u.collateral) return t("utxos.tag.collateral");
  if (u.unspendable) return t("utxos.tag.unspendable");
  if (u.locked) return t("utxos.tag.locked");
  return undefined;
}
const tag = utxoTag;

/** Where a private UTxO's money came from: Back from Lovejoin, Received, Made private, Private session N, Unknown. */
export function historyOf(u: UtxoInfo, accounts = 1): string | undefined {
  return u.history ? joinList(historyTags(u.history, accounts)) : undefined;
}

/** A seedelf's UTxO, the collateral and one no payment can take aren't locked or unlocked by hand. */
const lockable = (u: UtxoInfo) => !u.seedelf && !u.collateral && !u.unspendable;

function Icon({ u }: { u: UtxoInfo }) {
  if (u.seedelf) return <SproutIcon size={16} />;
  if (u.collateral) return <VaultIcon size={16} />;
  if (u.unspendable) return <WarnIcon size={16} />;
  return <CoinsIcon size={16} />;
}

type MixProgress = { total: number; sent: number; stopped?: string } | null;

/**
 * Says a public mix through Lovejoin is being sent: what it spends, and the
 * change it makes, stay out of this list and the balance until it's all
 * sent, so they don't look gone.
 */
export function MixHolding({ progress }: { progress: MixProgress }) {
  const t = useT();
  if (!progress || progress.stopped || progress.sent >= progress.total) return null;
  return (
    <Callout tone="info" testId="utxos-mix-holding">
      {t("utxos.mixHolding", { sent: progress.sent, total: progress.total })}
    </Callout>
  );
}

/**
 * What the wallet's own transactions on their way pay back to this side, all of them together, which no reading
 * lists yet: Home's figure (Balances' `incoming`, background/incoming.ts), passed in, so nothing more is asked of the
 * worker or Koios. Without it, during a pending send the list had dropped the UTxO spent and didn't show the change,
 * adding up to less than Home with nothing to say why (blind test T08). A line, not rows: none of it can be locked,
 * opened or spent until it's on chain.
 */
export function IncomingHere({ incoming }: { incoming?: Incoming }) {
  const t = useT();
  const amounts = useAmounts();
  if (!incoming || incoming.utxos === 0) return null;
  const what = incoming.tokens.length
    ? t("format.adaAndTokens", { ada: amounts.ada(incoming.lovelace), count: incoming.tokens.length })
    : `${amounts.ada(incoming.lovelace)}\u00a0₳`;
  return (
    <Callout tone="info" testId="utxos-incoming">
      {t("utxos.incoming", { what, count: incoming.utxos })}
    </Callout>
  );
}

/** Why the wallet can't spend a UTxO marked `unspendable`, on its side. */
export function unspendableWhy(of: UtxoSide): string {
  return t(of === "seedelf" ? "utxos.warn.unspendablePrivate" : "utxos.warn.unspendablePublic");
}

/** Kept ones first, so they're found among hundreds; each group largest first, as the worker sends them. */
const arrange = (all: UtxoInfo[]) => [...all.filter((u) => tag(u)), ...all.filter((u) => !tag(u))].map(ref);

export function Utxos({
  of,
  incoming,
  onBack,
  onChanged,
}: {
  of: UtxoSide;
  /** What's on its way back to this side, as Home has it: said above the list (`IncomingHere`). */
  incoming?: Incoming;
  onBack: () => void;
  onChanged: () => void;
}) {
  const amounts = useAmounts();
  // Private UTxOs name which public account money was made private from, once
  // there is more than one to tell apart (chunk 18): locking one to keep an
  // account's money apart is then an informed choice.
  const { accounts } = useAccounts();
  const [lists, setLists] = useState<UtxoLists>();
  // The order is set when the list is read, so a row stays put while it's locked and unlocked.
  const [order, setOrder] = useState<string[]>([]);
  const [open, setOpen] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();
  // The last lock or unlock, said for a few seconds: it changed nothing else on screen but an icon (AC-4).
  const [done, setDone] = useState<{ locked: boolean }>();
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(undefined), 6_000);
    return () => clearTimeout(timer);
  }, [done]);
  // Home's callback is new on every render; reading it through a ref keeps `read` (and the effect) stable.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });

  // A public mix being sent holds what it spends, and its change, out of this list until it's all sent.
  const [mix, setMix] = useState<MixProgress>(null);

  const read = useCallback(
    async (refresh: boolean) => {
      setRefreshing(refresh);
      setError(undefined);
      try {
        const next = await call("utxos", { refresh });
        setLists(next);
        setOrder(arrange(next[of]));
        if (of === "cardano") setMix(await call("lovejoin-mix-public-progress", {}).catch(() => null));
        if (refresh) changed.current();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setRefreshing(false);
      }
    },
    [of],
  );
  useEffect(() => void read(false), [read]);

  const list = useMemo(() => {
    const byRef = new Map((lists?.[of] ?? []).map((u) => [ref(u), u]));
    return lists && order.flatMap((r) => byRef.get(r) ?? []);
  }, [lists, of, order]);
  const locked = list?.filter((u) => u.locked && !u.seedelf).length ?? 0;
  const stuck = list?.filter((u) => u.unspendable).length ?? 0;
  const shown = list?.find((u) => ref(u) === open);

  async function setLocked(u: UtxoInfo, lock: boolean) {
    setSaving(ref(u));
    setError(undefined);
    try {
      setLists(await call("utxo-lock", { of, utxo: ref(u), locked: lock }));
      setDone({ locked: lock });
      changed.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <Screen
      title={t(of === "seedelf" ? "utxos.titlePrivate" : "utxos.titlePublic")}
      titleId="utxos-title"
      onBack={onBack}
      hint={joinSentences([t("utxos.lockNote"), of === "cardano" && t("utxos.lockNoteSite")])}
      hintTestId="utxos-lock-note"
      aside={list ? `${t("amount.utxos", { count: list.length })}${locked ? t("utxos.lockedMeta", { count: locked }) : ""}` : " "}
      error={shown ? undefined : error}
    >
      {of === "cardano" && <MixHolding progress={mix} />}
      <IncomingHere incoming={incoming} />
      {stuck > 0 && (
        <Callout tone="warn" testId="utxos-unspendable">
          {t("utxos.warn.someUnspendable", { count: stuck })}
        </Callout>
      )}
      {of === "seedelf" && (
        <Callout tone="privacy">{t("utxos.privacy.onlyThisWallet")}</Callout>
      )}
      <RefreshRow reading={refreshing} updatedAt={lists?.updatedAt} onRefresh={() => void read(true)} />
      {done && !shown && <LockDone locked={done.locked} />}
      {list === undefined ? (
        <p className="note center empty">{error ? "" : t("activity.reading")}</p>
      ) : list.length === 0 ? (
        <p className="note center empty">{t("utxos.empty")}</p>
      ) : (
        <section className="section" aria-label={t("utxos.listLabel")}>
          <ul className="list" data-testid="utxos">
            {list.map((u) => {
              const name = joinList([`${amounts.ada(u.lovelace)}\u00a0₳`, `${shortHex(u.txHash)}#${u.index}`]);
              const history = historyOf(u, accounts.length);
              return (
                <li key={ref(u)} className="utxo-row">
                  <button
                    type="button"
                    className="token-row"
                    onClick={() => setOpen(ref(u))}
                    aria-label={joinList(
                      [`${amounts.ada(u.lovelace)}\u00a0₳`, tag(u), history, `${shortHex(u.txHash)}#${u.index}`].filter((x): x is string => !!x),
                    )}
                  >
                    <span className={`avatar activity__icon${tag(u) ? " utxo__icon--kept" : ""}`}>
                      <Icon u={u} />
                    </span>
                    <span className="token-row__label">
                      {u.tokens.length
                        ? t("format.adaAndTokens", { ada: amounts.ada(u.lovelace), count: u.tokens.length })
                        : `${amounts.ada(u.lovelace)}\u00a0₳`}
                    </span>
                    <span className="token-row__amount">
                      {!lockable(u) && <span className="utxo-tag">{tag(u)}</span>}
                    </span>
                    <span className="token-row__sub">
                      {shortHex(u.txHash, 8, 4)}#{u.index}
                      {history && <span data-testid="utxo-history"> · {history}</span>}
                    </span>
                  </button>
                  {lockable(u) ? (
                    <button
                      type="button"
                      className="icon-button utxo-row__lock"
                      aria-pressed={u.locked}
                      aria-label={t("utxos.lock.lockOne", { name })}
                      title={t(u.locked ? "utxos.lock.locked" : "utxos.lock.lock")}
                      onClick={() => void setLocked(u, !u.locked)}
                      disabled={saving === ref(u)}
                    >
                      <PinIcon size={16} />
                    </button>
                  ) : (
                    <span className="utxo-row__lock" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {shown && (
        <UtxoDetails
          of={of}
          utxo={shown}
          busy={saving === ref(shown)}
          done={done}
          error={error}
          onLock={(lock) => void setLocked(shown, lock)}
          onClose={() => {
            setOpen(undefined);
            setError(undefined);
          }}
        />
      )}
    </Screen>
  );
}

/** That a lock or an unlock was kept, and what it means. */
function LockDone({ locked }: { locked: boolean }) {
  const t = useT();
  return (
    <p className="note" role="status" data-testid="utxo-lock-done">
      {t(locked ? "utxos.lock.done.locked" : "utxos.lock.done.unlocked")}
    </p>
  );
}

export function UtxoDetails({
  of,
  utxo,
  busy,
  done,
  error,
  onLock,
  onClose,
}: {
  of: UtxoSide;
  utxo: UtxoInfo;
  busy: boolean;
  /** The lock or unlock just kept, to say so. */
  done?: { locked: boolean };
  error?: string;
  onLock: (lock: boolean) => void;
  onClose: () => void;
}) {
  const amounts = useAmounts();
  // The account its money was made private from, as its row names it: here is where locking it is decided.
  const { accounts } = useAccounts();
  const foot = lockable(utxo) ? (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && !error && <LockDone locked={done.locked} />}
      <button type="button" className={utxo.locked ? "secondary" : "primary"} onClick={() => onLock(!utxo.locked)} disabled={busy}>
        {utxo.locked ? <PinOffIcon size={16} /> : <PinIcon size={16} />}
        {t(busy ? "utxos.lock.saving" : utxo.locked ? "utxos.lock.unlockIt" : "utxos.lock.lockIt")}
      </button>
    </>
  ) : undefined;
  return (
    <Modal title={`${amounts.ada(utxo.lovelace)}\u00a0₳`} titleId="utxo-details-title" onClose={onClose} foot={foot}>
      <div className="stack" data-testid="utxo-details">
        {utxo.seedelf ? (
          <>
            <Callout tone="info">
              {utxo.seedelf.label ? (
                <Rich k="utxos.holdsSeedelfNamed" parts={{ name: <strong>{utxo.seedelf.label}</strong> }} />
              ) : (
                t("utxos.holdsSeedelf")
              )}
              {sentenceGap()}
              {t("utxos.onlyRemoveSpends")}
            </Callout>
            <CopyField
              label={t("utxos.seedelfName")}
              copyLabel={t("utxos.copySeedelfName")}
              value={utxo.seedelf.name}
              display={shortHex(utxo.seedelf.name, 14, 8)}
              testId="utxo-seedelf-name"
            />
          </>
        ) : utxo.collateral ? (
          <Callout tone="info" testId="utxo-collateral">
            {t("utxos.collateralNote")}
          </Callout>
        ) : utxo.unspendable ? (
          <Callout tone="warn" testId="utxo-unspendable">
            {unspendableWhy(of)}
          </Callout>
        ) : (
          <p className="note" data-testid="utxo-state">
            {t(utxo.locked ? "utxos.state.locked" : "utxos.state.spendable")}
          </p>
        )}
        <UtxoTokens tokens={utxo.tokens} />
        <CopyField
          label={t("utxos.transaction")}
          copyLabel={t("utxos.copyTransaction")}
          value={utxo.txHash}
          display={shortHex(utxo.txHash, 14, 8)}
          testId="utxo-tx"
        />
        {utxo.history && (
          <p className="note" data-testid="utxo-history-note">
            {t("utxos.privacy.cameFrom", { history: historyOf(utxo, accounts.length) })}
          </p>
        )}
        <ReviewRows testId="utxo-output">
          <Row label={t("utxos.output")} value={String(utxo.index)} />
          {utxo.blockHeight !== undefined && <Row label={t("utxos.block")} value={utxo.blockHeight.toLocaleString("en-GB")} />}
        </ReviewRows>
        {utxo.address && (
          <CopyField
            label={t("utxos.address")}
            copyLabel={t("utxos.copyAddress")}
            value={utxo.address}
            display={shortHex(utxo.address, 16, 8)}
            testId="utxo-address"
          />
        )}
        {/* Whose it is: often not the Receive address, which said nothing of why (AC-4). */}
        {utxo.address && utxo.path && (
          <p className="note" data-testid="utxo-address-whose">
            {t(
              utxo.path.role === 1
                ? "utxos.addressWhose.change"
                : utxo.path.index === 0
                  ? "utxos.addressWhose.receive"
                  : "utxos.addressWhose.other",
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** How many of a UTxO's tokens its details show before Show all. */
const PREVIEW = 5;
/** From this many tokens, Show all has a search. */
const SEARCH_FROM = 10;

/**
 * A UTxO's tokens, by name: the first five, then Show all, which lists them
 * all in a box of its own height, scrolling, with a search when there are
 * many. So a UTxO holding hundreds doesn't stretch its details.
 */
function UtxoTokens({ tokens }: { tokens: UtxoInfo["tokens"] }) {
  const t = useT();
  const network = useNetwork();
  const amounts = useAmounts();
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  // A lookalike's second line is words: made again when another page switches the language.
  const language = currentLanguage();
  const views = useMemo(() => sortTokens(tokens.map((t) => viewToken(network, t)), "name"), [network, tokens, language]);
  if (!views.length) return null;
  const shown = all ? searchTokens(views, query) : views.slice(0, PREVIEW);
  return (
    <div className="stack-tight" data-testid="utxo-tokens">
      <span className="label">{t("tokens.count", { count: views.length })}</span>
      {all && views.length > SEARCH_FROM && (
        <label className="search">
          <SearchIcon size={16} />
          <input
            type="search"
            aria-label={t("utxos.searchTokens")}
            placeholder={t("tokens.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      <div className={all ? "utxo-tokens utxo-tokens--all" : "utxo-tokens"}>
        {shown.length ? (
          <ReviewRows testId="utxo-token-rows">
            {shown.map((v) => (
              <Row key={tokenKey(v.token)} label={v.label} value={amounts.text(v.amount)} title={v.sub} />
            ))}
          </ReviewRows>
        ) : (
          <p className="note center">{t("utxos.noTokenMatch")}</p>
        )}
      </div>
      {views.length > PREVIEW && (
        <button
          type="button"
          className="view-all"
          onClick={() => {
            setAll(!all);
            setQuery("");
          }}
        >
          {all ? t("utxos.showFewer") : t("utxos.showAll", { number: views.length })}
        </button>
      )}
    </div>
  );
}
