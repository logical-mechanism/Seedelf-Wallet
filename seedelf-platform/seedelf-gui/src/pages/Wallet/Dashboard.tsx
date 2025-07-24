// default home screen dashboard
import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";
import { useNetwork } from "@/types/network";


export function Dashboard() {

    const { lovelace, history } = useOutletContext<OutletContextType>();
    const { network } = useNetwork();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <span>{lovelace} {network == "mainnet" ? "₳" : "t₳"}</span>
            <ul className="mt-4 text-gray-700 space-y-2">
                {history.slice(-5).reverse().map(h => (
                    <li key={`${h.tx.tx_hash}-${h.side}`}>
                        <strong>{h.side}</strong> – {h.tx.tx_hash} (height {h.tx.block_height})
                    </li>
                ))}
            </ul>
        </div>
    );
}
