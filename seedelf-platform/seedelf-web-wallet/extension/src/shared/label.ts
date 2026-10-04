// A seedelf's personal tag. The worker's WebAssembly enforces the same rule
// (seedelf-wasm `check_label`); this lets the form say so as the user types.

import { t } from "../i18n";
/** A tag fits the token name whole: prefix (4 bytes) ‖ tag ‖ index ‖ tx id, cut to 32 bytes. */
export const LABEL_MAX = 15;

/** Why `label` can't be a tag, or undefined if it can. Printable ASCII only, so it reads back as typed. */
export function labelProblem(label: string): string | undefined {
  const bad = [...label].find((c) => c < " " || c > "~");
  if (bad !== undefined) return t("shared.label.warn.badCharacter", { character: bad });
  if (label.length > LABEL_MAX) return t("shared.label.warn.tooLong", { max: LABEL_MAX });
  return undefined;
}

/** The start of the token name a tag gives: the prefix, then the tag's bytes. */
export function tokenNamePrefix(label: string): string {
  return `5eed0e1f${[...label].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;
}
