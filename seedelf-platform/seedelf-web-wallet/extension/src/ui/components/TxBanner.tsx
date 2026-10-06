// A sent transaction, as a banner: what's happening with a spinner or a
// tick, what it means when that needs saying, the transaction on
// Cardanoscan (a private one's with what opening it tells, ExplorerLink),
// and Dismiss once there's nothing to wait for. Centred, after
// Lace's toasts. Home's pending banner and the collateral's "waiting" both
// use it.

import type { ReactNode } from "react";
import { useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import { shortHex } from "../format";
import { ExplorerLink } from "./ExplorerLink";
import { DoneIcon, InfoIcon, SpinnerIcon } from "./Icons";

export function TxBanner({
  state,
  title,
  detail,
  network,
  txHash,
  onDismiss,
  testId,
  private: isPrivate = false,
}: {
  /** Waiting for the network, confirmed, or no longer watched. */
  state: "waiting" | "done" | "stale";
  title: ReactNode;
  /** What it means, under the title: for one that may have gone through, or never landed. */
  detail?: ReactNode;
  network: NetworkName;
  txHash: string;
  onDismiss?: () => void;
  testId: string;
  /** A private transaction: its link says what opening it tells Cardanoscan. */
  private?: boolean;
}) {
  const t = useT();
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
      {detail && (
        <div className="tx-banner__detail" data-testid={`${testId}-detail`}>
          {detail}
        </div>
      )}
      <ExplorerLink network={network} tx={txHash} private={isPrivate} className="banner__link">
        {t("txBanner.onCardanoscan", { hash: shortHex(txHash, 10, 6) })}
      </ExplorerLink>
      {onDismiss && (
        <button type="button" className="tx-banner__dismiss" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      )}
    </section>
  );
}
