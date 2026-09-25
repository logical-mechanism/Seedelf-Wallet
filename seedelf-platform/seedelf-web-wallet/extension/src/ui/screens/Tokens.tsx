// Every token of one balance, for wallets that hold many: tokens and NFTs in
// two tabs, a search over names, tickers, policy IDs and fingerprints, and a
// sort. Rows open the same details as Home's. After Lace's portfolio.

import { useMemo, useState } from "react";

import type { TokenAmount } from "../../shared/rpc";
import { SearchIcon } from "../components/Icons";
import { Screen } from "../components/Screen";
import { Tabs } from "../components/Tabs";
import { TokenDetails, TokenRow } from "../components/TokenList";
import { plural, tokenKey } from "../format";
import { useNetwork } from "../network";
import { searchTokens, sortTokens, type TokenSort, type TokenView, viewToken } from "../tokens";

/** Rows shown at a time; "Show more" adds as many again. */
const PAGE = 50;

type Kind = "tokens" | "nfts";

export function Tokens({
  tokens,
  of,
  onBack,
}: {
  tokens: TokenAmount[];
  /** Whose tokens: the title says. */
  of: "seedelf" | "cardano";
  onBack: () => void;
}) {
  const network = useNetwork();
  const views = useMemo(() => tokens.map((t) => viewToken(network, t)), [network, tokens]);
  const fungible = views.filter((v) => !v.nft);
  const nfts = views.filter((v) => v.nft);
  const [kind, setKind] = useState<Kind>(fungible.length || !nfts.length ? "tokens" : "nfts");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("name");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<TokenView>();

  const found = sortTokens(searchTokens(kind === "tokens" ? fungible : nfts, query), sort);
  const what = kind === "tokens" ? "tokens" : "NFTs";

  return (
    <Screen
      title={of === "seedelf" ? "Private tokens" : "Public tokens"}
      titleId="tokens-title"
      onBack={onBack}
      aside={`${plural(fungible.length, "token")} · ${plural(nfts.length, "NFT")}`}
    >
      <Tabs
        label="Tokens or NFTs"
        prefix="tokens-"
        tabs={[
          { value: "tokens", label: `Tokens (${fungible.length})` },
          { value: "nfts", label: `NFTs (${nfts.length})` },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setLimit(PAGE);
        }}
      />
      <div className="token-tools">
        <label className="search">
          <SearchIcon size={16} />
          <input
            type="search"
            aria-label="Search tokens"
            placeholder="Name, ticker or ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            spellCheck={false}
          />
        </label>
        <div className="segmented segmented--small" role="group" aria-label="Sort by">
          {(["name", "amount"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={s === sort ? "segmented__item segmented__item--on" : "segmented__item"}
              aria-pressed={s === sort}
              onClick={() => setSort(s)}
            >
              {s === "name" ? "Name" : "Amount"}
            </button>
          ))}
        </div>
      </div>
      <section role="tabpanel" id={`tokens-panel-${kind}`} aria-labelledby={`tokens-tab-${kind}`}>
        {found.length ? (
          <ul className="list" data-testid="token-results">
            {found.slice(0, limit).map((v) => (
              <TokenRow key={tokenKey(v.token)} view={v} onOpen={setOpen} />
            ))}
          </ul>
        ) : (
          <p className="note center empty">
            {query.trim() ? `No ${what} match “${query.trim()}”.` : `No ${what} in this balance.`}
          </p>
        )}
      </section>
      {found.length > limit && (
        <button type="button" className="secondary" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, found.length - limit)} more
        </button>
      )}
      {open && <TokenDetails view={open} onClose={() => setOpen(undefined)} />}
    </Screen>
  );
}
