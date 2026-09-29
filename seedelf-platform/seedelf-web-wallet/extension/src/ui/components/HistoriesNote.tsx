// What a private spend's review says when it spends money with different
// histories together (privacy review §2.3). Coin selection keeps them apart
// where it can, so this shows only when it merged them, or for Max, which
// takes everything. It says what's spent together, never that nothing else
// could have paid (independent review L39). It's a plain note: nothing to
// press, and Send goes as it is. A funding also names money another private
// session left.

import type { HistoryClass } from "../../shared/histories";
import { historiesNote } from "../../shared/histories";

export function HistoriesNote({
  histories,
  max,
  session,
  testId = "histories-note",
}: {
  histories?: HistoryClass[];
  max?: boolean;
  /** The private session a funding pays (from 0). */
  session?: number;
  testId?: string;
}) {
  const note = historiesNote(histories, { max, session });
  if (!note) return null;
  return (
    <p className="note" data-testid={testId}>
      {note}
    </p>
  );
}
