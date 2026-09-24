// The pool browser, after Lace's: every live pool, searched by ticker or pool
// ID and sorted by ticker, saturation, margin, cost or pledge. The list is
// the same for everyone, so the worker keeps it on the device for a day: no
// requests after the first. A pool opens its details, fresh (one request),
// and Stake builds the delegation for review. Pool names come with the
// details: the list has tickers only (Koios's pool_list), and asking for every
// name would cost several requests a day.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { PoolDetails, PoolList, PoolRow } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { SearchIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { Screen } from "../components/Screen";
import { formatAda, formatPercent, plural, poolLabel, shortHex } from "../format";
import { initials, tint } from "../tokens";
import { PoolFacts } from "./Staking";

/** Rows shown at a time; "Show more" adds as many again. */
const PAGE = 50;

export type PoolSort = "ticker" | "saturation" | "margin" | "cost" | "pledge";

const SORTS: Array<{ value: PoolSort; label: string }> = [
  { value: "ticker", label: "Ticker, A to Z" },
  { value: "saturation", label: "Least saturated" },
  { value: "margin", label: "Lowest margin" },
  { value: "cost", label: "Lowest cost" },
  { value: "pledge", label: "Highest pledge" },
];

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
  onStake: (pool: PoolDetails) => void;
}) {
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

  if (open) {
    return (
      <PoolPage
        row={open}
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
      title="Choose a pool"
      titleId="pools-title"
      onBack={onBack}
      aside={list ? `${plural(list.pools.length, "live pool")}` : " "}
    >
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label="Search pools"
          placeholder="Ticker or pool ID"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          spellCheck={false}
        />
      </label>
      <select aria-label="Sort pools" value={sort} onChange={(e) => setSort(e.target.value as PoolSort)}>
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {readError && (
        <Callout tone="warn" role="alert">
          Couldn't read the pools: {readError}
        </Callout>
      )}
      {list &&
        (found.length ? (
          <ul className="list" data-testid="pool-results">
            {found.slice(0, limit).map((p) => (
              <PoolListRow key={p.id} pool={p} current={p.id === current} onOpen={setOpen} />
            ))}
          </ul>
        ) : (
          <p className="note center empty">No live pool matches “{query.trim()}”.</p>
        ))}
      {found.length > limit && (
        <button type="button" className="secondary" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, found.length - limit)} more
        </button>
      )}
      <RefreshRow reading={reading} updatedAt={list?.updatedAt} onRefresh={() => void load(true)} />
    </Screen>
  );
}

function PoolListRow({ pool, current, onOpen }: { pool: PoolRow; current: boolean; onOpen: (p: PoolRow) => void }) {
  const label = pool.ticker ?? shortHex(pool.id, 10, 6);
  return (
    <li>
      <button
        type="button"
        className="token-row"
        onClick={() => onOpen(pool)}
        aria-label={`${label}, ${formatPercent(pool.saturation)} saturated${current ? ", your pool" : ""}`}
      >
        <span className={`avatar avatar--tint-${tint(pool.id)}`} aria-hidden="true">
          {initials(pool.ticker ?? "?")}
        </span>
        <span className="token-row__label">
          {label}
          {current && <span className="utxo-tag"> Yours</span>}
        </span>
        <span className="token-row__amount">{formatPercent(pool.saturation)}</span>
        <span className="token-row__sub">
          {formatPercent(pool.margin * 100)} margin · {formatAda(pool.cost)} ₳ cost
        </span>
      </button>
    </li>
  );
}

/** One pool's details, fresh, and Stake. */
function PoolPage({
  row,
  current,
  registered,
  blocked,
  busy,
  error,
  onBack,
  onStake,
}: {
  row: PoolRow;
  current?: string;
  registered: boolean;
  blocked?: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onStake: (pool: PoolDetails) => void;
}) {
  const [details, setDetails] = useState<PoolDetails>();
  const [readError, setReadError] = useState<string>();
  useEffect(() => {
    call("pool", { id: row.id }).then(setDetails, (e: Error) => setReadError(e.message));
  }, [row.id]);

  const yours = row.id === current;
  const label = poolLabel(details ?? { id: row.id, ticker: row.ticker });
  const why = blocked ?? (yours ? "You're staking with this pool" : details?.status === "retired" ? "This pool has retired" : undefined);
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
          onClick={() => details && onStake(details)}
          disabled={!details || !!why || busy}
          title={why}
        >
          {busy ? "Building…" : yours ? "Your pool" : `Stake with ${label}`}
        </button>
      }
    >
      <PoolFacts pool={details ?? { id: row.id, ticker: row.ticker }} error={readError} testId="pool-details" named={false} />
      {details?.description && <p className="note">{details.description}</p>}
      <p className="note mono-id" title={row.id}>
        {row.id}
      </p>
      {!registered && !yours && (
        <p className="note">Staking the first time takes a 2 ₳ deposit, which comes back when you stop.</p>
      )}
    </Screen>
  );
}
