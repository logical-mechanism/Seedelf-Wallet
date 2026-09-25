// Where a payment goes: a Cardano address or an ADA Handle, read as it's
// typed (a handle asks Koios), with Contacts to pick from and to save it to.
// Withdraw and Send share it; each screen says what's special about its own
// account. Send also takes a seedelf's whole name (`seedelfs`), found in the
// wallet contract as Send to a seedelf finds it, never by asking Koios about
// it; your own seedelfs are Move in's. With several recipients, each has its
// own field (`DestinationInput`), which reports what it read.

import { useEffect, useRef, useState } from "react";

import type { SeedelfLookup, WithdrawDestination } from "../../shared/rpc";
import { OWN_SEEDELF_FROM_ACCOUNT, SEEDELF_NAME_RULE, SEEDELF_PREFIX, seedelfName } from "../../shared/seedelf-name";
import { call } from "../background";
import { shortHex } from "../format";
import { ContactEditor, ContactPicker, useContacts } from "./Contacts";

export type DestinationRead =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "read"; destination: WithdrawDestination }
  | { state: "seedelf"; seedelf: SeedelfLookup }
  | { state: "error"; message: string };

/** Wait this long after the last key press before reading the destination (a handle asks Koios). */
const SETTLE_MS = 400;

/** What a field read, and for which text: a form keeps it, so a field that comes back (after Review) needn't read again. */
export interface KnownRead {
  to: string;
  read: DestinationRead;
}

/**
 * The destination typed in `to`, read once typing settles. With `seedelfs`,
 * a seedelf's name is looked up too. `known` is what was read before for
 * this same text, if anything: it's shown as is, without asking again.
 */
export function useDestination(to: string, { seedelfs = false, known }: { seedelfs?: boolean; known?: KnownRead } = {}): DestinationRead {
  const destination = to.trim();
  const reuse = known && known.to === destination && known.read.state !== "reading" ? known.read : undefined;
  const [read, setRead] = useState<DestinationRead>(reuse ?? { state: "idle" });
  const skip = useRef(reuse !== undefined);
  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (!destination) {
      setRead({ state: "idle" });
      return;
    }
    const name = seedelfs ? seedelfName(destination) : undefined;
    // Part of a seedelf's name: say what a whole one is, rather than "not an address".
    if (seedelfs && !name && destination.replace(/\s+/g, "").toLowerCase().startsWith(SEEDELF_PREFIX)) {
      setRead({ state: "error", message: SEEDELF_NAME_RULE });
      return;
    }
    let current = true;
    setRead({ state: "reading" });
    const timer = setTimeout(() => {
      const reading: Promise<DestinationRead> = name
        ? call("seedelf-lookup", { to: name }).then((s) =>
            s.own ? { state: "error", message: OWN_SEEDELF_FROM_ACCOUNT } : { state: "seedelf", seedelf: s },
          )
        : call("resolve-destination", { to: destination }).then((d) => ({ state: "read", destination: d }));
      reading.then(
        (r) => current && setRead(r),
        (e: Error) => current && setRead({ state: "error", message: e.message }),
      );
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [destination, seedelfs]);
  return read;
}

/** A destination field that reads what's typed itself and reports it, with the text it read: one per recipient. */
export function DestinationInput({
  id,
  value,
  onChange,
  known,
  onRead,
  seedelfs = false,
}: {
  id: string;
  value: string;
  onChange: (to: string) => void;
  /** What this field reported last, kept by the form. */
  known?: KnownRead;
  onRead: (read: KnownRead) => void;
  seedelfs?: boolean;
}) {
  const read = useDestination(value, { seedelfs, known });
  const report = useRef(onRead);
  report.current = onRead;
  const to = value.trim();
  useEffect(() => report.current({ to, read }), [to, read]);
  return <DestinationField id={id} value={value} onChange={onChange} read={read} seedelfs={seedelfs} />;
}

export function DestinationField({
  id,
  value,
  onChange,
  read,
  seedelfs = false,
}: {
  id: string;
  value: string;
  onChange: (to: string) => void;
  read: DestinationRead;
  /** A seedelf's name is a destination too (Send from the Cardano account). */
  seedelfs?: boolean;
}) {
  const [contacts, reloadContacts] = useContacts();
  const [contactModal, setContactModal] = useState<"pick" | "save">();
  const kind = seedelfs ? undefined : "address";
  const hasContacts = !!contacts?.some((c) => !kind || c.kind === kind);
  // What a contact holds for this destination: a seedelf's name, the $handle as typed, or the address.
  const saveable =
    read.state === "seedelf"
      ? read.seedelf.name
      : read.state === "read"
        ? read.destination.handle
          ? `$${read.destination.handle}`
          : read.destination.address
        : undefined;
  const savedAs = saveable ? contacts?.find((c) => c.value === saveable) : undefined;
  const saveLink = savedAs ? (
    <> · your contact {savedAs.name}</>
  ) : (
    contacts && (
      <>
        {" · "}
        <button type="button" className="link" onClick={() => setContactModal("save")}>
          Save to contacts
        </button>
      </>
    )
  );

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
        placeholder={seedelfs ? "addr_test1…, $handle or 5eed0e1f…" : "addr_test1… or $handle"}
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
        ) : read.state === "seedelf" ? (
          <p className="note">
            Found: {read.seedelf.label && <><strong>{read.seedelf.label}</strong> · </>}
            <code title={read.seedelf.name}>{shortHex(read.seedelf.name, 12, 6)}</code>
            {saveLink}
          </p>
        ) : read.state === "read" ? (
          <p className="note">
            {read.destination.handle ? `$${read.destination.handle} is ` : "Sends to "}
            <code title={read.destination.address}>{shortHex(read.destination.address, 14, 8)}</code>
            {(savedAs || !read.destination.own) && saveLink}
          </p>
        ) : seedelfs ? (
          <p className="note">
            A Cardano address, an ADA Handle like $name, or a Seedelf's whole name. Looking up a handle tells Koios which
            one.
          </p>
        ) : (
          <p className="note">A Cardano address, or an ADA Handle like $name. Looking up a handle tells Koios which one.</p>
        )}
      </div>
      {contactModal === "pick" && (
        <ContactPicker
          contacts={contacts ?? []}
          kind={kind}
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
