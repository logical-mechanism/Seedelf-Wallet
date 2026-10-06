// Tokens as rows: the logo (or two letters), the ticker or name with a second
// line, and the amount. Tapping one opens its details. Home shows the first
// few and a way to all of them (screens/Tokens.tsx). An NFT's image is shown
// only once the user asks for it in its details (NftImage.tsx), and from then
// until the wallet locks it's its avatar too.

import { useMemo, useState } from "react";
import { currentLanguage, joinList, useT } from "../../i18n";

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

/**
 * `coming`: some of it is on its way back, with a payment's change, and the
 * row says so rather than the token vanishing until it confirms (chunk 23's
 * second review, HM-1).
 */
export function TokenRow({ view, coming, onOpen }: { view: TokenView; coming?: boolean; onOpen: (view: TokenView) => void }) {
  const tr = useT();
  const amount = useAmounts().text(view.amount);
  return (
    <li>
      <button
        type="button"
        className="token-row"
        onClick={() => onOpen(view)}
        aria-label={joinList(view.warn ? [view.label, amount, view.sub] : [view.label, amount])}
        title={tr("tokenList.details", { label: view.label })}
      >
        <TokenAvatar view={view} />
        <span className="token-row__label">{view.label}</span>
        <span className="token-row__amount">{amount}</span>
        <span className={view.warn ? "token-row__sub wrap token-row__sub--warn" : "token-row__sub"}>
          {coming ? joinList([tr("tokenList.onItsWay"), view.sub]) : view.sub}
        </span>
      </button>
    </li>
  );
}

/**
 * What a token's details can start, with the token picked: a payment from the
 * balance it's in (Send), or moving it to the other side (Make private, Make
 * public). Before chunk 23 the details were a dead end (the review's T-1).
 */
export type TokenAction = "send" | "move";

/** Home's tokens: fungible ones first, by name, then NFTs; the first five, and View all. */
export function TokenList({
  tokens,
  of,
  testId,
  coming,
  blocked,
  onViewAll,
  onAction,
}: {
  tokens: TokenAmount[];
  /** Whose tokens: what showing an NFT's image reveals depends on it. */
  of: "seedelf" | "cardano";
  testId: string;
  /** The tokens (`tokenKey`) some of which are on their way back. */
  coming?: ReadonlySet<string>;
  /** Why a token's details can't start a payment now, when that's the one transaction at a time. */
  blocked?: string;
  onViewAll: () => void;
  /** A token's details start a payment with it, when one can be made now. */
  onAction?: (action: TokenAction, token: TokenAmount) => void;
}) {
  const tr = useT();
  const network = useNetwork();
  const [open, setOpen] = useState<TokenView>();
  // A view's second line can be words (a lookalike's warning): another page's switch of language makes them again.
  const language = currentLanguage();
  const views = useMemo(() => {
    const sorted = sortTokens(
      tokens.map((t) => viewToken(network, t)),
      "name",
    );
    return [...sorted.filter((v) => !v.nft), ...sorted.filter((v) => v.nft)];
  }, [network, tokens, language]);
  if (!views.length) return null;
  return (
    <div className="stack-tight" data-testid={testId}>
      <ul className="list">
        {views.slice(0, PREVIEW).map((v) => (
          <TokenRow key={tokenKey(v.token)} view={v} coming={coming?.has(tokenKey(v.token))} onOpen={setOpen} />
        ))}
      </ul>
      {views.length > PREVIEW && (
        <button type="button" className="view-all" onClick={onViewAll}>
          {tr("tokenList.viewAll", { number: views.length })}
          <ChevronRightIcon size={16} />
        </button>
      )}
      {open && <TokenDetails view={open} of={of} onClose={() => setOpen(undefined)} onAction={onAction} blocked={blocked} />}
    </div>
  );
}

/**
 * A token's details, in a modal: what it is, how much, and the ids that
 * identify it, each with Copy. An NFT's image is offered here, and only here.
 * `of`: whose token it is, the private balance's or the public account's.
 */
export function TokenDetails({
  view,
  of,
  onClose,
  onAction,
  blocked,
}: {
  view: TokenView;
  of: "seedelf" | "cardano";
  onClose: () => void;
  onAction?: (action: TokenAction, token: TokenAmount) => void;
  /** Why there's no Send or Make private here now: said, where the buttons were (chunk 23's second review, HM-3). */
  blocked?: string;
}) {
  const tr = useT();
  const t = view.token;
  const amounts = useAmounts();
  const start = (action: TokenAction) => {
    onClose();
    onAction?.(action, t);
  };
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
        {!onAction && blocked && (
          <p className="note" data-testid="token-actions-blocked">
            {blocked}
          </p>
        )}
        {onAction && (
          <div className="actions" data-testid="token-actions">
            <button type="button" className="primary primary--compact" onClick={() => start("send")}>
              {tr("home.action.send")}
            </button>
            <button type="button" className="secondary primary--compact" onClick={() => start("move")}>
              {tr(of === "cardano" ? "home.action.makePrivate" : "home.action.makePublic")}
            </button>
          </div>
        )}
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
