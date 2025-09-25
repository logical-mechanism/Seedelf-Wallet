import { useState, useMemo, useEffect } from "react";
import { useOutletContext } from "react-router";
import { Copy, CircleQuestionMark, Link } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OutletContextType } from "@/types/layout";
import { useNetwork, Network } from "@/types/network";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { TextField } from "@/components/TextField";
import { ToTopButton } from "@/components/ToTopButton";
import { colorClasses } from "./colors";
import { seedelfPolicyId } from "./api";
import { display_ascii } from "./util";

export function Receive() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");
  const [query, setQuery] = useState("");
  const [policyId, setPolicyId] = useState<string>("");

  const { ownedSeedelfs } = useOutletContext<OutletContextType>();

  const { network } = useNetwork();

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setVariant("info");
    setMessage(`${text} has been copied`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ownedSeedelfs;
    // this needs to account for hex search and ascii search
    return ownedSeedelfs.filter(
      (h) =>
        h.toLowerCase().includes(q) ||
        display_ascii(h)?.toLowerCase().includes(q),
    );
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
      <button
        disabled
        title="Use one of these seedelfs to receive funds."
        className=""
      >
        <CircleQuestionMark />
      </button>
      <h1 className="text-xl font-semibold text-center">Receive</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <div className={`rounded-xl w-full my-12`}>
        <div className="flex flex-grow items-center gap-2 mx-auto w-full max-w-3/8">
          <div className="flex-1">
            <TextField
              label="Search"
              title="Search for a specific token name"
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
              }}
              className="w-full"
              size={64}
            />
          </div>
          <button
            type="button"
            title="Clear field"
            onClick={() => {
              setQuery("");
            }}
            className={`rounded-xl ${colorClasses.slate.bg} px-4 py-2 mt-6 text-sm disabled:opacity-50`}
          >
            Clear
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-center mt-12">No Seedelfs Available.</p>
        ) : (
          <ul className="space-y-3 m-4 mt-12 mx-auto w-full border rounded-xl max-w-33/64">
            {filtered.map((h) => (
              <li key={`${h}`} className="m-4 p-4">
                <div className="flex items-center justify-center gap-2 w-full min-w-0">
                  <code className="min-w-0 truncate font-bold pr-16">{h}</code>
                  <button
                    type="button"
                    title="Copy the token name"
                    aria-label="Copy the token name"
                    onClick={() => copy(h)}
                    className="pr-4"
                  >
                    <Copy />
                  </button>
                  <button
                    type="button"
                    title="Open on Cardanoscan.io"
                    aria-label="Open on Cardanoscan.io"
                    onClick={() => openUrl(tokenUrl(h, network))}
                    className=""
                  >
                    <Link />
                  </button>
                </div>
                <small>{display_ascii(h)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ToTopButton />
    </div>
  );
}
