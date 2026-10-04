// Activity: one balance's history, newest first, grouped by day, after Lace's
// Activity tab. The Seedelf history comes from the device (no requests); the
// Cardano account's, a page of 20 at a time from Koios, with what each
// transaction did with the stake key and its note. An entry opens its
// details, with the transaction on Cardanoscan: on the private side, with
// what opening it tells (ExplorerLink). Refresh reads again: the
// balances, for the Seedelf side's arrivals; what's newer, for the account's.
// Export saves what's listed as CSV, on the device: the file isn't
// encrypted, and the screen says so. On the private side it says what the
// file ties together, for whoever has it: each row's transaction ID finds it
// on the chain (privacy review §2.21).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { joinSentences, t, useT } from "../../i18n";

import type { ActivityEntry } from "../../shared/rpc";
import { activityCsv, activityDetail, activityTitle as title, poolOf, signedQuantity, stakingLine, voteOf } from "../activity";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { ExplorerLink } from "../components/ExplorerLink";
import {
  ArrowUpRightIcon,
  DownloadIcon,
  MoveInIcon,
  PieIcon,
  ReceiveIcon,
  SproutIcon,
  TrashIcon,
  WithdrawIcon,
} from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmountRow } from "../components/TokenList";
import { formatAda, shortHex } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";

type Of = "seedelf" | "cardano";

function icon(e: ActivityEntry): ReactNode {
  switch (e.kind) {
    case "move-in":
      return <MoveInIcon size={16} />;
    case "mint":
      return <SproutIcon size={16} />;
    case "withdraw":
      return <WithdrawIcon size={16} />;
    case "remove":
      return <TrashIcon size={16} />;
    case "stake":
    case "vote":
    case "withdraw-rewards":
    case "unstake":
      return <PieIcon size={16} />;
    default:
      return e.direction === "in" ? <ReceiveIcon size={16} /> : <ArrowUpRightIcon size={16} />;
  }
}

/** "+25 ₳", "−5 ₳ and 1 token", or "1.74986 ₳" for a seedelf's locked ADA; masked while balances are hidden. */
function amount(e: ActivityEntry, ada: (lovelace: string) => string): string {
  const sign = e.direction === "in" ? "+" : e.direction === "out" ? "−" : "";
  const held = e.tokens ? t("format.adaAndTokens", { ada: ada(e.lovelace), count: e.tokens }) : `${ada(e.lovelace)} ₳`;
  return `${sign}${held}`;
}

