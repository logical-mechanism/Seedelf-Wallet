// What a private session leaves at its one-time account, and why (launch
// review H6), on every session's page and return: UTxOs no return of the
// wallet's takes (`leftBehind`: a reference script it can't price, or too
// little to pay its own way back, a stranger's tokens say), which stay there
// and don't hold the session open; and what one return leaves for the next
// (`leftOut`: a token that would add up to more with the rest than an output
// can hold, or more than one transaction holds). Without this, "everything
// came back" wouldn't quite be true.

import type { LeftBehindUtxo, LeftOutUtxo } from "../../shared/rpc";
import { t, useT } from "../../i18n";
import { shortHex } from "../format";
import { useAmounts } from "../preferences";
import { Callout } from "./Callout";

/** Why no return takes a UTxO at a session's account, after its outpoint. */
export function leftBehindReason(reason: LeftBehindUtxo["reason"]): string {
  return t(reason === "script" ? "sessionLeft.behind.script" : "sessionLeft.behind.tooLittle");
}

/** Why a return leaves a UTxO at the session's account, after its outpoint. */
export function returnLeftOutReason(reason: LeftOutUtxo["reason"]): string {
  if (reason === "tokens" || reason === "size") return t("sessionLeft.out.nextReturn");
  // Someone else's tokens: the session's own ADA never pays for their deposit (independent review H1, H2).
  if (reason === "cost") return t("sessionLeft.out.cost");
  return t("sessionLeft.out.script");
}

const outpoint = (u: { txHash: string; txIndex: number }) => (
  <code>
    {shortHex(u.txHash, 8, 4)}#{u.txIndex}
  </code>
);

/**
 * A session's page: what stays at its account, UTxO by UTxO; nothing when no
 * return leaves anything. `name` names the session ("private session 3"),
 * where a page has several.
 */
export function LeftBehindNote({ leftBehind, name }: { leftBehind?: LeftBehindUtxo[]; name?: string }) {
  const tr = useT();
  const amounts = useAmounts();
  if (!leftBehind?.length) return null;
  return (
    <Callout tone="info" testId="session-left-behind">
      {tr(name ? "sessionLeft.behind.named" : "sessionLeft.behind.unnamed", { count: leftBehind.length, name })}
      <ul className="dapp-points left-out">
        {leftBehind.map((u) => (
          <li key={`${u.txHash}#${u.txIndex}`}>
            {outpoint(u)} ({amounts.ada(u.lovelace)}{"\u00a0₳"}) {leftBehindReason(u.reason)}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/**
 * A return's review: what it leaves at the session's account this time, and
 * why. A swap that runs itself brings the rest back by itself; a return the
 * user reviews needs another. `name` names the session ("private session
 * 3"), where a review has several.
 */
export function ReturnLeftOut({ leftOut, name }: { leftOut?: LeftOutUtxo[]; name?: string }) {
  const tr = useT();
  if (!leftOut?.length) return null;
  const tokens = leftOut.some((u) => u.reason === "tokens");
  const size = !tokens && leftOut.some((u) => u.reason === "size");
  return (
    <Callout tone="info" testId="return-left-out">
      {name
        ? tr("sessionLeft.out.leavesNamed", { name: `${name.charAt(0).toUpperCase()}${name.slice(1)}`, count: leftOut.length })
        : tr("sessionLeft.out.leaves", { count: leftOut.length })}
      <ul className="dapp-points left-out">
        {leftOut.map((u) => (
          <li key={`${u.txHash}#${u.txIndex}`}>
            {outpoint(u)} {returnLeftOutReason(u.reason)}
          </li>
        ))}
      </ul>
      {tokens && tr("sessionLeft.out.tokensNote")}
      {size && tr("sessionLeft.out.sizeNote")}
    </Callout>
  );
}
