// Start a pool (chunk 34's §5 and session 1, 10, 14, 17, 20, 21 and 23): the
// form, its review, and what follows once it's sent. Anyone may start a pool
// of a token on the wallet's list, at any amount a box, or an ADA pool at any
// amount but the classic pool's 10 ₳; the creator needn't hold the token. The
// form lists the token's pools already shown, with their crowds, so a creator
// can join one rather than split it, and refuses a copy of one. The box's ADA
// is suggested (the least a box needs to come back and pay part of itself on
// its own, with a margin) and can be changed, never below that least nor, in
// a token pool, above 9 ₳. The private balance pays by default; the public
// account may, a switch, never a link, since it shows that link.
//
// The worker checks it all again, builds it, and checks the pool it makes
// from its own bytes (lovejoin-launch.ts); Send checks the token's supply.
// The pool shows in the list once a look finds it, as every wallet's does:
// the launcher's own record never puts it there sooner (§3). Bootstrapping
// is offered next, from the pool's page, never forced (23).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { joinSentences, useT } from "../../i18n";

import { NETWORKS } from "../../networks";
import type { Balances, LovejoinLaunchSummary, LovejoinLaunchTerms, PendingTx, TokenAmount } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { GivemeNote } from "../components/GivemeNote";
import { HistoriesNote } from "../components/HistoriesNote";
import { LOVEJOIN_UNAUDITED } from "../components/LovejoinReturn";
import { PoolAvatar } from "../components/PoolAvatar";
import { ReviewRows, Row } from "../components/ReviewRows";
import { homeBalance, TotalRows } from "../components/ReviewTotals";
import { Screen } from "../components/Screen";
import { Tabs } from "../components/Tabs";
import { TxDetailButton } from "../components/TxDetail";
import { adaText, formatAda, formatQuantity, parseAda, parseQuantity, tokenKey } from "../format";
import { boxText, crowdText, isCopy, type ShownPool } from "../lovejoin-pools";
import { useNetwork } from "../network";
import { listedTokens, tokenDecimals, tokenText } from "../tokens";

type From = "private" | "public";

/** The classic pool's box: an ADA pool at this amount is a copy of its value, never shown (session 1, 17). */
const CLASSIC_LOVELACE = "10000000";

/** A pause in typing before the terms for a new amount are asked: they read the protocol parameters. */
const TERMS_PAUSE_MS = 400;

/** What the form's token picker names: ADA, or a token on the wallet's list, by `tokenKey`. */
const ADA = "ada";

