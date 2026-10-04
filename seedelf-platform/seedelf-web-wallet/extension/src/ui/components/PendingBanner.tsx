// The one sent transaction the wallet watches, as a banner: Home's, and on a
// dApp page such as Lovejoin's, where a withdraw or a mix is sent from. Home
// asks the worker about it every 15 s while it waits, wherever the user is.
// One Koios didn't answer may have gone through, and says so: it waits, with
// no Dismiss, until the worker settles it. One from the public account can
// land until its slot, about two hours on, and says until when. One that
// never landed says that nothing was sent, or most likely wasn't
// (pending.ts).

import type { PendingTx } from "../../shared/rpc";
import { type I18nKey, t, useT } from "../../i18n";
import { TxBanner } from "./TxBanner";

/**
 * The kinds whose transaction only this wallet can tell is the user's: a
 * Seedelf spend, a session's step, a Lovejoin box or mix. Their banner's
 * link says what opening it tells (ExplorerLink). A move-in, an
 * account-paid mint and the public account's own payments are signed by
 * the account in the open, so theirs stay plain. Not the worker's
 * SEEDELF_KINDS, which says what the private history notes.
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
 * which carries no slot yet.
 */
export function validUntil(pending: PendingTx): string | undefined {
  if (pending.invalidHereafter === undefined) return undefined;
  return new Date(pending.submittedAt + VALID_FOR_MS).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Why a payment Koios didn't answer is still shown as on its way, and until when it holds new ones back. */
function maybeSentDetail(pending: PendingTx): string {
  const until = validUntil(pending);
  if (pending.inMempool) {
    const held = new Date(pending.submittedAt + HELD_IN_MEMPOOL_MS).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return until
      ? t("pending.maybeSent.inMempoolUntil", { until })
      : t("pending.maybeSent.inMempoolHeld", { held });
  }
  return until
    ? t("pending.maybeSent.resentUntil", { until })
    : t("pending.maybeSent.resentNoSlot");
}

/**
 * Home's banner for the sent transaction. `watching`: Home still asks about
 * it, and new payments wait. A maybe-sent one always waits, whatever
 * `watching` says: only the worker settles it, and Dismiss would hide a
 * payment that may still land.
 */
export function PendingBanner({ pending, watching, onDismiss }: { pending: PendingTx; watching: boolean; onDismiss: () => void }) {
  const tr = useT();
  const what = tr(SENT[pending.kind]);
  const shared = {
    network: pending.network,
    txHash: pending.txHash,
    testId: "pending-tx",
    private: PRIVATE_KINDS.has(pending.kind),
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
        detail={maybeSentDetail(pending)}
      />
    );
  }
  const until = validUntil(pending);
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
