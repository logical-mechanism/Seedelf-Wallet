// Where a payment goes: a Cardano address or an ADA Handle, read as it's
// typed (a handle asks Koios), with Contacts to pick from and to save it to.
// Withdraw and Send share it; each screen says what's special about its own
// account. Send also takes a seedelf's whole name (`seedelfs`), found in the
// wallet contract as Send to a seedelf finds it, never by asking Koios about
// it; your own seedelfs are Move in's. With several recipients, each has its
// own field (`DestinationInput`), which reports what it read.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { SeedelfLookup, WithdrawDestination } from "../../shared/rpc";
import { OWN_SEEDELF_FROM_ACCOUNT, SEEDELF_NAME_RULE, SEEDELF_PREFIX, seedelfName } from "../../shared/seedelf-name";
import { call } from "../background";
import { shortHex } from "../format";
import { useNetwork } from "../network";
import { useAccounts } from "../accounts";
import { AccountRecipients } from "./AccountRecipients";
import { Clearable } from "./Clearable";
import { ContactEditor, ContactPicker, useContacts } from "./Contacts";

export type DestinationRead =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "read"; destination: WithdrawDestination }
  | { state: "seedelf"; seedelf: SeedelfLookup }
  | { state: "error"; message: string };

/** How an address on `network` starts, for the To field's hint: a mainnet wallet never asks for a testnet one. */
export const addressHint = (network: NetworkName) => (network === "mainnet" ? "addr1…" : "addr_test1…");

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
      setRead({ state: "error", message: SEEDELF_NAME_RULE() });
      return;
    }
    let current = true;
    setRead({ state: "reading" });
    const timer = setTimeout(() => {
      const reading: Promise<DestinationRead> = name
        ? call("seedelf-lookup", { to: name }).then((s) =>
            s.own ? { state: "error", message: OWN_SEEDELF_FROM_ACCOUNT() } : { state: "seedelf", seedelf: s },
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
  ownAccounts = false,
}: {
  id: string;
  value: string;
  onChange: (to: string) => void;
  /** What this field reported last, kept by the form. */
  known?: KnownRead;
  onRead: (read: KnownRead) => void;
  seedelfs?: boolean;
  /** Offer the wallet's own other public accounts as recipients (chunk 18). */
  ownAccounts?: boolean;
}) {
  const read = useDestination(value, { seedelfs, known });
  const report = useRef(onRead);
  report.current = onRead;
  const to = value.trim();
  useEffect(() => report.current({ to, read }), [to, read]);
  return (
    <DestinationField id={id} value={value} onChange={onChange} read={read} seedelfs={seedelfs} ownAccounts={ownAccounts} />
  );
}

export function DestinationField({
  id,
  value,
  onChange,
  read,
  seedelfs = false,
  ownAccounts = false,
}: {
  id: string;
  value: string;
  onChange: (to: string) => void;
  read: DestinationRead;
  /** A seedelf's name is a destination too (Send from the Cardano account). */
  seedelfs?: boolean;
  /**
   * Offer the wallet's own other public accounts as recipients (chunk 18).
   * The public Send does; Make public doesn't, where the destination is
   * already about leaving the private balance.
   */
  ownAccounts?: boolean;
}) {
  const t = useT();
  const [contacts, reloadContacts] = useContacts();
  const [contactModal, setContactModal] = useState<"pick" | "save">();
  const [accountModal, setAccountModal] = useState(false);
  const { several } = useAccounts();
  const address = addressHint(useNetwork());
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
  // Each "·" starts what it leads to, never ends a line: a no-break space after it, and Save to contacts wraps whole
  // with it (the visual review of pass two: the dot was left at a line's end).
  const saveLink = savedAs ? (
    <>{" ·\u00a0"}{t("destination.yourContact", { name: savedAs.name })}</>
  ) : (
    contacts && (
      <>
        {" "}
        <span className="note-part">
          {"·\u00a0"}
          <button type="button" className="link" onClick={() => setContactModal("save")}>
            {t("destination.saveToContacts")}
          </button>
        </span>
      </>
    )
  );

  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{t("destination.to")}</label>
        {hasContacts && (
          <button type="button" className="link" onClick={() => setContactModal("pick")}>
            {t("destination.contacts")}
          </button>
        )}
        {/* Only with another account to offer: with one, there is nothing to pick. */}
        {ownAccounts && several && (
          <button type="button" className="link" onClick={() => setAccountModal(true)}>
            {t("destination.yourAccounts")}
          </button>
        )}
      </div>
      <Clearable id={id} value={value} onClear={() => onChange("")} what={t(seedelfs ? "destination.what.recipient" : "destination.what.address")}>
        <input
          id={id}
          className="seedelf-name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(seedelfs ? "destination.placeholderSeedelf" : "destination.placeholder", { address })}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-invalid={read.state === "error" ? true : undefined}
          aria-describedby={`${id}-note`}
        />
      </Clearable>
      <div id={`${id}-note`} data-testid={`${id}-note`}>
        {read.state === "reading" ? (
          <p className="note">{t("destination.reading")}</p>
        ) : read.state === "error" ? (
          <p className="field-note" role="alert">
            {read.message}
          </p>
        ) : read.state === "seedelf" ? (
          <p className="note">
            {t("destination.found")}{" "}
            {read.seedelf.label && <><strong>{read.seedelf.label}</strong>{" ·\u00a0"}</>}
            <code title={read.seedelf.name}>{shortHex(read.seedelf.name, 12, 6)}</code>
            {saveLink}
          </p>
        ) : read.state === "read" ? (
          <p className="note">
            {`${read.destination.handle ? t("destination.handleIs", { handle: read.destination.handle }) : t("destination.sendsTo")} `}
            <code title={read.destination.address}>{shortHex(read.destination.address, 14, 8)}</code>
            {(savedAs || !read.destination.own) && saveLink}
          </p>
        ) : (
          // What may go in the field is the placeholder's to say: this says only what looking it up tells Koios.
          <p className="note">{t("destination.privacy.hint")}</p>
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
      {/* Picking one only fills the field: it is then read, and said, like any
          other address — including the note naming the account (chunk 18). */}
      {accountModal && (
        <AccountRecipients
          onClose={() => setAccountModal(false)}
          onPick={(address) => {
            onChange(address);
            setAccountModal(false);
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
