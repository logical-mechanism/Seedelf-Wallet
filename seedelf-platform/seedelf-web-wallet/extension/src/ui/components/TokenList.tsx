// Tokens as rows: the logo (or two letters), the ticker or name with a second
// line, and the amount. Tapping one opens its details. Home shows the first
// few and a way to all of them (screens/Tokens.tsx).

import { useMemo, useState } from "react";

import type { TokenAmount } from "../../shared/rpc";
import { tokenKey } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { initials, sortTokens, tint, type TokenView, viewToken } from "../tokens";
import { CopyField } from "./CopyField";
import { CheckIcon, ChevronRightIcon } from "./Icons";
import { Modal } from "./Modal";

/** How many tokens Home shows before "View all". */
const PREVIEW = 5;

export function TokenAvatar({ view, large }: { view: TokenView; large?: boolean }) {
  const shape = `avatar${large ? " avatar--large" : ""}${view.nft ? " avatar--nft" : ""}`;
  if (view.info?.logo) return <img className={`${shape} avatar--logo`} src={view.info.logo} alt="" />;
  return (
    <span className={`${shape} avatar--tint-${tint(view.token.policyId)}`} aria-hidden="true">
      {initials(view.label)}
    </span>
  );
}

export function TokenRow({ view, onOpen }: { view: TokenView; onOpen: (view: TokenView) => void }) {
  const amount = useAmounts().text(view.amount);
  return (
    <li>
      <button
        type="button"
        className="token-row"
        onClick={() => onOpen(view)}
        aria-label={`${view.label}, ${amount}`}
        title={`${view.label}: details`}
      >
        <TokenAvatar view={view} />
        <span className="token-row__label">{view.label}</span>
        <span className="token-row__amount">{amount}</span>
        <span className="token-row__sub">{view.sub}</span>
      </button>
    </li>
  );
}

/** Home's tokens: fungible ones first, by name, then NFTs; the first five, and View all. */
export function TokenList({
  tokens,
  testId,
  onViewAll,
}: {
  tokens: TokenAmount[];
  testId: string;
  onViewAll: () => void;
}) {
  const network = useNetwork();
  const [open, setOpen] = useState<TokenView>();
  const views = useMemo(() => {
    const sorted = sortTokens(
      tokens.map((t) => viewToken(network, t)),
      "name",
    );
    return [...sorted.filter((v) => !v.nft), ...sorted.filter((v) => v.nft)];
  }, [network, tokens]);
  if (!views.length) return null;
  return (
    <div className="stack-tight" data-testid={testId}>
      <ul className="list">
        {views.slice(0, PREVIEW).map((v) => (
          <TokenRow key={tokenKey(v.token)} view={v} onOpen={setOpen} />
        ))}
      </ul>
      {views.length > PREVIEW && (
        <button type="button" className="view-all" onClick={onViewAll}>
          View all {views.length} tokens
          <ChevronRightIcon size={16} />
        </button>
      )}
      {open && <TokenDetails view={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

/** A token's details, in a modal: what it is, how much, and the ids that identify it, each with Copy. */
export function TokenDetails({ view, onClose }: { view: TokenView; onClose: () => void }) {
  const t = view.token;
  const amounts = useAmounts();
  return (
    <Modal title={view.label} titleId="token-details-title" onClose={onClose}>
      <div className="token-details" data-testid="token-details">
        <div className="token-details__top">
          <TokenAvatar view={view} large />
          <p className="token-details__amount" data-testid="token-amount">
            {amounts.text(view.amount)}
          </p>
          {view.info && <p className="note">{view.info.name}</p>}
        </div>
        {view.info ? (
          <p className="token-details__listed">
            <CheckIcon size={14} />
            In the wallet's token list
          </p>
        ) : (
          <p className="note">
            Not in the wallet's token list, so its name is only what the token calls itself. Its policy ID is what
            identifies it.
          </p>
        )}
        <CopyField label="Policy ID" value={t.policyId} testId="token-policy" />
        <CopyField
          label="Asset name (hex)"
          value={t.assetName}
          display={t.assetName || "(empty)"}
          testId="token-asset-name"
        />
        <CopyField label="Fingerprint" value={t.fingerprint} testId="token-fingerprint" />
        <p className="note">
          {view.nft ? "NFT" : "Fungible token"} · {view.decimals} decimal places
        </p>
      </div>
    </Modal>
  );
}
