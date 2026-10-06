// The one sent transaction the wallet watches, as a banner: Home's, and on a
// dApp page such as Lovejoin's, where a withdraw or a mix is sent from. Home
// asks the worker about it every 15 s while it waits, wherever the user is.
// One Koios didn't answer may have gone through, and says so: it waits, with
// no Dismiss, until the worker settles it. One from the public account can
// land until its slot, about two hours on, and says until when. One that
// never landed says that nothing was sent, or most likely wasn't
// (pending.ts).
//
// One that may have gone through leads with what to do, not to pay it again,
// and offers Check now, the same question Home asks every 15 s; how long it
// can still land is under Details, with its date when that's not today: "until
// about 01:17", said at 23:17, read as hours ago (chunk 23's second review,
// HM-4).

import { useState } from "react";

import type { PendingTx } from "../../shared/rpc";
import { type I18nKey, t, useT } from "../../i18n";
import { TxBanner } from "./TxBanner";

/**
 * The kinds whose transaction only this wallet can tell is the user's: a
 * Seedelf spend, a session's step, a Lovejoin box or mix. Their banner's
 * link says what opening it tells (ExplorerLink). A move-in and the public
 * account's own payments are signed by the account in the open, so theirs
 * stay plain; so does a mint the account paid, which `privateBanner` tells
 * from a stealth mint. Not the worker's SEEDELF_KINDS, which says what the
 * private history notes.
 */
export const PRIVATE_KINDS: ReadonlySet<PendingTx["kind"]> = new Set([
  "transfer",
  "withdraw",
  "remove",
  "session-out",
  "session-swap",
  "session-cancel",
  "session-back",
  "lovejoin-withdraw",
  "lovejoin-mix",
]);

/**
 * Whether a sent transaction's link says what opening it tells: a private kind, or a stealth mint. Both mints are
 * one kind, and only the account's carries a slot (mint.ts, account.ts `validUntil`), as the worker tells them
 * apart (pending.ts `forgetReading`): one without is paid from the private balance, the very mint meant to hide
 * who paid, and its banner linked to Cardanoscan without the note.
 */
export function privateBanner(pending: PendingTx): boolean {
  return PRIVATE_KINDS.has(pending.kind) || (pending.kind === "mint" && pending.invalidHereafter === undefined);
}

/** How the banner names a sent transaction, and says it's confirmed. */
export const SENT: Record<PendingTx["kind"], I18nKey> = {
  "move-in": "pending.sent.move_in",
  mint: "pending.sent.mint",
  transfer: "pending.sent.transfer",
  withdraw: "pending.sent.withdraw",
  remove: "pending.sent.remove",
  send: "pending.sent.send",
  collateral: "pending.sent.collateral",
  stake: "pending.sent.stake",
  vote: "pending.sent.vote",
  "withdraw-rewards": "pending.sent.withdraw_rewards",
  unstake: "pending.sent.unstake",
  "drep-register": "pending.sent.drep_register",
  "drep-update": "pending.sent.drep_update",
  "drep-retire": "pending.sent.drep_retire",
  "drep-vote": "pending.sent.drep_vote",
  "session-out": "pending.sent.session_out",
  "session-swap": "pending.sent.session_swap",
  "session-cancel": "pending.sent.session_cancel",
  "session-back": "pending.sent.session_back",
  "lovejoin-withdraw": "pending.sent.lovejoin_withdraw",
  "lovejoin-mix": "pending.sent.lovejoin_mix",
};
export const CONFIRMED: Record<PendingTx["kind"], I18nKey> = {
  "move-in": "pending.confirmed.move_in",
  mint: "pending.confirmed.mint",
  transfer: "pending.confirmed.transfer",
  withdraw: "pending.confirmed.withdraw",
  remove: "pending.confirmed.remove",
  send: "pending.confirmed.send",
  collateral: "pending.confirmed.collateral",
  stake: "pending.confirmed.stake",
  vote: "pending.confirmed.vote",
  "withdraw-rewards": "pending.confirmed.withdraw_rewards",
  unstake: "pending.confirmed.unstake",
  "drep-register": "pending.confirmed.drep_register",
  "drep-update": "pending.confirmed.drep_update",
  "drep-retire": "pending.confirmed.drep_retire",
  "drep-vote": "pending.confirmed.drep_vote",
  "session-out": "pending.confirmed.session_out",
  "session-swap": "pending.confirmed.session_swap",
  "session-cancel": "pending.confirmed.session_cancel",
  "session-back": "pending.confirmed.session_back",
  "lovejoin-withdraw": "pending.confirmed.lovejoin_withdraw",
  "lovejoin-mix": "pending.confirmed.lovejoin_mix",
};

/** What the banner says of a transaction that never landed, by why it was let go. */
const DROPPED: Record<NonNullable<PendingTx["dropped"]>, { title: (what: string) => string; detail: () => string }> = {
  expired: {
    title: (what) => t("pending.dropped.expiredTitle", { what }),
    detail: () => t("pending.dropped.expired"),
  },
  unseen: {
    title: (what) => t("pending.dropped.unseenTitle", { what }),
    detail: () => t("pending.dropped.unseen"),
  },
};

