import { useEffect, useState, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNetwork } from "@/types/network";
import { ShowNotification } from "@/components/ShowNotification";
import { transactionStatus } from "@/pages/Wallet/api";
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
  const [numberConfirmations, setNumberConfirmations] = useState<number>(0);

  const running = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    let cancelled = false;
    if (!open) return;

    const tick = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const n = await transactionStatus(network, txHash);

        if (!cancelled) {
          setNumberConfirmations(n ?? 0);
        }
      } catch (e) {
        console.error("transactionStatus failed:", e);
        if (!cancelled) setNumberConfirmations(0);
      } finally {
        running.current = false;
      }
    };

    // kick off immediately, then every 10s
    tick();
    const id = setInterval(tick, 10_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, network, txHash]);

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
          <h1 id="modal-title" className="mb-4 font-semibold text-center">
            Transaction Successfully Submitted!
          </h1>

          <h2
            id="modal-sub-title"
            className="mb-4 text-center"
            title="It will take a few moments to hit the chain."
          >
            Number Of Confirmations: {numberConfirmations}
          </h2>

          <h3
            id="modal-sub-title"
            className="mb-4 text-center"
            title="It will take a few moments to hit the chain."
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
