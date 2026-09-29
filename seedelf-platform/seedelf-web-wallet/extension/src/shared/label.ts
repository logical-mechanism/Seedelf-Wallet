// A seedelf's personal tag. The worker's WebAssembly enforces the same rule
// (seedelf-wasm `check_label`); this lets the form say so as the user types.

/** A tag fits the token name whole: prefix (4 bytes) ‖ tag ‖ index ‖ tx id, cut to 32 bytes. */
export const LABEL_MAX = 15;

/** Why `label` can't be a tag, or undefined if it can. Printable ASCII only, so it reads back as typed. */
export function labelProblem(label: string): string | undefined {
  const bad = [...label].find((c) => c < " " || c > "~");
  if (bad !== undefined) return `A tag can use letters, digits, spaces and ASCII punctuation, not “${bad}”.`;
  if (label.length > LABEL_MAX) return `A tag is at most ${LABEL_MAX} characters.`;
  return undefined;
}

/** The start of the token name a tag gives: the prefix, then the tag's bytes. */
export function tokenNamePrefix(label: string): string {
  return `5eed0e1f${[...label].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;
}
