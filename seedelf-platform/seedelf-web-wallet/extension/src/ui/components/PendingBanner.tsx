// The one sent transaction the wallet watches, as a banner: Home's, and on a
// dApp page such as Lovejoin's, where a withdraw or a mix is sent from. Home
// asks the worker about it every 15 s while it waits, wherever the user is.

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

export function PendingBanner({ pending, watching, onDismiss }: { pending: PendingTx; watching: boolean; onDismiss: () => void }) {
  const confirmed = pending.confirmations !== null;
  const what = SENT[pending.kind];
  return (
    <TxBanner
      state={confirmed ? "done" : watching ? "waiting" : "stale"}
      title={
        confirmed
          ? CONFIRMED[pending.kind]
          : watching
            ? `${what} sent. Waiting for the network…`
            : `${what} not confirmed yet`
      }
      network={pending.network}
      txHash={pending.txHash}
      onDismiss={watching ? undefined : onDismiss}
      testId="pending-tx"
    />
  );
}
