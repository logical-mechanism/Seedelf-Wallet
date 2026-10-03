// A × inside a field that empties it (the owner, 2026-10-02).
//
// The destination fields hold the longest text in the wallet — a bech32
// address, an ADA Handle, a seedelf's 68-character name — and clearing one
// meant select-all-and-delete. Retyping over a wrong paste is common enough
// that it deserves one button.
//
// It only appears when there is something to clear, so an empty field looks
// exactly as it did, and focus goes back to the input afterwards: the next
// thing anyone does is type or paste the right value.

import type { ReactNode } from "react";

import { CloseIcon } from "./Icons";

export function Clearable({
  /** The input or textarea this wraps; its id, so focus can go back to it. */
  id,
  value,
  onClear,
  /** What the field holds, for the button's label: "address", "Seedelf name". */
  what,
  children,
}: {
  id: string;
  value: string;
  onClear: () => void;
  what: string;
  children: ReactNode;
}) {
  return (
    <div className="clearable">
      {children}
      {value !== "" && (
        <button
          type="button"
          className="icon-button icon-button--small clearable__button"
          aria-label={`Clear the ${what}`}
          title="Clear"
          onClick={() => {
            onClear();
            document.getElementById(id)?.focus();
          }}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}
