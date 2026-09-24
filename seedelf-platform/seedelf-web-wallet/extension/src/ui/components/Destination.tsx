// Where a payment goes: a Cardano address or an ADA Handle, read as it's
// typed (a handle asks Koios), with Contacts to pick from and to save it to.
// Withdraw and Send share it; each screen says what's special about its own
// account.

import { useEffect, useState } from "react";

import type { WithdrawDestination } from "../../shared/rpc";
import { call } from "../background";
import { shortHex } from "../format";
import { ContactEditor, ContactPicker, useContacts } from "./Contacts";

export type DestinationRead =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "read"; destination: WithdrawDestination }
  | { state: "error"; message: string };

/** Wait this long after the last key press before reading the destination (a handle asks Koios). */
const SETTLE_MS = 400;

/** The destination typed in `to`, read once typing settles. */
export function useDestination(to: string): DestinationRead {
  const [read, setRead] = useState<DestinationRead>({ state: "idle" });
  const destination = to.trim();
  useEffect(() => {
    if (!destination) {
      setRead({ state: "idle" });
      return;
    }
    let current = true;
    setRead({ state: "reading" });
    const timer = setTimeout(() => {
      call("resolve-destination", { to: destination }).then(
        (d) => current && setRead({ state: "read", destination: d }),
        (e: Error) => current && setRead({ state: "error", message: e.message }),
      );
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [destination]);
  return read;
}

export function DestinationField({
  id,
  value,
  onChange,
  read,
}: {
  id: string;
  value: string;
  onChange: (to: string) => void;
  read: DestinationRead;
}) {
  const [contacts, reloadContacts] = useContacts();
  const [contactModal, setContactModal] = useState<"pick" | "save">();
  const hasContacts = !!contacts?.some((c) => c.kind === "address");
  // What a contact holds for this destination: the $handle as typed, or the address.
  const saveable =
    read.state === "read" ? (read.destination.handle ? `$${read.destination.handle}` : read.destination.address) : undefined;
  const savedAs = saveable ? contacts?.find((c) => c.kind === "address" && c.value === saveable) : undefined;

  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>To</label>
        {hasContacts && (
          <button type="button" className="link" onClick={() => setContactModal("pick")}>
            Contacts
          </button>
        )}
      </div>
      <input
        id={id}
        className="seedelf-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="addr_test1… or $handle"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        aria-invalid={read.state === "error" ? true : undefined}
        aria-describedby={`${id}-note`}
      />
      <div id={`${id}-note`} data-testid={`${id}-note`}>
        {read.state === "reading" ? (
          <p className="note">Reading it…</p>
        ) : read.state === "error" ? (
          <p className="field-note" role="alert">
            {read.message}
          </p>
        ) : read.state === "read" ? (
          <p className="note">
            {read.destination.handle ? `$${read.destination.handle} is ` : "Sends to "}
            <code title={read.destination.address}>{shortHex(read.destination.address, 14, 8)}</code>
            {savedAs ? (
              <> · your contact {savedAs.name}</>
            ) : (
              !read.destination.own &&
              contacts && (
                <>
                  {" · "}
                  <button type="button" className="link" onClick={() => setContactModal("save")}>
                    Save to contacts
                  </button>
                </>
              )
            )}
          </p>
        ) : (
          <p className="note">A Cardano address, or an ADA Handle like $name. Looking up a handle tells Koios which one.</p>
        )}
      </div>
      {contactModal === "pick" && (
        <ContactPicker
          contacts={contacts ?? []}
          kind="address"
          onClose={() => setContactModal(undefined)}
          onPick={(picked) => {
            onChange(picked);
            setContactModal(undefined);
          }}
        />
      )}
      {contactModal === "save" && saveable && (
        <ContactEditor
          value={saveable}
          onClose={() => setContactModal(undefined)}
          onSaved={(next) => {
            reloadContacts(next);
            setContactModal(undefined);
          }}
        />
      )}
    </div>
  );
}
