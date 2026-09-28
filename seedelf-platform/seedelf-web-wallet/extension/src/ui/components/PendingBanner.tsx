// The one sent transaction the wallet watches, as a banner: Home's, and on a
// dApp page such as Lovejoin's, where a withdraw or a mix is sent from. Home
// asks the worker about it every 15 s while it waits, wherever the user is.
// One Koios didn't answer may have gone through, and says so: it waits, with
// no Dismiss, until the worker settles it. One from the public account can
// land until its slot, about two hours on, and says until when. One that
// never landed says that nothing was sent, or most likely wasn't
// (pending.ts).

import type { PendingTx } from "../../shared/rpc";
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
export const SENT: Record<PendingTx["kind"], string> = {
  "move-in": "Payment into your private balance",
  mint: "Seedelf mint",
  transfer: "Private payment",
  withdraw: "Payment from your private balance",
  remove: "Seedelf removal",
  send: "Payment",
  collateral: "Collateral payment",
  stake: "Delegation",
  vote: "Vote delegation",
  "withdraw-rewards": "Reward withdrawal",
  unstake: "Stop staking",
  "session-out": "Payment into a private session",
  "session-swap": "Swap order",
  "session-cancel": "Order cancel",
  "session-back": "Return from a private session",
  "lovejoin-withdraw": "A box back from Lovejoin",
  "lovejoin-mix": "Mixes into Lovejoin",
};
export const CONFIRMED: Record<PendingTx["kind"], string> = {
  "move-in": "Made private",
  mint: "Seedelf created",
  transfer: "Private payment confirmed",
  withdraw: "Made public",
  remove: "Seedelf removed",
  send: "Payment confirmed",
  collateral: "Collateral set",
  stake: "Now staking",
  vote: "Voting power delegated",
  "withdraw-rewards": "Rewards withdrawn",
  unstake: "Staking stopped",
  "session-out": "Private session funded",
  "session-swap": "Swap order placed",
  "session-cancel": "Order cancelled",
  "session-back": "Back in your private balance",
  "lovejoin-withdraw": "Back in your private balance",
  "lovejoin-mix": "In Lovejoin, on their way to your private balance",
};

/** What the banner says of a transaction that never landed, by why it was let go. */
const DROPPED: Record<NonNullable<PendingTx["dropped"]>, { title: (what: string) => string; detail: string }> = {
  expired: {
    title: (what) => `${what} expired: nothing was sent`,
    detail: "The network didn't take it in the time it was valid for, so it can't go through any more. Its UTxOs are back in your balance.",
  },
  unseen: {
    title: (what) => `${what} not seen on the network`,
    detail:
      "Koios didn't answer when it was sent, and 20 minutes on the network still hasn't shown it, so it most likely never went out. " +
      "Its UTxOs count in your balance again: check Activity before you send it again.",
  },
};

/**
 * How long a payment from the public account stays valid once it's built
 * (background/account.ts VALID_FOR_MS): the slot it carries, that long past
 * the chain's tip.
 */
const VALID_FOR_MS = 2 * 60 * 60_000;

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
    return (
      "Koios didn't answer when it was sent. Sent again, the network says it has it already, and what it spends isn't spent on chain yet: " +
      "it's waiting to go into a block, and may still land. New payments wait until it lands, or until it can't any more" +
      (until ? `: it can land until about ${until}.` : ".")
    );
  }
  return (
    "Koios didn't answer when it was sent. The wallet sends it again now and then, which is safe: the network takes it only once. " +
    "New payments wait until it lands, or until it can't any more: " +
    (until
      ? `it can land until about ${until}, and the wallet waits half an hour past that to be sure.`
      : "if the network still hasn't shown it 20 minutes after it was sent, the wallet lets it go.")
  );
}

/**
 * Home's banner for the sent transaction. `watching`: Home still asks about
 * it, and new payments wait. A maybe-sent one always waits, whatever
 * `watching` says: only the worker settles it, and Dismiss would hide a
 * payment that may still land.
 */
export function PendingBanner({ pending, watching, onDismiss }: { pending: PendingTx; watching: boolean; onDismiss: () => void }) {
  const what = SENT[pending.kind];
  const shared = {
    network: pending.network,
    txHash: pending.txHash,
    testId: "pending-tx",
    private: PRIVATE_KINDS.has(pending.kind),
  };
  if (pending.confirmations !== null) {
    return <TxBanner {...shared} state="done" title={CONFIRMED[pending.kind]} onDismiss={watching ? undefined : onDismiss} />;
  }
  if (pending.dropped) {
    const dropped = DROPPED[pending.dropped];
    return <TxBanner {...shared} state="stale" title={dropped.title(what)} detail={dropped.detail} onDismiss={onDismiss} />;
  }
  if (pending.maybeSent) {
    return (
      <TxBanner
        {...shared}
        state="waiting"
        title={`${what} may have gone through. Waiting for the network…`}
        detail={maybeSentDetail(pending)}
      />
    );
  }
  const until = validUntil(pending);
  return (
    <TxBanner
      {...shared}
      state={watching ? "waiting" : "stale"}
      title={watching ? `${what} sent. Waiting for the network…` : `${what} not confirmed yet`}
      detail={
        !watching && until
          ? `The network hasn't shown it yet. It can land until about ${until}, and the wallet keeps watching: if it hasn't landed by then, nothing was sent, and its UTxOs count in your balance again.`
          : undefined
      }
      onDismiss={watching ? undefined : onDismiss}
    />
  );
}
