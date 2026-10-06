// The lines a review's reader would otherwise add up for themselves (chunk 23's
// review, S-1 to S-3): what leaves the balance a payment comes from, fee
// included, and what that balance holds afterwards, as Home will show it.
//
// What isn't here is a change output. "Back to your public account 47.8 ₳",
// beside a balance of 10,408 ₳, read as what would be left; the transaction's
// details list every output. Nor are staking rewards a loss: a payment that
// takes them collects them into the account, whose balance on Home already
// counts them.

import { useT } from "../../i18n";

import { adaText, adaWithTokens } from "../format";
import { useAmounts } from "../preferences";
import { Row } from "./ReviewRows";

/** Which balance: Home's two. */
export type Side = "public" | "private";

/**
 * "Total leaving your public account" and, given what the side holds now,
 * "Public account after". `before` is Home's whole balance, locked UTxOs and
 * rewards included; the after is masked with the balances when they're
 * hidden, as Home's is. Each amount keeps its ₳ beside it, with a no-break
 * space: the long label beside it pushed the ₳ onto a line of its own.
 *
 * `tokens`: how many kinds of token leave too, said with the ADA ("5.195025 ₳
 * and 2 tokens"): a total of the ADA alone read as everything that leaves,
 * while 100 LINK and a billion VEGA went with it (chunk 23's second review,
 * PY-5). Each recipient's rows name them.
 */
export function TotalRows({ side, leaving, before, tokens = 0 }: { side: Side; leaving: bigint; before?: string; tokens?: number }) {
  const t = useT();
  return (
    <>
      <Row
        label={t(side === "public" ? "review.total.public" : "review.total.private")}
        value={adaWithTokens(leaving.toString(), tokens)}
        strong
        testId="review-total"
      />
      {before !== undefined && <AfterRow side={side} lovelace={BigInt(before) - leaving} />}
    </>
  );
}

/**
 * Home's balance for a side a form was handed spendable (format.ts
 * `unlocked`, which keeps what it took out in `locked`): what's spendable
 * and what's locked, together, as Home shows it. A screen that gets the
 * spendable side alone (the dApps page's, a site's session) gives its review
 * "… after" from it (blind test §9.8).
 */
export function homeBalance(side: { lovelace: string; locked: { lovelace: string } }): string {
  return (BigInt(side.lovelace) + BigInt(side.locked.lovelace)).toString();
}

/** "Private balance after": what a side holds once the transaction lands. */
export function AfterRow({ side, lovelace }: { side: Side; lovelace: bigint }) {
  const t = useT();
  const amounts = useAmounts();
  const after = lovelace > 0n ? lovelace : 0n;
  return (
    <Row
      label={t(side === "public" ? "review.after.public" : "review.after.private")}
      value={`${amounts.ada(after.toString())}\u00a0₳`}
      testId={`review-after-${side}`}
    />
  );
}

/**
 * Staking rewards a payment from the public account collects: already in the
 * balance Home shows, so neither a cost nor a gain (S-2). Said as moved into
 * the balance, not "collected": beside a payment nobody asked to collect
 * anything with, that read as a charge (chunk 23's second review, PY-6).
 * The amount is the row's value, as every other row's is, and what it means
 * goes across the row under it: as the value, the sentence ran to three
 * right-aligned lines beside the label (the visual review of pass two).
 */
export function RewardsRow({ withdrawal }: { withdrawal?: string }) {
  const t = useT();
  if (!withdrawal || BigInt(withdrawal) === 0n) return null;
  return (
    <div className="review__row review__row--hinted" data-testid="review-rewards">
      <dt>{t("review.rewardsCollected")}</dt>
      <dd>{adaText(withdrawal)}</dd>
      <dd className="note review__hint">{t("review.alreadyCounted")}</dd>
    </div>
  );
}

/** Under a review that moves rewards: which setting does it, since the user didn't ask for it here (PY-6). */
export function RewardsSetting({ withdrawal }: { withdrawal?: string }) {
  const t = useT();
  if (!withdrawal || BigInt(withdrawal) === 0n) return null;
  return (
    <p className="note" data-testid="rewards-setting">
      {t("review.rewardsSetting", { setting: t("settings.staking.useRewards") })}
    </p>
  );
}
