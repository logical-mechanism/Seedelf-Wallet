// Contacts in the UI: the list in Settings, a modal to add or change one, a
// picker for Send to a seedelf (seedelfs), Withdraw (addresses and $handles)
// and Send from the Cardano account (either), and a "Save to contacts" link
// for a destination that isn't saved yet. The worker
// keeps them sealed on the device (contacts.ts); nothing here asks Koios.

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";

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
  const tr = useT();
  return (
    <li>
      <button type="button" className="token-row" onClick={onClick} aria-label={label ?? contact.name}>
        <span className="avatar avatar--contact" aria-hidden="true">
          {initials(contact.name)}
        </span>
        <span className="token-row__label">{contact.name}</span>
        <span className="token-row__amount note">
          {contact.kind === "seedelf" ? "Seedelf" : tr("contacts.kind.address")}
        </span>
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
  const t = useT();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const found = contacts.filter(
    (c) => (!kind || c.kind === kind) && (!q || c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)),
  );
  return (
    <Modal title={t("contacts.title")} titleId="contact-picker-title" onClose={onClose}>
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label={t("contacts.search")}
          placeholder={t("contacts.searchPlaceholder")}
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
        <p className="note center empty">{q ? t("contacts.noneMatch", { query: query.trim() }) : t("contacts.noneOfKind")}</p>
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
  const t = useT();
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
      title={t(contact ? "contacts.edit" : given !== undefined ? "destination.saveToContacts" : "contacts.add")}
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
              {t("contacts.delete")}
            </button>
          )}
          <button type="button" className="primary" disabled={busy || !name.trim() || !value.trim()} onClick={save}>
            {t("contacts.save")}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="contact-name">{t("contacts.nameLabel")}</label>
          <input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            maxLength={40}
            autoComplete="off"
            // Chrome's enhanced spell check sends what's typed to Google: a name stays on the device.
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="contact-value">{t("contacts.valueLabel")}</label>
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
        <p className="note">{t("contacts.privacy.encrypted")}</p>
      </div>
    </Modal>
  );
}

/** Settings' contacts: every one on this network, to add, change or delete. */
export function ContactsPage({ contacts, onChange }: { contacts: Contact[] | undefined; onChange: (c: Contact[]) => void }) {
  const t = useT();
  const [editing, setEditing] = useState<Contact | "new">();
  const done = (next: Contact[]) => {
    setEditing(undefined);
    onChange(next);
  };
  return (
    <>
      {contacts === undefined ? (
        <p className="note">{t("contacts.opening")}</p>
      ) : contacts.length ? (
        <section className="section" aria-label={t("contacts.yours")}>
          <ul className="list" data-testid="contacts">
            {contacts.map((c) => (
              <ContactRow key={c.id} contact={c} onClick={() => setEditing(c)} label={t("contacts.editOne", { name: c.name })} />
            ))}
          </ul>
        </section>
      ) : (
        <Callout tone="info">
          {t("contacts.empty")}
        </Callout>
      )}
      <button type="button" className="secondary" onClick={() => setEditing("new")}>
        {t("contacts.add")}
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
