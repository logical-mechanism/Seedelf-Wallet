// Activity: one balance's history, newest first, grouped by day, after Lace's
// Activity tab. The Seedelf history comes from the device (no requests); the
// Cardano account's, a page of 20 at a time from Koios. An entry opens its
// details, with the transaction on Cardanoscan.

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { ActivityEntry } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import {
  ArrowUpRightIcon,
  ExternalIcon,
  MoveInIcon,
  ReceiveIcon,
  SproutIcon,
  TrashIcon,
  WithdrawIcon,
} from "../components/Icons";
import { Modal } from "../components/Modal";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { explorerUrl, formatAda, plural, shortHex } from "../format";
import { useNetwork } from "../network";

type Of = "seedelf" | "cardano";

/** What an entry is called, on this balance's side. */
function title(e: ActivityEntry, of: Of): string {
  switch (e.kind) {
    case "received":
      return "Received";
    case "sent":
      return "Sent";
    case "move-in":
      return of === "seedelf" ? "Moved in" : "Moved into Seedelf";
    case "mint":
      return "Created a seedelf";
    case "transfer":
      return "Sent to a seedelf";
    case "withdraw":
      return of === "seedelf" ? "Withdrew" : "Withdrawn from Seedelf";
    case "remove":
      return "Removed a seedelf";
  }
}

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
    default:
      return e.direction === "in" ? <ReceiveIcon size={16} /> : <ArrowUpRightIcon size={16} />;
  }
}

/** "+25 ₳", "−5 ₳ and 1 token", or "1.74986 ₳" for a seedelf's locked ADA. */
function amount(e: ActivityEntry): string {
  const sign = e.direction === "in" ? "+" : e.direction === "out" ? "−" : "";
  return `${sign}${formatAda(e.lovelace)} ₳${e.tokens ? ` and ${plural(e.tokens, "token")}` : ""}`;
}

/** Today, Yesterday, or the date; "Earlier" when the time isn't known. */
function day(at: number, now: Date): string {
  if (!at) return "Earlier";
  const d = new Date(at);
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const time = (at: number) => (at ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

export function Activity({ of, pendingHash, onBack }: { of: Of; pendingHash?: string; onBack: () => void }) {
  const network = useNetwork();
  const [entries, setEntries] = useState<ActivityEntry[]>();
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<ActivityEntry>();

  const load = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(undefined);
      try {
        const page = await call("history", { of, more: next });
        setEntries(page.entries);
        setMore(page.more);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [of],
  );
  useEffect(() => void load(false), [load]);

  const now = new Date();
  const groups: Array<[string, ActivityEntry[]]> = [];
  for (const e of entries ?? []) {
    const label = day(e.at, now);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(e);
    else groups.push([label, [e]]);
  }

  return (
    <Screen
      title={of === "seedelf" ? "Seedelf activity" : "Cardano account activity"}
      titleId="activity-title"
      onBack={onBack}
      error={error}
    >
      {of === "seedelf" ? (
        <Callout tone="privacy">
          Kept encrypted on this device, never asked of Koios. It starts from when this wallet first saw each payment.
        </Callout>
      ) : (
        <p className="note">Read from Koios, which already knows this account, 20 transactions at a time.</p>
      )}
      {entries === undefined ? (
        <p className="note center empty">{busy ? "Reading…" : ""}</p>
      ) : entries.length === 0 ? (
        <p className="note center empty">Nothing yet.</p>
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
                      <span className="token-row__label">{title(e, of)}</span>
                      <span className={`token-row__amount activity__amount--${e.direction}`}>{amount(e)}</span>
                      <span className="token-row__sub">
                        {e.txHash === pendingHash ? "Pending · " : ""}
                        {[time(e.at), e.detail].filter(Boolean).join(" · ")}
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
        <button type="button" className="secondary" onClick={() => void load(true)} disabled={busy}>
          {busy ? "Reading…" : "Load more"}
        </button>
      )}
      {open && (
        <Modal title={title(open, of)} titleId="activity-details-title" onClose={() => setOpen(undefined)}>
          <ReviewRows testId="activity-details">
            <Row label="Amount" value={amount(open)} strong />
            {open.fee && <Row label="Network fee" value={`${formatAda(open.fee)} ₳`} />}
            {open.detail && <Row label={open.kind === "withdraw" || open.kind === "transfer" ? "To" : "Seedelf"} value={open.detail} />}
            <Row label="When" value={open.at ? new Date(open.at).toLocaleString("en-GB") : "Before this wallet"} />
          </ReviewRows>
          <div className="field-row">
            <code className="note">{shortHex(open.txHash, 14, 8)}</code>
            <CopyButton value={open.txHash} label="Copy the transaction id" />
          </div>
          <a className="menu-link" href={explorerUrl(network, open.txHash)} target="_blank" rel="noreferrer">
            View on Cardanoscan <ExternalIcon size={12} />
          </a>
        </Modal>
      )}
    </Screen>
  );
}
