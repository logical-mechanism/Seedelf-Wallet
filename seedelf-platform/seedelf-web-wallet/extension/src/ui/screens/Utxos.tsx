// UTxOs: one balance's UTxOs, kept ones first, then largest first, from the
// last reading (no requests; Refresh reads the chain again). The lock at the
// end of a row locks or unlocks it at once; the row opens its details, which
// have Lock too. A locked UTxO is left out of every payment on its side, Max
// included. The Cardano account's collateral is listed too, and reclaimed in
// Settings; a seedelf's UTxO only ever moves when the seedelf is removed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { UtxoInfo, UtxoLists, UtxoSide } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyField } from "../components/CopyField";
import { CoinsIcon, LockIcon, LockOpenIcon, SearchIcon, SproutIcon, VaultIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { formatAda, plural, shortHex, tokenKey } from "../format";
import { useNetwork } from "../network";
import { searchTokens, sortTokens, viewToken } from "../tokens";

const ref = (u: UtxoInfo) => `${u.txHash}#${u.index}`;

/** What a UTxO is kept for, if anything. */
function tag(u: UtxoInfo): string | undefined {
  if (u.seedelf) return "Seedelf";
  if (u.collateral) return "Collateral";
  if (u.locked) return "Locked";
  return undefined;
}

/** A seedelf's UTxO and the collateral aren't locked or unlocked by hand. */
const lockable = (u: UtxoInfo) => !u.seedelf && !u.collateral;

function Icon({ u }: { u: UtxoInfo }) {
  if (u.seedelf) return <SproutIcon size={16} />;
  if (u.collateral) return <VaultIcon size={16} />;
  return <CoinsIcon size={16} />;
}

/** Kept ones first, so they're found among hundreds; each group largest first, as the worker sends them. */
const arrange = (all: UtxoInfo[]) => [...all.filter((u) => tag(u)), ...all.filter((u) => !tag(u))].map(ref);

export function Utxos({ of, onBack, onChanged }: { of: UtxoSide; onBack: () => void; onChanged: () => void }) {
  const [lists, setLists] = useState<UtxoLists>();
  // The order is set when the list is read, so a row stays put while it's locked and unlocked.
  const [order, setOrder] = useState<string[]>([]);
  const [open, setOpen] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();
  // Home's callback is new on every render; reading it through a ref keeps `read` (and the effect) stable.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });

  const read = useCallback(
    async (refresh: boolean) => {
      setRefreshing(refresh);
      setError(undefined);
      try {
        const next = await call("utxos", { refresh });
        setLists(next);
        setOrder(arrange(next[of]));
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
  const shown = list?.find((u) => ref(u) === open);

  async function setLocked(u: UtxoInfo, lock: boolean) {
    setSaving(ref(u));
    setError(undefined);
    try {
      setLists(await call("utxo-lock", { of, utxo: ref(u), locked: lock }));
      changed.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <Screen
      title={of === "seedelf" ? "Private UTxOs" : "Public UTxOs"}
      titleId="utxos-title"
      onBack={onBack}
      aside={list ? `${plural(list.length, "UTxO")}${locked ? ` · ${locked} locked` : ""}` : " "}
      error={shown ? undefined : error}
    >
      <p className="note">Lock a UTxO to keep it out of every payment from this balance, Max included.</p>
      {of === "seedelf" && (
        <Callout tone="privacy">
          Only this wallet can tell these are yours. Looking one up on an explorer tells that site which UTxO you care
          about.
        </Callout>
      )}
      <RefreshRow reading={refreshing} updatedAt={lists?.updatedAt} onRefresh={() => void read(true)} />
      {list === undefined ? (
        <p className="note center empty">{error ? "" : "Reading…"}</p>
      ) : list.length === 0 ? (
        <p className="note center empty">No UTxOs yet.</p>
      ) : (
        <section className="section" aria-label="UTxOs">
          <ul className="list" data-testid="utxos">
            {list.map((u) => {
              const name = `${formatAda(u.lovelace)} ₳, ${shortHex(u.txHash)}#${u.index}`;
              return (
                <li key={ref(u)} className="utxo-row">
                  <button
                    type="button"
                    className="token-row"
                    onClick={() => setOpen(ref(u))}
                    aria-label={`${formatAda(u.lovelace)} ₳${tag(u) ? `, ${tag(u)}` : ""}, ${shortHex(u.txHash)}#${u.index}`}
                  >
                    <span className={`avatar activity__icon${tag(u) ? " utxo__icon--kept" : ""}`}>
                      <Icon u={u} />
                    </span>
                    <span className="token-row__label">
                      {formatAda(u.lovelace)} ₳{u.tokens.length ? ` and ${plural(u.tokens.length, "token")}` : ""}
                    </span>
                    <span className="token-row__amount">
                      {!lockable(u) && <span className="utxo-tag">{tag(u)}</span>}
                    </span>
                    <span className="token-row__sub">
                      {shortHex(u.txHash, 8, 4)}#{u.index}
                    </span>
                  </button>
                  {lockable(u) ? (
                    <button
                      type="button"
                      className="icon-button utxo-row__lock"
                      aria-pressed={u.locked}
                      aria-label={`Lock ${name}`}
                      title={u.locked ? "Locked: tap to spend it again" : "Lock: keep it out of payments"}
                      onClick={() => void setLocked(u, !u.locked)}
                      disabled={saving === ref(u)}
                    >
                      {u.locked ? <LockIcon size={16} /> : <LockOpenIcon size={16} />}
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
          utxo={shown}
          busy={saving === ref(shown)}
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

function UtxoDetails({
  utxo,
  busy,
  error,
  onLock,
  onClose,
}: {
  utxo: UtxoInfo;
  busy: boolean;
  error?: string;
  onLock: (lock: boolean) => void;
  onClose: () => void;
}) {
  const foot = lockable(utxo) ? (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className={utxo.locked ? "secondary" : "primary"} onClick={() => onLock(!utxo.locked)} disabled={busy}>
        {utxo.locked ? <LockOpenIcon size={16} /> : <LockIcon size={16} />}
        {busy ? "Saving…" : utxo.locked ? "Unlock" : "Lock"}
      </button>
    </>
  ) : undefined;
  return (
    <Modal title={`${formatAda(utxo.lovelace)} ₳`} titleId="utxo-details-title" onClose={onClose} foot={foot}>
      <div className="stack" data-testid="utxo-details">
        {utxo.seedelf ? (
          <>
            <Callout tone="info">
              {utxo.seedelf.label ? (
                <>
                  It holds your Seedelf <strong>{utxo.seedelf.label}</strong>.
                </>
              ) : (
                "It holds one of your Seedelfs."
              )}{" "}
              Only removing the Seedelf spends it.
            </Callout>
            <CopyField
              label="Seedelf name"
              value={utxo.seedelf.name}
              display={shortHex(utxo.seedelf.name, 14, 8)}
              testId="utxo-seedelf-name"
            />
          </>
        ) : utxo.collateral ? (
          <Callout tone="info" testId="utxo-collateral">
            Your collateral: put up by transactions that run a script, and otherwise kept. Reclaim it in Settings, under
            Collateral.
          </Callout>
        ) : (
          <p className="note" data-testid="utxo-state">
            {utxo.locked ? "Locked: left out of every payment." : "Spent by payments as needed."}
          </p>
        )}
        <UtxoTokens tokens={utxo.tokens} />
        <CopyField label="Transaction" value={utxo.txHash} display={shortHex(utxo.txHash, 14, 8)} testId="utxo-tx" />
        <ReviewRows testId="utxo-output">
          <Row label="Output" value={String(utxo.index)} />
          {utxo.blockHeight !== undefined && <Row label="Block" value={utxo.blockHeight.toLocaleString("en-GB")} />}
        </ReviewRows>
        {utxo.address && (
          <CopyField label="Address" value={utxo.address} display={shortHex(utxo.address, 16, 8)} testId="utxo-address" />
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
  const network = useNetwork();
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const views = useMemo(() => sortTokens(tokens.map((t) => viewToken(network, t)), "name"), [network, tokens]);
  if (!views.length) return null;
  const shown = all ? searchTokens(views, query) : views.slice(0, PREVIEW);
  return (
    <div className="stack-tight" data-testid="utxo-tokens">
      <span className="label">{plural(views.length, "token")}</span>
      {all && views.length > SEARCH_FROM && (
        <label className="search">
          <SearchIcon size={16} />
          <input
            type="search"
            aria-label="Search this UTxO's tokens"
            placeholder="Name, ticker or ID"
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
              <Row key={tokenKey(v.token)} label={v.label} value={v.amount} title={v.sub} />
            ))}
          </ReviewRows>
        ) : (
          <p className="note center">No token matches.</p>
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
          {all ? "Show fewer" : `Show all ${views.length} tokens`}
        </button>
      )}
    </div>
  );
}
