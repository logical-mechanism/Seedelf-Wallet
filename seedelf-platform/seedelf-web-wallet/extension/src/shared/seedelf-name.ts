// A seedelf's name is its whole token name: 32 bytes of hex starting with the
// 5eed0e1f prefix. Tags aren't unique (anyone can mint "alice"), so a
// seedelf is only ever paid by its full name.

/** The seedelf token-name prefix (lib/token_name.ak). */
export const SEEDELF_PREFIX = "5eed0e1f";

const NAME = /^5eed0e1f[0-9a-f]{56}$/;

/** A pasted seedelf name, tidied (spaces dropped, lowercase); undefined when it isn't a whole name. */
export function seedelfName(input: string): string | undefined {
  const name = input.replace(/\s+/g, "").toLowerCase();
  return NAME.test(name) ? name : undefined;
}

export const SEEDELF_NAME_RULE = "A Seedelf's name is 64 hex characters starting 5eed0e1f.";

/** Send from the Cardano account pays someone else's seedelf; paying your own is a move-in. */
export const OWN_SEEDELF_FROM_ACCOUNT = "That Seedelf is yours. To put money into your Seedelf balance, use Move in.";

/** Withdraw pays an address; a seedelf is paid by Send. */
export const SEEDELF_NOT_AN_ADDRESS = "That's a Seedelf's name. Withdraw pays a Cardano address; Send pays a Seedelf.";
