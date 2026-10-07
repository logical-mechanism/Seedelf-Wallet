// Swaps, each in a private session (background/sessions.ts): a one-time
// account is funded from the private balance, Minswap's aggregator builds the
// swap for it, the session's key signs it, and once it's filled everything
// comes back into the private balance. The public account isn't in its
// transactions; anyone can follow the money back through the funding, though
// (privacy review §2.12).
//
// Swaps       the sessions, newest first: those in progress, then past ones,
//             each with its pair and a tag for how it's doing. And New swap.
// NewSwap     Minswap's shape: You pay over You receive, a live quote under
//             them, then the swap and its funding payment to review.
// Session     one session: a timeline of the swap as it runs itself, with Stop,
//             or, for one from before, the next step as a button.
//
// Tokens are named as every text view names them (tokens.ts tokenText), and
// ADA is told by its ID, "lovelace", never by a label: anyone can mint a
// token called ₳ (launch review #18). What's received must be ADA, a token on
// the wallet's list, or one Minswap verifies by its ID: the quote says, and
// the wallet funds no other (#20). The least an order gives is what the
// wallet asks Minswap for; Minswap builds the order (#21).

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { currentLanguage, type I18nKey, joinList, joinSentences, sentenceGap, t, useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type {
  AdaPrice,
  Balances,
  PendingTx,
  SessionBackSummary,
  SessionOrder,
  SessionOutSummary,
  SessionAuto,
  SessionPause,
  SessionTx,
  SessionTxReview,
  SessionView,
  SwapAsk,
  SwapLovejoin,
  SwapQuote,
  SwapSide,
  SwapTokenInfo,
  TokenQuantity,
} from "../../shared/rpc";
import { call } from "../background";
import { AmountField } from "../components/AmountField";
import { Callout } from "../components/Callout";
import { GivemeNote } from "../components/GivemeNote";
import { ExplorerLink, ExplorerNote } from "../components/ExplorerLink";
import { HandleWarning } from "../components/HandleWarning";
import { HistoriesNote } from "../components/HistoriesNote";
import {
  chainText,
  delayText,
  IntoRow,
  LOVEJOIN_UNAUDITED,
  lovejoinHides,
  LovejoinNote,
  LovejoinRows,
  LovejoinSkipped,
  LovejoinSwitch,
  ReturnLinks,
  useSendingLabel,
  useSessionsWhile,
} from "../components/LovejoinReturn";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SlidersIcon,
  SpinnerIcon,
  SwapIcon,
  WalletIcon,
  WarnIcon,
} from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { homeBalance, TotalRows } from "../components/ReviewTotals";
import { Screen } from "../components/Screen";
import { refusalOf, SessionRefusedFoot, unsentWhyText, type Refusal } from "../components/SessionRefused";
import { TxDetailButton, entryLabel } from "../components/TxDetail";
import { LeftBehindNote, ReturnLeftOut } from "../components/SessionLeft";
import {
  ADA_RULES,
  adaText,
  type AmountRules,
  formatAda,
  formatFiat,
  formatPercent,
  formatQuantity,
  parseQuantity,
  sanitizeAmount,
  shortHex,
  tokenKey,
  whenOf,
} from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { withStop } from "../sentence";
import {
  aboutAda,
  adaShort,
  fundParts,
  halfOf,
  impactLevel,
  maxAdaIn,
  parseSlippage,
  rateOf,
  sameAsk,
  SLIPPAGE_HIGH,
  SLIPPAGE_MAX,
  SLIPPAGE_MIN,
  SESSION_FEE_ESTIMATE,
  swapCosts,
  toCents,
  wholeUnits,
} from "../swap";
import {
  initials,
  listedTokens,
  sortTokens,
  tint,
  tokenAmountText,
  tokenDecimals,
  tokenInfo,
  tokenMark,
  tokenText,
  viewToken,
} from "../tokens";

const ADA: SwapSide = { label: "₳", decimals: 6 };

/** One side of a swap: ADA ("lovelace") or a token, by Minswap's ID, and how it's shown. */
interface Pick {
  id: string;
  side: SwapSide;
}

const ADA_PICK: Pick = { id: "lovelace", side: ADA };

/**
 * An amount on one side of a swap: "10 ₳", "906.5941 MIN". ADA by its ID: a token may call itself ₳. `write` writes
 * the number: `useAmounts().quantity` for what the private balance holds, masked while balances are hidden (HM-9).
 */
function amountOf(quantity: string, pick: Pick, write = formatQuantity): string {
  return pick.id === "lovelace" ? `${write(quantity, 6)}\u00a0₳` : `${write(quantity, pick.side.decimals)} ${pick.side.label}`;
}

/** A side's name on its button and in the lists: ADA, or the token's name (tokenText). */
const nameOf = (p: Pick) => (p.id === "lovelace" ? "ADA" : p.side.label);

/** A token's side, by its Minswap ID: named by `tokenText`, with `decimals` (a quote's, or the list's). */
function pickOf(network: NetworkName, id: string, decimals: number): Pick {
  return id === "lovelace" ? ADA_PICK : { id, side: { label: tokenText(network, tokenOf(id)).label, decimals } };
}

/**
 * A session's two sides, named now as every text view names a token: its
 * recorded display keeps only their decimals, since a label recorded before
 * could pass for another token.
 */
function sidesOf(network: NetworkName, s: SessionView): { pay: Pick; get: Pick } | undefined {
  const d = s.swap?.display;
  if (!s.swap || !d) return undefined;
  return { pay: pickOf(network, s.swap.tokenIn, d.in.decimals), get: pickOf(network, s.swap.tokenOut, d.out.decimals) };
}

/** A session's swap in a line: "10 ₳ → MIN", "906.5941 MIN → ADA". */
export function pairOf(s: SessionView, network: NetworkName): string {
  const sides = sidesOf(network, s);
  if (!s.swap || !sides) return t("swaps.aSwap");
  return `${amountOf(s.swap.amount, sides.pay)} → ${nameOf(sides.get)}`;
}

const STAGE: Record<SessionView["stage"], I18nKey> = {
  funding: "swaps.stage.funding",
  open: "swaps.stage.open",
  returning: "swaps.stage.returning",
  closed: "swaps.stage.done",
  failed: "swaps.stage.failed",
};

const STEP: Record<SessionAuto["step"], I18nKey> = {
  funding: "swaps.stage.funding",
  ordering: "swaps.step.ordering",
  filling: "swaps.step.filling",
  cancelling: "swaps.step.cancelling",
  returning: "swaps.stage.returning",
  done: "swaps.stage.done",
};

/**
 * Back in the private balance, or never funded: nothing more happens. A
 * swap's funding the chain hasn't shown may still land, and waits on the
 * user's Try again or Forget it: that one isn't over (launch review #11).
 */
const isOver = (s: SessionView) => s.stage === "closed" || (s.stage === "failed" && (!!s.unsent || !s.auto));

/** A swap whose funding the chain hasn't shown yet, which may still land: it needs the user. */
export const fundingUnseen = (s: SessionView) => s.stage === "failed" && !s.unsent && !!s.auto;

/** A swap that runs itself and isn't over: Home shows it. A mix (Lovejoin's) isn't a swap. */
export function isRunningSwap(s: SessionView): boolean {
  return !!s.auto && !s.mix && !isOver(s);
}

/** How a swap is doing at a glance: running, waiting on the user, done, stopped, or failed. */
export type SwapTone = "live" | "wait" | "done" | "off" | "bad";

/** A session's tag: a word or two, in its tone. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  // A funding the chain hasn't shown may still land: it waits on the user's Try again or Forget it.
  if (s.stage === "failed") {
    return s.unsent || !s.auto ? { tone: "bad", label: t("swaps.tag.failed") } : { tone: "wait", label: t("swaps.tag.notSeen") };
  }
  const a = s.auto;
  if (!a) {
    // From before: every step after the funding is the user's.
    if (s.stage === "closed") return { tone: "done", label: t("swaps.tag.done") };
    return s.stage === "open"
      ? { tone: "wait", label: t("swaps.tag.open") }
      : { tone: "live", label: t("swaps.tag.running") };
  }
  if (a.step === "done") {
    // A refunded order isn't a swap done (independent review M18).
    if (a.refunded) return { tone: "off", label: t("swaps.tag.refunded") };
    if (a.partly) return { tone: "done", label: t("swaps.tag.partly") };
    return a.filled ? { tone: "done", label: t("swaps.tag.done") } : { tone: "off", label: t("swaps.tag.stopped") };
  }
  if (a.paused) return { tone: "wait", label: t("swaps.tag.needsYou") };
  if (a.retry) return { tone: "wait", label: t("swaps.tag.retrying") };
  // Stopped, and waiting on an order it can't cancel yet: neither done nor an error (independent review L16).
  if (a.orderOpen !== undefined) return { tone: "off", label: t("swaps.tag.orderOpen") };
  return { tone: "live", label: t(a.stopping ? "swaps.tag.stopping" : "swaps.tag.running") };
}

const PAUSED: Record<SessionPause["why"], I18nKey> = {
  price: "swaps.paused.price",
  refused: "swaps.paused.refused",
};

/** A session's second line: what it's doing while it runs (its tag says if it's stopping), or when it ran. */
function subOf(s: SessionView, now: number): string {
  if (isOver(s)) return whenOf(s.createdAt, new Date(now));
  if (!s.auto) return t(s.stage === "open" ? "swaps.sub.nextIsYours" : STAGE[s.stage]);
  if (fundingUnseen(s)) return t("swaps.sub.fundingUnseen");
  if (s.auto.paused) return t(PAUSED[s.auto.paused.why]);
  if (s.auto.orderOpen !== undefined) return t("swaps.sub.orderOpen");
  // Stopped before its order: it comes back rather than place one.
  return t(STEP[s.auto.stopping && s.auto.step === "ordering" ? "returning" : s.auto.step]);
}

/**
 * Whether Stop still changes anything: before the order is filled or
 * refunded. Once it has been, everything is coming back anyway, and Stop's
 * dialog would speak of cancelling an order that's gone (chunk 23's second
 * review, DX-5).
 */
const stoppable = (a: SessionAuto) =>
  !a.stopping && !a.filled && !a.refunded && (a.step === "funding" || a.step === "ordering" || a.step === "filling");

