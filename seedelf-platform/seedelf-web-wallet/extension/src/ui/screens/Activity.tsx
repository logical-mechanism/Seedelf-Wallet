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
// on the chain (privacy review §2.21). Saving says how many rows it holds. A
// read that fails says so in plain words, with Try again (chunk 23's second
// review, AC-2, AC-3).
//
// The blind test: an entry's amount is what moved, the fee apart, so a payment
// reads as what it paid, never "Sent +32.300614 ₳" for 25 ₳ (§9.1, T08); the
// public side lists what the wallet sent before Koios does, marked Pending,
// the details say so on both sides, and Home's banner shows here too (§9.3).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type I18nKey, joinSentences, Rich, t, useT } from "../../i18n";

import { entrySession, type ActivityEntry } from "../../shared/rpc";
import {
  activityAmount as amount,
  activityCsv,
  activityDetail,
  activityTitle as title,
  exported,
  feeOnly,
  poolOf,
  signedQuantity,
  stakingLine,
  voteOf,
} from "../activity";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { ExplorerLink } from "../components/ExplorerLink";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import {
  ArrowUpRightIcon,
  DownloadIcon,
  LandmarkIcon,
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
    case "drep-register":
    case "drep-update":
    case "drep-retire":
    case "drep-vote":
      return <LandmarkIcon size={16} />;
    default:
      return e.direction === "in" ? <ReceiveIcon size={16} /> : <ArrowUpRightIcon size={16} />;
  }
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
  banner,
  onBack,
  onRead,
}: {
  of: Of;
  pendingHash?: string;
  /** Home's banner for the transaction it watches: the payment is still on its way here too (blind test T08). */
  banner?: ReactNode;
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
  // What failed, and which read, so Try again asks the same (chunk 23's second review, AC-2).
  const [error, setError] = useState<{ message: string; why: "more" | "refresh" | "open" }>();
  const [open, setOpen] = useState<ActivityEntry>();
  // Save as CSV's answer: how many rows the file holds (AC-3).
  const [saved, setSaved] = useState<number>();
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
        setError({ message: (e as Error).message, why });
      } finally {
        setBusy(undefined);
      }
    },
    [of],
  );
  useEffect(() => void load("open"), [load]);

  const now = new Date();
  const openDetail = open && activityDetail(open);
  // Sent and not in a block yet: Private activity's entry from its history while Home watches it, Public activity's
  // from what the device keeps (the worker marks it), until Koios lists it (blind test §9.3).
  const pending = (e: ActivityEntry) => !!e.pending || e.txHash === pendingHash;
  const groups: Array<[string, ActivityEntry[]]> = [];
  for (const e of entries ?? []) {
    const label = dayHeading(e.at, now);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(e);
    else groups.push([label, [e]]);
  }

  return (
    <Screen title={t(of === "seedelf" ? "activity.titlePrivate" : "activity.titlePublic")} titleId="activity-title" onBack={onBack}>
      {banner}
      {of === "seedelf" ? (
        <Callout tone="privacy">{t("activity.privacy.kept")}</Callout>
      ) : (
        <p className="note">{t("activity.fromKoios")}</p>
      )}
      <RefreshRow reading={busy === "refresh"} updatedAt={updatedAt} onRefresh={() => void load("refresh")} />
      {/* What failed in plain words, with the way back; the service's own words under Details. It was the service's
          words alone, in a red card below a gap, with no Try again (chunk 23's second review, AC-2). */}
      {error && (
        <Callout tone="warn" role="alert" testId="activity-failed">
          <div className="stack-tight">
            <strong>{t("activity.warn.readFailed")}</strong>
            <button type="button" className="link align-start" onClick={() => void load(error.why)} disabled={busy !== undefined}>
              {busy ? t("home.trying") : t("common.tryAgain")}
            </button>
            <details className="disclosure">
              <summary>{t("common.details")}</summary>
              <p className="note">{error.message}</p>
            </details>
          </div>
        </Callout>
      )}
      {entries === undefined ? (
        !error && <p className="note center empty">{busy ? t("activity.reading") : ""}</p>
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
                      {/* Whole, on a second line if it must: "Already in your private bal…" was cut (AC-3). */}
                      <span className="token-row__label activity__title">{title(e)}</span>
                      <span className={`token-row__amount activity__amount--${e.direction}`}>
                        {amount(e, amounts.ada)}
                      </span>
                      <EntryLine
                        lead={[pending(e) ? t("activity.pending") : "", time(e.at)]}
                        entry={e}
                        otherwise={stakingLine(network, e.staking)}
                      />
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
              // What's pending isn't in the file: it isn't on chain yet.
              setSaved(exported(entries).length);
            }}
          >
            <DownloadIcon size={16} />
            {t("activity.export.save")}
          </button>
          {/* It said nothing, and held only the rows read so far (chunk 23's second review, AC-3). */}
          {saved !== undefined && (
            <p className="note" role="status" data-testid="export-saved">
              {t(more ? "activity.export.savedSoFar" : "activity.export.saved", { count: saved })}
            </p>
          )}
          <ExportNote of={of} listed={entries.length} more={more} />
        </section>
      )}
      {open && (
        <Modal title={title(open)} titleId="activity-details-title" onClose={() => setOpen(undefined)}>
          <ReviewRows testId="activity-details">
            {/* What it paid, or what came in, the fee apart below; one that moved nothing but its fee says the fee alone
                (blind test §9.1: T08's read "Amount +32.300614 ₳" for 25 ₳ paid). */}
            {!feeOnly(open) && <Row label={t("activity.row.amount")} value={amount(open, amounts.ada)} strong />}
            {open.assets?.map((t) => (
              <TokenAmountRow
                key={`${t.policyId}.${t.assetName}`}
                label=""
                token={t}
                amount={amounts.text(signedQuantity(network, t))}
              />
            ))}
            {open.fee && <Row label={t("activity.row.fee")} value={`${formatAda(open.fee)}\u00a0₳`} />}
            {/* Who was paid, or who paid: a public Send's recipient was labelled "Seedelf", and a payment read from the
                chain named no one (chunk 23's review, A-1). */}
            {openDetail && <Row label={t(detailLabel(open.kind))} value={openDetail} />}
            {open.staking && poolOf(open.staking) && (
              <Row label={t("activity.row.pool")} value={poolOf(open.staking)!} title={open.staking.pool} />
            )}
            {open.staking && voteOf(network, open.staking) && (
              <Row label={t("activity.row.votingPower")} value={voteOf(network, open.staking)!} title={open.staking.drep} />
            )}
            {open.staking?.deposit && <Row label={t("activity.row.deposit")} value={`${formatAda(open.staking.deposit)}\u00a0₳`} />}
            {open.staking?.refund && <Row label={t("activity.row.depositBack")} value={`${formatAda(open.staking.refund)}\u00a0₳`} />}
            {open.staking?.rewards && (
              <Row
                label={t(open.kind === "withdraw-rewards" || open.kind === "unstake" ? "activity.row.rewardsWithdrawn" : "activity.row.rewardsSpent")}
                value={`${amounts.ada(open.staking.rewards)}\u00a0₳`}
              />
            )}
            <Row label={t("activity.row.when")} value={open.at ? new Date(open.at).toLocaleString("en-GB") : t("activity.row.beforeWallet")} />
            {/* The list said Pending, and the details dropped it (blind test T07). */}
            {pending(open) && <Row label={t("activity.row.status")} value={t("activity.row.pending")} />}
          </ReviewRows>
          {/* Why it's called that: found already there, so who paid it isn't known (AC-3). */}
          {open.kind === "received" && open.origin?.origin === "unknown" && (
            <p className="note" data-testid="activity-already-private">
              {t("activity.alreadyPrivateWhy")}
            </p>
          )}
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

/**
 * An entry's line under its title: pending, the time, then who or where (or,
 * with no one, `otherwise`: its staking). An address is cut in the middle,
 * keeping the tail people compare, as everywhere else: cut at the end it read
 * "08:35 · a…" (chunk 23's second review, AC-1).
 */
function EntryLine({ lead, entry, otherwise }: { lead: string[]; entry: ActivityEntry; otherwise?: string }) {
  // A session is named by its number, in the page's words; anyone else as the worker kept them.
  const who = entry.detail !== undefined && entrySession(entry) === undefined ? entry.detail : undefined;
  const front = [...lead, who === undefined ? (activityDetail(entry) ?? otherwise) : undefined].filter(Boolean).join(" · ");
  return (
    <span className="token-row__sub activity__sub">
      <span className={who !== undefined ? "activity__sub-lead activity__sub-lead--fixed" : "activity__sub-lead"}>
        {front}
        {who !== undefined && front ? " · " : ""}
      </span>
      {who !== undefined && <Who name={who} more={entry.more} />}
    </span>
  );
}

/** Who an entry paid, or who paid it: an address cut in the middle, and how many more beside it. */
function Who({ name, more }: { name: string; more?: number }) {
  // A tag or a $handle is short and said whole; an address has no spaces and runs long.
  const shown = name.length > 24 && !/\s/.test(name) ? <MiddleEllipsis text={name} /> : <span>{name}</span>;
  return more ? <Rich k="activity.andMore" parts={{ first: shown }} values={{ count: more }} /> : shown;
}

/** What an entry's who-or-where row is called: who it paid, who paid it, or the Seedelf it made or removed. */
function detailLabel(kind: ActivityEntry["kind"]): I18nKey {
  if (kind === "received") return "activity.row.from";
  if (kind === "sent" || kind === "send" || kind === "withdraw" || kind === "transfer") return "activity.row.to";
  return "activity.row.seedelf";
}
