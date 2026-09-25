// ADA Handles: `$name` is paid at whatever address holds the name's token,
// so a handle among a balance's tokens is an address people pay by name.
// Receive lists the public account's. One in the private balance is a trap:
// another wallet paying `$name` pays the Seedelf contract with no datum,
// which anyone can spend (the validator lets a UTxO without a register go),
// so the screens warn before a handle goes into Seedelf.

/** The ADA Handle policy, the same on preprod and mainnet. */
export const ADA_HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
/** CIP-68's user-token label, which newer handles carry. */
export const CIP68_USER_TOKEN = "000de140";
/** An ADA Handle's name, after the $. */
export const HANDLE = /^[a-z0-9._@-]{1,28}$/;

/**
 * The name (without the $) a token is the ADA Handle for, or undefined. The
 * other CIP-67 labels under the policy (the reference token, 100, which sits
 * with the handle's contract) aren't one: a handle's own name, as hex, never
 * starts with a 0 nibble.
 */
export function handleOf(token: { policyId: string; assetName: string }): string | undefined {
  if (token.policyId !== ADA_HANDLE_POLICY) return undefined;
  const hex = token.assetName.startsWith(CIP68_USER_TOKEN) ? token.assetName.slice(8) : token.assetName;
  if (!hex || hex.startsWith("0") || hex.length % 2) return undefined;
  const bytes = Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));
  const name = new TextDecoder().decode(bytes);
  return HANDLE.test(name) ? name : undefined;
}

/** Every handle among `tokens`, by name. */
export function handlesIn(tokens: Array<{ policyId: string; assetName: string }>): string[] {
  return [...new Set(tokens.map(handleOf).filter((h): h is string => !!h))].sort();
}