/** A swap's state as a small pill: a live dot, a tick, a warning, a stop, or a cross. */
export function SwapTag({ tone, label }: { tone: SwapTone; label: string }) {
  return (
    <span className={`swap-tag swap-tag--${tone}`}>
      {tone === "done" ? (
        <CheckIcon size={12} />
      ) : tone === "wait" ? (
        <WarnIcon size={12} />
      ) : tone === "bad" ? (
        <CloseIcon size={12} />
      ) : (
        <span className="swap-tag__dot" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

/** A swap's two tokens, what's paid overlapping what's received. */
function SwapPair({ session: s }: { session: SessionView }) {
  const sides = sidesOf(useNetwork(), s);
  if (!sides) {
    return (
      <span className="swap-pair" aria-hidden="true">
        <span className="avatar activity__icon">
          <SwapIcon size={14} />
        </span>
      </span>
    );
  }
  return (
    <span className="swap-pair" aria-hidden="true">
      <SwapAvatar pick={sides.pay} />
      <SwapAvatar pick={sides.get} />
    </span>
  );
}

/** A session in a list, which opens its page: the pair, what it's doing or when it ran, and its tag. Home shows the running ones. */
export function SwapRow({ session: s, onOpen }: { session: SessionView; onOpen: () => void }) {
  const tag = tagOf(s);
  const network = useNetwork();
  return (
    <button type="button" className="token-row swap-row" onClick={onOpen}>
      <SwapPair session={s} />
      <span className="token-row__label">{pairOf(s, network)}</span>
      <SwapTag {...tag} />
      <span className={tag.tone === "wait" ? "token-row__sub swap-row__sub--wait" : "token-row__sub"}>
        {subOf(s, Date.now())}
      </span>
    </button>
  );
}

/** A titled card of sessions. */
function SwapList({ title, sessions, onOpen }: { title: string; sessions: SessionView[]; onOpen: (index: number) => void }) {
  return (
    <section className="section" aria-label={title}>
      <h2>{title}</h2>
      <ul className="list">
        {sessions.map((s) => (
          <li key={s.index}>
            <SwapRow session={s} onOpen={() => onOpen(s.index)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Minswap's page in the dApp browser: its swaps, each from a one-time account, and New swap. */
export function Swaps({
  seedelf,
  blocked,
  start,
  onBack,
  onPending,
}: {
  seedelf: Balances["seedelf"];
  /** Why a new swap can't start now: a transaction still waiting, say. */
  blocked?: string;
  /** A session to open first. */
  start?: number;
  onBack: () => void;
  /** A funding payment was sent: Home's banner watches it. */
  onPending: (pending: PendingTx) => void;
}) {
  const tr = useT();
  const [sessions, setSessions] = useState<SessionView[]>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number | undefined>(start);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setReading(true);
    try {
      // A site's private session (private CIP-30) is listed under the dApps page's Sites, not here.
      setSessions((await call("sessions", { refresh })).filter((s) => !s.site && !s.mix));
      if (refresh) setUpdatedAt(Date.now());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    void load(false).then(() => load(true));
  }, [load]);

  if (starting) {
    const done = () => {
      setStarting(false);
      // A session may have started meanwhile, whether its funding went through or not.
      void load(true);
    };
    const started = (index: number, pending: PendingTx) => {
      onPending(pending);
      setStarting(false);
      // Straight to the swap's own page, where it runs.
      void load(false).then(() => setOpen(index));
    };
    // Refused, but it may have gone out: its page watches for it, and says whether it lands (DX-1).
    const watch = (index: number) => {
      setStarting(false);
      void load(true).then(() => setOpen(index));
    };
    return <NewSwap seedelf={seedelf} onCancel={done} onStarted={started} onWatch={watch} />;
  }
  const session = sessions?.find((s) => s.index === open);
  if (session) {
    return (
      <Session
        session={session}
        updatedAt={updatedAt}
        reading={reading}
        onRefresh={() => void load(true)}
        onBack={() => {
          setOpen(undefined);
          void load(false);
        }}
        onChanged={setSessions}
      />
    );
  }

  const noFunds = seedelf.utxos === 0 ? tr("swaps.noFunds") : undefined;
  const running = sessions?.filter((s) => !isOver(s)) ?? [];
  const over = sessions?.filter(isOver) ?? [];
  return (
    <Screen
      title="Minswap"
      titleId="swaps-title"
      onBack={onBack}
      aside={tr("swaps.aside")}
      error={error}
      foot={
        <button
          type="button"
          className="primary"
          onClick={() => setStarting(true)}
          disabled={!!(blocked ?? noFunds)}
          title={blocked ?? noFunds}
        >
          {tr("swaps.new")}
        </button>
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load(true)} />
      {sessions?.length === 0 && (
        <p className="note center empty" data-testid="swaps-empty">
          {tr("swaps.empty")}
        </p>
      )}
      {!!sessions?.length && (
        <div className="stack" data-testid="swaps">
          {running.length > 0 && <SwapList title={tr("swaps.inProgress")} sessions={running} onOpen={setOpen} />}
          {over.length > 0 && <SwapList title={tr("swaps.past")} sessions={over} onOpen={setOpen} />}
        </div>
      )}
      <Callout tone="privacy">{tr("swaps.privacy.oneTime")}</Callout>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A new swap
// ---------------------------------------------------------------------------

/** The most of one token a value can hold: 2⁶³ − 1. */
const TOKEN_MAX = 2n ** 63n - 1n;
/** How long typing pauses before Minswap is asked for a quote: it limits how often it's asked. */
const QUOTE_PAUSE_MS = 600;
/** A quote older than this is asked for again before the funding is built on it. */
const QUOTE_FRESH_MS = 60_000;

/** What the private balance holds of a side. */
function heldOf(seedelf: Balances["seedelf"], id: string): string {
  if (id === "lovelace") return seedelf.lovelace;
  return seedelf.tokens.find((t) => t.policyId + t.assetName === id)?.quantity ?? "0";
}

/** A held token in the picker: its side, its second line, what's held, and whether it's on the wallet's list. */
type OwnPick = Pick & { sub: string; held: string; listed: boolean };

/**
 * ADA, then the private balance's tokens by name, with a second line and
 * what's held: one that isn't on the wallet's list says so, with its
 * fingerprint. NFTs aren't swapped on a DEX.
 */
function ownPicks(network: NetworkName, seedelf: Balances["seedelf"]): OwnPick[] {
  const views = sortTokens(
    seedelf.tokens.map((t) => viewToken(network, t)),
    "name",
  ).filter((v) => !v.nft);
  return [
    { ...ADA_PICK, sub: t("swaps.cardano"), held: seedelf.lovelace, listed: true },
    ...views.map((v) => {
      const text = tokenText(network, v.token);
      const mark = tokenMark(text);
      return {
        id: v.token.policyId + v.token.assetName,
        side: { label: text.label, decimals: tokenDecimals(network, v.token) },
        sub: mark ? mark.charAt(0).toUpperCase() + mark.slice(1) : v.sub,
        held: v.token.quantity,
        listed: text.listed,
      };
    }),
  ];
}

/** What the amount box takes for a side: its decimals, and no more than there can be. */
function rulesFor(p: Pick): AmountRules {
  if (p.id === "lovelace") return ADA_RULES;
  const { label, decimals } = p.side;
  return {
    decimals,
    max: TOKEN_MAX,
    notANumber: t(decimals ? "swaps.rules.notANumber" : "swaps.rules.notAWholeNumber"),
    tooPrecise: decimals
      ? t("swaps.rules.tooPrecise", { token: label, count: decimals })
      : t("swaps.rules.wholeUnits", { token: label }),
    tooMuch: t("swaps.rules.tooMuch", { token: label }),
  };
}

/** A big amount's class: smaller type once it's long, so it fits beside its token. */
const amountClass = (text: string, extra = "") =>
  `swap-card__amount${text.length > 10 ? " swap-card__amount--long" : ""}${extra}`;

/** A side's logo: ₳ for ADA, the wallet's listed logo for a token, or two letters. */
function SwapAvatar({ pick }: { pick: Pick }) {
  const network = useNetwork();
  if (pick.id === "lovelace") {
    return (
      <span className="avatar avatar--ada" aria-hidden="true">
        ₳
      </span>
    );
  }
  const token = tokenOf(pick.id);
  const logo = tokenInfo(network, token)?.logo;
  if (logo) return <img className="avatar avatar--logo" src={logo} alt="" />;
  return (
    <span className={`avatar avatar--tint-${tint(token.policyId)}`} aria-hidden="true">
      {initials(nameOf(pick))}
    </span>
  );
}

/** A card's token: its logo, name and a chevron, or Select token. Opens the picker. */
function TokenButton({ pick, what, testId, onClick }: { pick?: Pick; what: string; testId: string; onClick: () => void }) {
  const tr = useT();
  if (!pick) {
    return (
      <button type="button" className="swap-token swap-token--empty" onClick={onClick} aria-haspopup="dialog" data-testid={testId}>
        <PlusIcon size={16} />
        {tr("swaps.selectToken")}
        <ChevronDownIcon size={16} />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="swap-token"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={tr("swaps.changeTokenLabel", { token: nameOf(pick), what })}
      title={tr("swaps.changeToken", { what })}
      data-testid={testId}
    >
      <SwapAvatar pick={pick} />
      <span className="swap-token__name">{nameOf(pick)}</span>
      <ChevronDownIcon size={16} />
    </button>
  );
}

/** One row of a quote's details. */
function Detail({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "high" }) {
  return (
    <div className="swap-details__row">
      <dt>{label}</dt>
      <dd className={tone && tone !== "ok" ? `swap-impact--${tone}` : undefined}>{value}</dd>
    </div>
  );
}

export function NewSwap({
  seedelf,
  onCancel,
  onStarted,
  onWatch,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  /** The funding was sent: session `index` runs from here. */
  onStarted: (index: number, pending: PendingTx) => void;
  /** The funding was refused, but may have gone out all the same: session `index`'s page watches for it (DX-1). */
  onWatch?: (index: number) => void;
}) {
  const tr = useT();
  const amounts = useAmounts();
  const [pay, setPay] = useState<Pick>(ADA_PICK);
  const [get, setGet] = useState<Pick>();
  const [amount, setAmount] = useState("");
  // What the last edit of the amount changed or refused.
  const [note, setNote] = useState<string>();
  const [slippage, setSlippage] = useState(1);
  const [picking, setPicking] = useState<"pay" | "get">();
  const [settings, setSettings] = useState(false);
  const [quoted, setQuoted] = useState<{ quote: SwapQuote; at: number }>();
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string>();
  // Bumped to ask Minswap again for the same swap.
  const [again, setAgain] = useState(0);
  const [details, setDetails] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [price, setPrice] = useState<AdaPrice | null>(null);
  const [out, setOut] = useState<{ summary: SessionOutSummary; quote: SwapQuote; lovejoin?: SwapLovejoin }>();
  // The approval's switch: through Lovejoin, as Settings starts it, or directly (privacy review §4.1).
  const [through, setThrough] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Send was refused: the review gives way to building it again, or to watching one that may have gone out (DX-1).
  const [refusal, setRefusal] = useState<Refusal>();

  useEffect(() => {
    call("price", {}).then(setPrice, () => setPrice(null));
  }, []);

  const held = heldOf(seedelf, pay.id);
  const raw = parseQuantity(amount, pay.side.decimals);
  const tooMuch = !!raw && BigInt(raw) > BigInt(held);
  const getId = get?.id;
  const ask = useMemo<SwapAsk | undefined>(
    () => (getId && raw && raw !== "0" ? { amount: raw, tokenIn: pay.id, tokenOut: getId, slippage } : undefined),
    [pay.id, getId, raw, slippage],
  );

  // Minswap's quote, asked again whenever the swap changes, once typing pauses.
  useEffect(() => {
    setQuoteError(undefined);
    if (!ask) {
      setQuoting(false);
      return;
    }
    let live = true;
    setQuoting(true);
    const timer = setTimeout(() => {
      call("swap-quote", ask).then(
        (quote) => {
          if (!live) return;
          setQuoted({ quote, at: Date.now() });
          setQuoting(false);
        },
        (e: Error) => {
          if (!live) return;
          setQuoteError(e.message);
          setQuoting(false);
        },
      );
    }, QUOTE_PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ask, again]);

  const current = quoted && ask && sameAsk(quoted.quote.ask, ask) ? quoted.quote : undefined;
  // While a new amount is quoted, the last quote for the same pair stays, dimmed.
  const shown =
    ask && quoted && quoted.quote.ask.tokenIn === ask.tokenIn && quoted.quote.ask.tokenOut === ask.tokenOut
      ? quoted.quote
      : undefined;
  const short = current && !tooMuch ? adaShort(seedelf.lovelace, current) : undefined;
  // In whole units, as if typed: Minswap sees the amount, and Max and Half are worked out from the private balance (§2.13).
  const max = wholeUnits(pay.id === "lovelace" ? maxAdaIn(held, quoted?.quote) : held, pay.side.decimals);
  const half = wholeUnits(halfOf(held, max), pay.side.decimals);
  // A token that's neither on the wallet's list nor verified by Minswap: anyone can name one like a known one (#20).
  const unverified = current?.verified === false;
  const ready = !!current && !tooMuch && !short && !unverified && !quoteError;
  const level = shown ? impactLevel(shown.priceImpact) : "ok";

  const setTyped = (value: string) => {
    setAmount(value);
    setNote(undefined);
  };
  const fill = (quantity: string) => setTyped(quantity === "0" ? "" : formatQuantity(quantity, pay.side.decimals));

  /** What's received becomes what's paid, and the other way round. */
  function flip() {
    if (!get) return;
    setPay(get);
    setGet(pay);
    setTyped(current ? formatQuantity(current.amountOut, get.side.decimals) : "");
  }

  function choose(which: "pay" | "get", p: Pick) {
    setPicking(undefined);
    // The other side's token: they change places.
    if ((which === "pay" ? get : pay)?.id === p.id) return flip();
    if (which === "get") return setGet(p);
    if (p.id !== pay.id) {
      setPay(p);
      setTyped("");
    }
  }

  /**
   * Builds the funding on the quote shown, asked again first when it's over a
   * minute old (prices move). False: the fresh quote is more than the private
   * balance has, which the form then says. `keepWay`: a review built again
   * keeps the way back the user chose on the one before.
   */
  async function buildOut(keepWay = false): Promise<boolean> {
    if (!current || !quoted || !get) return false;
    let quote = current;
    if (Date.now() - quoted.at > QUOTE_FRESH_MS) {
      quote = await call("swap-quote", quote.ask);
      setQuoted({ quote, at: Date.now() });
      if (adaShort(seedelf.lovelace, quote)) return false;
    }
    const { lovejoin, ...summary } = await call("session-out-build", { quote, display: { in: pay.side, out: get.side } });
    if (!keepWay) setThrough(lovejoin?.on ?? false);
    setOut({ summary, quote, lovejoin });
    return true;
  }

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await buildOut();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** A refused funding, built again on the next unused account; back to the form when that can't be done (DX-1). */
  async function buildAgain() {
    if (busy) return;
    // The refusal stays until the new review is in, so its button says Building…, never Sending… (PY-1's lesson).
    setBusy(true);
    setError(undefined);
    try {
      if (!(await buildOut(true))) setOut(undefined);
    } catch (err) {
      setOut(undefined);
      setError((err as Error).message);
    } finally {
      setRefusal(undefined);
      setBusy(false);
    }
  }

  async function send() {
    if (!out || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // What the approval says of Lovejoin is kept with the swap: it comes back that way.
      const direct = out.lovejoin ? { direct: !through } : {};
      onStarted(out.summary.index, await call("session-out-submit", { txHash: out.summary.txHash, ...direct }));
    } catch (err) {
      // Its session was recorded before it was sent, so Send can't go again: build it again, or watch it (DX-1).
      const refused = await refusalOf(err, out.summary.index, out.summary.txHash);
      if (refused) setRefusal(refused);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  if (out && get) {
    return (
      <Screen
        title={tr("swaps.review.title")}
        titleId="swap-fund-review"
        review
        onBack={() => {
          // The review's alert doesn't follow the user back to the form (DX-1).
          setOut(undefined);
          setRefusal(undefined);
          setError(undefined);
        }}
        backDisabled={busy}
        aside={tr("swaps.review.nothingSent")}
        error={error}
        foot={
          refusal ? (
            <SessionRefusedFoot
              refusal={refusal}
              busy={busy}
              onAgain={() => void buildAgain()}
              onWatch={onWatch && (() => onWatch(out.summary.index))}
            />
          ) : (
            <button type="button" className="primary" onClick={send} disabled={busy}>
              {busy ? tr("common.sending") : tr("swaps.review.start")}
            </button>
          )
        }
      >
        <SwapApproval {...out} pay={pay} get={get} through={through} onThrough={setThrough} busy={busy} before={homeBalance(seedelf)} />
        <TxDetailButton txHash={out.summary.txHash} testId="swap-out-tx" />
      </Screen>
    );
  }

  const outText = shown && get ? formatQuantity(shown.amountOut, get.side.decimals) : "";
  const fiat = (id: string, quantity?: string) =>
    id === "lovelace" && quantity && quantity !== "0" && price ? `≈ ${formatFiat(quantity, price)}` : "";
  const cta = !get
    ? tr("swaps.cta.selectToken")
    : !raw || raw === "0"
      ? tr("swaps.cta.enterAmount")
      : tooMuch
        ? tr("swaps.cta.notEnough", { token: nameOf(pay) })
        : !current
          ? tr("swaps.cta.quoting")
          : unverified
            ? tr("swaps.cta.unverified")
            : short
              ? tr("swaps.cta.notEnoughAda")
              : busy
                ? tr("common.building")
                : tr("swaps.cta.review");

  return (
    <Screen
      onSubmit={review}
      title={tr("swaps.form.title")}
      titleId="swap-title"
      onBack={onCancel}
      backDisabled={busy}
      aside={tr("swaps.form.aside")}
      error={error ?? quoteError}
      foot={
        quoteError && !error ? (
          <button type="button" className="primary" onClick={() => setAgain((n) => n + 1)}>
            {tr("common.tryAgain")}
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!ready || busy}>
            {cta}
          </button>
        )
      }
    >
      {/* The slippage, said with its value where the swap is set up, not behind an unlabelled icon in the header;
          amber once it's high (chunk 23's second review, DX-4). */}
      <button
        type="button"
        className={slippage >= SLIPPAGE_HIGH ? "chip swap-slippage swap-slippage--high" : "chip swap-slippage"}
        onClick={() => setSettings(true)}
        aria-haspopup="dialog"
        data-testid="swap-slippage"
      >
        <SlidersIcon size={14} />
        {tr("swaps.slippageIs", { percent: formatPercent(slippage) })}
      </button>
      <div className="swap-cards">
        <div className="swap-card">
          <div className="swap-card__head">
            <label htmlFor="swap-amount">{tr("swaps.youPay")}</label>
            <span className="swap-card__quick">
              <button
                type="button"
                className="link"
                onClick={() => fill(half)}
                disabled={half === "0"}
                aria-label={tr("swaps.halfOf", { token: nameOf(pay) })}
                title={tr(pay.side.decimals ? "swaps.halfWhole" : "swaps.half")}
              >
                {tr("swaps.half")}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => fill(max)}
                disabled={max === "0"}
                aria-label={tr("swaps.maxOf", { token: nameOf(pay) })}
                title={
                  pay.id === "lovelace"
                    ? tr("swaps.maxAda")
                    : pay.side.decimals
                      ? tr("swaps.maxToken", { token: pay.side.label })
                      : tr("swaps.maxAll")
                }
              >
                {tr("swaps.max")}
              </button>
            </span>
          </div>
          <div className="swap-card__main">
            <AmountField
              id="swap-amount"
              className={amountClass(amount)}
              placeholder="0.0"
              value={amount}
              clean={(previous, text) => sanitizeAmount(previous, text, rulesFor(pay))}
              onChange={(value, why) => {
                setAmount(value);
                setNote(why);
              }}
              aria-invalid={tooMuch || undefined}
              autoFocus
            />
            <TokenButton pick={pay} what={tr("swaps.what.pay")} testId="swap-from" onClick={() => setPicking("pay")} />
          </div>
          <div className="swap-card__foot">
            <span>{fiat(pay.id, raw)}</span>
            <span
              className={tooMuch ? "swap-card__held swap-card__held--short" : "swap-card__held"}
              title={tr("swaps.inPrivate")}
              data-testid="swap-held"
            >
              <WalletIcon size={14} />
              {amounts.quantity(held, pay.side.decimals)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="swap-flip"
          onClick={flip}
          disabled={!get}
          aria-label={tr("swaps.switchLabel")}
          title={tr("swaps.switch")}
        >
          <ArrowDownIcon size={18} />
        </button>
        <div className="swap-card">
          <div className="swap-card__head">
            <span className="label" id="swap-out-label">
              {tr("swaps.youReceive")}
            </span>
          </div>
          <div className="swap-card__main">
            <output
              className={amountClass(outText, !outText ? " swap-card__amount--empty" : quoting ? " swap-card__amount--waiting" : "")}
              aria-labelledby="swap-out-label"
              aria-busy={quoting}
              data-testid="swap-out"
            >
              {outText || "0.0"}
            </output>
            <TokenButton pick={get} what={tr("swaps.what.get")} testId="swap-to" onClick={() => setPicking("get")} />
          </div>
          <div className="swap-card__foot">
            <span>{get && fiat(get.id, shown?.amountOut)}</span>
            {get && (
              <span className="swap-card__held" title={tr("swaps.inPrivate")}>
                <WalletIcon size={14} />
                {amounts.quantity(heldOf(seedelf, get.id), get.side.decimals)}
              </span>
            )}
          </div>
        </div>
      </div>
      {note && <p className="field-note">{note}</p>}
      {tooMuch && (
        <p className="field-note" data-testid="swap-short">
          {tr("swaps.tooMuch", { held: amountOf(held, pay, amounts.quantity) })}
        </p>
      )}
      {/* Max is less than the balance: it says why, on the page, not only in its label (DX-4). */}
      {pay.id === "lovelace" && max !== "0" && raw === max && (
        <p className="note" data-testid="swap-max-note">
          {tr("swaps.maxNote", { max: amounts.ada(max), aside: amounts.ada((BigInt(held) - BigInt(max)).toString()) })}
        </p>
      )}
      {unverified && get && <Unverified pick={get} />}
      {short && current && (
        <p className="field-note" data-testid="swap-short">
          {tr("swaps.short", {
            takes: formatAda(current.fund.lovelace),
            collateral: formatAda(current.collateral),
            held: amounts.ada(seedelf.lovelace),
          })}
        </p>
      )}
      {shown && get && (
        <div className={current ? "swap-details" : "swap-details swap-details--stale"} data-testid="swap-details">
          <div className="swap-rate">
            <button
              type="button"
              className="swap-rate__text"
              onClick={() => setInverted(!inverted)}
              title={tr("swaps.turnRate")}
              data-testid="swap-rate"
            >
              {inverted
                ? tr("swaps.rate", {
                    one: nameOf(get),
                    rate: rateOf(shown.amountOut, get.side.decimals, shown.amountIn, pay.side.decimals),
                    other: nameOf(pay),
                  })
                : tr("swaps.rate", {
                    one: nameOf(pay),
                    rate: rateOf(shown.amountIn, pay.side.decimals, shown.amountOut, get.side.decimals),
                    other: nameOf(get),
                  })}
            </button>
            {level !== "ok" && !details && (
              <span className={`swap-rate__impact swap-impact--${level}`}>
                {tr("swaps.impact", { percent: formatPercent(shown.priceImpact) })}
              </span>
            )}
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={() => setAgain((n) => n + 1)}
              disabled={quoting}
              aria-label={tr("swaps.askAgain")}
              title={tr("swaps.askAgain")}
            >
              <span className={quoting ? "spin" : "swap-rate__icon"}>
                <RefreshIcon size={14} />
              </span>
            </button>
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={() => setDetails(!details)}
              aria-expanded={details}
              aria-controls="swap-quote-rows"
              aria-label={tr("swaps.quoteDetails")}
              title={tr(details ? "swaps.hideDetails" : "swaps.showDetails")}
            >
              <span className={details ? "swap-chevron swap-chevron--open" : "swap-chevron"}>
                <ChevronDownIcon size={16} />
              </span>
            </button>
          </div>
          {details && (
            <dl className="swap-details__rows" id="swap-quote-rows" data-testid="swap-quote-rows">
              <Detail label={tr("swaps.detail.atLeast")} value={amountOf(shown.minAmountOut, get)} />
              <Detail label={tr("swaps.detail.impact")} value={formatPercent(shown.priceImpact)} tone={level} />
              <Detail
                label={tr("swaps.slippage")}
                value={
                  <button type="button" className="link" onClick={() => setSettings(true)}>
                    {formatPercent(slippage)}
                  </button>
                }
              />
              <Detail label={tr("swaps.detail.route")} value={shown.route.join(tr("histories.list.comma"))} />
              <Detail label={tr("swaps.detail.dexFee")} value={`${formatAda(shown.dexFee)}\u00a0₳`} />
              {shown.aggregatorFee !== "0" && (
                <Detail label={tr("swaps.detail.minswapFee")} value={`${formatAda(shown.aggregatorFee)}\u00a0₳`} />
              )}
              <Detail
                label={tr("swaps.detail.deposit")}
                value={tr("swaps.detail.depositValue", { ada: formatAda(shown.deposits) })}
              />
            </dl>
          )}
        </div>
      )}
      {!shown && quoting && (
        <p className="note swap-asking">
          <span className="spin">
            <SpinnerIcon size={14} />
          </span>
          {tr("swaps.asking")}
        </p>
      )}
      {level === "high" && shown && (
        <Callout tone="warn" testId="swap-impact-warning">
          {tr("swaps.warn.impact", { percent: formatPercent(shown.priceImpact), token: nameOf(pay) })}
        </Callout>
      )}
      {/* On the form too, not only in the slippage's dialog (DX-4). */}
      {slippage >= SLIPPAGE_HIGH && (
        <Callout tone="warn" testId="swap-slippage-high">
          {tr("swaps.slippage.warn.high", { percent: formatPercent(slippage) })}
        </Callout>
      )}
      <Callout tone="privacy" testId="swap-quote-privacy">{tr("swaps.privacy.quote")}</Callout>
      {picking && (
        <TokenSelect
          which={picking}
          seedelf={seedelf}
          chosen={picking === "pay" ? pay.id : get?.id}
          onPick={(p) => choose(picking, p)}
          onClose={() => setPicking(undefined)}
        />
      )}
      {settings && <SlippageSettings value={slippage} onChange={setSlippage} onClose={() => setSettings(false)} />}
    </Screen>
  );
}

/**
 * A swap's approval, under its Send: the swap, the funding payment, what
 * then happens by itself, and how it comes back (LovejoinChoice).
 * `lovejoin`: the quote's Lovejoin, checked against the pool at Review.
 * `before`: the private balance as Home shows it, for "Private balance
 * after".
 */
export function SwapApproval({
  summary,
  quote,
  lovejoin: l,
  pay,
  get,
  through,
  onThrough,
  busy,
  before,
}: {
  summary: SessionOutSummary;
  quote: SwapQuote;
  lovejoin?: SwapLovejoin;
  pay: Pick;
  get: Pick;
  through: boolean;
  onThrough: (through: boolean) => void;
  busy: boolean;
  before?: string;
}) {
  const tr = useT();
  const network = useNetwork();
  const [swapPart, collateral] = summary.payments;
  const got = get.id === "lovelace" ? undefined : tokenText(network, tokenOf(get.id));
  const adaOut = quote.ask.tokenOut === "lovelace";
  // Lovejoin would take something, now or after a stop or a refund: the approval says which way it comes back.
  const any = !!l && (l.boxes > 0 || !!l.of || !!l.ifStopped);
  // Its return goes through Lovejoin, and the pool takes a box: its mixes and their way back are costs too.
  const mixes = through && !!l && !l.skipped && l.boxes > 0;
  // What leaves now, what it all costs and what comes back, as the other reviews say it (blind test §9.8, T10: one
  // Start swap approves three transactions, and the tester added up Transaction details to find what left).
  const paid = summary.payments.reduce((sum, p) => sum + BigInt(p.lovelace), 0n);
  const costs = swapCosts(quote, { paid, fee: BigInt(summary.fee.total) }, mixes ? l : undefined);
  const tokensOut = new Set(summary.payments.flatMap((p) => p.tokens.map(tokenKey))).size;
  return (
    <>
      <div className="swap-summary" data-testid="swap-summary">
        <div className="swap-summary__row">
          <SwapAvatar pick={pay} />
          <span className="swap-summary__label">{tr("swaps.youPay")}</span>
          <span className="swap-summary__amount">{amountOf(quote.amountIn, pay)}</span>
        </div>
        <div className="swap-summary__row">
          <SwapAvatar pick={get} />
          <span className="swap-summary__label">{tr("swaps.youReceive")}</span>
          <span className="swap-summary__amount">≈ {amountOf(quote.amountOut, get)}</span>
        </div>
        <p className="swap-summary__foot">
          {tr("swaps.summary.foot", {
            least: amountOf(quote.minAmountOut, get),
            slippage: formatPercent(quote.ask.slippage),
            impact: formatPercent(quote.priceImpact),
            route: quote.route.join(tr("histories.list.comma")),
          })}
        </p>
        {got && !got.listed && quote.verified && (
          <p className="swap-summary__foot" data-testid="swap-out-unlisted">
            {tr("swaps.summary.unlisted", { token: got.label, fingerprint: got.fingerprint })}
          </p>
        )}
      </div>
      {/* By the minimum, its own line: the wallet asks Minswap for it, and can't read it back from the order Minswap
          builds (chunk 23's second review, DX-2). Reading it would mean decoding each DEX's order datum. */}
      <Callout tone="warn" testId="swap-minimum-trust">
        {tr("swaps.review.warn.minimum", { least: amountOf(quote.minAmountOut, get) })}
      </Callout>
      {quote.ask.slippage >= SLIPPAGE_HIGH && (
        <Callout tone="warn" testId="swap-slippage-high">
          {tr("swaps.slippage.warn.high", { percent: formatPercent(quote.ask.slippage) })}
        </Callout>
      )}
      <h2>{tr("lovejoin.review.firstFunded")}</h2>
      <ReviewRows testId="swap-fund-review">
        <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: summary.index + 1 })} strong />
        <Row label={tr("lovejoin.review.account")} value={shortHex(summary.address, 16, 8)} title={summary.address} />
        {/* Not bold, and not "For the swap": above the 5 ₳ and the fee, it read as the total (blind test T10). The
            total is its own row now. */}
        <Row label={tr("swaps.review.forSwap")} value={fundText(swapPart!.lovelace, swapPart!.tokens, pay.side, network)} />
        <FundParts quote={quote} funded={swapPart!.lovelace} />
        <Row label={tr("lovejoin.review.itsCollateral")} value={tr("swaps.review.comesBack", { ada: formatAda(collateral!.lovelace) })} />
        <Row label={tr("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
        {/* What leaves, and the balance after, as every other review says them. The change isn't a row, as it isn't
            on theirs: beside the balance, "back to your private balance" read as what would be left (ReviewTotals). */}
        <TotalRows side="private" leaving={costs.leaving} before={before} tokens={tokensOut} />
      </ReviewRows>
      <SwapCosts quote={quote} get={get} costs={costs} />
      <h2>{tr("lovejoin.review.thenItself")}</h2>
      <Plan lovejoin={mixes} adaOut={adaOut} />
      <p className="note" data-testid="swap-approves">
        {tr("swaps.review.approves")}
      </p>
      {any && (
        <LovejoinChoice
          lovejoin={l!}
          funded={quote.fund.lovelace}
          through={through}
          onThrough={onThrough}
          busy={busy}
        />
      )}
      {l && !any && (
        <p className="note" data-testid="swap-lovejoin">
          {tr("swaps.review.noBox")}
        </p>
      )}
      <Callout tone="privacy">{tr("swaps.review.privacy.links")}</Callout>
      <HistoriesNote histories={summary.histories} session={summary.index} testId="swap-histories" />
      <GivemeNote funding />
    </>
  );
}

/**
 * What a swap costs, all told, and what comes back (blind test §9.8, T10):
 * the DEX's fee, Minswap's, the network fees of its transactions (this
 * payment's exact, the later ones' about SESSION_FEE_ESTIMATE each, as
 * nothing has built them yet), and Lovejoin's when its return goes through
 * it; then what comes back into the private balance: what's received, and
 * the ADA that isn't used up. Exported for its test.
 */
export function SwapCosts({
  quote,
  get,
  costs,
}: {
  quote: SwapQuote;
  get: Pick;
  costs: ReturnType<typeof swapCosts>;
}) {
  const tr = useT();
  const about = (lovelace: bigint) => adaText(toCents(lovelace));
  return (
    <>
      <h2>{tr("swaps.costs.title")}</h2>
      {/* The total first, what it's made of set in under it, as Lovejoin's page says a mix's cost (visual review). */}
      <ReviewRows testId="swap-costs">
        <Row label={tr("swaps.costs.total")} value={about(costs.cost)} strong testId="swap-cost-total" />
        <Row label={tr("swaps.detail.dexFee")} value={adaText(quote.dexFee)} part />
        {quote.aggregatorFee !== "0" && <Row label={tr("swaps.detail.minswapFee")} value={adaText(quote.aggregatorFee)} part />}
        <Row label={tr("swaps.costs.network")} value={about(costs.networkFees)} part />
        {costs.lovejoin > 0n && <Row label={tr("swaps.costs.lovejoin")} value={about(costs.lovejoin)} part />}
        <Row
          label={tr("swaps.costs.back")}
          value={
            get.id === "lovelace"
              ? tr("swaps.costs.backAda", { ada: aboutAda(costs.back) })
              : tr("swaps.costs.backToken", { token: amountOf(quote.amountOut, get), ada: aboutAda(costs.back) })
          }
          testId="swap-comes-back"
        />
      </ReviewRows>
      {/* Which transactions the network fees are, and that the later ones come out of the room for them: "Three
          transactions, three network fees" gave a figure for the first only (blind test T10). This payment's own is
          its row above. */}
      <p className="note" data-testid="swap-costs-note">
        {tr(costs.later > 2 ? "swaps.costs.noteLovejoin" : "swaps.costs.note", { each: aboutAda(SESSION_FEE_ESTIMATE) })}
      </p>
    </>
  );
}

/**
 * What happens after Send, as the swap's own page then shows it: the
 * timeline's four steps, none taken yet. `lovejoin`: the return goes through
 * Lovejoin first; `adaOut`: the proceeds are ADA, so they go through it too.
 * The least the order asks for is said above it, once.
 */
export function Plan({ lovejoin, adaOut }: { lovejoin: boolean; adaOut: boolean }) {
  const tr = useT();
  const steps = [
    [tr("swaps.plan.funded"), tr("swaps.plan.fundedSub")],
    [tr("swaps.plan.ordered"), tr("swaps.plan.orderedSub")],
    [tr("swaps.plan.filled"), tr("swaps.plan.filledSub")],
    [
      tr("swaps.plan.back"),
      tr(!lovejoin ? "swaps.plan.backDirect" : adaOut ? "swaps.plan.backAdaOut" : "swaps.plan.backTokenOut"),
    ],
  ];
  return (
    <div className="timeline" data-testid="swap-steps">
      <ol className="timeline__steps">
        {steps.map(([title, sub], i) => (
          <li key={title} className="timeline__step">
            <span className="timeline__icon" aria-hidden="true">
              {i + 1}
            </span>
            <span className="timeline__title">{title}</span>
            <p className="timeline__sub">{sub}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * How a swap comes back, on its approval (privacy review §4.1): a switch,
 * through Lovejoin as Settings starts it, or directly, kept with the swap.
 * Through it: what that takes (LovejoinCost), what a stop or a refund of an
 * ADA swap's order would take instead, since its whole funding then comes
 * back (`ifStopped`, §2.8), or why Lovejoin's pool takes nothing now
 * (`skipped`, §2.7). `funded`: the funding's ADA for the swap.
 */
export function LovejoinChoice({
  lovejoin: l,
  funded,
  through,
  onThrough,
  busy,
}: {
  lovejoin: SwapLovejoin;
  funded: string;
  through: boolean;
  onThrough: (through: boolean) => void;
  busy: boolean;
}) {
  const tr = useT();
  const cost = through && !l.skipped && l.boxes > 0;
  const stopped = through && !l.skipped ? l.ifStopped : undefined;
  return (
    <>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="swap-lovejoin-label">{tr("swaps.lovejoin.label")}</span>
          {/* On while the pool has no room now: the switch says it doesn't apply as things are, as the note under
              it does (chunk 23's second review, DX-3). */}
          <span className="note" id="swap-lovejoin-note" data-testid="swap-lovejoin-choice">
            {tr(!through ? "swaps.lovejoin.privacy.off" : l.skipped ? "swaps.lovejoin.privacy.onPoolShort" : "swaps.lovejoin.privacy.on")}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={through}
          aria-labelledby="swap-lovejoin-label"
          aria-describedby="swap-lovejoin-note"
          onClick={() => onThrough(!through)}
          disabled={busy}
          data-testid="swap-lovejoin-switch"
        />
      </div>
      {through && l.skipped && (
        <Callout tone="warn" testId="swap-lovejoin-pool">
          {tr("swaps.lovejoin.warn.pool", { why: l.skipped })}
        </Callout>
      )}
      {cost && <LovejoinCost lovejoin={l} />}
      {stopped && (
        <p className="note" data-testid="swap-lovejoin-stopped">
          {tr("swaps.lovejoin.ifStopped", {
            ada: formatAda(funded),
            boxes: boxesText(stopped),
            mixFees: formatAda(stopped.mixFees),
            backFees: formatAda(stopped.withdrawFees),
            delay: delayText(l.delay),
          })}
        </p>
      )}
      {through && !cost && (
        <p className="note" data-testid="lovejoin-unaudited">
          {LOVEJOIN_UNAUDITED()}
        </p>
      )}
    </>
  );
}

/** About how many boxes of 10 ₳: at most, or as many as the pool has room for now (`of`: what the ADA pays for). */
function boxesText(l: { boxes: number; of?: number }): string {
  return l.of
    ? t("swaps.boxes.roomFor", { count: l.boxes, of: l.of })
    : t("swaps.boxes.atMost", { count: l.boxes });
}

/**
 * What bringing the session back through Lovejoin is expected to take, from
 * the worker's quote: the boxes (at most: the pool may take fewer, or none;
 * or as many as the pool has room for at Review), their mixes and fees, and
 * the fees to bring each back, after its wait. Which money goes through it
 * (the proceeds too when they're ADA, launch review #26) is the Plan's last
 * step, said once.
 */
export function LovejoinCost({ lovejoin: l }: { lovejoin: SwapLovejoin }) {
  const tr = useT();
  return (
    <>
      <h2>{tr("swaps.cost.title")}</h2>
      <ReviewRows testId="swap-lovejoin-cost">
        <Row
          label={tr("swaps.cost.boxesLabel")}
          value={l.of ? tr("swaps.cost.boxesOf", { boxes: l.boxes, of: l.of }) : tr("swaps.cost.boxesAtMost", { boxes: l.boxes })}
        />
        <Row
          label={tr("lovejoin.mixedLabel")}
          value={tr("lovejoin.mix.depthAndMixes", { count: l.depth, mixes: tr("amount.mixes", { count: l.mixes }) })}
        />
        <Row label={tr("lovejoin.mix.feesLabel")} value={`${formatAda(l.mixFees)}\u00a0₳`} />
        <Row label={tr("swaps.cost.backLabel")} value={`${formatAda(l.withdrawFees)}\u00a0₳`} />
        <Row label={tr("lovejoin.backLater")} value={tr("lovejoin.eachBoxAfter", { delay: delayText(l.delay) })} stack />
      </ReviewRows>
      {/* The rows say the boxes, their fees and their wait: the note says only what they hide, and that this swap
          keeps them whatever Settings says later (independent review L21). */}
      <p className="note" data-testid="swap-lovejoin">
        {joinSentences([lovejoinHides(l.depth), tr("swaps.cost.settingsLater")])}
      </p>
      <p className="note" data-testid="lovejoin-unaudited">
        {LOVEJOIN_UNAUDITED()}
      </p>
    </>
  );
}

/**
 * A quote for a token the wallet won't swap into (#20): neither on its list
 * nor verified by Minswap, by its ID. It's named by its fingerprint, and
 * Review stays off: the worker refuses to fund it.
 */
export function Unverified({ pick }: { pick: Pick }) {
  const tr = useT();
  const text = tokenText(useNetwork(), tokenOf(pick.id));
  return (
    <Callout tone="warn" testId="swap-unverified">
      <div className="stack-tight">
        <strong>{tr("swaps.cta.unverified")}</strong>
        <span>{tr("swaps.warn.unverified", { token: text.label })}</span>
        <code className="swap-token-id">{text.fingerprint}</code>
      </div>
    </Callout>
  );
}

/**
 * What "For the swap" pays for, a row each, so the rows add up to it (chunk
 * 23's second review, DX-3): the ADA swapped, the DEX's fee, Minswap's, the
 * order's deposit, back with the proceeds, and the room left for the network
 * fees, whose rest comes back. Nothing when they don't add up (fundParts).
 */
function FundParts({ quote, funded }: { quote: SwapQuote; funded: string }) {
  const tr = useT();
  const parts = fundParts(quote, funded);
  if (!parts) return null;
  const ada = (lovelace: string) => `${formatAda(lovelace)}\u00a0₳`;
  return (
    <>
      {/* Set in under "The swap and its costs": its parts, not more charges beside the total (visual review). */}
      {parts.swapped !== "0" && <Row label={tr("swaps.review.part.swapped")} value={ada(parts.swapped)} part />}
      <Row label={tr("swaps.detail.dexFee")} value={ada(parts.dexFee)} part />
      {parts.aggregatorFee !== "0" && <Row label={tr("swaps.detail.minswapFee")} value={ada(parts.aggregatorFee)} part />}
      <Row label={tr("swaps.detail.deposit")} value={tr("swaps.detail.depositValue", { ada: formatAda(parts.deposits) })} part />
      <Row label={tr("swaps.review.part.room")} value={tr("swaps.review.part.roomValue", { ada: formatAda(parts.room) })} part />
    </>
  );
}

/** What the funding carries for the swap, in words: each token named by `tokenAmountText`. */
function fundText(lovelace: string, tokens: TokenQuantity[], side: SwapSide, network: NetworkName): string {
  const ada = `${formatAda(lovelace)}\u00a0₳`;
  if (!tokens.length) return ada;
  return t("swaps.fundAndTokens", {
    ada,
    tokens: tokens.map((q) => tokenAmountText(network, { ...q, decimals: side.decimals })).join(t("histories.list.comma")),
  });
}

/** A token on the wallet's list that isn't held, as the picker offers it: its ticker, and the list's name under it. */
type ListedPick = Pick & { sub: string };

/**
 * What the picker finds for `query` without asking anyone (privacy review
 * §3.11): what's held (`own`) and, for what's received, the tokens on the
 * wallet's list that aren't held, by ticker, name or ID. Minswap is asked
 * only when neither has a match, or when the user asks it.
 */
export function localMatches(
  network: NetworkName,
  own: OwnPick[],
  query: string,
  which: "pay" | "get",
): { held: OwnPick[]; listed: ListedPick[] } {
  const lower = query.trim().toLowerCase();
  const hit = (p: Pick & { sub: string }) => !lower || [nameOf(p), p.sub, p.id].some((s) => s.toLowerCase().includes(lower));
  const listed =
    which === "get"
      ? listedTokens(network)
          .map((t) => ({ id: t.policyId + t.assetName, side: { label: t.info.ticker, decimals: t.info.decimals }, sub: t.info.name }))
          .filter((p) => !own.some((o) => o.id === p.id))
      : [];
  return { held: own.filter(hit), listed: listed.filter(hit) };
}

/**
 * Picks one side's token: ADA or one in the private balance, and for what's
 * received, one on the wallet's list, or any on Minswap's. The wallet's own
 * list is matched first, on the device; Minswap is asked only when nothing
 * here matches, or on Search Minswap, and then sees what's searched for
 * (privacy review §3.11). What's received lists held tokens that are
 * neither on the wallet's list nor found on Minswap's verified list apart,
 * after Minswap's, never first: anyone can put a token named like a known
 * one in a private balance (#20).
 */
export function TokenSelect({
  which,
  seedelf,
  chosen,
  onPick,
  onClose,
}: {
  which: "pay" | "get";
  seedelf: Balances["seedelf"];
  chosen?: string;
  onPick: (pick: Pick) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const network = useNetwork();
  // What's held: masked while balances are hidden, as on the form (HM-9).
  const amounts = useAmounts();
  // The second lines are words: made again when another page switches the language.
  const language = currentLanguage();
  const own = useMemo(() => ownPicks(network, seedelf), [network, seedelf, language]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SwapTokenInfo[]>();
  const [error, setError] = useState<string>();
  // The query the user asked Minswap about (Search Minswap), though something here matched it.
  const [asked, setAsked] = useState<string>();
  const q = query.trim();
  const { held: matching, listed } = useMemo(() => localMatches(network, own, q, which), [network, own, q, which]);
  const search = which === "get" && q.length >= 2 && (asked === q || (!matching.length && !listed.length));

  useEffect(() => {
    setFound(undefined);
    setError(undefined);
    if (!search) return;
    let live = true;
    // Asked once typing pauses, not on every key.
    const timer = setTimeout(() => {
      call("swap-tokens", { query: q }).then(
        (list) => live && setFound(list.filter((t) => t.id !== "lovelace")),
        (e: Error) => live && setError(e.message),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, q]);

  // Minswap's search lists verified tokens only: one of those held is as good as listed.
  const vouched = (p: OwnPick) => p.listed || !!found?.some((t) => t.id === p.id);
  const mine = which === "get" ? matching.filter(vouched) : matching;
  const others = which === "get" ? matching.filter((p) => !vouched(p)) : [];
  const theirs = found?.filter((t) => !own.some((p) => p.id === t.id) && !listed.some((p) => p.id === t.id));

  const row = (p: Pick, sub: string, held?: string) => (
    <li key={p.id}>
      <button
        type="button"
        className={p.id === chosen ? "token-row token-row--on" : "token-row"}
        aria-label={nameOf(p)}
        aria-current={p.id === chosen || undefined}
        onClick={() => onPick(p)}
      >
        <SwapAvatar pick={p} />
        <span className="token-row__label">{nameOf(p)}</span>
        <span className="token-row__amount">{held === undefined ? "" : amounts.quantity(held, p.side.decimals)}</span>
        <span className="token-row__sub">{sub}</span>
      </button>
    </li>
  );

  return (
    <Modal title={tr(which === "pay" ? "swaps.pick.pay" : "swaps.youReceive")} titleId="swap-pick-title" onClose={onClose}>
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label={tr("swaps.pick.search")}
          placeholder={tr(which === "get" ? "swaps.pick.placeholderGet" : "swaps.pick.placeholderPay")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </label>
      {which === "get" && (
        <p className="field-note">{tr("swaps.pick.privacy.ownListFirst")}</p>
      )}
      <h3 className="swap-pick__heading">{tr("swaps.inPrivate")}</h3>
      {mine.length ? (
        <ul className="list" data-testid="swap-own-tokens">
          {mine.map((p) => row(p, p.sub, p.held))}
        </ul>
      ) : (
        <p className="note">
          {others.length ? tr("swaps.pick.noneVouched") : tr("swaps.pick.noneHeld", { query: q })}
        </p>
      )}
      {listed.length > 0 && (
        <>
          <h3 className="swap-pick__heading">{tr("swaps.pick.onOurList")}</h3>
          <ul className="list" data-testid="swap-listed-tokens">
            {listed.map((p) => row(p, p.sub))}
          </ul>
        </>
      )}
      {which === "get" && (
        <>
          <h3 className="swap-pick__heading">{tr("swaps.pick.onMinswap")}</h3>
          {!search &&
            (q.length >= 2 ? (
              <button type="button" className="link align-start" onClick={() => setAsked(q)} data-testid="swap-search-minswap">
                {tr("swaps.pick.searchMinswap", { query: q })}
              </button>
            ) : (
              <p className="note">{tr("swaps.pick.searchToFind")}</p>
            ))}
          {search && error && <p className="error">{error}</p>}
          {search && !found && !error && <p className="note">{tr("swaps.pick.searching")}</p>}
          {theirs?.length === 0 && <p className="note">{tr("swaps.pick.minswapNone")}</p>}
          {!!theirs?.length && (
            <ul className="list" data-testid="swap-tokens">
              {theirs.slice(0, 12).map((t) => {
                // Named as every text view names a token; Minswap's own name for it goes under.
                const pick = pickOf(network, t.id, t.decimals);
                const minswap = [t.ticker, t.name].filter(Boolean).join(" · ") || shortHex(t.id, 12, 6);
                return row(pick, tr("swaps.pick.verifiedBy", { name: minswap }));
              })}
            </ul>
          )}
          {others.length > 0 && (
            <>
              <h3 className="swap-pick__heading">{tr("swaps.pick.alsoHeld")}</h3>
              <p className="field-note" data-testid="swap-unverified-note">
                {tr(found ? "swaps.pick.warn.notListedNorMinswap" : "swaps.pick.warn.notListed")}
              </p>
              <ul className="list" data-testid="swap-unverified-tokens">
                {others.map((p) => row(p, p.sub, p.held))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/** The slippage: a few usual ones, or the user's own. */
function SlippageSettings({
  value,
  onChange,
  onClose,
}: {
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const presets = [0.5, 1, 3];
  const [own, setOwn] = useState(presets.includes(value) ? "" : String(value));
  const typed = own.trim() ? parseSlippage(own) : undefined;
  return (
    <Modal
      title={tr("swaps.slippage")}
      titleId="swap-slippage-title"
      onClose={onClose}
      foot={
        <button type="button" className="primary" onClick={onClose}>
          {tr("swaps.slippage.done")}
        </button>
      }
    >
      <p className="note">{tr("swaps.slippage.note")}</p>
      <div className="segmented" role="group" aria-label={tr("swaps.slippage.usual")}>
        {presets.map((p) => {
          const on = value === p && !own.trim();
          return (
            <button
              key={p}
              type="button"
              className={on ? "segmented__item segmented__item--on" : "segmented__item"}
              aria-pressed={on}
              onClick={() => {
                setOwn("");
                onChange(p);
              }}
            >
              {formatPercent(p)}
            </button>
          );
        })}
      </div>
      <div className="field">
        <label htmlFor="swap-slippage-own">{tr("swaps.slippage.yourOwn")}</label>
        {/* No placeholder: a "2" there read as a value set while 1% was chosen (DX-4). */}
        <div className="amount-box">
          <input
            id="swap-slippage-own"
            inputMode="decimal"
            autoComplete="off"
            value={own}
            aria-invalid={(!!own.trim() && typed === undefined) || undefined}
            onChange={(e) => {
              setOwn(e.target.value);
              const n = parseSlippage(e.target.value);
              if (n !== undefined) onChange(n);
            }}
          />
          <span className="amount-box__unit">%</span>
        </div>
        {!!own.trim() && typed === undefined && (
          <p className="field-note">
            {tr("swaps.slippage.range", { min: formatPercent(SLIPPAGE_MIN), max: formatPercent(SLIPPAGE_MAX) })}
          </p>
        )}
      </div>
      {value >= SLIPPAGE_HIGH && (
        <Callout tone="warn" testId="swap-slippage-warning">
          {tr("swaps.slippage.warn.high", { percent: formatPercent(value) })}
        </Callout>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

/** How often a running swap's page asks the runner for its next step. */
const ADVANCE_EVERY_MS = 20_000;

export function Session({
  session,
  updatedAt,
  reading,
  onRefresh,
  onBack,
  onChanged,
}: {
  session: SessionView;
  updatedAt?: number;
  reading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onChanged: (sessions: SessionView[]) => void;
}) {
  const tr = useT();
  const network = useNetwork();
  const amounts = useAmounts();
  const [s, setS] = useState(session);
  const [orders, setOrders] = useState<SessionOrder[]>();
  const [review, setReview] = useState<SessionTxReview>();
  const [back, setBack] = useState<SessionBackSummary>();
  // Which way the return shown was built: as the swap was approved, or directly, by its switch.
  const [backThrough, setBackThrough] = useState(true);
  const [stopping, setStopping] = useState(false);
  // What Stop brings back through Lovejoin, read as its dialog opens: null, directly.
  const [stopCost, setStopCost] = useState<SwapLovejoin | null>();
  // Stop's switch: through Lovejoin, as the swap was approved, until the user turns it off.
  const [stopThrough, setStopThrough] = useState(true);
  // Whether an order has gone out, as the record says as Stop's dialog opens: the page's last reading may be
  // behind the runner. And one went out before Stop took effect, though the dialog said none had (independent
  // review L22).
  const [placedNow, setPlacedNow] = useState(false);
  const [stoppedLate, setStoppedLate] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // The list read it again: take its reading.
  useEffect(() => setS(session), [session]);

  // A swap that runs itself takes its next step now and then while its page is open
  // (and once a minute without it, from the worker's alarm). Refresh takes it now.
  const runs = !!s.auto && s.stage !== "closed" && s.stage !== "failed";
  const [checkedAt, setCheckedAt] = useState<number>();
  const [checking, setChecking] = useState(false);
  const index = s.index;
  const advance = useCallback(
    async (now: boolean) => {
      setChecking(true);
      try {
        setS(await call("session-advance", { index, now }));
        setCheckedAt(Date.now());
        setError(undefined);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setChecking(false);
      }
    },
    [index],
  );
  useEffect(() => {
    if (!runs) return;
    void advance(false);
    const timer = setInterval(() => void advance(false), ADVANCE_EVERY_MS);
    return () => clearInterval(timer);
  }, [runs, advance]);
  // A return brought back by hand, through Lovejoin: its Send button counts the chain's transactions.
  const backSending = useSendingLabel(s.index, busy && !!back?.lovejoin);
  // Once it's coming back, a chain through Lovejoin moves on with every transaction: read its progress from the record.
  const returning = runs && (s.auto!.step === "returning" || s.auto!.filled || !!s.auto!.refunded || s.auto!.stopping);
  useSessionsWhile(returning, (all) => {
    const now = all.find((x) => x.index === index);
    if (now) setS(now);
  });

  const swapped = s.txs.some((t) => t.kind === "swap");
  useEffect(() => {
    if (s.auto || s.stage !== "open" || !swapped) return;
    call("session-orders", { index: s.index }).then(setOrders, (e: Error) => setError(e.message));
  }, [s.auto, s.index, s.stage, swapped, updatedAt]);

  const sides = sidesOf(network, s);
  const act = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  /** Builds its return as approved, or directly: Bring it back, then its review's switch. */
  const buildBack = (through: boolean) =>
    void act(async () => {
      setBack(await call("session-back-build", { index: s.index, ...(through ? {} : { direct: true }) }));
      setBackThrough(through);
    });
  /** After a step sent by hand: a swap that runs itself goes on from there; one from before is read again. */
  const sent = async () => {
    setReview(undefined);
    setBack(undefined);
    if (s.auto) setS(await call("session-advance", { index: s.index, now: true }));
    else onRefresh();
  };

  if (review) {
    const paid = review.summary.paid;
    return (
      <Screen
        title={tr(review.kind === "swap" ? "swaps.tx.reviewOrder" : "swaps.tx.reviewCancel")}
        titleId="session-tx-review"
        review
        onBack={() => setReview(undefined)}
        backDisabled={busy}
        aside={tr("swaps.tx.aside")}
        error={error}
        foot={
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await call(review.kind === "swap" ? "session-swap-submit" : "session-cancel-submit", { txHash: review.txHash });
                await sent();
              })
            }
          >
            {busy ? tr("common.sending") : tr("common.send")}
          </button>
        }
      >
        <ReviewRows testId="session-tx-review">
          {review.kind === "swap" && review.quote && sides && (
            <>
              <Row label={tr("swaps.tx.getAbout")} value={amountOf(review.quote.amountOut, sides.get)} strong />
              <Row label={tr("swaps.tx.askedLeast")} value={amountOf(review.quote.minAmountOut, sides.get)} />
            </>
          )}
          {review.kind === "cancel" && (
            <Row label={tr("swaps.tx.cancels")} value={tr("swaps.tx.orderCount", { count: review.orders ?? 0 })} strong />
          )}
          {paid.map((p, i) => (
            <Row
              key={i}
              label={tr(p.script ? "swaps.tx.intoOrder" : "lovejoin.review.to")}
              value={
                p.tokens.length
                  ? tr("format.adaAndTokens", { ada: formatAda(p.lovelace), count: p.tokens.length })
                  : `${formatAda(p.lovelace)}\u00a0₳`
              }
              title={p.address}
            />
          ))}
          <Row label={tr("review.fee")} value={`${formatAda(review.summary.fee)}\u00a0₳`} />
          <Row label={tr("swaps.tx.backToSession")} value={`${formatAda(review.summary.returnedLovelace)}\u00a0₳`} />
          {review.summary.collateral && (
            <Row label={tr("swaps.tx.collateralAtRisk")} value={`${formatAda(review.summary.collateral.atRisk)}\u00a0₳`} />
          )}
        </ReviewRows>
        <TxDetailButton txHash={review.txHash} testId="session-tx-detail" />
        {review.summary.note && (
          <p className="note">{tr("swaps.tx.minswapNote", { note: review.summary.note.join("") })}</p>
        )}
        <p className="note">
          {tr(
            review.kind !== "swap"
              ? "swaps.tx.afterCancel"
              : s.auto
                ? "swaps.tx.afterOrderAuto"
                : "swaps.tx.afterOrder",
          )}
        </p>
      </Screen>
    );
  }

  if (back) {
    return (
      <Screen
        title={tr("swaps.back.title")}
        titleId="session-back-review"
        review
        onBack={() => setBack(undefined)}
        backDisabled={busy}
        aside={tr("review.nothingSent")}
        error={error}
        foot={
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await call("session-back-submit", { txHash: back.txHash });
                await sent();
              })
            }
          >
            {busy ? backSending : tr("common.send")}
          </button>
        }
      >
        {/* The way back first, a switch, where it can't be missed (blind test §9.8; Stop's, 5289dcf). */}
        <LovejoinSwitch back={back} through={backThrough} busy={busy} onThrough={buildBack} />
        <ReviewRows testId="session-back-review">
          <LovejoinRows back={back} />
          <Row
            label={tr(back.lovejoin ? "swaps.back.backNow" : "swaps.back.intoPrivate")}
            value={`${formatAda(back.lovelace)}\u00a0₳`}
            strong
          />
          {back.tokens.map((t) => (
            <Row key={tokenKey(t)} label="" value={heldText(t, s, network)} />
          ))}
          <Row label={tr(back.lovejoin ? "lovejoin.review.fees" : "review.fee")} value={`${formatAda(back.fee)}\u00a0₳`} />
          <Row
            label={tr("swaps.back.from")}
            value={tr("swaps.back.fromValue", { utxos: tr("amount.utxos", { count: back.inputs }), number: s.index + 1 })}
          />
          <IntoRow back={back} />
        </ReviewRows>
        {/* Through Lovejoin, its chain's first transaction: `txHash` is the
            return, the last of the chain, which spends what isn't sent yet. */}
        <TxDetailButton
          txHash={back.lovejoin?.entry ?? back.txHash}
          label={back.lovejoin && entryLabel(back.lovejoin)}
          testId="session-back-tx"
        />
        <ReturnLeftOut leftOut={back.leftOut} />
        <HandleWarning tokens={back.tokens} returning />
        <LovejoinNote back={back} />
        <ReturnLinks back={back} after={back.leftOut?.length ? undefined : tr("swaps.back.privacy.neverAgain")} />
      </Screen>
    );
  }

  // Once it's over, an empty account says nothing: what it holds shows only while it holds something.
  const holding = s.holding && (!isOver(s) || s.holding.lovelace !== "0" || s.holding.tokens.length) ? s.holding : null;
  const rows = (
    <ReviewRows testId="session-rows">
      {!s.auto && (
        <Row
          label={tr("swaps.rows.whereAt")}
          value={tr(s.stage === "failed" && !s.unsent ? "swaps.rows.fundingNotShown" : STAGE[s.stage])}
          strong
        />
      )}
      {s.swap && sides && (
        <Row label={tr("swaps.rows.quoted")} value={tr("swaps.rows.about", { amount: amountOf(s.swap.amountOut, sides.get) })} />
      )}
      <Row label={tr("swaps.rows.started")} value={whenOf(s.createdAt, new Date())} />
      <Row label={tr("lovejoin.review.account")} value={shortHex(s.address, 16, 8)} title={s.address} />
      {/* What it holds is a balance: hidden while balances are (launch review #56). Its tokens on the same
          labelled row, not rows with none (chunk 23's second review, DX-5). */}
      {holding && (
        <Row
          label={tr("swaps.rows.itHolds")}
          value={joinList([`${amounts.ada(holding.lovelace)}\u00a0₳`, ...holding.tokens.map((t) => amounts.text(heldText(t, s, network)))])}
        />
      )}
      {/* Over: what came back, as its return's review said, when the wallet kept it (DX-5). Through Lovejoin, its
          boxes come back later, on their own. */}
      {s.stage === "closed" && s.received && (
        <Row
          label={tr(s.chain && !s.chain.cut ? "swaps.rows.receivedBesides" : "swaps.rows.received")}
          value={joinList([
            ...s.received.tokens.map((t) => amounts.text(heldText(t, s, network))),
            `${amounts.ada(s.received.lovelace)}\u00a0₳`,
          ])}
          strong
        />
      )}
    </ReviewRows>
  );
  // A funding turned away never went out; one the chain hasn't shown may still land, and a
  // forgotten session's account isn't looked at again: that one asks first (launch review #11).
  const forgetNow = () =>
    void act(async () => {
      onChanged(await call("session-forget", { index: s.index }));
      setForgetting(false);
    });
  const forget = () => (s.unsent || !s.auto ? forgetNow() : setForgetting(true));
  const lookAgain = () => void act(async () => setS(await call("session-resume", { index: s.index })));
  const forgetModal = forgetting && <ForgetSwap busy={busy} onKeep={() => setForgetting(false)} onForget={forgetNow} />;

  if (s.auto) {
    const auto = s.auto;
    const done = s.stage === "closed";
    const placed = s.txs.some((t) => t.kind === "swap");
    const openStop = () => {
      setStopCost(undefined);
      setStopThrough(true);
      setPlacedNow(false);
      setStopping(true);
      // The record as it is now (no Koios read), not the page's last reading: the runner may have placed the order since.
      call("sessions", {}).then(
        (all) => setPlacedNow(!!all.find((x) => x.index === index)?.txs.some((t) => t.kind === "swap")),
        () => undefined,
      );
      // A pool read the worker keeps five minutes; without it, Stop says only what it always did.
      call("session-stop-cost", { index: s.index }).then(setStopCost, () => setStopCost(null));
    };
    return (
      <Screen
        title={pairOf(s, network)}
        titleId="session-title"
        onBack={onBack}
        aside={tr("lovejoin.privateSession", { number: s.index + 1 })}
        error={error}
        foot={
          done ? (
            <button type="button" className="primary" onClick={onBack}>
              {tr("common.done")}
            </button>
          ) : s.stage === "failed" ? (
            <div className="actions">
              {!s.unsent && (
                <button type="button" className="primary" onClick={lookAgain} disabled={busy} data-testid="session-look-again">
                  {tr(busy ? "swaps.looking" : "common.tryAgain")}
                </button>
              )}
              {/* Known never to have gone out, it only comes off the list; one that may still land asks first. */}
              <button type="button" className="secondary" onClick={forget} disabled={busy}>
                {tr(s.unsent ? "swaps.forget.remove" : "swaps.forget.confirm")}
              </button>
            </div>
          ) : !stoppable(auto) ? null : (
            <button type="button" className="secondary" onClick={openStop} disabled={busy}>
              {tr("lovejoin.mixes.stop")}
            </button>
          )
        }
      >
        {runs && <RefreshRow reading={checking} updatedAt={checkedAt} onRefresh={() => void advance(true)} />}
        {/* What it needs from the user comes first; the timeline under it shows where it stopped. */}
        {auto.paused && (
          <Callout tone="warn" testId="session-paused">
            <div className="stack-tight">
              <strong>{tr("swaps.paused.title")}</strong>
              <span data-testid="session-paused-why">{pauseText(auto.paused, auto.approvedMinOut, sides?.get)}</span>
              <span className="row-links">
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => void act(async () => setS(await call("session-resume", { index: s.index })))}
                >
                  {tr("common.tryAgain")}
                </button>
                {!placed && !auto.stopping && (
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={() => void act(async () => setReview(await call("session-swap-build", { index: s.index })))}
                  >
                    {tr("swaps.paused.reviewMyself")}
                  </button>
                )}
              </span>
            </div>
          </Callout>
        )}
        {stoppedLate && (
          <Callout tone="warn" testId="session-stop-ordered">{tr("swaps.warn.stoppedLate")}</Callout>
        )}
        <Timeline
          s={s}
          busy={busy}
          onRetry={() => void act(async () => setS(await call("session-resume", { index: s.index })))}
        />
        <LovejoinSkipped reason={s.lovejoinSkipped} />
        {rows}
        <LeftBehindNote leftBehind={s.leftBehind} />
        {forgetModal}
        {stopping && (
          <StopDialog
            placed={placed || placedNow}
            cost={stopCost}
            through={stopThrough}
            onThrough={setStopThrough}
            busy={busy}
            onClose={() => setStopping(false)}
            onStop={(direct) =>
              void act(async () => {
                const { ordered, ...stopped } = await call("session-stop", { index: s.index, ...(direct ? { direct } : {}) });
                setS(stopped);
                // The runner was placing it as the dialog said none was: Stop says what it does now.
                setStoppedLate(!!ordered && !placed && !placedNow);
                setStopping(false);
              })
            }
          />
        )}
      </Screen>
    );
  }

  const waiting = !!orders?.length;
  return (
    <Screen
      title={tr("lovejoin.privateSession", { number: s.index + 1 })}
      titleId="session-title"
      onBack={onBack}
      aside={pairOf(s, network)}
      error={error}
      foot={
        <SessionFoot
          s={s}
          swapped={swapped}
          waiting={waiting}
          busy={busy}
          onSwap={() => void act(async () => setReview(await call("session-swap-build", { index: s.index })))}
          onCancel={() => void act(async () => setReview(await call("session-cancel-build", { index: s.index })))}
          onBack={() => buildBack(true)}
          onForget={forget}
        />
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={onRefresh} />
      {rows}
      <LovejoinSkipped reason={s.lovejoinSkipped} />
      <LeftBehindNote leftBehind={s.leftBehind} />
      <p className="note" data-testid="session-next">
        {nextStep(s, swapped, waiting)}
      </p>
    </Screen>
  );
}

/**
 * Forget asks first where the funding may still land: the account isn't
 * looked at again (launch review #11). Exported for its test.
 */
export function ForgetSwap({ busy, onKeep, onForget }: { busy: boolean; onKeep: () => void; onForget: () => void }) {
  const tr = useT();
  return (
    <Modal
      title={tr("swaps.forget.title")}
      titleId="session-forget-title"
      onClose={onKeep}
      foot={
        <>
          <button type="button" className="secondary" onClick={onKeep} disabled={busy}>
            {/* Its own words, not the unmixed box's: Spanish needs the swap's gender, as "Olvidarlo" beside it has. */}
            {tr("swaps.forget.keep")}
          </button>
          <button type="button" className="danger" onClick={onForget} disabled={busy}>
            {tr(busy ? "swaps.forget.working" : "swaps.forget.confirm")}
          </button>
        </>
      }
    >
      <p className="note">{tr("swaps.forget.note")}</p>
    </Modal>
  );
}

/** Stop's words for an order the runner may be placing as the dialog shows (independent review L22). */
const IF_ORDERED = () => t("swaps.stop.ifOrdered");

/**
 * Stop's dialog (privacy review §2.8, §4.1): what stopping does, and when it
 * would come back through Lovejoin (`cost`, as the worker works it out now:
 * undefined while it's read, null when it comes back directly anyway), the
 * approval's switch again, first, on as approved (`through`), with what each
 * way takes. Stop says which way it goes. The way back directly was a link
 * under the costs, and the owner, stopping a real swap after a price drop,
 * never saw it (2026-10-05).
 */
export function StopDialog({
  placed,
  cost,
  through,
  onThrough,
  busy,
  onStop,
  onClose,
}: {
  placed: boolean;
  cost?: SwapLovejoin | null;
  through: boolean;
  onThrough: (through: boolean) => void;
  busy: boolean;
  onStop: (direct: boolean) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const mixes = !!cost && !cost.skipped && cost.boxes > 0;
  const lovejoin = mixes && through;
  return (
    <Modal
      title={tr("swaps.stop.title")}
      titleId="session-stop-title"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {tr("lovejoin.stop.keep")}
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => onStop(mixes && !through)}>
            {tr(busy ? "swaps.stop.stopping" : !mixes ? "swaps.stop.confirm" : through ? "swaps.stop.throughLovejoin" : "swaps.stop.direct")}
          </button>
        </>
      }
    >
      {mixes && (
        <div className="setting-row">
          <span className="stack-tight">
            <span id="session-stop-lovejoin-label">{tr("swaps.lovejoin.label")}</span>
            <span className="note" id="session-stop-lovejoin-note">
              {tr(through ? "swaps.lovejoin.privacy.on" : "swaps.stop.privacy.direct")}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={through}
            aria-labelledby="session-stop-lovejoin-label"
            aria-describedby="session-stop-lovejoin-note"
            onClick={() => onThrough(!through)}
            disabled={busy}
            data-testid="session-stop-lovejoin-switch"
          />
        </div>
      )}
      <p className="note" data-testid="session-stop-what">
        {lovejoin
          ? joinSentences([
              tr(placed ? "swaps.stop.cancelled" : "swaps.stop.notPlaced"),
              !placed && IF_ORDERED(),
              tr("swaps.stop.throughCost", {
                boxes: boxesText(cost),
                mixFees: formatAda(cost.mixFees),
                backFees: formatAda(cost.withdrawFees),
                delay: delayText(cost.delay),
              }),
              placed && tr("swaps.stop.cancelFeeToo"),
            ])
          : placed
            ? tr("swaps.stop.cancelledDirect")
            : joinSentences([tr("swaps.stop.notPlacedDirect"), IF_ORDERED()])}
      </p>
      {cost?.skipped && (
        <p className="note" data-testid="session-stop-pool">
          {tr("swaps.stop.poolShort", { why: cost.skipped })}
        </p>
      )}
      {cost === undefined && <p className="note">{tr("swaps.stop.working")}</p>}
    </Modal>
  );
}

/**
 * A token the session holds or brings back, as every text view names one
 * (`tokenAmountText`): what the swap gets is in the quote's decimals.
 */
function heldText(t: TokenQuantity, s: SessionView, network: NetworkName): string {
  const d = s.swap?.display;
  const decimals = d && tokenKey(t) === tokenKeyOf(s.swap!.tokenOut) ? d.out.decimals : undefined;
  return tokenAmountText(network, { ...t, ...(decimals === undefined ? {} : { decimals }) });
}

/**
 * Why a swap that runs itself waits for the user, in words: the price, or
 * which of the wallet's checks what Minswap built failed (`detail`, launch
 * review #21). It shows in the paused warning, built here rather than in its
 * JSX, so its keys are named `.warn.`: the name is what keeps them checked.
 */
export function pauseText(p: SessionPause, approvedMinOut: string, out?: Pick): string {
  if (p.why === "refused") {
    return t("swaps.pause.warn.refused", { detail: withStop(p.detail) });
  }
  const amount = (q: string) => (out ? amountOf(q, out) : q);
  return t("swaps.pause.warn.price", { now: amount(p.amountOut), approved: amount(approvedMinOut) });
}

/** When a failed step is tried again. */
function retryText(at: number): string {
  const ms = at - Date.now();
  if (ms <= 0) return t("swaps.retry.now");
  return ms < 60_000 ? t("swaps.retry.soon") : t("swaps.retry.in", { count: Math.ceil(ms / 60_000) });
}

type Retry = NonNullable<SessionAuto["retry"]>;

/** The plain words for each reason the worker gives a failed step (sessions.ts retryReasonOf). */
const RETRY_REASONS: Record<Exclude<NonNullable<Retry["reason"]>, "other">, I18nKey> = {
  "minswap-rate-limited": "swaps.retry.rateLimited",
  "koios-rate-limited": "swaps.retry.koiosRateLimited",
  "minswap-silent": "swaps.retry.minswapSilent",
  "koios-silent": "swaps.retry.koiosSilent",
  "funding-unseen": "swaps.retry.fundingUnseen",
};

/**
 * Why a step failed, in plain words, when the worker knew why; else the error
 * itself. A retry recorded before the worker gave a reason has only its
 * error, written in English, the one language the worker had then: that one
 * alone is still read by its words.
 */
export function retryReason({ error, reason }: Retry): string {
  if (reason) return reason === "other" ? error : t(RETRY_REASONS[reason]);
  if (/limiting requests/i.test(error)) return t("swaps.retry.rateLimited");
  if (/no wallet utxos|insufficient balance/i.test(error)) return t("swaps.retry.fundingUnseen");
  if (/couldn't reach minswap/i.test(error)) return t("swaps.retry.minswapSilent");
  if (/koios/i.test(error)) return t("swaps.retry.koiosSilent");
  return error;
}

type StepState = "done" | "now" | "paused" | "failed" | "todo" | "skipped";

/**
 * A swap that runs itself, as four steps: funded, the order placed, filled
 * (or cancelled), and back in the private balance. Each is waiting, done
 * (with its transaction), or paused; the whole card turns the success colour
 * once it's over. A funding that never reached the chain fails the first
 * step, and none of the others happen.
 */
function Timeline({ s, busy, onRetry }: { s: SessionView; busy: boolean; onRetry: () => void }) {
  const tr = useT();
  const network = useNetwork();
  const auto = s.auto!;
  const sides = sidesOf(network, s);
  const at = { funding: 0, ordering: 1, filling: 2, cancelling: 2, returning: 3, done: 4 }[auto.step];
  const tx = (kind: SessionTx["kind"]) => s.txs.findLast((t) => t.kind === kind);
  const failed = s.stage === "failed";
  // Stopped before any order: the order and its fill never happen.
  const unordered = auto.stopping && !tx("swap");
  // Stopped, but an order Minswap doesn't list is still open: not cancelled (independent review L16).
  const open = auto.orderOpen !== undefined;
  const cancelled = !!tx("cancel") || (auto.stopping && !auto.filled && !auto.refunded);
  const state = (i: number): StepState => {
    if (failed) return i === 0 ? "failed" : "skipped";
    if ((i === 1 || i === 2) && unordered) return "skipped";
    if (i < at) return "done";
    if (i > at) return "todo";
    return auto.paused || auto.retry ? "paused" : "now";
  };
  // What the order placed asks for, once one is; the approved least before (independent review L24).
  const least = sides ? amountOf((tx("swap") && auto.placedMinOut) || auto.approvedMinOut, sides.get) : undefined;
  const steps: Array<{ title: string; sub: string; tx?: SessionTx }> = [
    {
      title: tr(failed ? "swaps.step.notFunded" : "swaps.plan.funded"),
      // Only one turned away is known never to have gone out: one unseen may still land.
      sub: failed
        ? tr(s.unsent ? "swaps.step.neverReached" : "swaps.step.notShownYet")
        : tr("swaps.plan.fundedSub"),
      tx: tx("out"),
    },
    {
      title: tr(unordered ? "swaps.step.noOrder" : "swaps.plan.ordered"),
      sub: unordered
        ? tr("swaps.step.stoppedBefore")
        : least
          ? tr("swaps.step.askedLeast", { least })
          : tr("swaps.step.throughMinswap"),
      tx: tx("swap"),
    },
    {
      title: tr(
        unordered
          ? "swaps.step.nothingToFill"
          : open
            ? "swaps.step.waitingOnOrder"
            : cancelled
              ? "swaps.step.cancelled"
              : auto.refunded
                ? "swaps.tag.refunded"
                : auto.partly
                  ? "swaps.tag.partly"
                  : "swaps.plan.filled",
      ),
      sub: tr(
        unordered
          ? "swaps.step.nothingOrdered"
          : open
            ? "swaps.step.openAtDex"
            : cancelled
              ? "swaps.step.fundsBack"
              : auto.refunded
                ? "swaps.step.refundedSub"
                : auto.partly
                  ? "swaps.step.partlySub"
                  : auto.filled
                    ? "swaps.step.proceedsAt"
                    : "swaps.plan.filledSub",
      ),
      tx: tx("cancel"),
    },
    {
      title: tr("swaps.plan.back"),
      sub: tr(
        s.lovejoinSkipped
          ? "swaps.step.directLeftOut"
          : auto.direct
            ? "swaps.step.directChosen"
            : "swaps.step.freshRegisters",
      ),
      tx: tx("back"),
    },
  ];
  const done = auto.step === "done";
  return (
    <div className={done ? "timeline timeline--done" : "timeline"} data-testid="session-timeline">
      <ol className="timeline__steps">
        {steps.map((step, i) => {
          const st = state(i);
          return (
            <li key={step.title} className={`timeline__step timeline__step--${st}`} data-state={st}>
              <span className="timeline__icon" aria-hidden="true">
                {st === "done" ? (
                  <CheckIcon size={14} />
                ) : st === "now" ? (
                  <span className="spin">
                    <SpinnerIcon size={14} />
                  </span>
                ) : st === "paused" ? (
                  <WarnIcon size={13} />
                ) : st === "failed" ? (
                  <CloseIcon size={13} />
                ) : st === "skipped" ? (
                  "–"
                ) : (
                  i + 1
                )}
              </span>
              <span className="timeline__title">{step.title}</span>
              {step.tx && st === "done" && (
                <ExplorerLink network={network} tx={step.tx.txHash} private note={false} className="timeline__link">
                  {tr("swaps.cardanoscan")}
                </ExplorerLink>
              )}
              <p className="timeline__sub">{step.sub}</p>
            </li>
          );
        })}
      </ol>
      {auto.retry && !auto.paused ? (
        <div className="timeline__now timeline__now--retry" data-testid="session-retry" aria-live="polite">
          <p>
            {/* Why, then when. An error with no code is shown as it came, often with no stop of its own (the node's
                raw refusal): it takes one, and Japanese, which sets nothing between sentences, still sets a space
                after a Latin one, so the time never runs into it. */}
            {joinSentences([withStop(retryReason(auto.retry)), retryText(auto.retry.at)])}
            {sentenceGap()}
            <button type="button" className="link" disabled={busy} onClick={onRetry}>
              {tr("lovejoin.mixes.tryNow")}
            </button>
          </p>
          {retryReason(auto.retry) !== auto.retry.error && <p className="timeline__error">{auto.retry.error}</p>}
        </div>
      ) : (
        // Paused, the callout above says why and what to do.
        !auto.paused && (
          <p className="timeline__now" data-testid="session-now" aria-live="polite">
            {nowLine(s)}
          </p>
        )
      )}
      {/* Each step's link is to a transaction only this wallet can tell is the user's. */}
      {steps.some((step, i) => step.tx && state(i) === "done") && <ExplorerNote what="transactions" />}
    </div>
  );
}

/** A stopped swap waiting on an order Minswap doesn't list (independent review L16). */
const ORDER_OPEN = () => t("swaps.now.orderOpen");

/** What's happening now, in plain words. */
export function nowLine(s: SessionView): string {
  const a = s.auto!;
  if (s.stage === "failed") return s.unsent ? neverSent(s) : t("swaps.now.fundingUnseen");
  switch (a.step) {
    case "funding":
      return t(a.stopping ? "swaps.now.stoppingAtFunding" : "swaps.now.funding");
    case "ordering":
      if (a.stopping) return t("swaps.now.stoppingBringingBack");
      return t(s.txs.some((x) => x.kind === "swap") ? "swaps.now.orderOnItsWay" : "swaps.now.quoting");
    case "filling":
      return t("swaps.now.filling");
    case "cancelling":
      // An order Minswap doesn't list can't be cancelled: what the swap waits on, plainly (independent review L16).
      if (a.orderOpen !== undefined) return ORDER_OPEN();
      return t("swaps.now.cancelling");
    case "returning":
      if (s.chain) {
        const how = chainText(s.chain, !s.auto);
        return t("swaps.now.throughLovejoin", { how: `${how.charAt(0).toLowerCase()}${how.slice(1)}` });
      }
      return t("swaps.now.returning");
    case "done":
      // Refunded, the swap didn't happen: never "Done" (independent review M18).
      if (a.refunded) return t("swaps.now.refunded");
      if (a.partly) return t("swaps.now.partly");
      return t(a.filled ? "swaps.now.done" : "swaps.now.stopped");
  }
}

/** A Minswap token ID as a policy ID and an asset name. */
function tokenOf(id: string): { policyId: string; assetName: string } {
  return { policyId: id.slice(0, 56), assetName: id.slice(56) };
}

/** A Minswap token ID as the wallet keys tokens. */
function tokenKeyOf(id: string): string {
  return tokenKey(tokenOf(id));
}

/** A funding turned away before it went out, and why, when the worker knew (chunk 23's second review, DX-5). */
function neverSent(s: SessionView): string {
  return joinSentences([t("swaps.now.neverSent"), unsentWhyText(s.unsentWhy), t("swaps.now.removeIt")]);
}

/** A session from before swaps ran themselves: what to do next, by hand. */
function nextStep(s: SessionView, swapped: boolean, waiting: boolean): string {
  switch (s.stage) {
    case "funding":
      return t("swaps.next.funding");
    case "failed":
      return s.unsent ? neverSent(s) : t("swaps.next.fundingUnseen");
    case "returning":
      return t("swaps.next.returning");
    case "closed":
      return t("swaps.next.closed");
    case "open":
      if (!swapped) return t("swaps.next.placeOrder");
      if (waiting) return t("swaps.next.waiting");
      return t("swaps.next.bringBack");
  }
}

function SessionFoot({
  s,
  swapped,
  waiting,
  busy,
  onSwap,
  onCancel,
  onBack,
  onForget,
}: {
  s: SessionView;
  swapped: boolean;
  waiting: boolean;
  busy: boolean;
  onSwap: () => void;
  onCancel: () => void;
  onBack: () => void;
  onForget: () => void;
}) {
  const tr = useT();
  if (s.stage === "failed") {
    return (
      <button type="button" className="secondary" onClick={onForget} disabled={busy}>
        {tr(s.unsent ? "swaps.forget.remove" : "swaps.forget.confirm")}
      </button>
    );
  }
  if (s.stage !== "open") return null;
  return (
    <div className="stack">
      {!swapped && (
        <button type="button" className="primary" onClick={onSwap} disabled={busy}>
          {tr(busy ? "swaps.foot.asking" : "swaps.foot.placeOrder")}
        </button>
      )}
      {waiting && (
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          {tr("swaps.foot.cancelOrder")}
        </button>
      )}
      {!waiting && (
        <button type="button" className={swapped ? "primary" : "secondary"} onClick={onBack} disabled={busy}>
          {tr("swaps.foot.bringBack")}
        </button>
      )}
    </div>
  );
}
