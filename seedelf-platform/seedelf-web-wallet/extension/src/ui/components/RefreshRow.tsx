// "Updated 2 min ago" and a refresh button: Home's, and each list screen's
// that reads the chain (UTxOs, Activity), so a fresh read doesn't mean going
// back to Home.

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
      <button
        type="button"
        className="icon-button"
        onClick={onRefresh}
        disabled={reading}
        aria-label={t("refresh.again")}
        title={t("refresh.againTitle")}
      >
        <span className={reading ? "spin" : "icon"}>
          <RefreshIcon size={15} />
        </span>
      </button>
    </div>
  );
}
