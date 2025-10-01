import { useEffect, useMemo, useState } from "react";
import { AddressAsset } from "@/types/wallet";
// import { colorClasses } from "@/pages/Wallet/colors";

export type SelectedAssetOut = {
  fingerprint: string;
  amount: string;
};

type InternalSelection = Record<string, { amountBase: string }>;

export interface AssetSelectorModalProps {
  open: boolean;
  assets: AddressAsset[];
  onConfirm: (selected: SelectedAssetOut[]) => void; // called when user clicks "Select assets"
  onClose: () => void;                                // called on Cancel/close (no changes)
  initialSelection?: SelectedAssetOut[];              // rehydrate when reopened
  title?: string;
}

export function AssetSelectorModal({
  open,
  assets,
  onConfirm,
  onClose,
  initialSelection,
  title = "Select Assets",
}: AssetSelectorModalProps) {
  const [selection, setSelection] = useState<InternalSelection>({});

  // Build a quick lookup for max quantities by fingerprint
  const maxByFingerprint = useMemo(() => {
    const m: Record<string, { maxBase: bigint; decimals: number }> = {};
    for (const a of assets) {
      m[a.fingerprint] = { maxBase: BigInt(a.quantity || "0"), decimals: a.decimals ?? 0 };
    }
    return m;
  }, [assets]);

  // Rehydrate selection when modal opens
  useEffect(() => {
    if (!open) return;
    const next: InternalSelection = {};
    if (initialSelection?.length) {
      for (const s of initialSelection) {
        if (!s || !s.fingerprint) continue;
        const rec = maxByFingerprint[s.fingerprint];
        if (!rec) continue;
        const amt = safeBig(s.amount);
        const clamped = clampBig(amt, 0n, rec.maxBase);
        if (clamped > 0n) {
          next[s.fingerprint] = { amountBase: clamped.toString() };
        }
      }
    }
    setSelection(next);
  }, [open, initialSelection, maxByFingerprint]);

  const selectedCount = Object.keys(selection).length;

  const handleToggleAdd = (asset: AddressAsset) => {
    setSelection((prev) => {
      const current = { ...prev };
      if (current[asset.fingerprint]) {
        // remove
        delete current[asset.fingerprint];
      } else {
        // add with default amount: 1 (or 1 unit considering decimals)
        const baseUnitOne = toBaseUnits("1", asset.decimals);
        const max = safeBig(asset.quantity);
        const initial = max >= baseUnitOne ? baseUnitOne : max; // if NFT (1), set 1; if less, clamp
        if (initial > 0n) current[asset.fingerprint] = { amountBase: initial.toString() };
      }
      return current;
    });
  };

  const handleAmountChange = (asset: AddressAsset, humanAmount: string) => {
    setSelection((prev) => {
      const next = { ...prev };
      const max = safeBig(asset.quantity);
      const base = toBaseUnits(humanAmount, asset.decimals); // invalid strings become 0n
      const clamped = clampBig(base, 0n, max);
      if (clamped === 0n) {
        // keep the asset "selected" only if user explicitly toggled add; here, if zero, remove
        delete next[asset.fingerprint];
      } else {
        next[asset.fingerprint] = { amountBase: clamped.toString() };
      }
      return next;
    });
  };

  const allValid = useMemo(() => {
    // valid if every selected amount > 0 and <= max
    for (const fp of Object.keys(selection)) {
      const rec = maxByFingerprint[fp];
      if (!rec) return false;
      const amt = safeBig(selection[fp].amountBase);
      if (amt <= 0n || amt > rec.maxBase) return false;
    }
    return true;
  }, [selection, maxByFingerprint]);

  const confirm = () => {
    if (!allValid || selectedCount === 0) return;
    const out: SelectedAssetOut[] = Object.entries(selection).map(([fingerprint, { amountBase }]) => ({
      fingerprint,
      amount: amountBase,
    }));
    onConfirm(out);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative mx-4 max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            aria-label="Close"
          >
            Cancel
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4">
          {assets.length === 0 ? (
            <p className="text-sm text-zinc-600">No assets available for this address.</p>
          ) : (
            <ul
              className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
              role="list"
              aria-label="Asset list"
            >
              {assets.map((a) => {
                const added = !!selection[a.fingerprint];
                const maxBase = safeBig(a.quantity);
                const maxHuman = fromBaseUnits(maxBase, a.decimals);
                const currentHuman = added
                  ? fromBaseUnits(safeBig(selection[a.fingerprint].amountBase), a.decimals)
                  : "";

                const showAmount = maxBase > 1n; // only show amount if total quantity > 1 unit
                const step = a.decimals > 0 ? `0.${"0".repeat(a.decimals - 1)}1` : "1";

                return (
                  <li
                    key={a.fingerprint}
                    className="group rounded-2xl border p-4 shadow-sm transition hover:shadow-md"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                        {truncateMid(a.policy_id, 10)}
                      </span>
                      <span className="text-xs text-zinc-500">decimals: {a.decimals}</span>
                    </div>

                    <div className="mb-1 truncate font-medium">
                      {a.asset_name || truncateMid(a.fingerprint, 10)}
                    </div>
                    <div className="mb-3 text-sm text-zinc-600">
                      Quantity: <span className="font-mono">{maxHuman}</span>
                    </div>

                    {showAmount && (
                      <label className="mb-3 block text-sm">
                        <span className="mb-1 block text-zinc-700">Amount</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step={step}
                          min={0}
                          max={maxHuman}
                          placeholder={`0 – ${maxHuman}`}
                          value={currentHuman}
                          onChange={(e) => handleAmountChange(a, e.target.value)}
                          className={`w-full rounded-xl border px-3 py-2 font-mono text-sm outline-none transition
                            ${added ? "border-emerald-300 ring-1 ring-emerald-200" : "border-zinc-200"}
                            focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200`}
                        />
                        <span className="mt-1 block text-xs text-zinc-500">
                          Step: {step}, Max: {maxHuman}
                        </span>
                      </label>
                    )}

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => handleToggleAdd(a)}
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition
                          ${added
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"}`}
                        aria-pressed={added}
                      >
                        {added ? "Added" : "Add asset"}
                      </button>

                      {added && showAmount && (
                        <span className="text-xs text-emerald-700">
                          Selected:{" "}
                          {fromBaseUnits(safeBig(selection[a.fingerprint].amountBase), a.decimals)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <div className="text-sm text-zinc-600">
            {selectedCount} selected
            {selectedCount > 0 && !allValid && (
              <span className="ml-2 text-amber-600">Check amounts</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelection({})}
              className="rounded-xl px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!allValid || selectedCount === 0}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition
                ${allValid && selectedCount > 0
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "cursor-not-allowed bg-zinc-200 text-zinc-500"}`}
            >
              Select assets
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- utils ---------- */

function truncateMid(s: string, keep = 8) {
  if (!s) return "";
  if (s.length <= keep * 2 + 3) return s;
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

function safeBig(x?: string | number | bigint) {
  try {
    if (typeof x === "bigint") return x;
    if (typeof x === "number") return BigInt(Math.trunc(x));
    return BigInt(x || "0");
  } catch {
    return 0n;
  }
}

/** Convert a human string (e.g. "1.234") into base units (BigInt) using `decimals`. */
function toBaseUnits(human: string, decimals: number): bigint {
  if (!human || isNaN(Number(human))) return 0n;
  const [wholeRaw, fracRaw = ""] = String(human).trim().split(".");
  const negative = wholeRaw.startsWith("-") ? -1n : 1n;
  const whole = wholeRaw.replace("-", "") || "0";
  const frac = (fracRaw || "").slice(0, Math.max(0, decimals)); // cut extra
  const fracPadded = frac.padEnd(Math.max(0, decimals), "0");
  const base = BigInt(10) ** BigInt(decimals);
  const wholePart = safeBig(whole) * base;
  const fracPart = fracPadded ? safeBig(fracPadded) : 0n;
  return (wholePart + fracPart) * (negative < 0n ? -1n : 1n);
}

/** Convert base units (BigInt) to human string using `decimals`. */
function fromBaseUnits(base: bigint, decimals: number): string {
  const neg = base < 0n ? "-" : "";
  const v = base < 0n ? -base : base;
  const factor = BigInt(10) ** BigInt(decimals);
  const whole = v / factor;
  const frac = v % factor;
  if (decimals === 0) return `${neg}${whole.toString()}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg}${whole.toString()}${fracStr ? "." + fracStr : ""}`;
}

function clampBig(v: bigint, min: bigint, max: bigint) {
  return v < min ? min : v > max ? max : v;
}
