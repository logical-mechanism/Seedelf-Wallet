// Live preprod runs of the built extension (see lib.mjs): one or more flows,
// separated by "+", in one browser session, as a user would run them. Each
// submits a REAL preprod transaction from the test wallet and waits for it
// to confirm. Never run in CI.
//
//   npm run build
//   node e2e/live/run.mjs all
//   node e2e/live/run.mjs mint live-1 account + move-in 25.5
//   node e2e/live/run.mjs staking
//
// Flows (flows.mjs): mint [tag] [account|seedelf], move-in [ada],
// transfer [ada] [tag|name], withdraw [ada|max] [address|$handle],
// remove [tag] [account|seedelf], stake [ticker|pool1…],
// vote [abstain|no-confidence|drep1…], withdraw-rewards, unstake.
//
// "staking" stakes with TPREP (registering the key if it isn't), delegates
// the vote to no confidence and then to always abstain, then moves to LOGIC.
// The vote changes twice so each review has something to send: a wallet
// whose vote already goes to always abstain, as a run before leaves it,
// can't review that again (1.7.0's live run). Rewards take 15 to 20 days to
// arrive, so withdraw-rewards and unstake are run on their own, later.
//
// "all" is the whole lifecycle, in the order that keeps a new wallet's
// seedelf apart from what it moves in: mint (account), move in, a stealth
// mint, a transfer to the first seedelf, a withdrawal to the wallet's own
// account, and removing the stealth-minted seedelf into Seedelf.
import { FLOWS, run } from "./flows.mjs";
import { log, openWallet } from "./lib.mjs";

// Each run tags its own Seedelfs (15 characters at most), so the first one an earlier run left, which stays, is never
// taken for this run's: a tag two Seedelfs share finds neither. "seedelf" is the flows' word for the private balance,
// a keyword, not the name shown (chunk 14's rename reached it).
const stamp = Date.now().toString(36).slice(-4);
const ALL = `mint live1-${stamp} account + move-in 25.5 + mint live2-${stamp} seedelf + transfer 3.3 live1-${stamp} + withdraw 5.5 + remove live2-${stamp} seedelf`;

const STAKING = "stake TPREP + vote no-confidence + vote abstain + stake LOGIC";

const words = process.argv.slice(2).join(" ").trim() || "all";
const preset = { all: ALL, staking: STAKING }[words] ?? words;
const steps = preset.split("+").map((s) => s.trim().split(/\s+/));
for (const [name] of steps) if (!FLOWS[name]) throw new Error(`no flow "${name}": ${Object.keys(FLOWS).join(", ")}`);

const wallet = await openWallet();
const done = [];
try {
  for (const [name, ...args] of steps) done.push([[name, ...args].join(" "), await run(wallet, name, args)]);
} finally {
  log("hosts contacted:", wallet.hosts().join(", "));
  for (const [step, txHash] of done) console.log(`${step.padEnd(28)} https://preprod.cardanoscan.io/transaction/${txHash}`);
  await wallet.close();
}
