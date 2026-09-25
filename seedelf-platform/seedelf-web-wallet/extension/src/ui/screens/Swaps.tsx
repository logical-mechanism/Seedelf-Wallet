// Swaps, each in a private session (background/sessions.ts): a one-time
// account is funded from the private balance, Minswap's aggregator builds the
// swap for it, the session's key signs it, and once it's filled everything
// comes back into the private balance. The public account never appears.
//
// Swaps       the sessions, newest first: those in progress, then past ones,
//             each with its pair and a tag for how it's doing. And New swap.
// NewSwap     Minswap's shape: You pay over You receive, a live quote under
//             them, then the swap and its funding payment to review.
// Session     one session: a timeline of the swap as it runs itself, with Stop,
//             or, for one from before, the next step as a button.

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
  SwapQuote,
  SwapSide,
  SwapTokenInfo,
  TokenQuantity,
} from "../../shared/rpc";
import { call } from "../background";
import { AmountField } from "../components/AmountField";
import { Callout } from "../components/Callout";
import {
  chainText,
  delayText,
  IntoRow,
  LovejoinNote,
  LovejoinRows,
  ReturnLinks,
  useSendingLabel,
  useSessionsWhile,
} from "../components/LovejoinReturn";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  ExternalIcon,
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
import {
  ADA_RULES,
  type AmountRules,
  explorerUrl,
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
import { usePreferences } from "../preferences";
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
} from "../swap";
import { initials, sortTokens, tint, tokenInfo, tokenLabel, viewToken } from "../tokens";

const ADA: SwapSide = { label: "₳", decimals: 6 };

/** An amount on one side of a swap: "10 ₳", "906.5941 MIN". */
function amountOf(quantity: string, side: SwapSide): string {
  return side === ADA || side.label === "₳" ? `${formatAda(quantity)} ₳` : `${formatQuantity(quantity, side.decimals)} ${side.label}`;
}

/** A side's name on its own: ADA, or the token's ticker. */
const sideName = (side: SwapSide) => (side.label === "₳" ? "ADA" : side.label);