/** Saves `text` as a file on the device, as the browser saves any download. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Today, Yesterday, or the date; Earlier when the time isn't known. Each heading in the page's language. */
export function dayHeading(at: number, now: Date): string {
  if (!at) return t("activity.day.earlier");
  const d = new Date(at);
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return t("activity.day.today");
  if (days === 1) return t("activity.day.yesterday");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const time = (at: number) => (at ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

/** What Save as CSV's file holds, said under it: on the private side, all that it ties together. */
export function ExportNote({ of, listed, more }: { of: Of; listed: number; more: boolean }) {
  const t = useT();
  return (
    <p className="note" data-testid="export-note">
      {joinSentences([
        of === "cardano" && more && t("activity.export.readSoFar", { count: listed }),
        t(of === "seedelf" ? "activity.export.privacy.private" : "activity.export.privacy.public"),
      ])}
    </p>
  );
}

export function Activity({
  of,
  pendingHash,
  onBack,
  onRead,
}: {
  of: Of;
  pendingHash?: string;
  onBack: () => void;
  /** After Refresh: the balances may have been read again. */
  onRead: () => void;
}) {
  const network = useNetwork();
  const t = useT();
  const amounts = useAmounts();
  const [entries, setEntries] = useState<ActivityEntry[]>();
  const [more, setMore] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [busy, setBusy] = useState<"more" | "refresh" | "open">();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<ActivityEntry>();
  // Home's callback is new on every render; reading it through a ref keeps `load` (and the effect) stable.
  const read = useRef(onRead);
  useEffect(() => {
    read.current = onRead;
  });

  const load = useCallback(
    async (why: "more" | "refresh" | "open") => {
      setBusy(why);
      setError(undefined);
      try {
        const page = await call("history", { of, more: why === "more", refresh: why === "refresh" });
        setEntries(page.entries);
        setMore(page.more);
        setUpdatedAt(page.updatedAt);
        if (why === "refresh") read.current();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(undefined);
      }
    },
    [of],
  );
  useEffect(() => void load("open"), [load]);

  const now = new Date();
  const openDetail = open && activityDetail(open);
  const groups: Array<[string, ActivityEntry[]]> = [];
  for (const e of entries ?? []) {
    const label = dayHeading(e.at, now);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(e);
    else groups.push([label, [e]]);
  }

  return (
    <Screen
      title={t(of === "seedelf" ? "activity.titlePrivate" : "activity.titlePublic")}
      titleId="activity-title"
      onBack={onBack}
      error={error}
    >
      {of === "seedelf" ? (
        <Callout tone="privacy">{t("activity.privacy.kept")}</Callout>
      ) : (
        <p className="note">{t("activity.fromKoios")}</p>
      )}
      <RefreshRow reading={busy === "refresh"} updatedAt={updatedAt} onRefresh={() => void load("refresh")} />
      {entries === undefined ? (
        <p className="note center empty">{busy ? t("activity.reading") : ""}</p>
      ) : entries.length === 0 ? (
        <p className="note center empty">{t("activity.empty")}</p>
      ) : (
        <div className="stack" data-testid="activity">
          {groups.map(([label, list]) => (
            <section key={label} className="section" aria-label={label}>
              <h2>{label}</h2>
              <ul className="list">
                {list.map((e) => (
                  <li key={e.txHash}>
                    <button type="button" className="token-row" onClick={() => setOpen(e)}>
                      <span className={`avatar activity__icon activity__icon--${e.direction}`}>{icon(e)}</span>
                      <span className="token-row__label">{title(e)}</span>
                      <span className={`token-row__amount activity__amount--${e.direction}`}>
                        {amount(e, amounts.ada)}
                      </span>
                      <span className="token-row__sub">
                        {e.txHash === pendingHash ? `${t("activity.pending")} · ` : ""}
                        {[time(e.at), activityDetail(e) ?? stakingLine(network, e.staking)].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {more && (
        <button type="button" className="secondary" onClick={() => void load("more")} disabled={busy !== undefined}>
          {busy === "more" ? t("activity.reading") : t("activity.loadMore")}
        </button>
      )}
      {entries && entries.length > 0 && (
        <section className="section" aria-labelledby="export-title">
          <h2 id="export-title">{t("activity.export.title")}</h2>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const day = new Date().toISOString().slice(0, 10);
              download(`seedelf-wallet-${of === "seedelf" ? "private" : "public"}-activity-${network}-${day}.csv`, activityCsv(network, entries));
            }}
          >
            <DownloadIcon size={16} />
            {t("activity.export.save")}
          </button>
          <ExportNote of={of} listed={entries.length} more={more} />
        </section>
      )}
      {open && (
        <Modal title={title(open)} titleId="activity-details-title" onClose={() => setOpen(undefined)}>
          <ReviewRows testId="activity-details">
            <Row label={t("activity.row.amount")} value={amount(open, amounts.ada)} strong />
            {open.assets?.map((t) => (
              <TokenAmountRow
                key={`${t.policyId}.${t.assetName}`}
                label=""
                token={t}
                amount={amounts.text(signedQuantity(network, t))}
              />
            ))}
            {open.fee && <Row label={t("activity.row.fee")} value={`${formatAda(open.fee)} ₳`} />}
            {openDetail && <Row label={t(open.kind === "withdraw" || open.kind === "transfer" ? "activity.row.to" : "activity.row.seedelf")} value={openDetail} />}
            {open.staking && poolOf(open.staking) && (
              <Row label={t("activity.row.pool")} value={poolOf(open.staking)!} title={open.staking.pool} />
            )}
            {open.staking && voteOf(network, open.staking) && (
              <Row label={t("activity.row.votingPower")} value={voteOf(network, open.staking)!} title={open.staking.drep} />
            )}
            {open.staking?.deposit && <Row label={t("activity.row.deposit")} value={`${formatAda(open.staking.deposit)} ₳`} />}
            {open.staking?.refund && <Row label={t("activity.row.depositBack")} value={`${formatAda(open.staking.refund)} ₳`} />}
            {open.staking?.rewards && (
              <Row
                label={t(open.kind === "withdraw-rewards" || open.kind === "unstake" ? "activity.row.rewardsWithdrawn" : "activity.row.rewardsSpent")}
                value={`${amounts.ada(open.staking.rewards)} ₳`}
              />
            )}
            <Row label={t("activity.row.when")} value={open.at ? new Date(open.at).toLocaleString("en-GB") : t("activity.row.beforeWallet")} />
          </ReviewRows>
          {open.note && (
            <div className="stack-tight" data-testid="activity-note">
              <span className="label">{t("activity.row.note")}</span>
              <p className="note activity__note">{open.note}</p>
              <p className="note">{t("activity.privacy.note")}</p>
            </div>
          )}
          <div className="field-row">
            <code className="note">{shortHex(open.txHash, 14, 8)}</code>
            <CopyButton value={open.txHash} label={t("activity.copyId")} />
          </div>
          <ExplorerLink network={network} tx={open.txHash} private={of === "seedelf"}>
            {t("activity.viewOnCardanoscan")}
          </ExplorerLink>
        </Modal>
      )}
    </Screen>
  );
}
