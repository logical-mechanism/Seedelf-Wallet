import { useEffect, useMemo, useRef, useState } from "react";
import { AddressAsset } from "@/types/wallet";
import { colorClasses } from "@/pages/Wallet/colors";

export type SelectedAssetOut = {
  fingerprint: string;
  amount: string; // base units as string (BigInt)
};

type InternalSelection = Record<string, { amountBase: string }>;

export interface AssetSelectorModalProps {
  open: boolean;
  assets: AddressAsset[];
  onConfirm: (selected: SelectedAssetOut[]) => void; // called when user clicks "Select assets"
  onClose: () => void; // called on Cancel/close (no changes)
  initialSelection?: SelectedAssetOut[]; // rehydrate when reopened
  title?: string;
  /** Lock background scroll (defaults true) */
  lockBodyScroll?: boolean;
  /** Show a search filter (defaults true) */
  enableSearch?: boolean;
}

export function AssetSelectorModal({
  open,
  assets,
  onConfirm,
  onClose,
  initialSelection,
  title = "Select Assets",
  lockBodyScroll = true,
  enableSearch = true,
}: AssetSelectorModalProps) {
  const [selection, setSelection] = useState<InternalSelection>({});
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Optional: lock the page scroll behind the modal
  useEffect(() => {
    if (!lockBodyScroll) return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open, lockBodyScroll]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Build a quick lookup for max quantities by fingerprint
  const maxByFingerprint = useMemo(() => {
    const m: Record<string, { maxBase: bigint; decimals: number }> = {};
    for (const a of assets) {
      m[a.fingerprint] = {
        maxBase: safeBig(a.quantity || "0"),
        decimals: a.decimals ?? 0,
      };
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

  // Filtered assets (by policy_id, asset_name, fingerprint)
  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => {
      return (
        a.policy_id.toLowerCase().includes(q) ||
        (a.asset_name || "").toLowerCase().includes(q) ||
        a.fingerprint.toLowerCase().includes(q)
      );
    });
  }, [assets, query]);

  const selectedCount = Object.keys(selection).length;

  const isNFT = (a: AddressAsset) =>
    (a.decimals ?? 0) === 0 && safeBig(a.quantity) === 1n;

  const handleAdd = (asset: AddressAsset) => {
    setSelection((prev) => {
      const current = { ...prev };
      if (current[asset.fingerprint]) return current; // already added
      // NFTs: auto-select amount 1 (no input is shown).
      if (isNFT(asset)) {
        current[asset.fingerprint] = { amountBase: "1" };
      } else {
        // Fungible: show input but don't prefill (store 0; UI shows blank).
        current[asset.fingerprint] = { amountBase: "0" };
      }
      return current;
    });
  };

  const handleClearOne = (asset: AddressAsset) => {
    setSelection((prev) => {
      const next = { ...prev };
      delete next[asset.fingerprint]; // hide input again for fungible; deselect NFT
      return next;
    });
  };

  const handleMax = (asset: AddressAsset) => {
    const max = safeBig(asset.quantity);
    setSelection((prev) => ({
      ...prev,
      [asset.fingerprint]: { amountBase: max.toString() },
    }));
  };

  const handleAmountChange = (asset: AddressAsset, humanAmount: string) => {
    setSelection((prev) => {
      const next = { ...prev };
      const max = safeBig(asset.quantity);
      const base = toBaseUnits(humanAmount, asset.decimals); // invalid strings become 0n
      const clamped = clampBig(base, 0n, max);
      if (clamped === 0n) {
        // User cleared to blank/zero => hide input again (remove selection)
        delete next[asset.fingerprint];
      } else {
        next[asset.fingerprint] = { amountBase: clamped.toString() };
      }
      return next;
    });
  };

  const allValid = useMemo(() => {
    if (selectedCount === 0) return false;
    for (const fp of Object.keys(selection)) {
      const rec = maxByFingerprint[fp];
      if (!rec) return false;
      const amt = safeBig(selection[fp].amountBase);
      if (amt <= 0n || amt > rec.maxBase) return false;
    }
    return true;
  }, [selection, maxByFingerprint, selectedCount]);

  const confirm = () => {
    if (!allValid || selectedCount === 0) return;
    const out: SelectedAssetOut[] = Object.entries(selection).map(
      ([fingerprint, { amountBase }]) => ({
        fingerprint,
        amount: amountBase,
      }),
    );
    onConfirm(out);
  };

  const clearAll = () => setSelection({});

  // Show "Select All (NFTs)" only if at least one NFT exists in current view
  const hasNFTsFiltered = useMemo(
    () => filteredAssets.some((a) => isNFT(a)),
    [filteredAssets],
  );

  const selectAllNFTs = () => {
    setSelection((prev) => {
      const next = { ...prev };
      for (const a of filteredAssets) {
        if (isNFT(a)) {
          next[a.fingerprint] = { amountBase: "1" };
        }
      }
      return next;
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-selector-title"
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-700/50" onClick={onClose} />

      {/* Panel */}
      <div
        className={`relative mx-4 w-full max-w-4xl overflow-hidden rounded-xl shadow-xl ${colorClasses.zinc.bg} flex max-h-[90vh] flex-col`}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4 bg-inherit">
          <h2 id="asset-selector-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${colorClasses.sky.bg}`}
              aria-label="Close"
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Optional search */}
        {enableSearch && (
          <div className="px-6 pt-3">
            <label className="block text-sm">
              <span className="mb-1 block">Search</span>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter by policy, name, or fingerprint…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 pr-20 text-sm outline-none transition border-zinc-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs border hover:bg-zinc-100"
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
            </label>
          </div>
        )}

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredAssets.length === 0 ? (
            <p className="text-sm text-zinc-600">
              {assets.length === 0
                ? "No assets available for this address."
                : "No assets match your filter."}
            </p>
          ) : (
            <ul
              className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2"
              role="list"
              aria-label="Asset list"
            >
              {filteredAssets.map((a) => {
                const added = !!selection[a.fingerprint];
                const maxBase = safeBig(a.quantity);
                const maxHuman = fromBaseUnits(maxBase, a.decimals);
                const nft = isNFT(a);

                // For fungible tokens, show blank input after Add (amountBase "0" renders as "")
                const amountBase = selection[a.fingerprint]?.amountBase;
                const amountIsZero = safeBig(amountBase ?? "0") === 0n;
                const currentHuman =
                  added && !nft && !amountIsZero
                    ? fromBaseUnits(safeBig(amountBase), a.decimals)
                    : "";

                const step =
                  a.decimals > 0 ? `0.${"0".repeat(a.decimals - 1)}1` : "1";

                return (
                  <li
                    key={a.fingerprint}
                    className="group rounded-xl border p-4 shadow-sm transition hover:shadow-md"
                  >
                    <div className="mb-2 flex">
                      <span className="rounded-xl text-xs">
                        {truncateMid(a.policy_id, 22)}
                      </span>
                    </div>

                    <div className="mb-1 truncate font-medium">
                      {a.asset_name || truncateMid(a.fingerprint, 10)}
                    </div>

                    <div className="mb-3 text-sm">
                      Quantity: <span className="font-mono">{maxHuman}</span>
                    </div>

                    {/* Amount input:
                        - Hidden for NFTs.
                        - Hidden for fungible until "Add asset" is clicked.
                        - After Add, shown but blank (no default 1). */}
                    {!nft && added && (
                      <label className="mb-3 block text-sm">
                        <span className="mb-1 block">Amount</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            onWheel={(e) =>
                              (e.currentTarget as HTMLInputElement).blur()
                            }
                            step={step}
                            min={0}
                            max={maxHuman}
                            placeholder="0"
                            value={currentHuman}
                            onChange={(e) =>
                              handleAmountChange(a, e.target.value)
                            }
                            className={`w-full rounded-xl border px-3 py-2 font-mono text-sm outline-none transition
                              ${
                                added
                                  ? "border-emerald-300 ring-1 ring-emerald-200"
                                  : "border-zinc-200"
                              }
                              focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200`}
                          />
                          <button
                            type="button"
                            onClick={() => handleMax(a)}
                            className="rounded-xl border px-2.5 py-2 text-xs hover:bg-zinc-100"
                            title="Use full balance"
                          >
                            Max
                          </button>
                        </div>
                      </label>
                    )}

                    <div className="flex items-center justify-between">
                      {!added ? (
                        <button
                          type="button"
                          onClick={() => handleAdd(a)}
                          className="rounded-xl px-3 py-2 text-sm font-medium transition bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                          aria-pressed={false}
                        >
                          Add asset
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
                            Added
                          </span>
                          <button
                            type="button"
                            onClick={() => handleClearOne(a)}
                            className="rounded-xl px-3 py-2 text-sm border hover:bg-zinc-100"
                            title="Clear this selection"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer (sticky) */}
        <div className="sticky bottom-0 z-10 border-t bg-inherit px-6 py-4">
          <div className="grid grid-cols-3 items-center">
            {/* Left: status */}
            <div className="text-sm">{selectedCount} selected</div>

            {/* Middle: Clear + Select All (NFTs, only if present) */}
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={clearAll}
                className="rounded-xl px-3 py-2 text-sm border hover:bg-zinc-100"
              >
                Clear
              </button>
              {hasNFTsFiltered && (
                <button
                  type="button"
                  onClick={selectAllNFTs}
                  className="rounded-xl px-3 py-2 text-sm border hover:bg-zinc-100"
                  title="Select all 1-of-1 NFTs"
                >
                  Select All (NFTs)
                </button>
              )}
            </div>

            {/* Right: Confirm */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={confirm}
                disabled={!allValid}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition
                  ${
                    allValid
                      ? `${colorClasses.indigo.bg}`
                      : `cursor-not-allowed ${colorClasses.zinc.bg}`
                  }`}
              >
                Select assets
              </button>
            </div>
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