/** A session's swap in a line: "10 ₳ → MIN", "906.5941 MIN → ADA". */
export function pairOf(s: SessionView): string {
  const d = s.swap?.display;
  if (!s.swap || !d) return "A swap";
  return `${amountOf(s.swap.amount, d.in)} → ${sideName(d.out)}`;
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

/** Back in the private balance, or never funded: nothing more happens. */
const isOver = (s: SessionView) => s.stage === "closed" || s.stage === "failed";

/** A swap that runs itself and isn't over: Home shows it. A mix (Lovejoin's) isn't a swap. */
export function isRunningSwap(s: SessionView): boolean {
  return !!s.auto && !s.mix && !isOver(s);
}

/** How a swap is doing at a glance: running, waiting on the user, done, stopped, or failed. */
export type SwapTone = "live" | "wait" | "done" | "off" | "bad";

/** A session's tag: a word or two, in its tone. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") return { tone: "bad", label: "Failed" };
  const a = s.auto;
  if (!a) {
    // From before: every step after the funding is the user's.
    if (s.stage === "closed") return { tone: "done", label: "Done" };
    return s.stage === "open" ? { tone: "wait", label: "Open" } : { tone: "live", label: "Running" };
  }
  if (a.step === "done") return a.filled ? { tone: "done", label: "Done" } : { tone: "off", label: "Stopped" };
  if (a.paused) return { tone: "wait", label: "Needs you" };
  if (a.retry) return { tone: "wait", label: "Retrying" };
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
  if (s.auto.paused) return PAUSED[s.auto.paused.why];
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
  const d = s.swap?.display;
  if (!s.swap || !d) {
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
      <SwapAvatar pick={{ id: s.swap.tokenIn, side: d.in }} />
      <SwapAvatar pick={{ id: s.swap.tokenOut, side: d.out }} />
    </span>
  );
}

/** A session in a list, which opens its page: the pair, what it's doing or when it ran, and its tag. Home shows the running ones. */
export function SwapRow({ session: s, onOpen }: { session: SessionView; onOpen: () => void }) {
  const tag = tagOf(s);
  return (
    <button type="button" className="token-row swap-row" onClick={onOpen}>
      <SwapPair session={s} />
      <span className="token-row__label">{pairOf(s)}</span>
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
        A swap runs from a new one-time account: it's funded from your private balance, Minswap swaps from it, and
        everything comes back into your private balance. Your public account never appears. Anyone can follow the money
        through the one-time account, though, and the amounts and times tie its two ends together.
      </Callout>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A new swap
// ---------------------------------------------------------------------------

/** One side of a swap: ADA ("lovelace") or a token, by Minswap's ID, and how it's shown. */
interface Pick {
  id: string;
  side: SwapSide;
}

const ADA_PICK: Pick = { id: "lovelace", side: ADA };

/** The most of one token a value can hold: 2⁶³ − 1. */
const TOKEN_MAX = 2n ** 63n - 1n;
/** How long typing pauses before Minswap is asked for a quote: it limits how often it's asked. */
const QUOTE_PAUSE_MS = 600;
/** A quote older than this is asked for again before the funding is built on it. */
const QUOTE_FRESH_MS = 60_000;

/** A side's name on its button and in the lists: ADA, or the token's ticker. */
const nameOf = (p: Pick) => (p.id === "lovelace" ? "ADA" : p.side.label);

/** What the private balance holds of a side. */
function heldOf(seedelf: Balances["seedelf"], id: string): string {
  if (id === "lovelace") return seedelf.lovelace;
  return seedelf.tokens.find((t) => t.policyId + t.assetName === id)?.quantity ?? "0";
}

/** ADA, then the private balance's tokens by name, with a second line and what's held. NFTs aren't swapped on a DEX. */
function ownPicks(network: NetworkName, seedelf: Balances["seedelf"]): Array<Pick & { sub: string; held: string }> {
  const views = sortTokens(
    seedelf.tokens.map((t) => viewToken(network, t)),
    "name",
  ).filter((v) => !v.nft);
  return [
    { ...ADA_PICK, sub: "Cardano", held: seedelf.lovelace },
    ...views.map((v) => ({
      id: v.token.policyId + v.token.assetName,
      side: { label: tokenLabel(network, v.token), decimals: tokenInfo(network, v.token)?.decimals ?? v.token.decimals },
      sub: v.sub,
      held: v.token.quantity,
    })),
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

function NewSwap({
  seedelf,
  onCancel,
  onStarted,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  /** The funding was sent: session `index` runs from here. */
  onStarted: (index: number, pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const { prefs } = usePreferences();
  // Where Lovejoin is deployed, a return's spare ADA goes through it (Settings, Lovejoin).
  const lovejoin = network === "preprod";
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
  const [out, setOut] = useState<{ summary: SessionOutSummary; quote: SwapQuote }>();
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
  const max = pay.id === "lovelace" ? maxAdaIn(held, quoted?.quote) : held;
  const ready = !!current && !tooMuch && !short && !quoteError;
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
      const summary = await call("session-out-build", { quote, display: { in: pay.side, out: get.side } });
      setOut({ summary, quote });
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
      onStarted(out.summary.index, await call("session-out-submit", { txHash: out.summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (out && get) {
    const { summary, quote } = out;
    const [swapPart, collateral] = summary.payments;
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
        <div className="swap-summary" data-testid="swap-summary">
          <div className="swap-summary__row">
            <SwapAvatar pick={pay} />
            <span className="swap-summary__label">You pay</span>
            <span className="swap-summary__amount">{amountOf(quote.amountIn, pay.side)}</span>
          </div>
          <div className="swap-summary__row">
            <SwapAvatar pick={get} />
            <span className="swap-summary__label">You receive</span>
            <span className="swap-summary__amount">≈ {amountOf(quote.amountOut, get.side)}</span>
          </div>
          <p className="swap-summary__foot">
            At least {amountOf(quote.minAmountOut, get.side)} · {formatPercent(quote.priceImpact)} price impact · through{" "}
            {quote.route.join(", ")}
          </p>
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
        <Plan least={amountOf(quote.minAmountOut, get.side)} lovejoin={lovejoin} />
        <p className="note">
          Send approves all of it: the wallet places the order and brings everything back without asking again, as long
          as the order gives at least {amountOf(quote.minAmountOut, get.side)}. If the price moves past that, it pauses and
          asks you. Stop is there until it's done.
        </p>
        <p className="note">
          What the swap doesn't use, the collateral and the order's deposit come back with the proceeds. Three
          transactions, each with its network fee: that's the cost of keeping your public account out of it.
        </p>
        {lovejoin && (
          <p className="note" data-testid="swap-lovejoin">
            On the way back, ADA to spare goes through Lovejoin first: as many boxes of 10 ₳ as it pays for, mixed with other
            people's ({prefs.lovejoinDepth} {prefs.lovejoinDepth === 1 ? "wave" : "waves"} deep), the session paying every mix.
            Each box comes back on its own after {delayText(prefs.lovejoinDelay)}, the first time the wallet is unlocked
            after that. Less than a box's worth, and any tokens, come back at once. Settings, Lovejoin changes this.
          </p>
        )}
        <Callout tone="privacy">
          This payment links the private UTxOs it spends to the one-time account, as Make public does. The account then
          links to Minswap and back again.
        </Callout>
        <p className="note">Send asks giveme.my to lend the collateral, then submits.</p>
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
                onClick={() => fill(halfOf(held, max))}
                disabled={max === "0"}
                aria-label={`Half of your ${nameOf(pay)}`}
              >
                Half
              </button>
              <button
                type="button"
                className="link"
                onClick={() => fill(max)}
                disabled={max === "0"}
                aria-label={`As much ${nameOf(pay)} as a swap can take`}
                title={pay.id === "lovelace" ? "All of it, less the swap's costs and the collateral" : "All of it"}
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
          That's more than the {amountOf(held, pay.side)} in your private balance.
        </p>
      )}
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
              <Detail label="Minimum received" value={amountOf(shown.minAmountOut, get.side)} />
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
      <Callout tone="privacy">
        Quotes come from Minswap as you type: it sees the pair, the amount and your IP address, never your private balance
        or your public account.
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

/** What happens after Send, as the swap's own page then shows it: the timeline's four steps, none taken yet. */
function Plan({ least, lovejoin }: { least: string; lovejoin: boolean }) {
  const steps = [
    ["Funded", "A one-time account, from your private balance"],
    ["Order placed", `Through Minswap, for at least ${least}`],
    ["Filled", "By a DEX's batcher, usually within a few blocks"],
    [
      "Back in your private balance",
      lovejoin
        ? "Spare ADA through Lovejoin first, in boxes that come back later; the proceeds and the rest at once"
        : "The proceeds and everything left",
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

/** What the funding carries for the swap, in words. */
function fundText(lovelace: string, tokens: TokenQuantity[], side: SwapSide, network: "preprod" | "mainnet"): string {
  const ada = `${formatAda(lovelace)} ₳`;
  if (!tokens.length) return ada;
  return `${ada} and ${tokens.map((t) => `${formatQuantity(t.quantity, side.decimals)} ${tokenLabel(network, t)}`).join(", ")}`;
}

/**
 * Picks one side's token: ADA or one in the private balance, and for what's
 * received, any on Minswap's list too. Minswap sees what's searched for.
 */
function TokenSelect({
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
  const q = query.trim();
  const search = which === "get" && q.length >= 2;

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

  const lower = q.toLowerCase();
  const mine = lower ? own.filter((p) => [nameOf(p), p.sub, p.id].some((s) => s.toLowerCase().includes(lower))) : own;
  const theirs = found?.filter((t) => !own.some((p) => p.id === t.id));

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
      {which === "get" && <p className="field-note">Searching asks Minswap, which then knows what you looked for.</p>}
      <h3 className="swap-pick__heading">In your private balance</h3>
      {mine.length ? (
        <ul className="list" data-testid="swap-own-tokens">
          {mine.map((p) => row(p, p.sub, p.held))}
        </ul>
      ) : (
        <p className="note">Nothing you hold matches “{q}”.</p>
      )}
      {which === "get" && (
        <>
          <h3 className="swap-pick__heading">On Minswap</h3>
          {!search && <p className="note">Search to find any token Minswap lists.</p>}
          {search && error && <p className="error">{error}</p>}
          {search && !found && !error && <p className="note">Searching…</p>}
          {theirs?.length === 0 && <p className="note">Minswap lists nothing else by that name.</p>}
          {!!theirs?.length && (
            <ul className="list" data-testid="swap-tokens">
              {theirs.slice(0, 12).map((t) => {
                const label = t.ticker ?? t.name ?? shortHex(t.id);
                return row({ id: t.id, side: { label, decimals: t.decimals } }, t.name ?? shortHex(t.id, 12, 6));
              })}
            </ul>
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

function Session({
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
  const [s, setS] = useState(session);
  const [orders, setOrders] = useState<SessionOrder[]>();
  const [review, setReview] = useState<SessionTxReview>();
  const [back, setBack] = useState<SessionBackSummary>();
  const [stopping, setStopping] = useState(false);
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
  const returning = runs && (s.auto!.step === "returning" || s.auto!.filled || s.auto!.stopping);
  useSessionsWhile(returning, (all) => {
    const now = all.find((x) => x.index === index);
    if (now) setS(now);
  });

  const swapped = s.txs.some((t) => t.kind === "swap");
  useEffect(() => {
    if (s.auto || s.stage !== "open" || !swapped) return;
    call("session-orders", { index: s.index }).then(setOrders, (e: Error) => setError(e.message));
  }, [s.auto, s.index, s.stage, swapped, updatedAt]);

  const d = s.swap?.display;
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
          {review.kind === "swap" && review.quote && d && (
            <>
              <Row label="You get about" value={amountOf(review.quote.amountOut, d.out)} strong />
              <Row label="At least" value={amountOf(review.quote.minAmountOut, d.out)} />
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
            <Row key={tokenKey(t)} label="" value={tokenText(t, s, network)} />
          ))}
          <Row label={back.lovejoin ? "Network fees" : "Network fee"} value={`${formatAda(back.fee)} ₳`} />
          <Row label="From" value={`${plural(back.inputs, "UTxO")} at session ${s.index + 1}`} />
          <IntoRow back={back} />
        </ReviewRows>
        <LovejoinNote
          back={back}
          busy={busy}
          onDirect={() => void act(async () => setBack(await call("session-back-build", { index: s.index, direct: true })))}
        />
        <ReturnLinks back={back} after="The account is never used again." />
      </Screen>
    );
  }

  // Once it's over, an empty account says nothing: what it holds shows only while it holds something.
  const holding = s.holding && (!isOver(s) || s.holding.lovelace !== "0" || s.holding.tokens.length) ? s.holding : null;
  const rows = (
    <ReviewRows testId="session-rows">
      {!s.auto && <Row label="Where it's at" value={STAGE[s.stage]} strong />}
      {s.swap && d && <Row label="Quoted" value={`about ${amountOf(s.swap.amountOut, d.out)}`} />}
      <Row label="Started" value={whenOf(s.createdAt, new Date())} />
      <Row label="Account" value={shortHex(s.address, 16, 8)} title={s.address} />
      {holding && <Row label="It holds" value={`${formatAda(holding.lovelace)} ₳`} />}
      {holding?.tokens.map((t) => (
        <Row key={tokenKey(t)} label="" value={tokenText(t, s, network)} />
      ))}
    </ReviewRows>
  );
  const forget = () => void act(async () => onChanged(await call("session-forget", { index: s.index })));

  if (s.auto) {
    const auto = s.auto;
    const done = s.stage === "closed";
    const placed = s.txs.some((t) => t.kind === "swap");
    return (
      <Screen
        title={pairOf(s)}
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
            <button type="button" className="secondary" onClick={forget} disabled={busy}>
              Forget it
            </button>
          ) : auto.stopping ? null : (
            <button type="button" className="secondary" onClick={() => setStopping(true)} disabled={busy}>
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
              <span>{pauseText(auto.paused, auto.approvedMinOut, d?.out)}</span>
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
        <Timeline
          s={s}
          busy={busy}
          onRetry={() => void act(async () => setS(await call("session-resume", { index: s.index })))}
        />
        {rows}
        {stopping && (
          <Modal
            title="Stop this swap?"
            titleId="session-stop-title"
            onClose={() => setStopping(false)}
            foot={
              <>
                <button type="button" className="secondary" onClick={() => setStopping(false)} disabled={busy}>
                  Keep going
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setS(await call("session-stop", { index: s.index }));
                      setStopping(false);
                    })
                  }
                >
                  {busy ? "Stopping…" : "Stop the swap"}
                </button>
              </>
            }
          >
            <p className="note">
              {placed
                ? "The order is cancelled, unless a batcher fills it first, and everything comes back into your private balance. The cancel and the return each cost a network fee."
                : "No order is placed. Everything comes back into your private balance, less the return's network fee."}
            </p>
          </Modal>
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
      aside={pairOf(s)}
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
      <p className="note" data-testid="session-next">
        {nextStep(s, swapped, waiting)}
      </p>
    </Screen>
  );
}

/** A token the session holds or brings back, with its decimals. */
function tokenText(t: TokenQuantity, s: SessionView, network: NetworkName): string {
  const d = s.swap?.display;
  const decimals = d && tokenKey(t) === tokenKeyOf(s.swap!.tokenOut) ? d.out.decimals : (tokenInfo(network, t)?.decimals ?? 0);
  return `${formatQuantity(t.quantity, decimals)} ${tokenLabel(network, t)}`;
}

/** Why a swap that runs itself waits for the user, in words. */
function pauseText(p: SessionPause, approvedMinOut: string, out?: SwapSide): string {
  if (p.why === "refused") return `The wallet won't sign what Minswap built: ${p.detail}`;
  const amount = (q: string) => (out ? amountOf(q, out) : q);
  return `The price moved: the order would give about ${amount(p.amountOut)} now, less than the ${amount(approvedMinOut)} you approved at least, so it wasn't placed. Try again later, or review the new price yourself.`;
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
  const d = s.swap?.display;
  const at = { funding: 0, ordering: 1, filling: 2, cancelling: 2, returning: 3, done: 4 }[auto.step];
  const tx = (kind: SessionTx["kind"]) => s.txs.findLast((t) => t.kind === kind);
  const failed = s.stage === "failed";
  // Stopped before any order: the order and its fill never happen.
  const unordered = auto.stopping && !tx("swap");
  const cancelled = !!tx("cancel") || (auto.stopping && !auto.filled);
  const state = (i: number): StepState => {
    if (failed) return i === 0 ? "failed" : "skipped";
    if ((i === 1 || i === 2) && unordered) return "skipped";
    if (i < at) return "done";
    if (i > at) return "todo";
    return auto.paused || auto.retry ? "paused" : "now";
  };
  const least = d ? amountOf(auto.approvedMinOut, d.out) : undefined;
  const steps: Array<{ title: string; sub: string; tx?: SessionTx }> = [
    {
      title: failed ? "Not funded" : "Funded",
      sub: failed ? "It never reached the chain" : "A one-time account, from your private balance",
      tx: tx("out"),
    },
    {
      title: unordered ? "No order" : "Order placed",
      sub: unordered ? "Stopped before one was placed" : least ? `For at least ${least}` : "Through Minswap",
      tx: tx("swap"),
    },
    {
      title: unordered ? "Nothing to fill" : cancelled ? "Cancelled" : "Filled",
      sub: unordered
        ? "Nothing was ordered"
        : cancelled
          ? "The order's funds back at the account"
          : auto.filled
            ? "The proceeds are at the account"
            : "By a DEX's batcher, usually within a few blocks",
      tx: tx("cancel"),
    },
    { title: "Back in your private balance", sub: "Everything at the account, under fresh registers", tx: tx("back") },
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
                <a className="timeline__link" href={explorerUrl(network, step.tx.txHash)} target="_blank" rel="noreferrer">
                  Cardanoscan
                  <ExternalIcon size={12} />
                </a>
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
    </div>
  );
}

/** What's happening now, in plain words. */
function nowLine(s: SessionView): string {
  const a = s.auto!;
  if (s.stage === "failed") {
    return "Its funding never reached the chain, so the account is empty. Forget it: its account isn't used again.";
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
      return "Cancelling the order. Once that's confirmed, it all comes back.";
    case "returning":
      if (s.chain) {
        const how = chainText(s.chain);
        return `Coming back through Lovejoin: ${how.charAt(0).toLowerCase()}${how.slice(1)}.`;
      }
      return "Coming back into your private balance: waiting for the network to confirm it.";
    case "done":
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
      return "Its funding never reached the chain, so the account is empty. Forget it: its account isn't used again.";
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
