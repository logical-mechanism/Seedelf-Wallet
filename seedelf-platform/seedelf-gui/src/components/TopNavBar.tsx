import { useNetwork, Network } from "@/types/network";
import { RefreshIcon } from "./RefreshIcon";

export function TopNavBar({ onLock, onRefresh, lovelace }: { onLock: () => void, onRefresh: () => void, lovelace: number }) {
    const { network, setNetwork } = useNetwork();
    return (
        <header className="flex items-center justify-between h-14 px-4 shadow">
            <span className="font-semibold">Seedelf</span>

            <div className="flex items-center gap-8">
                <span>{lovelace} {network == "mainnet" ? "₳" : "t₳"}</span>

                <button
                    onClick={onRefresh}
                    className="rounded border border-white px-3 py-1"
                >
                    <RefreshIcon />
                </button>
            </div>
            <div className="flex items-center gap-8">
                <select className="rounded border px-2 py-1 text-sm text-black" value={network} onChange={(e) => setNetwork(e.target.value as Network)}>
                    <option value="mainnet" selected>Mainnet</option>
                    <option value="preprod">Preprod</option>
                </select>

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
