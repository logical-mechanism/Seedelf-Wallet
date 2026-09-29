// The vault password rule, shared by the UI (to guide) and the service worker
// (to enforce): at least 12 characters, no composition rules.

export const MIN_PASSWORD_LENGTH = 12;

/** Why a new password is refused, or undefined if it's acceptable. */
export function passwordProblem(password: string): string | undefined {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters (${length} so far).`;
  }
  return undefined;
}

export type Strength = "weak" | "fair" | "good" | "strong";

/**
 * A rough strength hint: length times the size of the character pool, where
 * a repeated unit ("passwordpassword") counts once. It only guides; the rule
 * is the length.
 */
export function passwordStrength(password: string): Strength {
  const unit = /^(.+?)\1+$/su.exec(password)?.[1] ?? password;
  const chars = [...unit];
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[ -/:-@[-`{-~]/.test(password)) pool += 33;
  if (/[^\x20-\x7e]/.test(password)) pool += 100;
  const bits = chars.length * Math.log2(Math.max(pool, 1));
  if (bits < 60) return "weak";
  if (bits < 80) return "fair";
  if (bits < 100) return "good";
  return "strong";
}
