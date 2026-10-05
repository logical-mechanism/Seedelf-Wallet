// Every token of one balance, for wallets that hold many: tokens and NFTs in
// two tabs, a search over names, tickers, policy IDs and fingerprints, and a
// sort. Rows open the same details as Home's. After Lace's portfolio.

import { useMemo, useState } from "react";
import { useT } from "../../i18n";

import type { TokenAmount } from "../../shared/rpc";
import { SearchIcon } from "../components/Icons";
import { Screen } from "../components/Screen";
import { Tabs } from "../components/Tabs";
import { TokenDetails, TokenRow, type TokenAction } from "../components/TokenList";
import { tokenKey } from "../format";
import { useNetwork } from "../network";
import { searchTokens, sortTokens, type TokenSort, type TokenView, viewToken } from "../tokens";

/** Rows shown at a time; "Show more" adds as many again. */
const PAGE = 50;

type Kind = "tokens" | "nfts";

export function Tokens({
  tokens,
  coming,
  of,
  onBack,
  onAction,
  blocked,
}: {
  tokens: TokenAmount[];
  /** The tokens (`tokenKey`) some of which are on their way back with a payment's change (chunk 23's second review, HM-1). */
  coming?: ReadonlySet<string>;
  /** Whose tokens: the title says. */
  of: "seedelf" | "cardano";
  onBack: () => void;
  /** A token's details start a payment with it, when one can be made now. */
  onAction?: (action: TokenAction, token: TokenAmount) => void;
  /** Why they can't now, when it's the one transaction at a time (HM-3). */
  blocked?: string;
}) {
  const network = useNetwork();
  const views = useMemo(() => tokens.map((t) => viewToken(network, t)), [network, tokens]);
  const fungible = views.filter((v) => !v.nft);
  const nfts = views.filter((v) => v.nft);
  const t = useT();
  const [kind, setKind] = useState<Kind>(fungible.length || !nfts.length ? "tokens" : "nfts");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("name");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<TokenView>();

  const found = sortTokens(searchTokens(kind === "tokens" ? fungible : nfts, query), sort);

  return (
    <Screen
      title={t(of === "seedelf" ? "tokens.titlePrivate" : "tokens.titlePublic")}
      titleId="tokens-title"
      onBack={onBack}
      aside={`${t("tokens.count", { count: fungible.length })} · ${t("tokens.nftCount", { count: nfts.length })}`}
    >
      <Tabs
        label={t("tokens.tabsLabel")}
        prefix="tokens-"
        tabs={[
          { value: "tokens", label: t("tokens.tabTokens", { number: fungible.length }) },
          { value: "nfts", label: t("tokens.tabNfts", { number: nfts.length }) },
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
            aria-label={t("tokens.search")}
            placeholder={t("tokens.searchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            spellCheck={false}
          />
        </label>
        <div className="segmented segmented--small" role="group" aria-label={t("tokens.sortBy")}>
          {(["name", "amount"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={s === sort ? "segmented__item segmented__item--on" : "segmented__item"}
              aria-pressed={s === sort}
              onClick={() => setSort(s)}
            >
              {t(s === "name" ? "tokens.sortName" : "tokens.sortAmount")}
            </button>
          ))}
        </div>
      </div>
      <section role="tabpanel" id={`tokens-panel-${kind}`} aria-labelledby={`tokens-tab-${kind}`}>
        {found.length ? (
          <ul className="list" data-testid="token-results">
            {found.slice(0, limit).map((v) => (
              <TokenRow key={tokenKey(v.token)} view={v} coming={coming?.has(tokenKey(v.token))} onOpen={setOpen} />
            ))}
          </ul>
        ) : (
          <p className="note center empty">
            {query.trim()
              ? t(kind === "tokens" ? "tokens.noneMatch" : "tokens.noNftsMatch", { query: query.trim() })
              : t(kind === "tokens" ? "tokens.none" : "tokens.noNfts")}
          </p>
        )}
      </section>
      {found.length > limit && (
        <button type="button" className="secondary" onClick={() => setLimit(limit + PAGE)}>
          {t("tokens.showMore", { number: Math.min(PAGE, found.length - limit) })}
        </button>
      )}
      {open && <TokenDetails view={open} of={of} onClose={() => setOpen(undefined)} onAction={onAction} blocked={blocked} />}
    </Screen>
  );
}
