// What a Max review left where it is, and why, UTxO by UTxO (launch review
// H6 and #12). Max takes everything it can, but not a UTxO whose token
// would total more with the rest than one output can hold (it comes with a
// later payment), nor one holding a reference script the wallet can't spend,
// nor one a return through Lovejoin still being sent spends (final review
// lovejoin-3). Without this, "everything" would quietly not be.

import { useT, type I18nKey } from "../../i18n";
import type { LeftOutUtxo } from "../../shared/rpc";
import { shortHex } from "../format";
import { Callout } from "./Callout";

/** Why a UTxO was left out, after its outpoint. */
export function leftOutReasonKey(reason: LeftOutUtxo["reason"]): I18nKey {
  if (reason === "tokens") return "leftOut.reason.tokens";
  if (reason === "returning") return "leftOut.reason.returning";
  return "leftOut.reason.script";
}

/** Max's review: each UTxO it left out, and why; nothing when it took them all. */
export function LeftOutNote({ leftOut, testId }: { leftOut?: LeftOutUtxo[]; testId: string }) {
  const t = useT();
  if (!leftOut?.length) return null;
  const tokens = leftOut.some((u) => u.reason === "tokens");
  return (
    <Callout tone="info" testId={testId}>
      {t("leftOut.leaves", { count: leftOut.length })}
      <ul className="dapp-points left-out">
        {leftOut.map((u) => (
          <li key={`${u.txHash}#${u.txIndex}`}>
            <code>
              {shortHex(u.txHash, 8, 4)}#{u.txIndex}
            </code>{" "}
            {t(leftOutReasonKey(u.reason))}
          </li>
        ))}
      </ul>
      {tokens && t("leftOut.tokensWait")}
    </Callout>
  );
}
