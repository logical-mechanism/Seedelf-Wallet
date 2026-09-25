// Swaps, each in a private session (background/sessions.ts): a one-time
// account is funded from the private balance, Minswap's aggregator builds the
// swap for it, the session's key signs it, and once it's filled everything
// comes back into the private balance. The public account never appears.
//
// Swaps       the sessions, newest first, and New swap.
// NewSwap     what to swap, Minswap's quote, then the funding payment to review.
// Session     one session: where it's at, and the next step (swap, cancel, bring back).

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type {
  Balances,
  PendingTx,
  SessionBackSummary,
  SessionOrder,
  SessionOutSummary,
  SessionTxReview,
  SessionView,
  SwapQuote,
  SwapSide,
  SwapTokenInfo,
  TokenQuantity,
} from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ChevronRightIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { formatAda, formatPercent, formatQuantity, parseQuantity, plural, shortHex, timeAgo, tokenKey } from "../format";
import { useNetwork } from "../network";
import { isNft, tokenInfo, tokenLabel } from "../tokens";

const ADA: SwapSide = { label: "₳", decimals: 6 };

/** An amount on one side of a swap: "10 ₳", "906.5941 MIN". */
function amountOf(quantity: string, side: SwapSide): string {
  return side === ADA || side.label === "₳" ? `${formatAda(quantity)} ₳` : `${formatQuantity(quantity, side.decimals)} ${side.label}`;
}

/** A session's swap in a line: "10 ₳ → MIN". */
function pairOf(s: SessionView): string {
  const d = s.swap?.display;
  if (!s.swap || !d) return "A swap";
  return `${amountOf(s.swap.amount, d.in)} → ${d.out.label}`;
}

const STAGE: Record<SessionView["stage"], string> = {
  funding: "Being funded",
  open: "Open",
  returning: "Coming back",
  closed: "Done",
  failed: "Its funding didn't go through",
};

