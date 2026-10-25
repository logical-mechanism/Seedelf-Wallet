// A review's own button: Send, Start swap. While anything runs it waits, and
// it says what: "Building…" while the review's switch or Change builds it
// again where it stands (`rebuilding`), the sending words only while it's sent.
// From 34f the swap approval's switch built the funding again, and Start swap
// read "Sending…" while nothing was sent; a return's review did the same with
// its own switch and Change (1.6.0's release review, 320-screens#3).
// buildAgain's lesson, on every review built again in place (PY-1).
// `sending`: what it says while it's sent, where that's more than "Sending…"
// (a return's chain, "Sending 7 of 13…").

import { useT } from "../../i18n";

export function SendButton({
  label,
  busy,
  rebuilding = false,
  sending,
  onClick,
  testId,
}: {
  label: string;
  busy: boolean;
  rebuilding?: boolean;
  sending?: string;
  onClick: () => void;
  testId?: string;
}) {
  const t = useT();
  return (
    <button type="button" className="primary" onClick={onClick} disabled={busy} data-testid={testId}>
      {!busy ? label : rebuilding ? t("common.building") : (sending ?? t("common.sending"))}
    </button>
  );
}
