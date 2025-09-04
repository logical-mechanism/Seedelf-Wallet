import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNetwork } from "@/types/network";
import { ShowNotification } from "@/components/ShowNotification";

import { Link, Copy } from "lucide-react";
import { colorClasses } from "@/pages/Wallet/colors";

type ExplorerModalProps = {
  open: boolean;
  txHash: string;
  onClose: () => void;
};

function txUrl(txHash: string, network: string) {
  return network === "mainnet"
    ? `https://cardanoscan.io/transaction/${txHash}`
    : `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

export function ExplorerLinkModal({
  open,
  txHash,
  onClose,
}: ExplorerModalProps) {
  const { network } = useNetwork();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setMessage(`${text} has been copied`);
  };

  return (
    <div className="fixed inset-0 z-50 ">
      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={"info"}
      />
      {/* Gray overlay */}
      <div className="absolute inset-0 bg-slate-700/50" />
      {/* Centered dialog */}
      <div className="absolute inset-0 grid place-items-center ">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className={`inline-block w-fit rounded-xl ${colorClasses.zinc.bg} p-6 shadow-lg`}
        >
          <h2
            id="modal-title"
            className="mb-4 font-semibold text-center"
          >
            Transaction Successfully Submitted!
          </h2>

          <h3
            id="modal-sub-title"
            className="mb-4 text-center"
          >
            View Transaction On Cardanoscan
          </h3>

          <p className="my-8 flex items-center justify-center gap-3">
            {/* Use Tauri opener so the link opens in the system browser */}
            <code className="pr-4 min-w-0 truncate">{txHash}</code>
            <button
              type="button"
              title={txUrl(txHash, network)}
              aria-label="Open on Cardanoscan"
              onClick={() => openUrl(txUrl(txHash, network))}
              className="pr-4"
            >
              <Link />
            </button>
            <button
              type="button"
              title="Copy"
              aria-label="Copy Tx Hash"
              onClick={() => copy(txHash)}
              className=""
            >
              <Copy />
            </button>
          </p>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                onClose();
              }}
              className="rounded-xl border px-3 py-1.5"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
