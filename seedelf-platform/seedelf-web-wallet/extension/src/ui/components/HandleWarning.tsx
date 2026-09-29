// A warning before an ADA Handle goes into Seedelf: a wallet paying `$name`
// pays the address holding it, and in a private balance that's the Seedelf
// contract, with no register to say whose the payment is, so anyone can take
// it (shared/handles.ts). A session's return takes everything at its
// account, a handle a site gave it included, so its review warns too, and
// says what to do once it's back (launch review #57).

import { handlesIn } from "../../shared/handles";
import type { TokenRef } from "../../shared/rpc";
import { Callout } from "./Callout";

export function HandleWarning({ tokens, returning = false }: { tokens: TokenRef[]; returning?: boolean }) {
  const handles = handlesIn(tokens);
  if (!handles.length) return null;
  const names = handles.map((h) => `$${h}`).join(", ");
  const one = handles.length === 1;
  return (
    <Callout tone="warn" testId="handle-into-seedelf">
      {names} {one ? "is an ADA Handle" : "are ADA Handles"}
      {returning ? `, and this return brings ${one ? "it" : "them"} into your private balance` : ""}. In a private
      balance, anyone who pays {one ? "it" : "one"} from another wallet pays the Seedelf contract with nothing to say whose
      the payment is, so anyone can take it.{" "}
      {returning
        ? `Once ${one ? "it's" : "they're"} back, make ${one ? "it" : "them"} public to your public account.`
        : "Keep handles in a public account."}
    </Callout>
  );
}
