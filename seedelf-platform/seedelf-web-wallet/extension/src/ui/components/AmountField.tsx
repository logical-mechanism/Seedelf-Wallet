// An amount's <input>, for ADA and for tokens alike. What's typed or pasted
// goes through `clean` (format.ts sanitizeAmount): the commas regroup as
// digits come and go, and the caret stays among the same digits. Backspace or
// Delete on a comma takes the digit beside it, as if the comma weren't there.

import { useLayoutEffect, useReducer, useRef, type InputHTMLAttributes } from "react";

import { caretAfter, deleteBesideComma } from "../format";

export function AmountField({
  value,
  onChange,
  clean,
  ...input
}: {
  value: string;
  /** The cleaned value, and a note when something was changed or refused. */
  onChange: (value: string, note?: string) => void;
  clean: (previous: string, typed: string) => { value: string; note?: string };
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  // Re-render on every edit, even a refused one, so the caret is put back.
  const [, edited] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current !== null && el && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      {...input}
      value={value}
      onChange={(e) => {
        const kind = (e.nativeEvent as InputEvent).inputType;
        const { text, caret: at } = deleteBesideComma(value, e.target.value, e.target.selectionStart ?? 0, kind);
        const cleaned = clean(value, text);
        caret.current = caretAfter(text, at, cleaned.value);
        edited();
        onChange(cleaned.value, cleaned.note);
      }}
    />
  );
}