/** What the banner says of one the network said it had (`inMempool`), let go when it was held as long as it could be. */
const HELD_TOO_LONG = {
  title: DROPPED.unseen.title,
  detail: () => t("pending.dropped.heldTooLong"),
};

/**
 * How long a payment from the public account stays valid once it's built
 * (background/account.ts VALID_FOR_MS): the slot it carries, that long past
 * the chain's tip.
 */
const VALID_FOR_MS = 2 * 60 * 60_000;

/**
 * How long a private payment the network said it had (`inMempool`) holds new
 * ones back at most, from when it was sent (background/pending.ts
 * HELD_IN_MEMPOOL_MS): as long as one from the public account, and the half
 * hour the wallet waits past that.
 */
const HELD_IN_MEMPOOL_MS = VALID_FOR_MS + 30 * 60_000;

/**
 * About when a payment from the public account stops being able to land
 * ("16:05"): its slot, two hours on by the chain's clock from when it was
 * built, read from when it was sent. Time passes the same here, so this
 * device's clock says it right even when it's off. None for a private one,
 * which carries no slot yet. With `now`, a time on another day says which
 * ("6 Oct, 01:17").
 */
export function validUntil(pending: PendingTx, now?: number): string | undefined {
  if (pending.invalidHereafter === undefined) return undefined;
  return clock(pending.submittedAt + VALID_FOR_MS, now);
}

/** A time to the minute, and its date when it isn't on `now`'s day (none given: the time alone). */
function clock(at: number, now?: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (now === undefined || d.toDateString() === new Date(now).toDateString()) return time;
  return t("format.dateAndTime", { date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), time });
}

/** Why a payment Koios didn't answer is still shown as on its way: said first, under the title. */
function maybeSentWhy(pending: PendingTx): string {
  return t(pending.inMempool ? "pending.maybeSent.inMempool" : "pending.maybeSent.resent");
}

/** Until when a payment Koios didn't answer holds new ones back: the far horizon, under Details. */
function maybeSentUntil(pending: PendingTx, now: number): string {
  const until = validUntil(pending, now);
  if (pending.inMempool) {
    return until
      ? t("pending.maybeSent.inMempoolUntil", { until })
      : t("pending.maybeSent.inMempoolHeld", { held: clock(pending.submittedAt + HELD_IN_MEMPOOL_MS, now) });
  }
  return until ? t("pending.maybeSent.resentUntil", { until }) : t("pending.maybeSent.resentNoSlot");
}

/**
 * What a payment that may have gone through means: that the wallet keeps at
 * it; Check now, which asks the network straight away what Home asks every
 * 15 s; and how long it can still land, under Details.
 */
function MaybeSentDetail({ pending, onCheck }: { pending: PendingTx; onCheck?: () => Promise<void> | void }) {
  const tr = useT();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      await onCheck?.();
    } finally {
      setChecking(false);
    }
  };
  return (
    <span className="stack-tight">
      <span>{maybeSentWhy(pending)}</span>
      {onCheck && (
        <button type="button" className="link" onClick={() => void check()} disabled={checking}>
          {checking ? tr("pending.checking") : tr("pending.checkNow")}
        </button>
      )}
      <details className="disclosure">
        <summary>{tr("common.details")}</summary>
        <span data-testid="pending-tx-until">{maybeSentUntil(pending, Date.now())}</span>
      </details>
    </span>
  );
}

/**
 * Home's banner for the sent transaction. `watching`: Home still asks about
 * it, and new payments wait. A maybe-sent one always waits, whatever
 * `watching` says: only the worker settles it, and Dismiss would hide a
 * payment that may still land. `onCheck` asks about it now.
 */
export function PendingBanner({
  pending,
  watching,
  onDismiss,
  onCheck,
}: {
  pending: PendingTx;
  watching: boolean;
  onDismiss: () => void;
  onCheck?: () => Promise<void> | void;
}) {
  const tr = useT();
  const what = tr(SENT[pending.kind]);
  const shared = {
    network: pending.network,
    txHash: pending.txHash,
    testId: "pending-tx",
    private: privateBanner(pending),
  };
  if (pending.confirmations !== null) {
    return <TxBanner {...shared} state="done" title={tr(CONFIRMED[pending.kind])} onDismiss={watching ? undefined : onDismiss} />;
  }
  if (pending.dropped) {
    const dropped = pending.dropped === "unseen" && pending.inMempool ? HELD_TOO_LONG : DROPPED[pending.dropped];
    return <TxBanner {...shared} state="stale" title={dropped.title(what)} detail={dropped.detail()} onDismiss={onDismiss} />;
  }
  if (pending.maybeSent) {
    return (
      <TxBanner
        {...shared}
        state="waiting"
        title={tr("pending.maybeSentTitle", { what })}
        detail={<MaybeSentDetail pending={pending} onCheck={onCheck} />}
      />
    );
  }
  const until = validUntil(pending, Date.now());
  return (
    <TxBanner
      {...shared}
      state={watching ? "waiting" : "stale"}
      title={watching ? tr("pending.sentWaiting", { what }) : tr("pending.notConfirmed", { what })}
      detail={
        !watching && until
          ? tr("pending.notShownYet", { until })
          : undefined
      }
      onDismiss={watching ? undefined : onDismiss}
    />
  );
}
