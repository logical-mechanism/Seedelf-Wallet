// Rewards history, from the Staking page (chunk 30): every reward the public
// account's stake key was paid, newest first, read fresh each time it opens
// (one `account_reward_history`, kept nowhere), with what's been paid in all,
// next epoch's if it's listed yet and the key is still registered, and each
// year's. Its pools are named from what the device knows: none is asked for.

import { useEffect, useState } from "react";

import { epochAt, epochStart, type NetworkName } from "../../networks";
import type { RewardRow } from "../../shared/rpc";
import { useT } from "../../i18n";
import { call } from "../background";
import { dayText, poolLabel } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { ReadFailed } from "./Staking";

/** Rows shown at first, and added by each Show more: about eight months of a pool's rewards. */
export const REWARDS_SHOWN = 50;

/** A year's rewards, newest first, and what they came to. */
export interface RewardYear {
  year: number;
  total: bigint;
  rows: RewardRow[];
}

export interface RewardsView {
  /** What's been paid by now, every year's. */
  paid: bigint;
  /** Listed, but paid at a later epoch's start: next epoch's, for a key that's registered. */
  coming: RewardRow[];
  /** The rest, by the year each was paid in, on this device's calendar. */
  years: RewardYear[];
}

/** The history as the page shows it, at `now` (ms): what's paid by year, and what's still to come. */
export function rewardsView(rows: RewardRow[], network: NetworkName, now: number, registered = true): RewardsView {
  const epoch = epochAt(network, now);
  const view: RewardsView = { paid: 0n, coming: [], years: [] };
  for (const row of rows) {
    if (row.epoch > epoch) {
      // Listed before it's paid, and paid only to a key still registered when that epoch starts: a stopped key's
      // goes to the treasury, and db-sync deletes the row. Shown, it would be money coming that never comes.
      if (registered) view.coming.push(row);
      continue;
    }
    const amount = BigInt(row.amount);
    view.paid += amount;
    const year = new Date(epochStart(network, row.epoch)).getFullYear();
    let group = view.years.at(-1);
    if (group?.year !== year) {
      group = { year, total: 0n, rows: [] };
      view.years.push(group);
    }
    group.total += amount;
    group.rows.push(row);
  }
  return view;
}

/** The years' groups cut to their first `shown` rows in all: a year past the cut isn't shown. */
export function firstRows(years: RewardYear[], shown: number): RewardYear[] {
  const cut: RewardYear[] = [];
  let left = shown;
  for (const group of years) {
    if (left <= 0) break;
    cut.push({ ...group, rows: group.rows.slice(0, left) });
    left -= group.rows.length;
  }
  return cut;
}

/** `registered`: whether the stake key is registered now. Next epoch's rewards are paid only if it is. */
export function Rewards({ onBack, registered }: { onBack: () => void; registered: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<RewardRow[]>();
  const [error, setError] = useState<string>();

  const read = () => {
    setError(undefined);
    call("reward-history", {}).then(setRows, (e: Error) => setError(e.message));
  };
  useEffect(read, []);

  return (
    <Screen title={t("rewards.title")} titleId="rewards-title" hint={t("rewards.hint")} hintTestId="rewards-hint" onBack={onBack}>
      <p className="note">{t("rewards.fromServer")}</p>
      {rows ? (
        <RewardList rows={rows} now={Date.now()} registered={registered} />
      ) : error ? (
        <ReadFailed what={t("rewards.readFailed")} detail={error} onRetry={read} testId="rewards-failed" />
      ) : (
        <p className="note center empty">{t("rewards.reading")}</p>
      )}
    </Screen>
  );
}

/** The rewards read, at `now` (ms): what's been paid in all, next epoch's, then each year's, 50 rows at a time. */
export function RewardList({ rows, now, registered = true }: { rows: RewardRow[]; now: number; registered?: boolean }) {
  const t = useT();
  const network = useNetwork();
  const amounts = useAmounts();
  const [shown, setShown] = useState(REWARDS_SHOWN);

  // Who paid it: the pool, by its ticker or its ID cut short, or the pot it came from.
  const from = (r: RewardRow) => {
    const pool = r.pool ? poolLabel(r.pool) : undefined;
    if (r.kind === "member" && pool) return pool;
    if (r.kind === "leader" && pool) return t("rewards.from.leader", { pool });
    if (r.kind === "refund" && pool) return t("rewards.from.refund", { pool });
    if (r.kind === "reserves") return t("rewards.from.reserves");
    if (r.kind === "treasury") return t("rewards.from.treasury");
    if (r.kind === "proposal_refund") return t("rewards.from.proposalRefund");
    return t("rewards.from.other");
  };
  const ada = (lovelace: bigint | string) => `${amounts.ada(lovelace.toString())}\u00a0₳`;
  const list = (items: RewardRow[], testId: string) => (
    <ul className="list" data-testid={testId}>
      {items.map((r, i) => (
        <li key={`${r.epoch}.${r.earned}.${r.kind}.${r.pool?.id ?? ""}.${i}`} className="list__row">
          <span className="stack-tight">
            <span className="list__name">{dayText(epochStart(network, r.epoch))}</span>
            {/* The whole pool ID on hover: a ticker is anyone's to choose. */}
            <span className="note" title={r.pool?.id}>
              {t("rewards.row", { epoch: r.epoch, from: from(r) })}
            </span>
          </span>
          <span className="list__value">{ada(r.amount)}</span>
        </li>
      ))}
    </ul>
  );

  const view = rewardsView(rows, network, now, registered);
  if (view.years.length === 0 && view.coming.length === 0) {
    return (
      <p className="note center empty" data-testid="rewards-none">
        {t("staking.noRewards")}
      </p>
    );
  }
  const paidRows = view.years.reduce((n, y) => n + y.rows.length, 0);
  return (
    <>
      <ReviewRows testId="rewards-total">
        <Row label={t("rewards.paid")} value={ada(view.paid)} strong />
      </ReviewRows>
      {view.coming.length > 0 && (
        <section className="section" aria-labelledby="rewards-coming-title">
          <h2 id="rewards-coming-title">{t("rewards.coming")}</h2>
          {list(view.coming, "rewards-coming")}
        </section>
      )}
      {firstRows(view.years, shown).map((y) => (
        <section key={y.year} className="section" aria-labelledby={`rewards-${y.year}`} data-testid="rewards-year">
          <h2 id={`rewards-${y.year}`}>
            {y.year}
            <span className="section__count">
              {" · "}
              {ada(y.total)}
            </span>
          </h2>
          {list(y.rows, `rewards-${y.year}-rows`)}
        </section>
      ))}
      {paidRows > shown && (
        <button type="button" className="secondary" onClick={() => setShown((n) => n + REWARDS_SHOWN)}>
          {t("rewards.showMore")}
        </button>
      )}
    </>
  );
}
