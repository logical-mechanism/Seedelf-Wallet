// Tokens as rows: the logo (or two letters), the ticker or name with a second
// line, and the amount. Tapping one opens its details. Home shows the first
// few and a way to all of them (screens/Tokens.tsx). An NFT's image is shown
// only once the user asks for it in its details (NftImage.tsx), and from then
// until the wallet locks it's its avatar too.

import { useMemo, useState } from "react";
import { joinList, useT } from "../../i18n";

import type { TokenAmount, TokenRef } from "../../shared/rpc";
import { tokenKey } from "../format";
import { useNetwork } from "../network";
import { imageIn, useShownImage } from "../nft-images";
import { useAmounts } from "../preferences";
import { initials, sortTokens, tint, tokenMark, tokenText, type TokenView, viewToken } from "../tokens";
import { CopyField } from "./CopyField";
import { CheckIcon, ChevronRightIcon } from "./Icons";
import { Modal } from "./Modal";
import { NftImageShow, NftPicture } from "./NftImage";

/** How many tokens Home shows before "View all". */
const PREVIEW = 5;

export function TokenAvatar({ view, large }: { view: TokenView; large?: boolean }) {
  const shape = `avatar${large ? " avatar--large" : ""}${view.nft ? " avatar--nft" : ""}`;
  // An NFT's image, once the user has asked to see it: never fetched for a list.
  const image = imageIn(useShownImage(view.token));
  if (view.nft && image) return <img className={`${shape} avatar--image`} src={image} alt="" />;
  if (view.info?.logo) return <img className={`${shape} avatar--logo`} src={view.info.logo} alt="" />;
  return (
    <span className={`${shape} avatar--tint-${tint(view.token.policyId)}`} aria-hidden="true">
      {initials(view.label)}
    </span>
  );
}

export function TokenRow({ view, onOpen }: { view: TokenView; onOpen: (view: TokenView) => void }) {
  const tr = useT();
  const amount = useAmounts().text(view.amount);
  return (
    <li>
      <button
        type="button"
        className="token-row"
        onClick={() => onOpen(view)}
        aria-label={joinList([view.label, amount])}
        title={tr("tokenList.details", { label: view.label })}
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
  of,
  testId,
  onViewAll,
}: {
  tokens: TokenAmount[];
  /** Whose tokens: what showing an NFT's image reveals depends on it. */
  of: "seedelf" | "cardano";
  testId: string;
  onViewAll: () => void;
}) {
  const tr = useT();
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
          {tr("tokenList.viewAll", { number: views.length })}
          <ChevronRightIcon size={16} />
        </button>
      )}
      {open && <TokenDetails view={open} of={of} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

/**
 * A token's details, in a modal: what it is, how much, and the ids that
 * identify it, each with Copy. An NFT's image is offered here, and only here.
 * `of`: whose token it is, the private balance's or the public account's.
 */
export function TokenDetails({ view, of, onClose }: { view: TokenView; of: "seedelf" | "cardano"; onClose: () => void }) {
  const tr = useT();
  const t = view.token;
  const amounts = useAmounts();
  return (
    <Modal title={view.label} titleId="token-details-title" onClose={onClose}>
      <div className="token-details" data-testid="token-details">
        <div className="token-details__top">
          <NftPicture view={view}>
            <TokenAvatar view={view} large />
          </NftPicture>
          <p className="token-details__amount" data-testid="token-amount">
            {amounts.text(view.amount)}
          </p>
          {view.info && <p className="note">{view.info.name}</p>}
        </div>
        <NftImageShow view={view} of={of} />
        {view.info ? (
          <p className="token-details__listed">
            <CheckIcon size={14} />
            {tr("tokenList.listed")}
          </p>
        ) : (
          <p className="note">
            {tr("tokenList.notListed")}
          </p>
        )}
        <CopyField label={tr("tokenList.policyId")} copyLabel={tr("tokenList.copyPolicyId")} value={t.policyId} testId="token-policy" />
        <CopyField
          label={tr("tokenList.assetName")}
          copyLabel={tr("tokenList.copyAssetName")}
          value={t.assetName}
          display={t.assetName || tr("tokenList.empty")}
          testId="token-asset-name"
        />
        <CopyField
          label={tr("tokenList.fingerprint")}
          copyLabel={tr("tokenList.copyFingerprint")}
          value={t.fingerprint}
          testId="token-fingerprint"
        />
        <p className="note">
          {tr(view.nft ? "tokenList.nft" : "tokenList.fungible")} · {tr("tokenList.decimals", { number: view.decimals })}
        </p>
      </div>
    </Modal>
  );
}

/**
 * A token amount in a review or a site's prompt, named by `tokenText`: "1.5
 * tUSDM" for a listed token. One that isn't listed gets a second line saying
 * so, with its fingerprint; one named like ADA or a listed token is named by
 * its fingerprint, and the line says what it calls itself (in the warning's
 * colour). `amount` is the quantity already in the token's units
 * (`tokenQuantity`), with any sign.
 */
export function TokenAmountText({ token, amount }: { token: TokenRef & { fingerprint?: string }; amount: string }) {
  const tr = useT();
  const text = tokenText(useNetwork(), token);
  const mark = tokenMark(text);
  return (
    <>
      {`${amount} ${text.label}`}
      {mark && (
        <span className={text.posesAs ? "token-mark token-mark--warn" : "token-mark"} data-testid="token-mark">
          {/* The mark is a clause, said here as a sentence: its full stop is the language's, not an ASCII one. */}
          {tr("common.sentence", { text: mark.charAt(0).toUpperCase() + mark.slice(1) })}
        </span>
      )}
    </>
  );
}

/** A review's row for a token amount (ReviewRows' Row, with TokenAmountText as its value). */
export function TokenAmountRow({ label, token, amount }: { label: string; token: TokenRef & { fingerprint?: string }; amount: string }) {
  return (
    <div className="review__row">
      <dt>{label}</dt>
      <dd>
        <TokenAmountText token={token} amount={amount} />
      </dd>
    </div>
  );
}
