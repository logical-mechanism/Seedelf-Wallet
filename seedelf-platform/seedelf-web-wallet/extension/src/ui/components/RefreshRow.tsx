// "Updated 2 min ago" and a Refresh button: Home's, and each list screen's
// that reads the chain (UTxOs, Activity), so a fresh read doesn't mean going
// back to Home.
//
// The wallet doesn't read again by itself while a page is open, the owner's
// call (no polling: each read is Koios requests), so Refresh is how money that
// came in shows. It was a small unlabelled icon, and testers waiting on a
// deposit didn't find it, or didn't trust pressing it (blind test §4.12, T01,
// T03): it says "Refresh" now, as a small pill beside when the balances were
// read, which still fits the 360 px side panel on one line.

import { useEffect, useState } from "react";
import { useT } from "../../i18n";

import { timeAgo } from "../format";
import { RefreshIcon } from "./Icons";

export function RefreshRow({
  reading,
  updatedAt,
  onRefresh,
}: {
  reading: boolean;
  /** When what's shown was read (ms since the epoch); nothing is said before the first read. */
  updatedAt?: number;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tick);
  }, [updatedAt]);
  const t = useT();

  return (
    <div className="refresh-row">
      <span className="note" data-testid="updated">
        {reading ? t("refresh.reading") : updatedAt !== undefined ? t("refresh.updated", { ago: timeAgo(updatedAt, now) }) : ""}
      </span>
      {/* Its name is its label: "Refresh", as the screen-reader name was. */}
      <button type="button" className="chip refresh-row__button" onClick={onRefresh} disabled={reading} title={t("refresh.againTitle")}>
        <span className={reading ? "spin" : "icon"}>
          <RefreshIcon size={14} />
        </span>
        {t("refresh.again")}
      </button>
    </div>
  );
}
