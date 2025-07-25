import { useState, useMemo } from "react";
import { useOutletContext, NavLink } from "react-router";
import { OutletContextType } from "@/types/layout";
import { ShowNotification } from "@/components/ShowNotification";
import { useNetwork } from "@/types/network";
import { ArrowUpRight, ArrowDownLeft, Link, Copy, Ellipsis, BanknoteArrowUp } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

function txUrl(txHash: string, network: string) {
    return network === "mainnet"
        ? `https://cardanoscan.io/transaction/${txHash}`
        : `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

export function Dashboard() {
    const [message, setMessage] = useState<string | null>(null);
    const { lovelace, seedelfs, history } = useOutletContext<OutletContextType>();
    const { network } = useNetwork();
    const recent = history.slice(-5).reverse();
    const elves = useMemo(
        () => [...seedelfs].sort(() => Math.random() - 0.5).slice(0, 3),
        [seedelfs]
    );


    const copy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setMessage(`${text} has been copied`);
    };

    return (
        <div className="mt-8 p-6 grid gap-8 grid-cols-1 md:grid-cols-2">
            <ShowNotification message={message} setMessage={setMessage} variant={'info'} />
            {/* Left column */}
            <div className="space-y-6 flex flex-col items-center">
                <span className="text-3xl font-semibold mb-8">
                    {lovelace} {network === "mainnet" ? "₳" : "t₳"}
                </span>
                    
                <div className="flex gap-16">
                    <NavLink
                        to="send"
                        className="flex flex-col items-center text-indigo-600 hover:text-indigo-700 hover:scale-105"
                    >
                        <div className="p-3 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition">
                            <ArrowUpRight className="w-10 h-10" />
                        </div>
                        <span className="mt-1 text-xs font-medium">Send</span>
                    </NavLink>

                    <NavLink
                        to="receive"
                        className="flex flex-col items-center text-teal-600 hover:text-teal-700 hover:scale-105"
                    >
                        <div className="p-3 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition">
                            <ArrowDownLeft className="w-10 h-10" />
                        </div>
                        <span className="mt-1 text-xs font-medium">Receive</span>
                    </NavLink>

                    <NavLink
                        to="fund"
                        className="flex flex-col items-center text-pink-600 hover:text-pink-700 hover:scale-105"
                    >
                        <div className="p-3 rounded-lg bg-pink-600 text-white hover:bg-pink-700 transition">
                            <BanknoteArrowUp className="w-10 h-10" />
                        </div>
                        <span className="mt-1 text-xs font-medium">Add Funds</span>
                    </NavLink>
                </div>

                <div className={`${elves.length === 0 ? "" : "border rounded"}`}>
                    {elves.length === 0 ? (
                        <p className="text-white">No Seedelfs Available.</p>
                    ) : (
                        <ul className="space-y-3 text-white m-4">
                            {elves.map(h => (
                                <li key={`${h}`} className="m-4 text-center p-4">
                                    <div className="gap-4">
                                        <code className={`font-bold items-center gap-1 m-4`}>
                                            {h}
                                        </code>
                                        <button
                                            onClick={() => copy(h)}
                                            className="hover:scale-105"
                                        >
                                            <Copy />
                                        </button>
                                    </div>
                                </li>
                            ))}
                            <li>
                                <NavLink
                                    to="manage"
                                    className="flex flex-col items-center text-zinc-600 hover:text-zinc-700 hover:scale-105"
                                >
                                    <div className="p-3 rounded-lg bg-zinc-600 text-white hover:bg-zinc-700 transition">
                                        <Ellipsis />
                                    </div>
                                    <span className="mt-1 text-xs font-medium">Manage</span>
                                </NavLink>
                            </li>
                        </ul>
                    )}
                </div>
            </div>

            {/* Right column */}
            <div>
                {recent.length === 0 ? (
                    <p className="text-white">No Transactions Available.</p>
                ) : (
                    <ul className="space-y-3 text-white">
                        {recent.map(h => (
                            <li key={`${h.tx.tx_hash}-${h.side}`} className="mb-4 border rounded text-center p-4">
                                <span className={`font-bold flex items-center gap-1 mb-4 ${h.side === "Input" ? "text-indigo-400" : "text-teal-400"}`}>
                                    {h.side === "Input" ? <ArrowUpRight /> : <ArrowDownLeft />}{h.side === "Input" ? "Sent Funds" : "Received Funds"}
                                </span>
                                <div className="gap-4">
                                    <span className={`font-semibold mr-8 ${h.side === "Input" ? "text-indigo-400" : "text-teal-400"}`}>{h.side}</span>
                                    <code className="pr-4">{h.tx.tx_hash}</code>
                                    <button
                                        onClick={() => openUrl(txUrl(h.tx.tx_hash, network))}
                                        className="hover:scale-105 pr-4"
                                    >
                                        <Link />
                                    </button>
                                    <button
                                        onClick={() => copy(h.tx.tx_hash)}
                                        className="hover:scale-105"
                                    >
                                        <Copy />
                                    </button>
                                </div>
                            </li>
                        ))}
                        <li>
                            <NavLink
                                to="history"
                                className="flex flex-col items-center text-slate-600 hover:text-slate-700 hover:scale-105"
                            >
                                <div className="p-3 rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition">
                                    <Ellipsis />
                                </div>
                                <span className="mt-1 text-xs font-medium">History</span>
                            </NavLink>
                        </li>
                    </ul>
                )}
            </div>

        </div>
    );
}