export function Swaps({
  seedelf,
  blocked,
  onBack,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  /** Why a new swap can't start now: a transaction still waiting, say. */
  blocked?: string;
  onBack: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const [sessions, setSessions] = useState<SessionView[]>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number>();
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setReading(true);
    try {
      setSessions(await call("sessions", { refresh }));
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
    return <NewSwap seedelf={seedelf} onCancel={done} onSent={onSent} />;
  }
  const session = sessions?.find((s) => s.index === open);
  if (session) {
    return (
      <Session
        session={session}
        updatedAt={updatedAt}
        reading={reading}
        onRefresh={() => void load(true)}
        onBack={() => setOpen(undefined)}
        onSent={onSent}
        onChanged={setSessions}
      />
    );
  }

  const noFunds = seedelf.utxos === 0 ? "Make some ADA private first: a swap is paid from your private balance" : undefined;
  return (
    <Screen
      title="Swaps"
      titleId="swaps-title"
      onBack={onBack}
      aside="Each from a one-time account"
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
      <Callout tone="privacy">
        A swap runs from a new one-time account: it's funded from your private balance, Minswap swaps from it, and
        everything comes back into your private balance. Your public account never appears. Anyone can follow the money
        through the one-time account, though, and the amounts and times tie its two ends together.
      </Callout>
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={() => void load(true)} />
      {sessions?.length === 0 && (
        <p className="note center" data-testid="swaps-empty">
          No swaps yet.
        </p>
      )}
      {!!sessions?.length && (
        <ul className="list section" data-testid="swaps">
          {sessions.map((s) => (
            <li key={s.index}>
              <button type="button" className="menu-row" onClick={() => setOpen(s.index)}>
                <span className="stack-tight">
                  <span>{pairOf(s)}</span>
                  <span className="note">
                    Session {s.index + 1} · {STAGE[s.stage]} · {timeAgo(s.createdAt, Date.now())}
                  </span>
                </span>
                <ChevronRightIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A new swap
// ---------------------------------------------------------------------------

/** What can be sold: ADA, or a token in the private balance. */
interface Source {
  id: string;
  side: SwapSide;
  /** What the private balance holds of it. */
  held: string;
}

function NewSwap({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const sources: Source[] = [
    { id: "lovelace", side: ADA, held: seedelf.lovelace },
    // NFTs aren't swapped on a DEX.
    ...seedelf.tokens
      .filter((t) => !isNft(t, tokenInfo(network, t)))
      .map((t) => ({
        id: t.policyId + t.assetName,
        side: { label: tokenLabel(network, t), decimals: tokenInfo(network, t)?.decimals ?? t.decimals },
        held: t.quantity,
      })),
  ];
  const [from, setFrom] = useState<Source>(sources[0]!);
  const [to, setTo] = useState<{ id: string; side: SwapSide }>();
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<"0.5" | "1" | "3">("1");
  const [quote, setQuote] = useState<SwapQuote>();
  const [out, setOut] = useState<SessionOutSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const raw = parseQuantity(amount, from.side.decimals);
  const tooMuch = !!raw && BigInt(raw) > BigInt(from.held);
  const ready = !!to && !!raw && raw !== "0" && !tooMuch;
  const display = to && { in: from.side, out: to.side };

  async function getQuote(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setQuote(await call("swap-quote", { amount: raw!, tokenIn: from.id, tokenOut: to!.id, slippage: Number(slippage) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fund() {
    if (!quote || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setOut(await call("session-out-build", { quote, display }));
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
      onSent(await call("session-out-submit", { txHash: out.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (out && quote && display) {
    const [swapPart, collateral] = out.payments;
    return (
      <Screen
        title="Review the funding"
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
        <ReviewRows testId="swap-fund-review">
          <Row label="To" value={`Private session ${out.index + 1}`} strong />
          <Row label="Account" value={shortHex(out.address, 16, 8)} title={out.address} />
          <Row label="For the swap" value={fundText(swapPart!.lovelace, swapPart!.tokens, display.in, network)} strong />
          <Row label="Its collateral" value={`${formatAda(collateral!.lovelace)} ₳`} />
          <Row label="Network fee" value={`${formatAda(out.fee.total)} ₳`} />
          <Row label="Back to your private balance" value={`${formatAda(out.changeLovelace)} ₳`} />
        </ReviewRows>
        <p className="note">
          What the swap doesn't use, the collateral, and the order's deposit all come back when you bring the session back.
        </p>
        <Callout tone="privacy">
          This payment links the private UTxOs it spends to the one-time account, as Make public does. The account then
          links to Minswap and back again.
        </Callout>
        <p className="note">
          Send asks giveme.my to lend the collateral, then submits. Once the network confirms it, open the swap to place
          the order.
        </p>
      </Screen>
    );
  }

  if (quote && display) {
    return (
      <Screen
        title="The quote"
        titleId="swap-quote"
        onBack={() => setQuote(undefined)}
        backDisabled={busy}
        aside="From Minswap, freshly asked again when the order is placed"
        error={error}
        foot={
          <button type="button" className="primary" onClick={fund} disabled={busy}>
            {busy ? "Building…" : "Continue"}
          </button>
        }
      >
        <ReviewRows testId="swap-quote-rows">
          <Row label="You swap" value={amountOf(quote.amountIn, display.in)} strong />
          <Row label="You get about" value={amountOf(quote.amountOut, display.out)} strong />
          <Row label="At least" value={amountOf(quote.minAmountOut, display.out)} />
          <Row label="Through" value={quote.route.join(", ")} />
          <Row label="Price impact" value={formatPercent(quote.priceImpact)} />
          <Row label="DEX fee" value={`${formatAda(quote.dexFee)} ₳`} />
          {quote.aggregatorFee !== "0" && <Row label="Minswap's fee" value={`${formatAda(quote.aggregatorFee)} ₳`} />}
          <Row label="Order deposit" value={`${formatAda(quote.deposits)} ₳, back with the proceeds`} />
        </ReviewRows>
        <ol className="steps" data-testid="swap-steps">
          <li>Fund a one-time account from your private balance.</li>
          <li>Once that's confirmed, place the order from it.</li>
          <li>When it's filled, bring everything back into your private balance.</li>
        </ol>
        <p className="note">Three transactions, each with its network fee: that's the cost of keeping your public account out of it.</p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={getQuote}
      title="New swap"
      titleId="swap-title"
      onBack={onCancel}
      aside="Through Minswap, from a one-time account"
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Asking Minswap…" : "Get a quote"}
        </button>
      }
    >
      <div className="field">
        <label htmlFor="swap-from">From your private balance</label>
        <select
          id="swap-from"
          value={from.id}
          onChange={(e) => {
            const source = sources.find((s) => s.id === e.target.value)!;
            setFrom(source);
            // A token sells for ADA; ADA buys what's searched for.
            setTo(source.id === "lovelace" ? undefined : { id: "lovelace", side: ADA });
          }}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.side === ADA ? "ADA" : s.side.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="swap-amount">Amount</label>
        <input
          id="swap-amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
        <p className={tooMuch ? "field-note" : "note"} data-testid="swap-held">
          {tooMuch ? "That's more than " : ""}
          {amountOf(from.held, from.side)} in your private balance
        </p>
      </div>
      {from.id === "lovelace" ? <TokenSearch value={to} onChange={setTo} /> : <p className="note">For ADA.</p>}
      <Choice
        label="Slippage"
        id="swap-slippage"
        options={[
          { value: "0.5", label: "0.5%" },
          { value: "1", label: "1%" },
          { value: "3", label: "3%" },
        ]}
        value={slippage}
        onChange={setSlippage}
      />
    </Screen>
  );
}

/** What the funding carries for the swap, in words. */
function fundText(lovelace: string, tokens: TokenQuantity[], side: SwapSide, network: "preprod" | "mainnet"): string {
  const ada = `${formatAda(lovelace)} ₳`;
  if (!tokens.length) return ada;
  return `${ada} and ${tokens.map((t) => `${formatQuantity(t.quantity, side.decimals)} ${tokenLabel(network, t)}`).join(", ")}`;
}

/** Picks the token to buy from Minswap's list; Minswap sees what's searched for. */
function TokenSearch({
  value,
  onChange,
}: {
  value?: { id: string; side: SwapSide };
  onChange: (to: { id: string; side: SwapSide } | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SwapTokenInfo[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound(undefined);
      return;
    }
    // Asked once typing pauses, not on every key.
    const timer = setTimeout(() => {
      call("swap-tokens", { query: q }).then(
        (list) => {
          setFound(list.filter((t) => t.id !== "lovelace"));
          setError(undefined);
        },
        (e: Error) => setError(e.message),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <div className="field">
        <span className="label">To</span>
        <div className="token-chosen" data-testid="swap-to">
          <span>{value.side.label}</span>
          <button type="button" className="link" onClick={() => onChange(undefined)}>
            Change
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor="swap-to">To</label>
      <input
        id="swap-to"
        autoComplete="off"
        placeholder="A ticker, a name, or the token's ID"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="field-note">Searching asks Minswap, which then knows what you looked for.</p>
      {error && <p className="error">{error}</p>}
      {found && found.length === 0 && <p className="note">Minswap lists nothing by that name.</p>}
      {!!found?.length && (
        <ul className="list section" data-testid="swap-tokens">
          {found.slice(0, 8).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="menu-row"
                onClick={() => onChange({ id: t.id, side: { label: t.ticker ?? t.name ?? shortHex(t.id), decimals: t.decimals } })}
              >
                <span className="stack-tight">
                  <span>{t.ticker ?? t.name ?? shortHex(t.id)}</span>
                  <span className="note">{t.name ?? shortHex(t.id, 12, 6)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

function Session({
  session: s,
  updatedAt,
  reading,
  onRefresh,
  onBack,
  onSent,
  onChanged,
}: {
  session: SessionView;
  updatedAt?: number;
  reading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onSent: (pending: PendingTx) => void;
  onChanged: (sessions: SessionView[]) => void;
}) {
  const network = useNetwork();
  const [orders, setOrders] = useState<SessionOrder[]>();
  const [review, setReview] = useState<SessionTxReview>();
  const [back, setBack] = useState<SessionBackSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const swapped = s.txs.some((t) => t.kind === "swap");
  useEffect(() => {
    if (s.stage !== "open" || !swapped) return;
    call("session-orders", { index: s.index }).then(setOrders, (e: Error) => setError(e.message));
  }, [s.index, s.stage, swapped, updatedAt]);

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
              void act(async () =>
                onSent(await call(review.kind === "swap" ? "session-swap-submit" : "session-cancel-submit", { txHash: review.txHash })),
              )
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
            ? "A DEX's batchers fill the order, usually within a few blocks, and pay the proceeds to this session. If the price moves past your slippage, it waits: cancel it here."
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
            onClick={() => void act(async () => onSent(await call("session-back-submit", { txHash: back.txHash })))}
          >
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRows testId="session-back-review">
          <Row label="Into your private balance" value={`${formatAda(back.lovelace)} ₳`} strong />
          {back.tokens.map((t) => (
            <Row
              key={tokenKey(t)}
              label=""
              value={`${formatQuantity(t.quantity, d && tokenKey(t) === tokenKeyOf(s.swap!.tokenOut) ? d.out.decimals : (tokenInfo(network, t)?.decimals ?? 0))} ${tokenLabel(network, t)}`}
            />
          ))}
          <Row label="Network fee" value={`${formatAda(back.fee)} ₳`} />
          <Row label="From" value={`${plural(back.inputs, "UTxO")} at session ${s.index + 1}`} />
        </ReviewRows>
        <Callout tone="privacy">
          This links the one-time account to the new private UTxOs, as Make private does. The account is never used again.
        </Callout>
      </Screen>
    );
  }

  const holding = s.holding;
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
          onForget={() => void act(async () => onChanged(await call("session-forget", { index: s.index })))}
        />
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={onRefresh} />
      <ReviewRows testId="session-rows">
        <Row label="Where it's at" value={STAGE[s.stage]} strong />
        <Row label="Account" value={shortHex(s.address, 16, 8)} title={s.address} />
        {holding && <Row label="It holds" value={`${formatAda(holding.lovelace)} ₳`} />}
        {holding?.tokens.map((t) => (
          <Row
            key={tokenKey(t)}
            label=""
            value={`${formatQuantity(t.quantity, d && tokenKeyOf(s.swap!.tokenOut) === tokenKey(t) ? d.out.decimals : (tokenInfo(network, t)?.decimals ?? 0))} ${tokenLabel(network, t)}`}
          />
        ))}
        {s.swap && d && <Row label="Quoted" value={`about ${amountOf(s.swap.amountOut, d.out)}`} />}
      </ReviewRows>
      <p className="note" data-testid="session-next">
        {nextStep(s, swapped, waiting)}
      </p>
    </Screen>
  );
}

/** A Minswap token ID as the wallet keys tokens. */
function tokenKeyOf(id: string): string {
  return tokenKey({ policyId: id.slice(0, 56), assetName: id.slice(56) });
}

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