export function LovejoinLaunch({
  seedelf,
  publicTotal,
  pools,
  holdings,
  banner,
  onBack,
  onOpenPool,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  /** The public account as Home shows it: a start it pays says what it holds after (LaunchTotals). */
  publicTotal?: string;
  /** Every pool the wallet read, for the token's pools to join and their crowds. */
  pools: ShownPool[];
  /** The tokens the wallet holds, either side: listed first. */
  holdings: TokenAmount[];
  banner?: ReactNode;
  onBack: () => void;
  /** Opens a pool's page: one of the token's pools, to join rather than split it. */
  onOpenPool: (id: string | undefined) => void;
  onSent: (pending: PendingTx) => void;
}) {
  const tr = useT();
  const network = useNetwork();
  const [unit, setUnit] = useState(ADA);
  const [quantity, setQuantity] = useState("");
  const [boxAda, setBoxAda] = useState<string>();
  const [from, setFrom] = useState<From>("private");
  const [terms, setTerms] = useState<LovejoinLaunchTerms>();
  const [termsError, setTermsError] = useState<string>();
  const [review, setReview] = useState<LovejoinLaunchSummary>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // The wallet's list, the tokens held in either balance first, each by its ticker.
  const options = useMemo(() => {
    const held = new Set(holdings.filter((t) => BigInt(t.quantity) > 0n).map(tokenKey));
    const all = listedTokens(network).map((t) => ({ key: tokenKey(t), token: { policyId: t.policyId, assetName: t.assetName }, label: t.info.ticker }));
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
    return { held: all.filter((o) => held.has(o.key)).sort(byLabel), rest: all.filter((o) => !held.has(o.key)).sort(byLabel) };
  }, [holdings, network]);
  const chosen = unit === ADA ? undefined : [...options.held, ...options.rest].find((o) => o.key === unit);
  const token = chosen?.token;
  const decimals = token ? tokenDecimals(network, token) : 0;
  const raw = token ? parseQuantity(quantity, decimals) : undefined;
  const q = raw && raw !== "0" ? raw : undefined;

  // What a box may hold for this token and amount (the least, the suggestion and the most) and its shown pools:
  // asked once typing pauses. Without an amount, the least for any.
  useEffect(() => {
    setTermsError(undefined);
    let live = true;
    const timer = setTimeout(() => {
      call("lovejoin-launch-terms", { ...(token ? { token } : {}), ...(q ? { quantity: q } : {}) }).then(
        (found) => {
          if (!live) return;
          setTerms(found);
          setBoxAda((was) => was ?? formatAda(found.suggested));
        },
        (e: Error) => live && setTermsError(e.message),
      );
    }, TERMS_PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token?.policyId, token?.assetName, q]);

  const box = boxAda !== undefined ? parseAda(boxAda) : undefined;
  // The token's pools already shown, with their crowds, to join rather than split (session 1, 14). Never a copy, read
  // for the boxes already in it, which takes none to join with (the merged fixes' review, MERGED-1): the earlier pool
  // of its values is listed, and a start of those values is refused as its copy.
  const same = pools.filter((p) => !isCopy(p) && (token ? p.box.token && tokenKey(p.box.token) === unit : !p.box.token));
  const copy = same.find((p) => p.box.lovelace === box && (!token || p.box.token?.quantity === q));
  // Why Review can't be pressed yet, each before a build would say it.
  const why = !terms
    ? undefined
    : token && !q
      ? tr("lovejoin.launch.needQuantity")
      : !box
        ? tr("lovejoin.launch.needBox")
        : !token && box === CLASSIC_LOVELACE
          ? tr("lj.launch.classicCopy")
          : BigInt(box) < BigInt(terms.least)
            ? tr("lj.launch.tooLittle", { least: formatAda(terms.least) })
            : terms.most !== undefined && BigInt(box) > BigInt(terms.most)
              ? tr("lj.launch.tooMuch", { most: formatAda(terms.most) })
              : copy
                ? tr("lj.launch.copy")
                : undefined;

  async function build() {
    if (busy || why || !box) return;
    setBusy(true);
    setError(undefined);
    try {
      setReview(await call("lovejoin-launch-build", { from, boxLovelace: box, ...(token ? { token, quantity: q } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!review || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSent(await call("lovejoin-launch-submit", { txHash: review.txHash }));
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent && review) {
    return (
      <Screen title={tr("lovejoin.launch.sentTitle")} titleId="lovejoin-launch-sent" onBack={onBack} error={error}>
        {banner}
        <p data-testid="lovejoin-launch-sent-note">{tr("lovejoin.launch.sentNote", { box: boxText(network, poolBox(review)) })}</p>
        {/* Bootstrapping is offered, never forced (round three, 23): from the pool's page, once it's found. */}
        <p className="note">{tr("lovejoin.launch.bootstrapNext")}</p>
        <button type="button" className="primary" onClick={onBack} data-testid="lovejoin-launch-done">
          {tr("lovejoin.launch.toPools")}
        </button>
      </Screen>
    );
  }

  if (review) {
    return (
      <Screen
        title={tr("lovejoin.launch.reviewTitle")}
        titleId="lovejoin-launch-review"
        review
        onBack={() => {
          setReview(undefined);
          setError(undefined);
        }}
        backDisabled={busy}
        aside={tr("lovejoin.launch.nothingSent")}
        error={error}
        foot={
          <button type="button" className="primary" disabled={busy} onClick={() => void send()} data-testid="lovejoin-launch-send">
            {busy ? tr("common.sending") : tr("lovejoin.launch.start")}
          </button>
        }
      >
        <ReviewRows testId="lovejoin-launch-summary">
          <Row label={tr("lovejoin.launch.eachBox")} value={boxText(network, poolBox(review))} strong />
          <Row label={tr("lovejoin.launch.paidFrom")} value={tr(review.from === "private" ? "lovejoin.mix.private" : "lovejoin.mix.public")} />
        </ReviewRows>
        <h2>{tr("lovejoin.launch.lockedTitle")}</h2>
        <ReviewRows testId="lovejoin-launch-locked">
          <Row label={tr("lovejoin.launch.lockedTotal")} value={adaText(review.locked.total)} strong />
          <Row label={tr("lovejoin.launch.lockedReference")} value={adaText(review.locked.reference)} part />
          <Row label={tr("lovejoin.launch.lockedMixBox")} value={adaText(review.locked.mixBox)} part />
          <Row label={tr("lovejoin.launch.lockedMixLogic")} value={adaText(review.locked.mixLogic)} part />
          <Row label={tr("lovejoin.launch.lockedDeposit")} value={adaText(review.locked.deposit)} part />
          <Row label={tr("review.fee")} value={adaText(review.fee)} />
          <LaunchTotals review={review} seedelf={seedelf} publicTotal={publicTotal} />
        </ReviewRows>
        {/* At most: Send sends the start with no deposit when something registered the credential already (34d). */}
        <p className="note" data-testid="lovejoin-launch-at-most">
          {tr("lovejoin.launch.warn.atMost", { deposit: formatAda(review.locked.deposit) })}
        </p>
        <Callout tone="privacy" testId="lovejoin-launch-privacy">
          {tr(review.from === "private" ? "lovejoin.launch.privacy.private" : "lovejoin.launch.privacy.public")}
        </Callout>
        <LaunchBootstrapNote />
        {review.from === "private" && <HistoriesNote histories={review.histories} testId="lovejoin-launch-histories" />}
        {review.from === "private" && <GivemeNote />}
        <TxDetailButton txHash={review.txHash} testId="lovejoin-launch-tx" />
        <p className="note" data-testid="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED()}
        </p>
      </Screen>
    );
  }

  const ticker = token ? tokenText(network, token).label : "";
  return (
    <Screen
      title={tr("lovejoin.launch.title")}
      titleId="lovejoin-launch-title"
      onBack={onBack}
      backDisabled={busy}
      aside={tr("lovejoin.launch.aside")}
      error={error ?? termsError}
    >
      {banner}
      <p className="note">{tr("lovejoin.launch.lead")}</p>
      <div className="field">
        <label htmlFor="lovejoin-launch-token">{tr("lovejoin.launch.token")}</label>
        <select
          id="lovejoin-launch-token"
          value={unit}
          disabled={busy}
          onChange={(e) => {
            setUnit(e.target.value);
            setQuantity("");
            // A new token's least may differ: the suggestion is asked again.
            setBoxAda(undefined);
            setTerms(undefined);
          }}
          data-testid="lovejoin-launch-token"
        >
          <option value={ADA}>ADA</option>
          {options.held.length > 0 && (
            <optgroup label={tr("lovejoin.launch.held")}>
              {options.held.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={tr("lovejoin.launch.listed")}>
            {options.rest.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
        <p className="note">{tr(token ? "lovejoin.launch.tokenNote" : "lovejoin.launch.adaNote")}</p>
      </div>
      {token && (
        <div className="field">
          <label htmlFor="lovejoin-launch-quantity">{tr("lovejoin.launch.quantity", { token: ticker })}</label>
          <input
            id="lovejoin-launch-quantity"
            inputMode="decimal"
            autoComplete="off"
            value={quantity}
            disabled={busy}
            placeholder={formatQuantity("0", decimals)}
            onChange={(e) => setQuantity(e.target.value)}
            data-testid="lovejoin-launch-quantity"
          />
          <p className="note">{tr("lovejoin.launch.quantityNote")}</p>
        </div>
      )}
      <div className="field">
        <label htmlFor="lovejoin-launch-ada">{tr(token ? "lovejoin.launch.boxAda" : "lovejoin.launch.boxAdaAlone")}</label>
        <input
          id="lovejoin-launch-ada"
          inputMode="decimal"
          autoComplete="off"
          value={boxAda ?? ""}
          disabled={busy || !terms}
          onChange={(e) => setBoxAda(e.target.value)}
          data-testid="lovejoin-launch-ada"
        />
        {terms && (
          <p className="note" data-testid="lovejoin-launch-bounds">
            {joinSentences([
              tr("lovejoin.launch.suggested", { suggested: formatAda(terms.suggested), least: formatAda(terms.least) }),
              terms.most !== undefined ? tr("lovejoin.launch.most", { most: formatAda(terms.most) }) : tr("lovejoin.launch.noMost"),
            ])}
          </p>
        )}
      </div>
      {/* The token's pools already shown: join one rather than split the crowd (session 1, 14). */}
      {same.length > 0 && (
        <section className="section stack-tight" aria-labelledby="lovejoin-launch-existing-title" data-testid="lovejoin-launch-existing">
          <h2 id="lovejoin-launch-existing-title">{tr("lovejoin.launch.existingTitle")}</h2>
          <p className="note">{tr("lovejoin.launch.existingNote")}</p>
          <ul className="list">
            {same.map((p) => (
              <li key={p.id ?? "classic"}>
                <button
                  type="button"
                  className={p === copy ? "token-row token-row--on" : "token-row"}
                  onClick={() => onOpenPool(p.id)}
                  data-testid={`lovejoin-launch-join-${p.id ?? "classic"}`}
                >
                  <PoolAvatar token={p.box.token} />
                  <span className="token-row__label">{boxText(network, p.box)}</span>
                  <span className="token-row__sub">{crowdText(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="section stack" aria-labelledby="lovejoin-launch-from-title">
        <h2 id="lovejoin-launch-from-title">{tr("lovejoin.launch.fromTitle")}</h2>
        <Tabs
          label={tr("lovejoin.launch.fromTitle")}
          prefix="lovejoin-launch-"
          tabs={[
            { value: "private", label: tr("lovejoin.mix.private") },
            { value: "public", label: tr("lovejoin.mix.public") },
          ]}
          value={from}
          onChange={setFrom}
        />
        <p className="note" role="tabpanel" id={`lovejoin-launch-panel-${from}`} aria-labelledby={`lovejoin-launch-tab-${from}`}>
          {tr(from === "private" ? "lovejoin.launch.privacy.fromPrivate" : "lovejoin.launch.privacy.fromPublic")}
        </p>
      </section>
      <p className="note" data-testid="lovejoin-launch-cost">
        {tr("lovejoin.launch.warn.cost")}
      </p>
      <Callout tone="warn" testId="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED()}
      </Callout>
      <button type="button" className="primary" disabled={busy || !terms || !!why} onClick={() => void build()} data-testid="lovejoin-launch-review-button">
        {busy ? tr("common.building") : tr("common.review")}
      </button>
      {why && (
        <p className="field-note" data-testid="lovejoin-launch-why">
          {why}
        </p>
      )}
    </Screen>
  );
}

/**
 * What the start's review says of bootstrapping (D2; round three, 23: the review offers Bootstrap next, never forces
 * it): the floor counts boxes not yours, so a pool needs others' too. Where the network has no floor (preprod), that
 * Bootstrap can follow from the pool's page, as the sent page says: the review said nothing of it there, so the
 * owner's preprod run never met it (1.6.0's preprod rehearsal, R7).
 */
export function LaunchBootstrapNote() {
  const tr = useT();
  const network = useNetwork();
  // The floor a pool's boxes not yours must reach before the wallet mixes there: none where the network has none.
  const floor = NETWORKS[network].lovejoin?.poolFloor ?? 0;
  return (
    <p className="note" data-testid="lovejoin-launch-bootstrap">
      {floor > 0 ? tr("lovejoin.launch.bootstrapNote", { floor }) : tr("lovejoin.launch.bootstrapNext")}
    </p>
  );
}

/**
 * What a start takes from the side that pays it, all told, and what that side holds after, from Home's figure for it:
 * the private balance's from the page's own, the public account's as Home handed it down (`publicTotal`). From the
 * public account it said what left and not what stayed, where the private balance's said both (1.6.0's rehearsal,
 * R9). No figure, no after line. Exported for its test.
 */
export function LaunchTotals({
  review,
  seedelf,
  publicTotal,
}: {
  review: Pick<LovejoinLaunchSummary, "from" | "locked" | "fee">;
  seedelf: Balances["seedelf"];
  publicTotal?: string;
}) {
  const leaving = BigInt(review.locked.total) + BigInt(review.fee);
  return <TotalRows side={review.from} leaving={leaving} before={review.from === "private" ? homeBalance(seedelf) : publicTotal} />;
}

/** The box a reviewed start's pool holds. */
const poolBox = (review: LovejoinLaunchSummary) => ({ lovelace: review.pool.boxLovelace, ...(review.pool.token ? { token: review.pool.token } : {}) });
