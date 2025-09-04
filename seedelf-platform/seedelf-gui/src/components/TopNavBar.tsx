import { useEffect, useState } from "react";
import { useNetwork, Network } from "@/types/network";
import { RefreshCw } from "lucide-react";
import Select from "react-select";

// tracks when the wallet was synced from koios
function formatAgo(ms: number) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ${sec % 60}s ago`;

  const d = Math.floor(hr / 24);
  return `${d}d ${hr % 24}h ${min % 60}m ${sec % 60}s ago`;
}

// colors here should match current color class well
const selectStyles = {
  control: (base: any, state: any) => ({
    ...base,
    backgroundColor: "#121212",
    borderColor: state.isFocused ? "#4338ca" : "#334155",
    boxShadow: "none",
    minHeight: "2rem",
    "&:hover": { borderColor: "#4338ca" },
  }),
  menu: (base: any) => ({
    ...base,
    backgroundColor: "#121212",
    border: "1px solid #334155",
    zIndex: 50,
  }),
  option: (base: any, state: any) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "#334155"
      : state.isFocused
        ? "#4338ca"
        : "#121212",
    color: "white",
    cursor: "pointer",
  }),
  singleValue: (base: any) => ({ ...base, color: "white" }),
  placeholder: (base: any) => ({ ...base, color: "#3f3f46" }),
  dropdownIndicator: (base: any, state: any) => ({
    ...base,
    color: state.isFocused ? "#3f3f46" : "#4338ca",
    "&:hover": { color: "#4338ca" },
  }),
  indicatorSeparator: () => ({ display: "none" }),
  valueContainer: (base: any) => ({ ...base, padding: "0 0.5rem" }),
};

export function TopNavBar({
  onLock,
  onRefresh,
  lovelace,
  lastSync,
}: {
  onLock: () => void;
  onRefresh: () => void;
  lovelace: number;
  lastSync: number | null;
}) {
  const { network, setNetwork } = useNetwork();
  const [ago, setAgo] = useState<string>("—");

  useEffect(() => {
    setAgo("—");
    if (lastSync === null) return;
    const tick = () => setAgo(formatAgo(Date.now() - lastSync));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastSync]);

  return (
    <header className="flex items-center justify-between h-14 px-4">
      <span className="font-semibold">Seedelf</span>

      <div className="flex items-center gap-8">
        <span>
          {lovelace} {network == "mainnet" ? "₳" : "t₳"}
        </span>

        <button
          onClick={onRefresh}
          className="rounded-xl border border-white px-3 py-1"
          title="Refresh the current UTxO set to sync with chain tip"
        >
          <RefreshCw />
        </button>
        <span
          className="text-sm text-gray-400"
          title="Time since the last wallet sync"
        >
          Last sync: {ago}
        </span>
      </div>
      <div className="flex items-center gap-8">
        <Select
          value={{
            value: network,
            label: network === "mainnet" ? "Mainnet" : "Pre-Production",
          }}
          onChange={(opt) => setNetwork(opt!.value as Network)}
          options={[
            { value: "mainnet", label: "Mainnet" },
            { value: "preprod", label: "Pre-Prod" },
          ]}
          styles={selectStyles}
        />

        <button
          onClick={onLock}
          className="rounded-xl border border-white px-3 py-1"
          title="Locking a wallet will force a password to unlock it"
        >
          Lock
        </button>
      </div>
    </header>
  );
}
