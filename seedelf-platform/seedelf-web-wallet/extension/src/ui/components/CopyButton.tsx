import { useState } from "react";
import { useT } from "../../i18n";

import { CheckIcon, CopyIcon } from "./Icons";

/**
 * A small "Copy" pill that puts `value` on the clipboard and says "Copied" for a
 * moment. `what` names it something else, for a row offering more than one thing
 * to copy ("CBOR", "JSON").
 */
export function CopyButton({ value, label, what }: { value: string; label?: string; what?: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className="chip"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      {copied ? t("common.copied") : (what ?? t("common.copy"))}
    </button>
  );
}
