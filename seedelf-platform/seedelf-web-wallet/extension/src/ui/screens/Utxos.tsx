// UTxOs: one balance's UTxOs, locked ones first, then largest first, from the
// last reading (no requests). A UTxO opens its details, where it can be
// locked: a locked UTxO is left out of every payment on its side, Max
// included. The Cardano account's collateral is listed too, and reclaimed in
// Settings; a seedelf's UTxO only ever moves when the seedelf is removed.

import { useEffect, useMemo, useState } from "react";

import type { UtxoInfo, UtxoLists, UtxoSide } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyField } from "../components/CopyField";
import { CoinsIcon, LockIcon, LockOpenIcon, SproutIcon, VaultIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { formatAda, formatQuantity, plural, shortHex, tokenKey } from "../format";
import { useNetwork } from "../network";
import { tokenLabel } from "../tokens";

const ref = (u: UtxoInfo) => `${u.txHash}#${u.index}`;

/** What a UTxO is kept for, if anything. */
function tag(u: UtxoInfo): string | undefined {
  if (u.seedelf) return "Seedelf";
  if (u.collateral) return "Collateral";
  if (u.locked) return "Locked";
  return undefined;
}

function Icon({ u }: { u: UtxoInfo }) {
  if (u.seedelf) return <SproutIcon size={16} />;
  if (u.collateral) return <VaultIcon size={16} />;
  if (u.locked) return <LockIcon size={16} />;
  return <CoinsIcon size={16} />;
}

export function Utxos({ of, onBack, onChanged }: { of: UtxoSide; onBack: () => void; onChanged: () => void }) {
  const [lists, setLists] = useState<UtxoLists>();
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    call("utxos", {}).then(setLists, (e: Error) => setError(e.message));
  }, []);

  // Locked ones first, so they're found among hundreds; each group largest first, as the worker sends them.
  const list = useMemo(() => {
    const all = lists?.[of];
    return all && [...all.filter((u) => tag(u)), ...all.filter((u) => !tag(u))];
  }, [lists, of]);
  const locked = list?.filter((u) => u.locked && !u.seedelf).length ?? 0;
  const shown = list?.find((u) => ref(u) === open);

  async function setLocked(u: UtxoInfo, lock: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      setLists(await call("utxo-lock", { of, utxo: ref(u), locked: lock }));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={of === "seedelf" ? "Seedelf UTxOs" : "Cardano account UTxOs"}
      titleId="utxos-title"
      onBack={onBack}
      aside={list ? `${plural(list.length, "UTxO")}${locked ? ` · ${locked} locked` : ""}` : " "}
      error={shown ? undefined : error}
    >
      <p className="note">Lock a UTxO to keep it out of every payment from this balance, Max included.</p>
      {of === "seedelf" && (
        <Callout tone="privacy">
          Only this wallet can tell these are yours. Looking one up on an explorer tells that site which UTxO you care
          about.
        </Callout>
      )}
      {list === undefined ? (
        <p className="note center empty">{error ? "" : "Reading…"}</p>
      ) : list.length === 0 ? (
        <p className="note center empty">No UTxOs yet.</p>
      ) : (
        <section className="section" aria-labelledby="utxos-title">
          <ul className="list" data-testid="utxos">
            {list.map((u) => (
              <li key={ref(u)}>
                <button
                  type="button"
                  className="token-row"
                  onClick={() => setOpen(ref(u))}
                  aria-label={`${formatAda(u.lovelace)} ₳${tag(u) ? `, ${tag(u)!.toLowerCase()}` : ""}, ${shortHex(u.txHash)}#${u.index}`}
                >
                  <span className={`avatar activity__icon${tag(u) ? " utxo__icon--kept" : ""}`}>
                    <Icon u={u} />
                  </span>
                  <span className="token-row__label">
                    {formatAda(u.lovelace)} ₳{u.tokens.length ? ` and ${plural(u.tokens.length, "token")}` : ""}
                  </span>
                  <span className="token-row__amount">{tag(u) && <span className="utxo-tag">{tag(u)}</span>}</span>
                  <span className="token-row__sub">
                    {shortHex(u.txHash, 8, 4)}#{u.index}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {shown && (
        <UtxoDetails
          utxo={shown}
          busy={busy}
          error={error}
          onLock={(lock) => void setLocked(shown, lock)}
          onClose={() => {
            setOpen(undefined);
            setError(undefined);
          }}
        />
      )}
    </Screen>
  );
}

function UtxoDetails({
  utxo,
  busy,
  error,
  onLock,
  onClose,
}: {
  utxo: UtxoInfo;
  busy: boolean;
  error?: string;
  onLock: (lock: boolean) => void;
  onClose: () => void;
}) {
  const network = useNetwork();
  const lockable = !utxo.seedelf && !utxo.collateral;
  const foot = lockable ? (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className={utxo.locked ? "secondary" : "primary"} onClick={() => onLock(!utxo.locked)} disabled={busy}>
        {utxo.locked ? <LockOpenIcon size={16} /> : <LockIcon size={16} />}
        {busy ? "Saving…" : utxo.locked ? "Unlock" : "Lock"}
      </button>
    </>
  ) : undefined;
  return (
    <Modal title={`${formatAda(utxo.lovelace)} ₳`} titleId="utxo-details-title" onClose={onClose} foot={foot}>
      <div className="stack" data-testid="utxo-details">
        {utxo.seedelf ? (
          <Callout tone="info">
            It holds your seedelf <strong>{utxo.seedelf}</strong>. Only removing the seedelf spends it.
          </Callout>
        ) : utxo.collateral ? (
          <Callout tone="info" testId="utxo-collateral">
            Your collateral: put up by transactions that run a script, and otherwise kept. Reclaim it in Settings, under
            Collateral.
          </Callout>
        ) : (
          <p className="note" data-testid="utxo-state">
            {utxo.locked ? "Locked: left out of every payment." : "Spent by payments as needed."}
          </p>
        )}
        {utxo.tokens.length > 0 && (
          <ReviewRows testId="utxo-tokens">
            {utxo.tokens.map((t, i) => (
              <Row key={tokenKey(t)} label={i === 0 ? "Tokens" : ""} value={`${formatQuantity(t.quantity, t.decimals)} ${tokenLabel(network, t)}`} />
            ))}
          </ReviewRows>
        )}
        <CopyField label="Transaction" value={utxo.txHash} display={shortHex(utxo.txHash, 14, 8)} testId="utxo-tx" />
        <ReviewRows testId="utxo-output">
          <Row label="Output" value={String(utxo.index)} />
          {utxo.blockHeight !== undefined && <Row label="Block" value={utxo.blockHeight.toLocaleString("en-GB")} />}
        </ReviewRows>
        {utxo.address && (
          <CopyField label="Address" value={utxo.address} display={shortHex(utxo.address, 16, 8)} testId="utxo-address" />
        )}
      </div>
    </Modal>
  );
}
