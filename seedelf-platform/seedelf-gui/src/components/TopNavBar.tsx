import { useNetwork, Network } from "@/types/network";
import { RefreshCw } from "lucide-react";
import Select from "react-select";

const selectStyles = {
  control: (base: any, state: any) => ({
    ...base,
    backgroundColor: "#121212",
    borderColor: state.isFocused ? "#6366f1" : "#374151",
    boxShadow: "none",
    minHeight: "2rem",
    "&:hover": { borderColor: "#6366f1" },
  }),
  menu: (base: any) => ({
    ...base,
    backgroundColor: "#121212",
    border: "1px solid #374151",
    zIndex: 50,
  }),
  option: (base: any, state: any) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "#6366f1"
      : state.isFocused
      ? "#374151"
      : "#121212",
    color: "white",
    cursor: "pointer",
  }),
  singleValue: (base: any) => ({ ...base, color: "white" }),
  placeholder: (base: any) => ({ ...base, color: "#9ca3af" }),
  dropdownIndicator: (base: any, state: any) => ({
    ...base,
    color: state.isFocused ? "#6366f1" : "#9ca3af",
    "&:hover": { color: "#6366f1" },
  }),
  indicatorSeparator: () => ({ display: "none" }),
  valueContainer: (base: any) => ({ ...base, padding: "0 0.5rem" }),
};

export function TopNavBar({ onLock, onRefresh, lovelace }: { onLock: () => void, onRefresh: () => void, lovelace: number }) {
    const { network, setNetwork } = useNetwork();
    return (
        <header className="flex items-center justify-between h-14 px-4 shadow">
            <span className="font-semibold">Seedelf: A Cardano Stealth Wallet</span>

            <div className="flex items-center gap-8">
                <span>{lovelace} {network == "mainnet" ? "₳" : "t₳"}</span>

                <button
                    onClick={onRefresh}
                    className="rounded border border-white px-3 py-1"
                >
                    <RefreshCw />
                </button>
            </div>
            <div className="flex items-center gap-8">
                <Select
                    value={{ value: network, label: network === "mainnet" ? "Mainnet" : "Pre-Production" }}
                    onChange={(opt) => setNetwork(opt!.value as Network)}
                    options={[
                        { value: "mainnet", label: "Mainnet" },
                        { value: "preprod", label: "Pre-Prod" },
                    ]}
                    styles={selectStyles}
                />

                <button
                    onClick={onLock}
                    className="rounded border border-white px-3 py-1"
                >
                    Lock
                </button>
            </div>
        </header>
    );
}
