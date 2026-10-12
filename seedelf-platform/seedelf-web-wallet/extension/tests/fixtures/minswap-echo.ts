// Minswap's estimate for what was asked, from a recorded one: the fakes'
// (tests/fakes.ts, e2e/support.ts). Live, Minswap gives the amount and the
// tokens back as asked, its paths summing to the amount (nine mainnet quotes,
// 2026-10-11), and the wallet refuses an estimate that doesn't
// (sessions.ts quotesTheAsk). What it gets stays the recording's, whatever
// was asked: 906.5941 MIN for 1 ₳ as for 500 (the usability review's DX-8).

interface Leg {
  token_in: string;
  token_out: string;
  amount_in: string;
}

interface Asked {
  amount: string;
  token_in: string;
  token_out: string;
}

/**
 * `recorded`, for the amount and tokens `body` (an `estimate` request's)
 * asked for: the amount shared out over its paths as their own amounts are,
 * so a route a test made up of copies of one leg adds up too.
 */
export function asAsked<T>(recorded: T, body: Asked): T {
  const est = recorded as T & Asked & { amount_in: string; paths: Leg[][] };
  const asked = BigInt(body.amount);
  const total = est.paths.reduce((sum, path) => sum + BigInt(path[0]!.amount_in), 0n);
  let left = asked;
  const paths = est.paths.map((path, i) => {
    const share = i === est.paths.length - 1 ? left : (BigInt(path[0]!.amount_in) * asked) / total;
    left -= share;
    return path.map((leg, j) => ({
      ...leg,
      ...(j === 0 ? { token_in: body.token_in, amount_in: share.toString() } : {}),
      ...(j === path.length - 1 ? { token_out: body.token_out } : {}),
    }));
  });
  return { ...est, token_in: body.token_in, token_out: body.token_out, amount_in: body.amount, paths };
}
