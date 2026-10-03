// A warning before an ADA Handle goes into Seedelf: a wallet paying `$name`
// pays the address holding it, and in a private balance that's the Seedelf
// contract, with no register to say whose the payment is, so anyone can take
// it (shared/handles.ts). A session's return takes everything at its
// account, a handle a site gave it included, so its review warns too, and
// says what to do once it's back (launch review #57).
//
// Four whole sentences rather than one assembled from six fragments: how many
// handles there are changes different words in different languages, and where
// "and this return brings them in" sits in the sentence is the translator's
// choice, not English's.

import { useT } from "../../i18n";
import { handlesIn } from "../../shared/handles";
import type { TokenRef } from "../../shared/rpc";
import { Callout } from "./Callout";

export function HandleWarning({ tokens, returning = false }: { tokens: TokenRef[]; returning?: boolean }) {
  const t = useT();
  const handles = handlesIn(tokens);
  if (!handles.length) return null;
  const names = handles.map((h) => `$${h}`).join(", ");
  return (
    <Callout tone="warn" testId="handle-into-seedelf">
      {t(returning ? "handleWarning.returning" : "handleWarning.note", { names, count: handles.length })}
    </Callout>
  );
}
