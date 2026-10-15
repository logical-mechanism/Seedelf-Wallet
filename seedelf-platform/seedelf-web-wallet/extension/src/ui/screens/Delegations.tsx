// Delegation history, from the Staking page (chunk 36), after Lace's staking
// activity: every certificate naming the public account's stake key, newest
// first (registered, staked with a pool, the vote delegated, stopped), read
// fresh each time it opens (one `account_update_history`, then `tx_info` for
// the transactions that made them, 20 a request; kept nowhere). Withdrawals
// are left out: payments take the rewards along, so they'd bury the rest, and
// Activity lists them. A row opens its details, with the transaction on
// Cardanoscan. Its pools are named from what the device knows, its DReps from
// the list that ships with the wallet: none is asked for.

import { useEffect, useState } from "react";

import { dateLocale, useT } from "../../i18n";
import type { NetworkName } from "../../networks";
import type { DelegationRow } from "../../shared/rpc";
import { drepName } from "../activity";
import { call } from "../background";
import { CopyButton } from "../components/CopyButton";
import { ExplorerLink } from "../components/ExplorerLink";
import { PieIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { dayText, poolLabel, shortHex, voteLabel } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { ReadFailed } from "./Staking";

/** Rows shown at first, and added by each Show more. */
export const DELEGATIONS_SHOWN = 50;

/** A year's certificates, newest first. */
export interface DelegationYear {
  year: number;
  rows: DelegationRow[];
}

/** The rows by the year each was made in, on this device's calendar, in the order given (newest first). */
export function delegationYears(rows: DelegationRow[]): DelegationYear[] {
  const years: DelegationYear[] = [];
  for (const row of rows) {
    const year = new Date(row.at).getFullYear();
    let group = years.at(-1);
    if (group?.year !== year) {
      group = { year, rows: [] };
      years.push(group);
    }
    group.rows.push(row);
  }
  return years;
}

/** The years' groups cut to their first `shown` rows in all: a year past the cut isn't shown. */
export function firstDelegations(years: DelegationYear[], shown: number): DelegationYear[] {
  const cut: DelegationYear[] = [];
  let left = shown;
  for (const group of years) {
    if (left <= 0) break;
    cut.push({ ...group, rows: group.rows.slice(0, left) });
    left -= group.rows.length;
  }
  return cut;
}

/** Where the vote went, in words: a pinned choice, the account's own DRep, a DRep's name from the list, or its ID cut short. */
function voteText(network: NetworkName, row: DelegationRow, yourOwn: string): string | undefined {
  if (!row.drep) return undefined;
  return row.ownDrep ? yourOwn : voteLabel(row.drep, drepName(network, row.drep));
}

export function Delegations({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<DelegationRow[]>();
  const [error, setError] = useState<string>();

  const read = () => {
    setError(undefined);
    call("delegation-history", {}).then(setRows, (e: Error) => setError(e.message));
  };
  useEffect(read, []);

  return (
    <Screen
      title={t("delegations.title")}
      titleId="delegations-title"
      hint={t("delegations.hint")}
      hintTestId="delegations-hint"
      onBack={onBack}
    >
      <p className="note">{t("delegations.fromServer")}</p>
      {rows ? (
        <DelegationList rows={rows} />
      ) : error ? (
        <ReadFailed what={t("delegations.readFailed")} detail={error} onRetry={read} testId="delegations-failed" />
      ) : (
        <p className="note center empty">{t("delegations.reading")}</p>
      )}
    </Screen>
  );
}

/** The certificates read, by year, 50 at a time; each opens its details. */
export function DelegationList({ rows }: { rows: DelegationRow[] }) {
  const t = useT();
  const network = useNetwork();
  const amounts = useAmounts();
  const [shown, setShown] = useState(DELEGATIONS_SHOWN);
  const [open, setOpen] = useState<DelegationRow>();

  // What it did, in a line: the pool by its ticker or its ID cut short, the vote in words.
  const title = (r: DelegationRow) => {
    switch (r.kind) {
      case "registration":
        return t("delegations.kind.registration");
      case "pool":
        return r.pool ? t("delegations.kind.pool", { pool: poolLabel(r.pool) }) : t("delegations.kind.poolUnknown");
      case "vote": {
        // The account's own in a sentence of its own: "Your own DRep" is a label, capitalised as one.
        if (r.ownDrep) return t("delegations.kind.voteOwn");
        const drep = voteText(network, r, t("drep.yourOwn"));
        return drep ? t("delegations.kind.vote", { drep }) : t("delegations.kind.voteUnknown");
      }
      case "deregistration":
        return t("delegations.kind.deregistration");
    }
  };
  // The deposit is the only money a certificate moves: paid when the key is registered, back when it stops.
  const amount = (r: DelegationRow) =>
    r.deposit ? `${r.kind === "deregistration" ? "+" : "−"}${amounts.ada(r.deposit)} ₳` : "";
  const direction = (r: DelegationRow) => (!r.deposit ? "none" : r.kind === "deregistration" ? "in" : "out");

  if (rows.length === 0) {
    return (
      <p className="note center empty" data-testid="delegations-none">
        {t("delegations.none")}
      </p>
    );
  }
  const vote = open && voteText(network, open, t("drep.yourOwn"));
  return (
    <>
      <div className="stack" data-testid="delegations">
        {firstDelegations(delegationYears(rows), shown).map((y) => (
          <section key={y.year} className="section" aria-labelledby={`delegations-${y.year}`} data-testid="delegations-year">
            <h2 id={`delegations-${y.year}`}>{y.year}</h2>
            <ul className="list" data-testid={`delegations-${y.year}-rows`}>
              {y.rows.map((r) => (
                <li key={`${r.txHash}.${r.kind}`}>
                  <button type="button" className="token-row" onClick={() => setOpen(r)}>
                    <span className={`avatar activity__icon activity__icon--${direction(r)}`}>
                      <PieIcon size={16} />
                    </span>
                    {/* The whole pool ID or DRep ID on hover: a ticker or a name is anyone's to choose. */}
                    <span className="token-row__label activity__title" title={r.pool?.id ?? r.drep}>
                      {title(r)}
                    </span>
                    <span className={`token-row__amount activity__amount--${direction(r)}`}>{amount(r)}</span>
                    <span className="token-row__sub activity__sub">
                      {t("delegations.when", { day: dayText(r.at), epoch: r.epoch })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {rows.length > shown && (
        <button type="button" className="secondary" onClick={() => setShown((n) => n + DELEGATIONS_SHOWN)}>
          {t("delegations.showMore")}
        </button>
      )}
      {open && (
        <Modal title={title(open)} titleId="delegation-details-title" onClose={() => setOpen(undefined)}>
          <ReviewRows testId="delegation-details">
            {open.pool && <Row label={t("activity.row.pool")} value={poolLabel(open.pool)} title={open.pool.id} strong />}
            {vote && <Row label={t("activity.row.votingPower")} value={vote} title={open.drep} strong />}
            {open.deposit && (
              <Row
                label={t(open.kind === "deregistration" ? "activity.row.depositBack" : "activity.row.deposit")}
                value={`${amounts.ada(open.deposit)} ₳`}
              />
            )}
            <Row label={t("delegations.epoch")} value={String(open.epoch)} />
            <Row label={t("activity.row.when")} value={new Date(open.at).toLocaleString(dateLocale())} />
          </ReviewRows>
          <div className="field-row">
            <code className="note">{shortHex(open.txHash, 14, 8)}</code>
            <CopyButton value={open.txHash} label={t("activity.copyId")} />
          </div>
          <ExplorerLink network={network} tx={open.txHash}>
            {t("activity.viewOnCardanoscan")}
          </ExplorerLink>
        </Modal>
      )}
    </>
  );
}
