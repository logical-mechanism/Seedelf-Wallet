// The pool browser, after Lace's: every live pool, searched by ticker or pool
// ID and sorted by ticker, saturation, margin, cost or pledge. The list is
// the same for everyone, so the worker keeps it on the device for a day: no
// requests after the first. A pool opens its details, fresh (one request),
// and Stake builds the delegation for review. Pool names come with the
// details: the list has tickers only (Koios's pool_list), and asking for every
// name would cost several requests a day. Anyone can register a pool under
// any ticker, so a ticker live pools share is flagged, and every row shows
// enough of the pool ID to tell them apart (launch review #59).

import { useCallback, useEffect, useMemo, useState } from "react";
import { type I18nKey, useT } from "../../i18n";

import type { PoolDetails, PoolList, PoolRow } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { SearchIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { Screen } from "../components/Screen";
import { formatAda, formatPercent, plainName, poolLabel, sharedNames, sharing, shortId } from "../format";
import { initials, tint } from "../tokens";
import { PoolFacts } from "./Staking";

/** Rows shown at a time; "Show more" adds as many again. */
const PAGE = 50;

export type PoolSort = "ticker" | "saturation" | "margin" | "cost" | "pledge";

const SORTS = [
  { value: "ticker", label: "pools.sort.ticker" },
  { value: "saturation", label: "pools.sort.saturation" },
  { value: "margin", label: "pools.sort.margin" },
  { value: "cost", label: "pools.sort.cost" },
  { value: "pledge", label: "pools.sort.pledge" },
] as const satisfies Array<{ value: PoolSort; label: I18nKey }>;

/** Pools whose ticker or ID holds `query`, case aside. */
export function searchPools(pools: PoolRow[], query: string): PoolRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return pools;
  return pools.filter((p) => p.ticker?.toLowerCase().includes(q) || p.id.includes(q));
}

