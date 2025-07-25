import { useState, useMemo } from "react";
import { useOutletContext, NavLink } from "react-router";
import { OutletContextType } from "@/types/layout";
import { ShowNotification } from "@/components/ShowNotification";
import { useNetwork } from "@/types/network";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Link,
  Copy,
  Ellipsis,
  BanknoteArrowUp,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { colorClasses } from "./colors";

function txUrl(txHash: string, network: string) {
  return network === "mainnet"
    ? `https://cardanoscan.io/transaction/${txHash}`
    : `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

function IconAction({
  to,
  color,
  icon,
  label,
}: {
  to: string;
  color: string;
  icon: React.ReactNode;
  label: string;
}) {
  const c = colorClasses[color];
  return (
    <NavLink
      to={to}
      className={`flex flex-col items-center ${c.text} hover:scale-105`}
    >
      <div className={`p-3 rounded-lg text-white ${c.bg} transition`}>
        {icon}
      </div>
      <span className="mt-1 text-xs font-medium">{label}</span>
    </NavLink>
  );
}

export function Dashboard() {
  const [message, setMessage] = useState<string | null>(null);
  const { lovelace, seedelfs, history } = useOutletContext<OutletContextType>();
  const { network } = useNetwork();
  const recent = history.slice(-5).reverse();
  const elves = useMemo(
    () => [...seedelfs].sort(() => Math.random() - 0.5).slice(0, 3),
    [seedelfs],
  );

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setMessage(`${text} has been copied`);
  };

  return (
    <div className="mt-8 p-6 grid gap-8 grid-cols-1 min-[960px]:grid-cols-2">
      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={"info"}
      />
      {/* Left column */}
      <div className="space-y-6 flex flex-col w-full items-center">
        <span className="text-3xl font-semibold mb-8">
          {lovelace} {network === "mainnet" ? "₳" : "t₳"}
        </span>

        <div className="flex gap-16">
          <IconAction
            to="send"
            color="indigo"
            icon={<ArrowUpRight className="w-10 h-10" />}
            label="Send"
          />
          <IconAction
            to="receive"
            color="teal"
            icon={<ArrowDownLeft className="w-10 h-10" />}
            label="Receive"
          />
          <IconAction
            to="fund"
            color="pink"
            icon={<BanknoteArrowUp className="w-10 h-10" />}
            label="Add Funds"
          />
        </div>

        <div className={`${elves.length === 0 ? "" : "border rounded w-full"}`}>
          {elves.length === 0 ? (
            <p className="text-white">No Seedelfs Available.</p>
          ) : (
            <ul className="space-y-3 text-white m-4 w-full max-[960px]:hidden">
              {elves.map((h) => (
                <li key={`${h}`} className="m-4 p-4">
                  <div className="flex items-center gap-2 w-full min-w-0">
                    <code className="min-w-0 truncate font-bold pr-16">
                      {h}
                    </code>
                    <button
                      type="button"
                      title="Copy"
                      aria-label="Copy Seedelf Token name"
                      onClick={() => copy(h)}
                      className="hover:scale-105"
                    >
                      <Copy />
                    </button>
                  </div>
                </li>
              ))}
              <li>
                <IconAction
                  to="manage"
                  color="zinc"
                  icon={<Ellipsis className="w-5 h-5" />}
                  label="Manage"
                />
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
          <ul className="space-y-3 text-white w-full max-[960px]:hidden">
            {recent.map((h) => (
              <li
                key={`${h.tx.tx_hash}-${h.side}`}
                className="mb-4 border rounded text-center p-4"
              >
                <span
                  className={`font-bold flex items-center gap-1 mb-4 ${h.side === "Input" ? "text-indigo-400" : "text-teal-400"}`}
                >
                  {h.side === "Input" ? <ArrowUpRight /> : <ArrowDownLeft />}
                  {h.side === "Input" ? "Sent Funds" : "Received Funds"}
                </span>
                <div className="gap-1 flex w-full min-w-0">
                  <span
                    className={`font-semibold mr-4 ${h.side === "Input" ? "text-indigo-400" : "text-teal-400"}`}
                  >
                    {h.side}
                  </span>
                  <code className="pr-4 min-w-0 truncate ">{h.tx.tx_hash}</code>
                  <button
                    type="button"
                    title="Link"
                    aria-label="Open on Cardanoscan"
                    onClick={() => openUrl(txUrl(h.tx.tx_hash, network))}
                    className="hover:scale-105 pr-4"
                  >
                    <Link />
                  </button>
                  <button
                    type="button"
                    title="Copy"
                    aria-label="Copy Transaction Id"
                    onClick={() => copy(h.tx.tx_hash)}
                    className="hover:scale-105"
                  >
                    <Copy />
                  </button>
                </div>
              </li>
            ))}
            <li>
              <IconAction
                to="history"
                color="slate"
                icon={<Ellipsis className="w-5 h-5" />}
                label="History"
              />
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
