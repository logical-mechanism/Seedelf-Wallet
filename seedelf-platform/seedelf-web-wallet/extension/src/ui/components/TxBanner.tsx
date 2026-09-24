// A sent transaction, as a banner: what's happening with a spinner or a
// tick, the transaction on Cardanoscan, and Dismiss once there's nothing to
// wait for. Centred, after Lace's toasts. Home's pending banner and the
// collateral's "waiting" both use it.

import type { ReactNode } from "react";

import type { NetworkName } from "../../networks";
import { explorerUrl, shortHex } from "../format";
import { DoneIcon, ExternalIcon, InfoIcon, SpinnerIcon } from "./Icons";

export function TxBanner({
  state,
  title,
  network,
  txHash,
  onDismiss,
  testId,
}: {
  /** Waiting for the network, confirmed, or no longer watched. */
  state: "waiting" | "done" | "stale";
  title: ReactNode;
  network: NetworkName;
  txHash: string;
  onDismiss?: () => void;
  testId: string;
}) {
  return (
    <section className={`callout tx-banner${state === "done" ? " callout--done" : ""}`} role="status" data-testid={testId}>
      <strong className="tx-banner__title">
        <span className="callout__icon">
          {state === "done" ? (
            <DoneIcon size={16} />
          ) : state === "waiting" ? (
            <span className="spin">
              <SpinnerIcon size={16} />
            </span>
          ) : (
            <InfoIcon size={16} />
          )}
        </span>
        {title}
      </strong>
      <a href={explorerUrl(network, txHash)} target="_blank" rel="noreferrer" className="banner__link">
        {shortHex(txHash, 10, 6)} on Cardanoscan
        <ExternalIcon size={12} />
      </a>
      {onDismiss && (
        <button type="button" className="tx-banner__dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </section>
  );
}
