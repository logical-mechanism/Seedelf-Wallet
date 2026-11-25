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
// Each list starts with a row for the other side's, which Home opens on a
// press, and Back from it comes back here (E01, the owner's call).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dateLocale, type I18nKey, joinSentences, t, useT } from "../../i18n";

import { entrySession, type ActivityEntry } from "../../shared/rpc";
import { isSeedelfShort } from "../../shared/seedelf-name";
import {
  activityAmount as amount,
  activityCsv,
  activityDetail,
  activityTitleIn,
  exported,
  feeOnly,
  poolOf,
  signedQuantity,
  stakingLine,
  voteOf,
} from "../activity";
import { call } from "../background";
import { shownSiteText } from "../dapp";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { ExplorerLink } from "../components/ExplorerLink";
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  DownloadIcon,
  LandmarkIcon,
  MoveInIcon,
  PieIcon,
  ReceiveIcon,
  ShieldIcon,
  SproutIcon,
  TrashIcon,
  WalletIcon,
  WithdrawIcon,
} from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmountRow } from "../components/TokenList";
import { formatAda, shortCounterparty, shortHex } from "../format";
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
    // Lovejoin's own mark, as its tile has: what the account paid into it.
    case "lovejoin-deposit":
    case "lovejoin-round":
      return <ShieldIcon size={16} />;
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
  return d.toLocaleDateString(dateLocale(), { day: "numeric", month: "short", year: "numeric" });
}

