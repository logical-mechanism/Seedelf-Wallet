// A link to a transaction, or an account, on Cardanoscan. It opens in the
// browser's own profile, with Cardanoscan's cookies, any login there and its
// trackers, and it lands in the browser's history (and Google's, with
// History sync). On the public side that tells Cardanoscan what Koios
// already ties to the account, so the link stays plain. On the private side,
// where only this wallet can tell what's the user's, the link carries the
// UTxOs screen's warning (privacy review §3.4). Copy stays wherever it is.

import { useId, type ReactNode } from "react";
import { useT, type I18nKey } from "../../i18n";

import type { NetworkName } from "../../networks";
import { explorerAddressUrl, explorerUrl } from "../format";
import { ExternalIcon } from "./Icons";

/**
 * What a private link tells Cardanoscan, and the browser's history, is the
 * user's. One key a case, not one sentence with the noun dropped into it:
 * "this transaction"/"this account" doesn't decline the same way everywhere.
 */
export function explorerWarningKey(what: "transaction" | "transactions" | "account"): I18nKey {
  if (what === "transactions") return "explorer.privacy.transactions";
  return what === "account" ? "explorer.privacy.account" : "explorer.privacy.transaction";
}

/** The warning on its own: under a group of private links, each shown with `note={false}`. */
export function ExplorerNote({ what, id }: { what: "transaction" | "transactions" | "account"; id?: string }) {
  const t = useT();
  return (
    <p className="note explorer-note" id={id} data-testid="explorer-note">
      {t(explorerWarningKey(what))}
    </p>
  );
}

export function ExplorerLink({
  network,
  tx,
  address,
  private: isPrivate = false,
  note = true,
  className = "menu-link",
  children,
}: {
  network: NetworkName;
  /** The transaction's hash; or `address`, a whole account. */
  tx?: string;
  address?: string;
  /** On the private side: the link says what opening it tells. */
  private?: boolean;
  /** False where one note, under the group, says it for every link (ExplorerNote). */
  note?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const noteId = useId();
  const href = address !== undefined ? explorerAddressUrl(network, address) : explorerUrl(network, tx ?? "");
  const noted = isPrivate && note;
  return (
    <>
      <a
        className={className}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-describedby={noted ? noteId : undefined}
        title={isPrivate && !note ? t(explorerWarningKey(address !== undefined ? "account" : "transaction")) : undefined}
      >
        {children}
        <ExternalIcon size={12} />
      </a>
      {noted && <ExplorerNote what={address !== undefined ? "account" : "transaction"} id={noteId} />}
    </>
  );
}
