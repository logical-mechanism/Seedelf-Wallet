import { useOutletContext, NavLink } from "react-router";
import { OutletContextType } from "@/types/layout";
import { useNetwork } from "@/types/network";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

function txUrl(txHash: string, network: string) {
    return network === "mainnet"
        ? `https://cardanoscan.io/transaction/${txHash}`
        : `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

export function Dashboard() {
    const { lovelace, history } = useOutletContext<OutletContextType>();
    const { network } = useNetwork();
    const recent = history.slice(-5).reverse();

    return (
        <div className="mt-8 p-6 grid gap-8 grid-cols-1 md:grid-cols-2">
            {/* Left column */}
            <div className="space-y-6 flex flex-col items-center">
                <span className="text-3xl font-semibold text-center">
                    {lovelace} {network === "mainnet" ? "₳" : "t₳"}
                </span>

                <div className="flex gap-16">
                    <NavLink
                        to="send"
                        className="flex flex-col items-center text-blue-600 hover:text-blue-700 hover:scale-105"
                    >
                        <div className="p-3 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition">
                            <ArrowUpRight className="w-10 h-10" />
                        </div>
                        <span className="mt-1 text-xs font-medium">Send</span>
                    </NavLink>

                    <NavLink
                        to="receive"
                        className="flex flex-col items-center text-green-600 hover:text-green-700 hover:scale-105"
                    >
                        <div className="p-3 rounded-full bg-green-600 text-white hover:bg-green-700 transition">
                            <ArrowDownLeft className="w-10 h-10" />
                        </div>
                        <span className="mt-1 text-xs font-medium">Receive</span>
                    </NavLink>
                </div>
            </div>

            {/* Right column */}
            <div>
                {recent.length === 0 ? (
                    <p className="text-white">No Transactions Available.</p>
                ) : (
                    <ul className="space-y-3 text-white">
                        {recent.map(h => (
                            <li key={`${h.tx.tx_hash}-${h.side}`}>
                                <span className="font-semibold mr-2">{h.side}</span>
                                <button
                                    onClick={() => openUrl(txUrl(h.tx.tx_hash, network))}
                                    className="underline text-blue-400 hover:text-blue-500"
                                >
                                    {h.tx.tx_hash}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

        </div>
    );
}
