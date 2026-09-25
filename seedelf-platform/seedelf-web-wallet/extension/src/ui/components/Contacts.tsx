// Contacts in the UI: the list in Settings, a modal to add or change one, a
// picker for Send to a seedelf (seedelfs), Withdraw (addresses and $handles)
// and Send from the Cardano account (either), and a "Save to contacts" link
// for a destination that isn't saved yet. The worker
// keeps them sealed on the device (contacts.ts); nothing here asks Koios.

import { useCallback, useEffect, useState } from "react";

import type { Contact } from "../../shared/rpc";
import { call } from "../background";
import { shortHex } from "../format";
import { initials } from "../tokens";
import { Callout } from "./Callout";
import { SearchIcon } from "./Icons";
import { Modal } from "./Modal";

/** This network's contacts, and a way to read them again. */
export function useContacts(): [Contact[] | undefined, (next?: Contact[]) => void] {
  const [contacts, setContacts] = useState<Contact[]>();
  const reload = useCallback((next?: Contact[]) => {
    if (next) setContacts(next);
    else call("contacts", {}).then(setContacts, () => setContacts([]));
  }, []);
  useEffect(() => reload(), [reload]);
  return [contacts, reload];
}

/** How a contact's value reads in a list: a seedelf or an address shortened, a $handle as is. */
export const shortValue = (c: Pick<Contact, "value">) => (c.value.startsWith("$") ? c.value : shortHex(c.value, 12, 6));

function ContactRow({ contact, onClick, label }: { contact: Contact; onClick: () => void; label?: string }) {
  return (
    <li>
      <button type="button" className="token-row" onClick={onClick} aria-label={label ?? contact.name}>
        <span className="avatar avatar--contact" aria-hidden="true">
          {initials(contact.name)}
        </span>
        <span className="token-row__label">{contact.name}</span>
        <span className="token-row__amount note">{contact.kind === "seedelf" ? "Seedelf" : "Address"}</span>
        <code className="token-row__sub">{shortValue(contact)}</code>
      </button>
    </li>
  );
}

/** Picks a contact of `kind` (any, without one) for a form's destination. */
export function ContactPicker({
  contacts,
  kind,
  onPick,
  onClose,
}: {
  contacts: Contact[];
  kind?: Contact["kind"];
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const found = contacts.filter(
    (c) => (!kind || c.kind === kind) && (!q || c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)),
  );
  return (
    <Modal title="Contacts" titleId="contact-picker-title" onClose={onClose}>
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label="Search contacts"
          placeholder="Name or value"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </label>
      {found.length ? (
        <ul className="list" data-testid="contact-picker">
          {found.map((c) => (
            <ContactRow key={c.id} contact={c} onClick={() => onPick(c.value)} />
          ))}
        </ul>
      ) : (
        <p className="note center empty">{q ? `No contacts match “${query.trim()}”.` : "No contacts of this kind yet."}</p>
      )}
    </Modal>
  );
}

/** Adds a contact (with `value` filled in, from a form), or changes or deletes `contact`. */
export function ContactEditor({
  contact,
  value: given,
  onClose,
  onSaved,
}: {
  contact?: Contact;
  value?: string;
  onClose: () => void;
  onSaved: (contacts: Contact[]) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [value, setValue] = useState(contact?.value ?? given ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(task: () => Promise<Contact[]>) {
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await task());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const save = () => {
    if (!busy && name.trim() && value.trim()) void run(() => call("contact-save", { id: contact?.id, name, value }));
  };

  return (
    <Modal
      title={contact ? "Edit contact" : given !== undefined ? "Save to contacts" : "Add a contact"}
      titleId="contact-editor-title"
      onClose={onClose}
      foot={
        <>
          {contact && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void run(() => call("contact-remove", { id: contact.id }))}
            >
              Delete
            </button>
          )}
          <button type="button" className="primary" disabled={busy || !name.trim() || !value.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="contact-name">Name</label>
          <input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            maxLength={40}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="contact-value">Seedelf name, address or $handle</label>
          <textarea
            id="contact-value"
            className="seedelf-name"
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            readOnly={given !== undefined && !contact}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="note">Contacts are encrypted on this device, and can't be read while the wallet is locked.</p>
      </div>
    </Modal>
  );
}

/** Settings' contacts: every one on this network, to add, change or delete. */
export function ContactsPage({ contacts, onChange }: { contacts: Contact[] | undefined; onChange: (c: Contact[]) => void }) {
  const [editing, setEditing] = useState<Contact | "new">();
  const done = (next: Contact[]) => {
    setEditing(undefined);
    onChange(next);
  };
  return (
    <>
      {contacts === undefined ? (
        <p className="note">Opening your contacts…</p>
      ) : contacts.length ? (
        <section className="section" aria-label="Your contacts">
          <ul className="list" data-testid="contacts">
            {contacts.map((c) => (
              <ContactRow key={c.id} contact={c} onClick={() => setEditing(c)} label={`Edit ${c.name}`} />
            ))}
          </ul>
        </section>
      ) : (
        <Callout tone="info">
          No contacts yet. Save a Seedelf or an address you pay often, then pick it in Send or Make public.
        </Callout>
      )}
      <button type="button" className="secondary" onClick={() => setEditing("new")}>
        Add a contact
      </button>
      {editing && (
        <ContactEditor
          contact={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={done}
        />
      )}
    </>
  );
}
