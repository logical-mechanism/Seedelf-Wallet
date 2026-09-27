// What a private session leaves at its one-time account, and why (launch
// review H6), on every session's page and return: UTxOs no return of the
// wallet's takes (`leftBehind`: a reference script it can't price, or too
// little to pay its own way back), which stay there and don't hold the
// session open; and what one return leaves for the next (`leftOut`: a token
// that would add up to more with the rest than an output can hold). Without
// this, "everything came back" wouldn't quite be true.

import type { LeftBehindUtxo, LeftOutUtxo } from "../../shared/rpc";
import { plural, shortHex } from "../format";
import { useAmounts } from "../preferences";
import { Callout } from "./Callout";

/** Why no return takes a UTxO at a session's account, after its outpoint. */
export function leftBehindReason(reason: LeftBehindUtxo["reason"]): string {
  return reason === "script"
    ? "holds a reference script the wallet can't price, so no return can spend it"
    : "is too little, with what else is left there, to pay for its own way back";
}

/** Why a return leaves a UTxO at the session's account, after its outpoint. */
export function returnLeftOutReason(reason: LeftOutUtxo["reason"]): string {
  return reason === "tokens" ? "comes back with the next return" : "holds a reference script the wallet can't spend, so it stays there";
}

const outpoint = (u: { txHash: string; txIndex: number }) => (
  <code>
    {shortHex(u.txHash, 8, 4)}#{u.txIndex}
  </code>
);

/** A session's page: what stays at its account, UTxO by UTxO; nothing when no return leaves anything. */
export function LeftBehindNote({ leftBehind }: { leftBehind?: LeftBehindUtxo[] }) {
  const amounts = useAmounts();
  if (!leftBehind?.length) return null;
  const one = leftBehind.length === 1;
  return (
    <Callout tone="info" testId="session-left-behind">
      {one ? "One UTxO stays" : `${leftBehind.length} UTxOs stay`} at the session's account: no return takes{" "}
      {one ? "it" : "them"}, and {one ? "it doesn't" : "they don't"} keep the session open.
      <ul className="dapp-points left-out">
        {leftBehind.map((u) => (
          <li key={`${u.txHash}#${u.txIndex}`}>
            {outpoint(u)} ({amounts.ada(u.lovelace)} ₳) {leftBehindReason(u.reason)}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/**
 * A return's review: what it leaves at the session's account this time, and
 * why. A swap that runs itself brings the rest back by itself; a return the
 * user reviews needs another. `name` names the session, where a review has
 * several.
 */
export function ReturnLeftOut({ leftOut, name }: { leftOut?: LeftOutUtxo[]; name?: string }) {
  if (!leftOut?.length) return null;
  const tokens = leftOut.some((u) => u.reason === "tokens");
  return (
    <Callout tone="info" testId="return-left-out">
      {name ? `${name}'s return` : "This return"} leaves {plural(leftOut.length, "UTxO")} at the session's account:
      <ul className="dapp-points left-out">
        {leftOut.map((u) => (
          <li key={`${u.txHash}#${u.txIndex}`}>
            {outpoint(u)} {returnLeftOutReason(u.reason)}
          </li>
        ))}
      </ul>
      {tokens &&
        "A token it holds would add up to more with the rest than one output can hold. Once this return lands, bring the session back again for the rest."}
    </Callout>
  );
}
