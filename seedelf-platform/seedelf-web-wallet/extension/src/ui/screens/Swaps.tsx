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
import { Screen } from "../components/Screen";
import { TxDetailButton, entryLabel } from "../components/TxDetail";
import { LeftBehindNote, ReturnLeftOut } from "../components/SessionLeft";
import {
  ADA_RULES,
  type AmountRules,
  formatAda,
  formatFiat,
  formatPercent,
  formatQuantity,
  parseQuantity,
  plural,
  sanitizeAmount,
  shortHex,
  tokenKey,
  whenOf,
} from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import {
  adaShort,
  halfOf,
  impactLevel,
  maxAdaIn,
  parseSlippage,
  rateOf,
  sameAsk,
  SLIPPAGE_MAX,
  SLIPPAGE_MIN,
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

/** An amount on one side of a swap: "10 ₳", "906.5941 MIN". ADA by its ID: a token may call itself ₳. */
function amountOf(quantity: string, pick: Pick): string {
  return pick.id === "lovelace" ? `${formatAda(quantity)} ₳` : `${formatQuantity(quantity, pick.side.decimals)} ${pick.side.label}`;
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
  if (!s.swap || !sides) return "A swap";
  return `${amountOf(s.swap.amount, sides.pay)} → ${nameOf(sides.get)}`;
}

const STAGE: Record<SessionView["stage"], string> = {
  funding: "Being funded",
  open: "Open",
  returning: "Coming back",
  closed: "Done",
  failed: "Its funding didn't go through",
};

const STEP: Record<SessionAuto["step"], string> = {
  funding: "Being funded",
  ordering: "Placing the order",
  filling: "Waiting for the fill",
  cancelling: "Cancelling",
  returning: "Coming back",
  done: "Done",
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
  if (s.stage === "failed") return s.unsent || !s.auto ? { tone: "bad", label: "Failed" } : { tone: "wait", label: "Not seen" };
  const a = s.auto;
  if (!a) {
    // From before: every step after the funding is the user's.
    if (s.stage === "closed") return { tone: "done", label: "Done" };
    return s.stage === "open" ? { tone: "wait", label: "Open" } : { tone: "live", label: "Running" };
  }
  if (a.step === "done") {
    // A refunded order isn't a swap done (independent review M18).
    if (a.refunded) return { tone: "off", label: "Refunded" };
    if (a.partly) return { tone: "done", label: "Partly filled" };
    return a.filled ? { tone: "done", label: "Done" } : { tone: "off", label: "Stopped" };
  }
  if (a.paused) return { tone: "wait", label: "Needs you" };
  if (a.retry) return { tone: "wait", label: "Retrying" };
  // Stopped, and waiting on an order it can't cancel yet: neither done nor an error (independent review L16).
  if (a.orderOpen !== undefined) return { tone: "off", label: "Order open" };
  return { tone: "live", label: a.stopping ? "Stopping" : "Running" };
}

const PAUSED: Record<SessionPause["why"], string> = {
  price: "The price moved",
  refused: "Refused Minswap's build",
};

/** A session's second line: what it's doing while it runs (its tag says if it's stopping), or when it ran. */
function subOf(s: SessionView, now: number): string {
  if (isOver(s)) return whenOf(s.createdAt, new Date(now));
  if (!s.auto) return s.stage === "open" ? "Its next step is yours" : STAGE[s.stage];
  if (fundingUnseen(s)) return "Its funding hasn't shown up yet";
  if (s.auto.paused) return PAUSED[s.auto.paused.why];
  if (s.auto.orderOpen !== undefined) return "An order is still open at a DEX";
  // Stopped before its order: it comes back rather than place one.
  return STEP[s.auto.stopping && s.auto.step === "ordering" ? "returning" : s.auto.step];
}

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
    return <NewSwap seedelf={seedelf} onCancel={done} onStarted={started} />;
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

  const noFunds = seedelf.utxos === 0 ? "Make some ADA private first: a swap is paid from your private balance" : undefined;
  const running = sessions?.filter((s) => !isOver(s)) ?? [];
  const over = sessions?.filter(isOver) ?? [];
  return (
    <Screen
      title="Minswap"
      titleId="swaps-title"
      onBack={onBack}
      aside="Swaps, each from a one-time account"
      error={error}
      foot={
        <button
          type="button"
          className="primary"
          onClick={() => setStarting(true)}
          disabled={!!(blocked ?? noFunds)}
          title={blocked ?? noFunds}
        >
          New swap
        </button>
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load(true)} />
      {sessions?.length === 0 && (
        <p className="note center empty" data-testid="swaps-empty">
          No swaps yet.
        </p>
      )}
      {!!sessions?.length && (
        <div className="stack" data-testid="swaps">
          {running.length > 0 && <SwapList title="In progress" sessions={running} onOpen={setOpen} />}
          {over.length > 0 && <SwapList title="Past swaps" sessions={over} onOpen={setOpen} />}
        </div>
      )}
      <Callout tone="privacy">
        Each swap runs from a new one-time account, funded from your private balance, so your public account isn't in its
        transactions. Anyone can follow the money through the one-time account back into your private balance, and money
        you made private yourself leads on to your public account; the amounts and times tie the two ends together.
      </Callout>
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
    { ...ADA_PICK, sub: "Cardano", held: seedelf.lovelace, listed: true },
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
    notANumber: decimals ? "Enter an amount, like 25 or 12.5." : "Enter a whole number, like 25.",
    tooPrecise: decimals
      ? `${label} has at most ${decimals} decimal places, so the extra digits were dropped.`
      : `${label} comes in whole units, so the decimals were dropped.`,
    tooMuch: `That's more ${label} than there can be.`,
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
  if (!pick) {
    return (
      <button type="button" className="swap-token swap-token--empty" onClick={onClick} aria-haspopup="dialog" data-testid={testId}>
        <PlusIcon size={16} />
        Select token
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
      aria-label={`${nameOf(pick)}: change ${what}`}
      title={`Change ${what}`}
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
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  /** The funding was sent: session `index` runs from here. */
  onStarted: (index: number, pending: PendingTx) => void;
}) {
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

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || !current || !quoted || !get || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      let quote = current;
      // Prices move: a quote over a minute old is asked for again before the funding is built on it.
      if (Date.now() - quoted.at > QUOTE_FRESH_MS) {
        quote = await call("swap-quote", quote.ask);
        setQuoted({ quote, at: Date.now() });
        // The form now says what's short.
        if (adaShort(seedelf.lovelace, quote)) return;
      }
      const { lovejoin, ...summary } = await call("session-out-build", { quote, display: { in: pay.side, out: get.side } });
      setThrough(lovejoin?.on ?? false);
      setOut({ summary, quote, lovejoin });
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (out && get) {
    return (
      <Screen
        title="Review the swap"
        titleId="swap-fund-review"
        onBack={() => setOut(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <SwapApproval {...out} pay={pay} get={get} through={through} onThrough={setThrough} busy={busy} />
        <TxDetailButton txHash={out.summary.txHash} testId="swap-out-tx" />
      </Screen>
    );
  }

  const outText = shown && get ? formatQuantity(shown.amountOut, get.side.decimals) : "";
  const fiat = (id: string, quantity?: string) =>
    id === "lovelace" && quantity && quantity !== "0" && price ? `≈ ${formatFiat(quantity, price)}` : "";
  const cta = !get
    ? "Select a token"
    : !raw || raw === "0"
      ? "Enter an amount"
      : tooMuch
        ? `Not enough ${nameOf(pay)}`
        : !current
          ? "Getting a quote…"
          : unverified
            ? "Not verified by Minswap"
            : short
              ? "Not enough ADA"
              : busy
                ? "Building…"
                : "Review swap";

  return (
    <Screen
      onSubmit={review}
      title="Swap"
      titleId="swap-title"
      onBack={onCancel}
      backDisabled={busy}
      aside="Through Minswap, from a one-time account"
      action={
        <button
          type="button"
          className="icon-button"
          onClick={() => setSettings(true)}
          aria-label={`Slippage: ${formatPercent(slippage)}`}
          title="Slippage"
        >
          <SlidersIcon />
        </button>
      }
      error={error ?? quoteError}
      foot={
        quoteError && !error ? (
          <button type="button" className="primary" onClick={() => setAgain((n) => n + 1)}>
            Try again
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!ready || busy}>
            {cta}
          </button>
        )
      }
    >
      <div className="swap-cards">
        <div className="swap-card">
          <div className="swap-card__head">
            <label htmlFor="swap-amount">You pay</label>
            <span className="swap-card__quick">
              <button
                type="button"
                className="link"
                onClick={() => fill(half)}
                disabled={half === "0"}
                aria-label={`Half of your ${nameOf(pay)}`}
                title={pay.side.decimals ? "Half, in whole units" : "Half"}
              >
                Half
              </button>
              <button
                type="button"
                className="link"
                onClick={() => fill(max)}
                disabled={max === "0"}
                aria-label={`As much ${nameOf(pay)} as a swap can take`}
                title={
                  pay.id === "lovelace"
                    ? "All but what's under 1 ₳, less the swap's costs and the collateral"
                    : pay.side.decimals
                      ? `All but what's under 1 ${pay.side.label}`
                      : "All of it"
                }
              >
                Max
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
            <TokenButton pick={pay} what="the token you pay with" testId="swap-from" onClick={() => setPicking("pay")} />
          </div>
          <div className="swap-card__foot">
            <span>{fiat(pay.id, raw)}</span>
            <span
              className={tooMuch ? "swap-card__held swap-card__held--short" : "swap-card__held"}
              title="In your private balance"
              data-testid="swap-held"
            >
              <WalletIcon size={14} />
              {formatQuantity(held, pay.side.decimals)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="swap-flip"
          onClick={flip}
          disabled={!get}
          aria-label="Switch what you pay and what you receive"
          title="Switch them"
        >
          <ArrowDownIcon size={18} />
        </button>
        <div className="swap-card">
          <div className="swap-card__head">
            <span className="label" id="swap-out-label">
              You receive
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
            <TokenButton pick={get} what="the token you receive" testId="swap-to" onClick={() => setPicking("get")} />
          </div>
          <div className="swap-card__foot">
            <span>{get && fiat(get.id, shown?.amountOut)}</span>
            {get && (
              <span className="swap-card__held" title="In your private balance">
                <WalletIcon size={14} />
                {formatQuantity(heldOf(seedelf, get.id), get.side.decimals)}
              </span>
            )}
          </div>
        </div>
      </div>
      {note && <p className="field-note">{note}</p>}
      {tooMuch && (
        <p className="field-note" data-testid="swap-short">
          That's more than the {amountOf(held, pay)} in your private balance.
        </p>
      )}
      {unverified && get && <Unverified pick={get} />}
      {short && current && (
        <p className="field-note" data-testid="swap-short">
          Not enough ADA: the swap takes {formatAda(current.fund.lovelace)} ₳ with its costs, and the one-time account{" "}
          {formatAda(current.collateral)} ₳ of collateral, which comes back. Your private balance has{" "}
          {formatAda(seedelf.lovelace)} ₳.
        </p>
      )}
      {shown && get && (
        <div className={current ? "swap-details" : "swap-details swap-details--stale"} data-testid="swap-details">
          <div className="swap-rate">
            <button
              type="button"
              className="swap-rate__text"
              onClick={() => setInverted(!inverted)}
              title="Turn the rate around"
              data-testid="swap-rate"
            >
              {inverted
                ? `1 ${nameOf(get)} ≈ ${rateOf(shown.amountOut, get.side.decimals, shown.amountIn, pay.side.decimals)} ${nameOf(pay)}`
                : `1 ${nameOf(pay)} ≈ ${rateOf(shown.amountIn, pay.side.decimals, shown.amountOut, get.side.decimals)} ${nameOf(get)}`}
            </button>
            {level !== "ok" && !details && (
              <span className={`swap-rate__impact swap-impact--${level}`}>{formatPercent(shown.priceImpact)} impact</span>
            )}
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={() => setAgain((n) => n + 1)}
              disabled={quoting}
              aria-label="Ask Minswap again"
              title="Ask Minswap again"
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
              aria-label="The quote's details"
              title={details ? "Hide the details" : "Show the details"}
            >
              <span className={details ? "swap-chevron swap-chevron--open" : "swap-chevron"}>
                <ChevronDownIcon size={16} />
              </span>
            </button>
          </div>
          {details && (
            <dl className="swap-details__rows" id="swap-quote-rows" data-testid="swap-quote-rows">
              <Detail label="Asks for at least" value={amountOf(shown.minAmountOut, get)} />
              <Detail label="Price impact" value={formatPercent(shown.priceImpact)} tone={level} />
              <Detail
                label="Slippage"
                value={
                  <button type="button" className="link" onClick={() => setSettings(true)}>
                    {formatPercent(slippage)}
                  </button>
                }
              />
              <Detail label="Route" value={shown.route.join(", ")} />
              <Detail label="DEX fee" value={`${formatAda(shown.dexFee)} ₳`} />
              {shown.aggregatorFee !== "0" && <Detail label="Minswap's fee" value={`${formatAda(shown.aggregatorFee)} ₳`} />}
              <Detail label="Order deposit" value={`${formatAda(shown.deposits)} ₳, back with the proceeds`} />
            </dl>
          )}
        </div>
      )}
      {!shown && quoting && (
        <p className="note swap-asking">
          <span className="spin">
            <SpinnerIcon size={14} />
          </span>
          Asking Minswap for a quote…
        </p>
      )}
      {level === "high" && shown && (
        <Callout tone="warn" testId="swap-impact-warning">
          This swap moves the price by {formatPercent(shown.priceImpact)}, so each {nameOf(pay)} gets noticeably less than
          the pool's price. A smaller amount moves it less.
        </Callout>
      )}
      <Callout tone="privacy" testId="swap-quote-privacy">
        Minswap sees the pair, the amount and your IP address as you type, never your public account. Half and Max round
        down to a whole unit, but still tell it roughly what your private balance holds.
      </Callout>
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
}: {
  summary: SessionOutSummary;
  quote: SwapQuote;
  lovejoin?: SwapLovejoin;
  pay: Pick;
  get: Pick;
  through: boolean;
  onThrough: (through: boolean) => void;
  busy: boolean;
}) {
  const network = useNetwork();
  const [swapPart, collateral] = summary.payments;
  const got = get.id === "lovelace" ? undefined : tokenText(network, tokenOf(get.id));
  const adaOut = quote.ask.tokenOut === "lovelace";
  // Lovejoin would take something, now or after a stop or a refund: the approval says which way it comes back.
  const any = !!l && (l.boxes > 0 || !!l.of || !!l.ifStopped);
  return (
    <>
      <div className="swap-summary" data-testid="swap-summary">
        <div className="swap-summary__row">
          <SwapAvatar pick={pay} />
          <span className="swap-summary__label">You pay</span>
          <span className="swap-summary__amount">{amountOf(quote.amountIn, pay)}</span>
        </div>
        <div className="swap-summary__row">
          <SwapAvatar pick={get} />
          <span className="swap-summary__label">You receive</span>
          <span className="swap-summary__amount">≈ {amountOf(quote.amountOut, get)}</span>
        </div>
        <p className="swap-summary__foot">
          Asks for at least {amountOf(quote.minAmountOut, get)} · {formatPercent(quote.priceImpact)} price impact · through{" "}
          {quote.route.join(", ")}
        </p>
        {got && !got.listed && quote.verified && (
          <p className="swap-summary__foot" data-testid="swap-out-unlisted">
            {got.label} isn't on the wallet's list: Minswap verifies it, by its ID ({got.fingerprint}).
          </p>
        )}
      </div>
      <h2>First, a one-time account is funded</h2>
      <ReviewRows testId="swap-fund-review">
        <Row label="To" value={`Private session ${summary.index + 1}`} strong />
        <Row label="Account" value={shortHex(summary.address, 16, 8)} title={summary.address} />
        <Row label="For the swap" value={fundText(swapPart!.lovelace, swapPart!.tokens, pay.side, network)} strong />
        <Row label="Its collateral" value={`${formatAda(collateral!.lovelace)} ₳`} />
        <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
        <Row label="Back to your private balance" value={`${formatAda(summary.changeLovelace)} ₳`} />
      </ReviewRows>
      <h2>Then it runs by itself</h2>
      <Plan least={amountOf(quote.minAmountOut, get)} lovejoin={any && through && !l!.skipped && l!.boxes > 0} adaOut={adaOut} />
      <p className="note" data-testid="swap-approves">
        Send approves the whole run: the order is for at least {amountOf(quote.minAmountOut, get)}, and the wallet places
        it and brings everything back without asking again. It checks that what Minswap built pays only this session, its
        order and Minswap's fee; the order's own minimum it can't read. If the price moves too far first, it pauses and
        asks. A refunded order comes back with the rest, and the page says so. Stop is there until it's done.
      </p>
      <p className="note">
        The collateral, the order's deposit and whatever the swap doesn't use come back with the proceeds. Three
        transactions, three network fees: the cost of keeping your public account out.
      </p>
      {any && (
        <LovejoinChoice
          lovejoin={l!}
          adaOut={adaOut}
          funded={quote.fund.lovelace}
          through={through}
          onThrough={onThrough}
          busy={busy}
        />
      )}
      {l && !any && (
        <p className="note" data-testid="swap-lovejoin">
          Less than a box's worth of ADA is spare, so none of it goes through Lovejoin: it all comes back at once.
        </p>
      )}
      <Callout tone="privacy">
        This payment links the private UTxOs it spends to the one-time account, as Make public does. The account then links
        to Minswap and back again.
      </Callout>
      <HistoriesNote histories={summary.histories} session={summary.index} testId="swap-histories" />
      <p className="note">Send asks giveme.my to lend the collateral, then submits.</p>
    </>
  );
}

/**
 * What happens after Send, as the swap's own page then shows it: the
 * timeline's four steps, none taken yet. `lovejoin`: the return goes through
 * Lovejoin first; `adaOut`: the proceeds are ADA, so they go through it too.
 */
export function Plan({ least, lovejoin, adaOut }: { least: string; lovejoin: boolean; adaOut: boolean }) {
  const steps = [
    ["Funded", "A one-time account, from your private balance"],
    ["Order placed", `Minswap builds it, asked for at least ${least}`],
    ["Filled", "By a DEX's batcher, usually within a few blocks"],
    [
      "Back in your private balance",
      !lovejoin
        ? "The proceeds and everything left, directly"
        : adaOut
          ? "The proceeds and spare ADA through Lovejoin first, in boxes that come back later; the rest at once"
          : "Spare ADA through Lovejoin first, in boxes that come back later; the proceeds and the rest at once",
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
  adaOut,
  funded,
  through,
  onThrough,
  busy,
}: {
  lovejoin: SwapLovejoin;
  adaOut: boolean;
  funded: string;
  through: boolean;
  onThrough: (through: boolean) => void;
  busy: boolean;
}) {
  const cost = through && !l.skipped && l.boxes > 0;
  const stopped = through && !l.skipped ? l.ifStopped : undefined;
  return (
    <>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="swap-lovejoin-label">Bring it back through Lovejoin</span>
          <span className="note" id="swap-lovejoin-note" data-testid="swap-lovejoin-choice">
            {through
              ? "Its spare ADA is mixed with other people's on the way back, so what comes back is harder to tie to this session."
              : "It all comes back at once, directly: anyone can tie it on chain to this session and its funding. Your public account stays out either way."}
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
          {l.skipped}, so this swap's ADA would come back directly, tied to this session on chain. The wallet looks again when
          it brings it back: if the pool has room by then, it goes through Lovejoin.
        </Callout>
      )}
      {cost && <LovejoinCost lovejoin={l} adaOut={adaOut} />}
      {stopped && (
        <p className="note" data-testid="swap-lovejoin-stopped">
          If you stop it, or Minswap refunds the order, its {formatAda(funded)} ₳ come back instead, through Lovejoin first:{" "}
          {boxesText(stopped)}, mixed in {plural(stopped.mixes, "mix", "mixes")} for about {formatAda(stopped.mixFees)} ₳
          in fees, which the session pays, and about {formatAda(stopped.withdrawFees)} ₳ to bring them back, each after{" "}
          {delayText(l.delay)}. Stop also lets you bring it back directly.
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
    ? `about ${plural(l.boxes, "box", "boxes")} of 10 ₳ of the ${l.of} its ADA pays for, as many as Lovejoin's pool has room for now (fewer, or none, if it has less by then)`
    : `about ${plural(l.boxes, "box", "boxes")} of 10 ₳ (at most: the pool may take fewer, or none)`;
}

/**
 * What bringing the session back through Lovejoin is expected to take, from
 * the worker's quote: the boxes (at most: the pool may take fewer, or none;
 * or as many as the pool has room for at Review), their mixes and fees, and
 * the fees to bring each back, after its wait. The proceeds go through it
 * too when they're ADA (launch review #26).
 */
export function LovejoinCost({ lovejoin: l, adaOut }: { lovejoin: SwapLovejoin; adaOut: boolean }) {
  return (
    <>
      <h2>On the way back, through Lovejoin</h2>
      <ReviewRows testId="swap-lovejoin-cost">
        <Row label="Boxes of 10 ₳" value={l.of ? `About ${l.boxes} of ${l.of}, as the pool is now` : `About ${l.boxes}, at most`} />
        <Row label="Mixed" value={`${l.depth} ${l.depth === 1 ? "wave" : "waves"} deep, ${plural(l.mixes, "mix", "mixes")}`} />
        <Row label="Mix fees, about" value={`${formatAda(l.mixFees)} ₳`} />
        <Row label="Bringing them back, about" value={`${formatAda(l.withdrawFees)} ₳`} />
        <Row label="Back later" value={`Each box on its own, after ${delayText(l.delay)}`} />
      </ReviewRows>
      <p className="note" data-testid="swap-lovejoin">
        On the way back, {adaOut ? "the proceeds and ADA to spare go" : "ADA to spare goes"} through Lovejoin first:{" "}
        {boxesText(l)}, mixed with other people's in {plural(l.mixes, "mix", "mixes")} for about {formatAda(l.mixFees)} ₳,
        which the session pays. {lovejoinHides(l.depth)} Each box comes back on its own after {delayText(l.delay)}, at the
        first unlock after that, for about {formatAda(l.withdrawFees)} ₳ in all; less than a box's worth, and any tokens,
        come back at once. Settings changes later swaps, not this one. Stop brings it back directly.
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
  const text = tokenText(useNetwork(), tokenOf(pick.id));
  return (
    <Callout tone="warn" testId="swap-unverified">
      <div className="stack-tight">
        <strong>Not verified by Minswap</strong>
        <span>
          {text.label} isn't on the wallet's list, and Minswap's verified list doesn't have it by its ID, so the wallet won't
          swap into it: anyone can give a token a known token's name.
        </span>
        <code className="swap-token-id">{text.fingerprint}</code>
      </div>
    </Callout>
  );
}

/** What the funding carries for the swap, in words: each token named by `tokenAmountText`. */
function fundText(lovelace: string, tokens: TokenQuantity[], side: SwapSide, network: NetworkName): string {
  const ada = `${formatAda(lovelace)} ₳`;
  if (!tokens.length) return ada;
  return `${ada} and ${tokens.map((t) => tokenAmountText(network, { ...t, decimals: side.decimals })).join(", ")}`;
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
  const network = useNetwork();
  const own = useMemo(() => ownPicks(network, seedelf), [network, seedelf]);
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
        <span className="token-row__amount">{held === undefined ? "" : formatQuantity(held, p.side.decimals)}</span>
        <span className="token-row__sub">{sub}</span>
      </button>
    </li>
  );

  return (
    <Modal title={which === "pay" ? "You pay with" : "You receive"} titleId="swap-pick-title" onClose={onClose}>
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label="Search tokens"
          placeholder={which === "get" ? "A ticker, a name, or the token's ID" : "Name, ticker or ID"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </label>
      {which === "get" && (
        <p className="field-note">
          The wallet's own list is searched here first. Minswap is asked only when nothing here matches, or when you search
          it, and then knows what you looked for.
        </p>
      )}
      <h3 className="swap-pick__heading">In your private balance</h3>
      {mine.length ? (
        <ul className="list" data-testid="swap-own-tokens">
          {mine.map((p) => row(p, p.sub, p.held))}
        </ul>
      ) : (
        <p className="note">{others.length ? "Nothing else you hold is listed or verified." : `Nothing you hold matches “${q}”.`}</p>
      )}
      {listed.length > 0 && (
        <>
          <h3 className="swap-pick__heading">On the wallet's list</h3>
          <ul className="list" data-testid="swap-listed-tokens">
            {listed.map((p) => row(p, p.sub))}
          </ul>
        </>
      )}
      {which === "get" && (
        <>
          <h3 className="swap-pick__heading">On Minswap</h3>
          {!search &&
            (q.length >= 2 ? (
              <button type="button" className="link align-start" onClick={() => setAsked(q)} data-testid="swap-search-minswap">
                Search Minswap for “{q}”
              </button>
            ) : (
              <p className="note">Search to find any token Minswap lists.</p>
            ))}
          {search && error && <p className="error">{error}</p>}
          {search && !found && !error && <p className="note">Searching…</p>}
          {theirs?.length === 0 && <p className="note">Minswap lists nothing else by that name.</p>}
          {!!theirs?.length && (
            <ul className="list" data-testid="swap-tokens">
              {theirs.slice(0, 12).map((t) => {
                // Named as every text view names a token; Minswap's own name for it goes under.
                const pick = pickOf(network, t.id, t.decimals);
                const minswap = [t.ticker, t.name].filter(Boolean).join(" · ") || shortHex(t.id, 12, 6);
                return row(pick, `${minswap}, verified by Minswap`);
              })}
            </ul>
          )}
          {others.length > 0 && (
            <>
              <h3 className="swap-pick__heading">Also in your private balance</h3>
              <p className="field-note" data-testid="swap-unverified-note">
                Not on the wallet's list{found ? ", nor on Minswap's verified list" : ""}: anyone can give a token a known
                token's name. The quote says whether Minswap verifies one, by its ID; the wallet swaps into no other.
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
  const presets = [0.5, 1, 3];
  const [own, setOwn] = useState(presets.includes(value) ? "" : String(value));
  const typed = own.trim() ? parseSlippage(own) : undefined;
  return (
    <Modal
      title="Slippage"
      titleId="swap-slippage-title"
      onClose={onClose}
      foot={
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="note">
        How far the price may move against you before the order is filled. Past it, the order isn't filled: it waits, and
        you can cancel it.
      </p>
      <div className="segmented" role="group" aria-label="Usual slippages">
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
        <label htmlFor="swap-slippage-own">Your own</label>
        <div className="amount-box">
          <input
            id="swap-slippage-own"
            inputMode="decimal"
            autoComplete="off"
            placeholder="2"
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
            Between {formatPercent(SLIPPAGE_MIN)} and {formatPercent(SLIPPAGE_MAX)}, with at most two decimal places.
          </p>
        )}
      </div>
      {value >= 5 && (
        <Callout tone="warn" testId="swap-slippage-warning">
          At {formatPercent(value)}, the order can be filled for that much less than the quote.
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
  const network = useNetwork();
  const amounts = useAmounts();
  const [s, setS] = useState(session);
  const [orders, setOrders] = useState<SessionOrder[]>();
  const [review, setReview] = useState<SessionTxReview>();
  const [back, setBack] = useState<SessionBackSummary>();
  const [stopping, setStopping] = useState(false);
  // What Stop brings back through Lovejoin, read as its dialog opens: null, directly.
  const [stopCost, setStopCost] = useState<SwapLovejoin | null>();
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
        title={review.kind === "swap" ? "Review the order" : "Review the cancel"}
        titleId="session-tx-review"
        onBack={() => setReview(undefined)}
        backDisabled={busy}
        aside="Built by Minswap, read by the wallet, signed only by this session's key"
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
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRows testId="session-tx-review">
          {review.kind === "swap" && review.quote && sides && (
            <>
              <Row label="You get about" value={amountOf(review.quote.amountOut, sides.get)} strong />
              <Row label="Asked for at least" value={amountOf(review.quote.minAmountOut, sides.get)} />
            </>
          )}
          {review.kind === "cancel" && <Row label="Cancels" value={plural(review.orders ?? 0, "order")} strong />}
          {paid.map((p, i) => (
            <Row
              key={i}
              label={p.script ? "Into the order" : "To"}
              value={`${formatAda(p.lovelace)} ₳${p.tokens.length ? ` and ${plural(p.tokens.length, "token")}` : ""}`}
              title={p.address}
            />
          ))}
          <Row label="Network fee" value={`${formatAda(review.summary.fee)} ₳`} />
          <Row label="Back to the session" value={`${formatAda(review.summary.returnedLovelace)} ₳`} />
          {review.summary.collateral && <Row label="Collateral at risk" value={`${formatAda(review.summary.collateral.atRisk)} ₳`} />}
        </ReviewRows>
        <TxDetailButton txHash={review.txHash} testId="session-tx-detail" />
        {review.summary.note && (
          <p className="note">Minswap's note on it, which anyone can read: “{review.summary.note.join("")}”.</p>
        )}
        <p className="note">
          {review.kind === "swap"
            ? s.auto
              ? "A DEX's batchers fill the order, usually within a few blocks, and pay the proceeds to this session. Then it all comes back by itself. If the price moves past your slippage, it waits: Stop cancels it."
              : "A DEX's batchers fill the order, usually within a few blocks, and pay the proceeds to this session. If the price moves past your slippage, it waits: cancel it here."
            : "The order's funds come back to this session. Then bring the session back."}
        </p>
      </Screen>
    );
  }

  if (back) {
    return (
      <Screen
        title="Review the return"
        titleId="session-back-review"
        onBack={() => setBack(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
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
            {busy ? backSending : "Send"}
          </button>
        }
      >
        <ReviewRows testId="session-back-review">
          <LovejoinRows back={back} />
          <Row label={back.lovejoin ? "Back now" : "Into your private balance"} value={`${formatAda(back.lovelace)} ₳`} strong />
          {back.tokens.map((t) => (
            <Row key={tokenKey(t)} label="" value={heldText(t, s, network)} />
          ))}
          <Row label={back.lovejoin ? "Network fees" : "Network fee"} value={`${formatAda(back.fee)} ₳`} />
          <Row label="From" value={`${plural(back.inputs, "UTxO")} at session ${s.index + 1}`} />
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
        <LovejoinNote
          back={back}
          busy={busy}
          onDirect={() => void act(async () => setBack(await call("session-back-build", { index: s.index, direct: true })))}
        />
        <ReturnLinks back={back} after={back.leftOut?.length ? undefined : "The account is never used again."} />
      </Screen>
    );
  }

  // Once it's over, an empty account says nothing: what it holds shows only while it holds something.
  const holding = s.holding && (!isOver(s) || s.holding.lovelace !== "0" || s.holding.tokens.length) ? s.holding : null;
  const rows = (
    <ReviewRows testId="session-rows">
      {!s.auto && (
        <Row label="Where it's at" value={s.stage === "failed" && !s.unsent ? "Its funding hasn't shown up" : STAGE[s.stage]} strong />
      )}
      {s.swap && sides && <Row label="Quoted" value={`about ${amountOf(s.swap.amountOut, sides.get)}`} />}
      <Row label="Started" value={whenOf(s.createdAt, new Date())} />
      <Row label="Account" value={shortHex(s.address, 16, 8)} title={s.address} />
      {/* What it holds is a balance: hidden while balances are (launch review #56). */}
      {holding && <Row label="It holds" value={`${amounts.ada(holding.lovelace)} ₳`} />}
      {holding?.tokens.map((t) => (
        <Row key={tokenKey(t)} label="" value={amounts.text(heldText(t, s, network))} />
      ))}
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
  const forgetModal = forgetting && (
    <Modal
      title="Forget this swap?"
      titleId="session-forget-title"
      onClose={() => setForgetting(false)}
      foot={
        <>
          <button type="button" className="secondary" onClick={() => setForgetting(false)} disabled={busy}>
            Keep it
          </button>
          <button type="button" className="danger" onClick={forgetNow} disabled={busy}>
            {busy ? "Forgetting…" : "Forget it"}
          </button>
        </>
      }
    >
      <p className="note">
        The chain hasn't shown its funding, but Koios may have taken it, so it may still land. If it lands after you forget
        the swap, the wallet doesn't look at this account again, and the money waits there unseen. Try again looks for it
        first.
      </p>
    </Modal>
  );

  if (s.auto) {
    const auto = s.auto;
    const done = s.stage === "closed";
    const placed = s.txs.some((t) => t.kind === "swap");
    const openStop = () => {
      setStopCost(undefined);
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
        aside={`Private session ${s.index + 1}`}
        error={error}
        foot={
          done ? (
            <button type="button" className="primary" onClick={onBack}>
              Done
            </button>
          ) : s.stage === "failed" ? (
            <div className="actions">
              {!s.unsent && (
                <button type="button" className="primary" onClick={lookAgain} disabled={busy} data-testid="session-look-again">
                  {busy ? "Looking…" : "Try again"}
                </button>
              )}
              <button type="button" className="secondary" onClick={forget} disabled={busy}>
                Forget it
              </button>
            </div>
          ) : auto.stopping ? null : (
            <button type="button" className="secondary" onClick={openStop} disabled={busy}>
              Stop
            </button>
          )
        }
      >
        {runs && <RefreshRow reading={checking} updatedAt={checkedAt} onRefresh={() => void advance(true)} />}
        {/* What it needs from the user comes first; the timeline under it shows where it stopped. */}
        {auto.paused && (
          <Callout tone="warn" testId="session-paused">
            <div className="stack-tight">
              <strong>Paused: it needs you</strong>
              <span data-testid="session-paused-why">{pauseText(auto.paused, auto.approvedMinOut, sides?.get)}</span>
              <span className="row-links">
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => void act(async () => setS(await call("session-resume", { index: s.index })))}
                >
                  Try again
                </button>
                {!placed && !auto.stopping && (
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={() => void act(async () => setReview(await call("session-swap-build", { index: s.index })))}
                  >
                    Review it myself
                  </button>
                )}
              </span>
            </div>
          </Callout>
        )}
        {stoppedLate && (
          <Callout tone="warn" testId="session-stop-ordered">
            An order had gone out before Stop took effect. The wallet cancels it, unless a batcher fills it first, and then
            everything comes back into your private balance.
          </Callout>
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
      title={`Private session ${s.index + 1}`}
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
          onBack={() => void act(async () => setBack(await call("session-back-build", { index: s.index })))}
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

/** Stop's words for an order the runner may be placing as the dialog shows (independent review L22). */
const IF_ORDERED = "If the wallet is placing one right now, it's cancelled, unless a batcher fills it first.";

/**
 * Stop's dialog (privacy review §2.8, §4.1): what stopping does, and when it
 * comes back through Lovejoin, what that takes as the worker works it out
 * now (`cost`: undefined while it's read, null when it comes back
 * directly), with the way to bring it back directly instead.
 */
export function StopDialog({
  placed,
  cost,
  busy,
  onStop,
  onClose,
}: {
  placed: boolean;
  cost?: SwapLovejoin | null;
  busy: boolean;
  onStop: (direct: boolean) => void;
  onClose: () => void;
}) {
  const mixes = !!cost && !cost.skipped && cost.boxes > 0;
  return (
    <Modal
      title="Stop this swap?"
      titleId="session-stop-title"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Keep going
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => onStop(false)}>
            {busy ? "Stopping…" : mixes ? "Stop, through Lovejoin" : "Stop the swap"}
          </button>
        </>
      }
    >
      <p className="note" data-testid="session-stop-what">
        {mixes
          ? `${placed ? "The order is cancelled, unless a batcher fills it first, and everything comes back into your private balance." : `If no order has gone out yet, none is placed, and everything comes back into your private balance. ${IF_ORDERED}`} Its ADA goes through Lovejoin first: ${boxesText(cost)}, mixed in ${plural(cost.mixes, "mix", "mixes")} for about ${formatAda(cost.mixFees)} ₳ in fees, which the session pays, and about ${formatAda(cost.withdrawFees)} ₳ to bring them back, each on its own after ${delayText(cost.delay)}.${placed ? " The cancel costs a network fee too." : ""}`
          : placed
            ? "The order is cancelled, unless a batcher fills it first, and everything comes back into your private balance. The cancel and the return each cost a network fee."
            : `If no order has gone out yet, none is placed, and everything comes back into your private balance, less the return's network fee. ${IF_ORDERED}`}
      </p>
      {cost?.skipped && (
        <p className="note" data-testid="session-stop-pool">
          {cost.skipped}, so it would come back directly, tied to this session on chain.
        </p>
      )}
      {cost === undefined && <p className="note">Working out what goes through Lovejoin…</p>}
      {mixes && (
        <div className="stack-tight">
          <button type="button" className="link align-start" disabled={busy} onClick={() => onStop(true)} data-testid="session-stop-direct">
            Stop and bring it back directly
          </button>
          <p className="note">
            Directly, it all comes back at once, for the return's network fee alone, and anyone can tie it on chain to this
            session and its funding.
          </p>
        </div>
      )}
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
 * review #21).
 */
export function pauseText(p: SessionPause, approvedMinOut: string, out?: Pick): string {
  if (p.why === "refused") {
    return `The wallet won't sign what Minswap built: ${p.detail.trim().replace(/\.?$/, ".")} Try again asks Minswap to build it afresh.`;
  }
  const amount = (q: string) => (out ? amountOf(q, out) : q);
  return `The price moved: an order now would give about ${amount(p.amountOut)}, less than the ${amount(approvedMinOut)} you approved at least, so the wallet didn't ask for one. Try again later, or review the new price yourself.`;
}

/** When a failed step is tried again. */
function retryText(at: number): string {
  const ms = at - Date.now();
  return ms <= 0 ? "Trying again now" : ms < 60_000 ? "Trying again in under a minute" : `Trying again in ${Math.ceil(ms / 60_000)} minutes`;
}

/** Why a step failed, in plain words, when the error is one that's known; else the error itself. */
function retryReason(error: string): string {
  if (/limiting requests/i.test(error)) return "Minswap is limiting requests from this connection for a minute.";
  if (/no wallet utxos|insufficient balance/i.test(error)) return "Minswap hasn't seen the funding yet.";
  if (/couldn't reach minswap/i.test(error)) return "Minswap didn't answer.";
  if (/koios/i.test(error)) return "Koios didn't answer.";
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
      title: failed ? "Not funded" : "Funded",
      // Only one turned away is known never to have gone out: one unseen may still land.
      sub: failed
        ? s.unsent
          ? "It never reached the chain"
          : "The chain hasn't shown it yet"
        : "A one-time account, from your private balance",
      tx: tx("out"),
    },
    {
      title: unordered ? "No order" : "Order placed",
      sub: unordered ? "Stopped before one was placed" : least ? `Asked for at least ${least}` : "Through Minswap",
      tx: tx("swap"),
    },
    {
      title: unordered
        ? "Nothing to fill"
        : open
          ? "Waiting on an order"
          : cancelled
            ? "Cancelled"
            : auto.refunded
              ? "Refunded"
              : auto.partly
                ? "Partly filled"
                : "Filled",
      sub: unordered
        ? "Nothing was ordered"
        : open
          ? "One is still open at a DEX, and Minswap doesn't list it"
          : cancelled
            ? "The order's funds back at the account"
            : auto.refunded
              ? "Not filled: the DEX gave the order's funds back to the account"
              : auto.partly
                ? "Part of it filled; the DEX gave the rest back. Both are at the account"
                : auto.filled
                  ? "The proceeds are at the account"
                  : "By a DEX's batcher, usually within a few blocks",
      tx: tx("cancel"),
    },
    {
      title: "Back in your private balance",
      sub: s.lovejoinSkipped
        ? "Directly: Lovejoin was left out"
        : auto.direct
          ? "Directly, as you chose: everything at the account, under fresh registers"
          : "Everything at the account, under fresh registers",
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
                  Cardanoscan
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
            {retryReason(auto.retry.error)} {retryText(auto.retry.at)}.{" "}
            <button type="button" className="link" disabled={busy} onClick={onRetry}>
              Try now
            </button>
          </p>
          {retryReason(auto.retry.error) !== auto.retry.error && <p className="timeline__error">{auto.retry.error}</p>}
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
const ORDER_OPEN =
  "Stopped, but one of this swap's orders is still open at a DEX, and Minswap doesn't list it, so it can't be cancelled yet. " +
  "What's left waits at the swap's account: it comes back once that order is filled or refunded, or cancelled once Minswap " +
  "lists it. Nothing is lost meanwhile.";

/** What's happening now, in plain words. */
export function nowLine(s: SessionView): string {
  const a = s.auto!;
  if (s.stage === "failed") {
    return s.unsent
      ? "Its funding never reached the chain, so the account is empty. Forget it: its account isn't used again."
      : "The chain hasn't shown its funding in 20 minutes, so the swap waits. Koios may have taken it, and it may still land: Try again looks for it again.";
  }
  switch (a.step) {
    case "funding":
      return a.stopping
        ? "Stopping: once the funding is confirmed, it all comes back."
        : "Waiting for the network to confirm the funding. It usually takes about a minute.";
    case "ordering":
      if (a.stopping) return "Stopping: bringing it all back.";
      return s.txs.some((t) => t.kind === "swap")
        ? "The order is on its way: waiting for the network to confirm it."
        : "Asking Minswap for a fresh quote, then placing the order.";
    case "filling":
      return "The order waits for a DEX's batcher to fill it, usually within a few blocks. It all comes back by itself once it's filled; Stop cancels it.";
    case "cancelling":
      // An order Minswap doesn't list can't be cancelled: what the swap waits on, plainly (independent review L16).
      if (a.orderOpen !== undefined) return ORDER_OPEN;
      return "Cancelling the order. Once that's confirmed, it all comes back.";
    case "returning":
      if (s.chain) {
        const how = chainText(s.chain, !s.auto);
        return `Coming back through Lovejoin: ${how.charAt(0).toLowerCase()}${how.slice(1)}.`;
      }
      return "Coming back into your private balance: waiting for the network to confirm it.";
    case "done":
      // Refunded, the swap didn't happen: never "Done" (independent review M18).
      if (a.refunded) return "Refunded: the order wasn't filled, so what you swapped is back in your private balance.";
      if (a.partly) {
        return "Partly filled: part of the swap went through and the rest was refunded. Both are back in your private balance.";
      }
      return a.filled ? "Done: the swap is in your private balance." : "Stopped: everything is back in your private balance.";
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

/** A session from before swaps ran themselves: what to do next, by hand. */
function nextStep(s: SessionView, swapped: boolean, waiting: boolean): string {
  switch (s.stage) {
    case "funding":
      return "Waiting for the network to confirm the funding. It takes about a minute: refresh to check.";
    case "failed":
      return s.unsent
        ? "Its funding never reached the chain, so the account is empty. Forget it: its account isn't used again."
        : "The chain hasn't shown its funding in 20 minutes. Refresh to look again: it may still land. Forget it only once you're sure it didn't go out.";
    case "returning":
      return "Coming back into your private balance. Refresh to check.";
    case "closed":
      return "Everything came back into your private balance. This account is never used again.";
    case "open":
      if (!swapped) return "Funded. Place the order: the wallet asks Minswap for a fresh quote and shows it before anything is signed.";
      if (waiting) return "The order is waiting for a DEX's batcher to fill it. If it doesn't, cancel it.";
      return "Nothing is waiting: bring everything in the account back into your private balance.";
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
  if (s.stage === "failed") {
    return (
      <button type="button" className="secondary" onClick={onForget} disabled={busy}>
        Forget it
      </button>
    );
  }
  if (s.stage !== "open") return null;
  return (
    <div className="stack">
      {!swapped && (
        <button type="button" className="primary" onClick={onSwap} disabled={busy}>
          {busy ? "Asking Minswap…" : "Place the order"}
        </button>
      )}
      {waiting && (
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel the order
        </button>
      )}
      {!waiting && (
        <button type="button" className={swapped ? "primary" : "secondary"} onClick={onBack} disabled={busy}>
          Bring it back
        </button>
      )}
    </div>
  );
}