/** Sorted by `by`; ties, and pools with no ticker, fall back to the ticker, then the ID. */
export function sortPools(pools: PoolRow[], by: PoolSort): PoolRow[] {
  const byTicker = (a: PoolRow, b: PoolRow) =>
    (a.ticker ? 0 : 1) - (b.ticker ? 0 : 1) ||
    (a.ticker ?? "").localeCompare(b.ticker ?? "", "en", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
  const compare: Record<PoolSort, (a: PoolRow, b: PoolRow) => number> = {
    ticker: () => 0,
    saturation: (a, b) => a.saturation - b.saturation,
    margin: (a, b) => a.margin - b.margin,
    cost: (a, b) => Number(BigInt(a.cost) - BigInt(b.cost)),
    pledge: (a, b) => Number(BigInt(b.pledge) - BigInt(a.pledge)),
  };
  return [...pools].sort((a, b) => compare[by](a, b) || byTicker(a, b));
}

export function Pools({
  current,
  registered,
  blocked,
  busy,
  error,
  onBack,
  onStake,
}: {
  /** The pool the account stakes with now. */
  current?: string;
  /** Unregistered, staking takes a deposit. */
  registered: boolean;
  blocked?: string;
  /** Building a delegation. */
  busy: boolean;
  error?: string;
  onBack: () => void;
  /** The pool, and how many live pools use its ticker. */
  onStake: (pool: PoolDetails, shared: number) => void;
}) {
  const t = useT();
  const [list, setList] = useState<PoolList>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PoolSort>("ticker");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<PoolRow>();

  const load = useCallback(async (refresh: boolean) => {
    setReading(true);
    try {
      setList(await call("pools", { refresh }));
      setReadError(undefined);
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);
  useEffect(() => void load(false), [load]);

  const found = useMemo(() => sortPools(searchPools(list?.pools ?? [], query), sort), [list, query, sort]);
  const tickers = useMemo(() => sharedNames(list?.pools ?? [], (p) => p.ticker), [list]);

  if (open) {
    return (
      <PoolPage
        row={open}
        shared={sharing(tickers, open.ticker)}
        current={current}
        registered={registered}
        blocked={blocked}
        busy={busy}
        error={error}
        onBack={() => setOpen(undefined)}
        onStake={onStake}
      />
    );
  }

  return (
    <Screen
      title={t("staking.choosePool")}
      titleId="pools-title"
      onBack={onBack}
      aside={list ? t("pools.count", { count: list.pools.length }) : " "}
    >
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label={t("pools.search")}
          placeholder={t("pools.searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          spellCheck={false}
        />
      </label>
      <select aria-label={t("pools.sortLabel")} value={sort} onChange={(e) => setSort(e.target.value as PoolSort)}>
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {t(s.label)}
          </option>
        ))}
      </select>

      {readError && (
        <Callout tone="warn" role="alert">
          {t("pools.warn.readFailed", { error: readError })}
        </Callout>
      )}
      {list &&
        (found.length ? (
          <ul className="list" data-testid="pool-results">
            {found.slice(0, limit).map((p) => (
              <PoolListRow key={p.id} pool={p} current={p.id === current} shared={sharing(tickers, p.ticker) > 1} onOpen={setOpen} />
            ))}
          </ul>
        ) : (
          <p className="note center empty">{t("pools.noneMatch", { query: query.trim() })}</p>
        ))}
      {found.length > limit && (
        <button type="button" className="secondary" onClick={() => setLimit(limit + PAGE)}>
          {t("tokens.showMore", { number: Math.min(PAGE, found.length - limit) })}
        </button>
      )}
      <RefreshRow reading={reading} updatedAt={list?.updatedAt} onRefresh={() => void load(true)} />
    </Screen>
  );
}

/** One live pool: its ticker, flagged when other live pools use it too, its ID, and its terms. */
export function PoolListRow({
  pool,
  current,
  shared,
  onOpen,
}: {
  pool: PoolRow;
  current: boolean;
  /** Another live pool uses this ticker, or one that looks the same. */
  shared: boolean;
  onOpen: (p: PoolRow) => void;
}) {
  const t = useT();
  const ticker = pool.ticker ? plainName(pool.ticker) : undefined;
  const label = ticker ?? shortId(pool.id);
  return (
    <li>
      <button
        type="button"
        className="token-row"
        onClick={() => onOpen(pool)}
        aria-label={`${label}${shared ? t("pools.row.sharedTicker") : ""}, ${shortId(pool.id)}, ${t("pools.row.saturated", {
          percent: formatPercent(pool.saturation),
        })}${current ? t("pools.row.yours") : ""}`}
      >
        <span className={`avatar avatar--tint-${tint(pool.id)}`} aria-hidden="true">
          {initials(ticker ?? "?")}
        </span>
        <span className="token-row__label">
          {label}
          {current && <span className="utxo-tag"> {t("pools.yours")}</span>}
          {shared && <span className="utxo-tag utxo-tag--warn"> {t("pools.sharedTickerTag")}</span>}
        </span>
        <span className="token-row__amount">{formatPercent(pool.saturation)}</span>
        <span className="token-row__sub">
          {ticker && <span className="mono-id">{shortId(pool.id)} · </span>}
          {t("pools.row.marginCost", { margin: formatPercent(pool.margin * 100), cost: formatAda(pool.cost) })}
        </span>
      </button>
    </li>
  );
}

/** One pool's details, fresh, and Stake. */
function PoolPage({
  row,
  shared,
  current,
  registered,
  blocked,
  busy,
  error,
  onBack,
  onStake,
}: {
  row: PoolRow;
  /** How many live pools use its ticker. */
  shared: number;
  current?: string;
  registered: boolean;
  blocked?: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onStake: (pool: PoolDetails, shared: number) => void;
}) {
  const t = useT();
  const [details, setDetails] = useState<PoolDetails>();
  const [readError, setReadError] = useState<string>();
  useEffect(() => {
    call("pool", { id: row.id }).then(setDetails, (e: Error) => setReadError(e.message));
  }, [row.id]);

  const yours = row.id === current;
  const label = poolLabel(details ?? { id: row.id, ticker: row.ticker });
  const why = blocked ?? (yours ? t("pools.alreadyYours") : details?.status === "retired" ? t("pools.retired") : undefined);
  return (
    <Screen
      title={label}
      titleId="pool-title"
      aside={details?.name && details.name !== label ? details.name : undefined}
      onBack={onBack}
      backDisabled={busy}
      error={error}
      foot={
        <button
          type="button"
          className="primary"
          onClick={() => details && onStake(details, shared)}
          disabled={!details || !!why || busy}
          title={why}
        >
          {busy ? t("common.building") : yours ? t("staking.yourPool") : t("pools.stakeWith", { label })}
        </button>
      }
    >
      <PoolFacts pool={details ?? { id: row.id, ticker: row.ticker }} error={readError} testId="pool-details" named={false} />
      {details?.description && <p className="note">{details.description}</p>}
      <p className="note mono-id" title={row.id}>
        {row.id}
      </p>
      <SharedTicker shared={shared} />
      {!registered && !yours && (
        <p className="note">{t("pools.firstDeposit")}</p>
      )}
    </Screen>
  );
}

/** Said on a pool's page and its review when other live pools use its ticker. */
export function SharedTicker({ shared }: { shared: number }) {
  const t = useT();
  if (shared < 2) return null;
  return (
    <Callout tone="warn" testId="pool-shared-ticker">
      {t("pools.warn.sharedTicker", { count: shared })}
    </Callout>
  );
}
