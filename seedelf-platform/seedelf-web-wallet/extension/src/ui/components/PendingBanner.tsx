// The one sent transaction the wallet watches, as a banner: Home's, and on a
// dApp page such as Lovejoin's, where a withdraw or a mix is sent from. Home
// asks the worker about it every 15 s while it waits, wherever the user is.
// One Koios didn't answer may have gone through, and says so; one that never
// landed says that nothing was sent, or most likely wasn't (pending.ts).

import type { PendingTx } from "../../shared/rpc";
import { TxBanner } from "./TxBanner";

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

/** Why a payment Koios didn't answer is still shown as on its way. */
const MAYBE_SENT =
  "Koios didn't answer when it was sent. The wallet sends it again now and then, which is safe: the network takes it only once. " +
  "New payments wait until it lands, or until it can't any more.";

export function PendingBanner({ pending, watching, onDismiss }: { pending: PendingTx; watching: boolean; onDismiss: () => void }) {
  const what = SENT[pending.kind];
  const shared = { network: pending.network, txHash: pending.txHash, testId: "pending-tx" };
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
        state={watching ? "waiting" : "stale"}
        title={watching ? `${what} may have gone through. Waiting for the network…` : `${what} may have gone through`}
        detail={MAYBE_SENT}
        onDismiss={watching ? undefined : onDismiss}
      />
    );
  }
  return (
    <TxBanner
      {...shared}
      state={watching ? "waiting" : "stale"}
      title={watching ? `${what} sent. Waiting for the network…` : `${what} not confirmed yet`}
      onDismiss={watching ? undefined : onDismiss}
    />
  );
}
