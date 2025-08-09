import { useState, useMemo, useEffect } from "react";
import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { Copy, CircleQuestionMark, Link } from "lucide-react";
import { TextField } from "@/components/TextField";
import { colorClasses } from "./colors";
import { seedelfPolicyId } from "./api";
import { useNetwork, Network } from "@/types/network";
import { openUrl } from "@tauri-apps/plugin-opener";

export function Receive() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");
  const { ownedSeedelfs } = useOutletContext<OutletContextType>();
  const [query, setQuery] = useState("");
  const { network } = useNetwork();
  const [policyId, setPolicyId] = useState<string>("");

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setVariant("info");
    setMessage(`${text} has been copied`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ownedSeedelfs;
    return ownedSeedelfs.filter((h) => h.toLowerCase().includes(q));
  }, [ownedSeedelfs, query]);

  const tokenUrl = (seedelf: string, network: Network) => {
    return network === "mainnet"
      ? `https://cardanoscan.io/token/${policyId}${seedelf}`
      : `https://preprod.cardanoscan.io/token/${policyId}${seedelf}`;
  };

  useEffect(() => {
    let isMounted = true;
    seedelfPolicyId(network).then((id) => {
      if (isMounted) setPolicyId(id);
    });
    return () => {
      isMounted = false;
    };
  }, [network]);

  return (
    <div className="p-6 w-full">
      <h1 className="text-xl font-semibold text-center">Receive</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <div className={`rounded w-full my-12`}>
        <div className="flex flex-grow items-center gap-2 mx-auto w-full max-w-3/8">
          <button
            disabled
            title="Seedelfs act like addresses inside the wallet. Other users may send funds to a seedelf."
            className="mt-5"
          >
            <CircleQuestionMark />
          </button>
          <div className="flex-1">
            <TextField
              label="Search"
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
              }}
              className="w-full"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
            }}
            className={`rounded ${colorClasses.slate.bg} px-4 py-2 mt-6 text-sm text-white disabled:opacity-50`}
          >
            Clear
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-white text-center mt-12">No Seedelfs Available.</p>
        ) : (
          <ul className="space-y-3 text-white m-4 mx-auto w-full">
            {filtered.map((h) => (
              <li key={`${h}`} className="m-4 p-4">
                <div className="flex items-center justify-center gap-2 w-full min-w-0">
                  <code className="min-w-0 truncate font-bold pr-16">{h}</code>
                  <button
                    type="button"
                    title="Copy"
                    aria-label="Copy Seedelf Token name"
                    onClick={() => copy(h)}
                    className="hover:scale-105"
                  >
                    <Copy />
                  </button>
                  <button
                    type="button"
                    title={tokenUrl(h, network)}
                    aria-label="Open on Cardanoscan"
                    onClick={() => openUrl(tokenUrl(h, network))}
                    className="hover:scale-105 pl-4"
                  >
                    <Link />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
