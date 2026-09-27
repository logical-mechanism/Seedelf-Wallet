// What a Max review left where it is, and why, UTxO by UTxO (launch review
// H6 and #12). Max takes everything it can, but not a UTxO whose token
// would total more with the rest than one output can hold (it comes with a
// later payment), nor one holding a reference script the wallet can't spend,
// nor one a return through Lovejoin still being sent spends (final review
// lovejoin-3). Without this, "everything" would quietly not be.

import type { LeftOutUtxo } from "../../shared/rpc";
import { plural, shortHex } from "../format";
import { Callout } from "./Callout";

/** Why a UTxO was left out, after its outpoint. */
export function leftOutReason(reason: LeftOutUtxo["reason"]): string {
  if (reason === "tokens") return "comes with a later payment";
  if (reason === "returning") return "waits for a return through Lovejoin that's still being sent, which adds to it";
  return "holds a reference script the wallet can't spend";
}

/** Max's review: each UTxO it left out, and why; nothing when it took them all. */
export function LeftOutNote({ leftOut, testId }: { leftOut?: LeftOutUtxo[]; testId: string }) {
  if (!leftOut?.length) return null;
  const tokens = leftOut.some((u) => u.reason === "tokens");
  return (
    <Callout tone="info" testId={testId}>
      Max leaves {plural(leftOut.length, "UTxO")} where {leftOut.length === 1 ? "it is" : "they are"}:
      <ul className="dapp-points left-out">
        {leftOut.map((u) => (
          <li key={`${u.txHash}#${u.txIndex}`}>
            <code>
              {shortHex(u.txHash, 8, 4)}#{u.txIndex}
            </code>{" "}
            {leftOutReason(u.reason)}
          </li>
        ))}
      </ul>
      {tokens && "A token it holds would add up to more with the rest than one output can hold, so it waits for the next payment."}
    </Callout>
  );
}