const time = (at: number) => (at ? new Date(at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" }) : "");

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

/**
 * The other side's list, as a row: its title, whose payments it holds, and a press to it. Each list is one side's
 * alone, and Home opens on Private, so a question about all the wallet's money was answered from half of it (blind
 * test E01). The same card as Home's row for the other side, so it reads as the same way across. Exported for its
 * tests.
 */
export function OtherList({ of, onOpen }: { of: Of; onOpen: () => void }) {
  const t = useT();
  const toPublic = of === "seedelf";
  return (
    <section className="section">
      <ul className="list">
        <li>
          <button type="button" className="menu-row" onClick={onOpen} data-testid="activity-other">
            <span className="menu-row__icon">{toPublic ? <WalletIcon size={16} /> : <ShieldIcon size={16} />}</span>
            <span className="menu-row__text">
              <span>{t(toPublic ? "activity.titlePublic" : "activity.titlePrivate")}</span>
              <span className="menu-row__sub menu-row__sub--wrap">
                {t(toPublic ? "activity.other.public" : "activity.other.private")}
              </span>
            </span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
      </ul>
    </section>
  );
}

export function Activity({
  of,
  pendingHash,
  banner,
  onBack,
  onRead,
  onOther,
}: {
  of: Of;
  pendingHash?: string;
  /** Home's banner for the transaction it watches: the payment is still on its way here too (blind test T08). */
  banner?: ReactNode;
  onBack: () => void;
  /** After Refresh: the balances may have been read again. */
  onRead: () => void;
  /** Opens the other side's list: nothing of it is read until it's pressed (blind test E01). */
  onOther?: () => void;
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
  // Each day's heading, newest first, and that day's entries picked from the list: kept apart, as the critical-set
  // guard follows a pair of them pushed together as one, and took an entry's token for a heading (chunk 51, e9b#2).
  const days: string[] = [];
  for (const e of entries ?? []) {
    const label = dayHeading(e.at, now);
    if (!days.includes(label)) days.push(label);
  }
  const onDay = (label: string) => (entries ?? []).filter((e) => dayHeading(e.at, now) === label);

  return (
    <Screen title={t(of === "seedelf" ? "activity.titlePrivate" : "activity.titlePublic")} titleId="activity-title" onBack={onBack}>
      {banner}
      {/* The other list, first: asked when ADA last came in, E01's tester answered from Private activity, whose latest
          was hours older than the public account's, and neither list said the other existed (blind test §4 entry 8). */}
      {onOther && <OtherList of={of} onOpen={onOther} />}
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
          {days.map((label) => (
            <section key={label} className="section" aria-label={label}>
              <h2>{label}</h2>
              <ul className="list">
                {onDay(label).map((e) => (
                  <li key={e.txHash}>
                    <button type="button" className="token-row" onClick={() => setOpen(e)}>
                      <span className={`avatar activity__icon activity__icon--${e.direction}`}>{icon(e)}</span>
                      {/* Whole, on a second line if it must: "Already in your private bal…" was cut (AC-3). */}
                      <span className="token-row__label activity__title">{activityTitleIn(network, e)}</span>
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
              download(
                `seedelf-wallet-${of === "seedelf" ? "private" : "public"}-activity-${network}-${day}.csv`,
                activityCsv(network, entries, pendingHash),
              );
              // What's pending isn't in the file: it isn't on chain yet, the payment Home watches included (e9a#5).
              setSaved(exported(entries, pendingHash).length);
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
        <Modal title={activityTitleIn(network, open)} titleId="activity-details-title" onClose={() => setOpen(undefined)}>
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
            {/* A Seedelf's saved short form "and 2 more" is a sentence, under its label: beside it, it broke after the
                short form's "…" (the 1.10.0 gate's second review). */}
            {openDetail && (
              <Row label={t(detailLabel(open))} value={openDetail} stack={!!open.more && isSeedelfShort(open.detail ?? "")} />
            )}
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
            <Row label={t("activity.row.when")} value={open.at ? new Date(open.at).toLocaleString(dateLocale()) : t("activity.row.beforeWallet")} />
            {/* The list said Pending, and the details dropped it (blind test T07). */}
            {pending(open) && <Row label={t("activity.row.status")} value={t("activity.row.pending")} />}
          </ReviewRows>
          {/* Why it's called that: found already there, so who paid it isn't known (AC-3). */}
          {open.kind === "received" && open.origin?.origin === "unknown" && (
            <p className="note" data-testid="activity-already-private">
              {t("activity.alreadyPrivateWhy")}
            </p>
          )}
          {open.note && <EntryNote note={open.note} />}
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
 * keeping its own first letters and its tail: cut at the end it read "08:35 ·
 * a…" (chunk 23's second review, AC-1), and squeezed into the line it kept
 * only its checksum (chunk 51, gap-g10#2).
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

/**
 * An entry's CIP-20 note, which whoever paid wrote: each character that changes how it reads without showing written
 * as its code, as the sign window writes a site's (ui/dapp.ts `shownSiteText`), so a right-to-left override can't turn
 * it around (chunk 51, gap-g7#3's class). Exported for its tests.
 */
export function EntryNote({ note }: { note: string }) {
  const t = useT();
  const shown = shownSiteText(note);
  return (
    <div className="stack-tight" data-testid="activity-note">
      <span className="label">{t("activity.row.note")}</span>
      <p className="note activity__note">{shown.text}</p>
      {shown.escaped && <p className="note" data-testid="activity-note-codes">{t("dappUi.warn.hiddenChars")}</p>}
      <p className="note">{t("activity.privacy.note")}</p>
    </div>
  );
}

/** Where a Seedelf's saved short form may break: after its prefix, its "…" and the first eight of its sixteen. */
const SHORT_BREAK = "5eed0e1f…".length + 8;

/** Where "and 2 more" is cut around the name: no translation holds it. */
const NAME_AT = "\u0000";

/**
 * Who an entry paid, or who paid it: an address cut in the middle, and how many more beside it. The words around the
 * name ("and 2 more") are a part of their own that keeps its spaces and never gives way: loose in the line's flex row,
 * their leading space collapsed ("…ckpvwrand 1 more"), and a squeezed name ran its tail over them (the pass-two
 * visual check). Exported for its tests.
 */
export function Who({ name, more }: { name: string; more?: number }) {
  const t = useT();
  // A tag or a $handle is short and said whole; an address or a Seedelf's name has no spaces and runs long. It's cut as
  // `shortCounterparty` cuts them, and goes to a line of its own rather than give way: squeezed into the line, an
  // address kept as few as three first letters and its checksum, which anyone can solve for (chunk 51, gap-g10#2).
  //
  // A Seedelf with no tag that a private Send paid, or one removed, comes already cut: the worker saved its short form
  // (seedelf-name.ts `seedelfShort`), 28 to 30 characters with a no-break space before its index. It's the same part,
  // said as it is and never cut again: as a plain span it could neither wrap nor shrink, and the line clipped its end,
  // the index, beside most amounts at 360 px (the 1.10.0 gate's second review). Where the line has no room for it
  // whole (beside "… and 1 token" in the side panel), it breaks after its "…" or in the middle of its sixteen: left to
  // break anywhere, "#1" went to a line of its own. What an entry saved before that (twelve and six) is short, and
  // stays a plain span.
  const shown = isSeedelfShort(name) ? (
    <span className="activity__who">
      {name.slice(0, SHORT_BREAK)}
      <wbr />
      {name.slice(SHORT_BREAK)}
    </span>
  ) : name.length > 24 && !/\s/.test(name) ? (
    <span className="activity__who" title={name} data-value={name}>
      {shortCounterparty(name)}
    </span>
  ) : (
    <span>{name}</span>
  );
  if (!more) return shown;
  const [before, after] = t("activity.andMore", { first: NAME_AT, count: more }).split(NAME_AT);
  return (
    <>
      {before && <span className="activity__more">{before}</span>}
      {shown}
      {after && <span className="activity__more">{after}</span>}
    </>
  );
}

/**
 * What an entry's who-or-where row is called: the Seedelf it made or removed, or by which way the money went, where it
 * came from or where it went. Every other kind was "Seedelf", so a private session's funding read "Seedelf: Private
 * session 3", and a box back "Seedelf: Lovejoin" (chunk 51, e9a#6). Exported for its tests.
 */
export function detailLabel(e: ActivityEntry): I18nKey {
  if (e.kind === "mint" || e.kind === "remove") return "activity.row.seedelf";
  return e.direction === "in" ? "activity.row.from" : "activity.row.to";
}
