import { useState } from "react";

/** A small "Copy" button that puts `value` on the clipboard and says "Copied" for a moment. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="link"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
