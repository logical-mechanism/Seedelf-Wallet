// i18n-assembly.test.ts reads this file to check its own check, written the
// way the worker writes its messages: each sentence, list or full stop put
// together English's way is caught, and a machine's format or someone else's
// words are left alone. Never run.
import { t } from "../../src/i18n/core";

export function probe(names: string[], message: string, columns: string[], noteLines: string[]): string[] {
  return [
    // Two of the wallet's sentences, side by side with English's space.
    [t("worker.wallet.locked"), t("lj.tryLater")].join(" "),
    `${t("worker.wallet.locked")} ${t("lj.tryLater")}`,
    // A list a person reads, with English's comma.
    names.join(", "),
    // The worker's old leftOut: a translated reason's full stop stripped as if it could only be English's.
    message.replace(/\.$/, ""),
    // Left alone: a CSV's columns, and the lines of a note someone else wrote.
    columns.join(","),
    noteLines.join(" "),
  ];
}
