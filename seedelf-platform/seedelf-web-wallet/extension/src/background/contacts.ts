// Contacts: names for the seedelfs and addresses this wallet pays, after
// Lace's address book. Who someone pays is private, so they're kept in the
// wallet's private store (sealed on the device, unreadable while locked) and
// checked here without asking anyone: a seedelf name by its shape, an address
// by WebAssembly's rule for a withdrawal's destination, and an ADA Handle by
// its shape only (it's looked up when a withdrawal uses it).

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Contact } from "../shared/rpc";
import { seedelfName } from "../shared/seedelf-name";
import type { PrivateStore } from "./private-store";
import { HANDLE } from "./withdraw";

/** The longest name a contact can have. */
export const CONTACT_NAME_MAX = 40;

export class ContactsService {
  /** Saves happen one at a time, so two can't overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: { wasm: typeof Wasm; store: PrivateStore; random?: () => string }) {}

  /** This network's contacts, by name. Throws if locked. */
  async list(network: NetworkName): Promise<Contact[]> {
    const all = (await this.deps.store.get<Contact[]>("contacts")) ?? [];
    return all
      .filter((c) => c.network === network)
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }

  /** Adds a contact, or renames and re-points the one with `id`. Returns this network's contacts. */
  save(network: NetworkName, contact: { id?: string; name: string; value: string }): Promise<Contact[]> {
    return this.serial(async () => {
      const name = contact.name.trim();
      if (!name) throw new Error("Give the contact a name.");
      if (name.length > CONTACT_NAME_MAX) throw new Error(`A contact's name is at most ${CONTACT_NAME_MAX} characters.`);
      const { kind, value } = this.check(network, contact.value);

      const all = (await this.deps.store.get<Contact[]>("contacts")) ?? [];
      const same = all.find((c) => c.network === network && c.value === value && c.id !== contact.id);
      if (same) throw new Error(`That's already saved, as ${same.name}.`);
      const id = contact.id ?? this.deps.random?.() ?? crypto.randomUUID();
      const next: Contact = { id, name, kind, value, network };
      await this.deps.store.set("contacts", [...all.filter((c) => c.id !== id), next]);
      return this.list(network);
    });
  }

  remove(network: NetworkName, id: string): Promise<Contact[]> {
    return this.serial(async () => {
      const all = (await this.deps.store.get<Contact[]>("contacts")) ?? [];
      await this.deps.store.set(
        "contacts",
        all.filter((c) => c.id !== id),
      );
      return this.list(network);
    });
  }

  /** What `text` is: a seedelf's full name, an ADA Handle, or a payable address on `network`. */
  private check(network: NetworkName, text: string): Pick<Contact, "kind" | "value"> {
    const seedelf = seedelfName(text);
    if (seedelf) return { kind: "seedelf", value: seedelf };
    const trimmed = text.trim();
    if (trimmed.startsWith("$")) {
      const handle = trimmed.slice(1).toLowerCase();
      if (!HANDLE.test(handle)) throw new Error("An ADA Handle is $ and up to 28 letters, digits, or . _ - @.");
      return { kind: "address", value: `$${handle}` };
    }
    const { wasm } = this.deps;
    try {
      wasm.checkWithdrawAddress(trimmed, network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod);
    } catch (e) {
      throw new Error(`That isn't a seedelf's full name, a $handle, or an address you can pay. ${(e as Error).message}`);
    }
    return { kind: "address", value: trimmed };
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
