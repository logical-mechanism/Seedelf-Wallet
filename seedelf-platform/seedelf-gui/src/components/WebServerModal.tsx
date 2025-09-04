import { useEffect, useState, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { stopWebServer } from "@pages/Wallet/webServer";
import { Link, CircleQuestionMark, Copy } from "lucide-react";
import { ShowNotification } from "@/components/ShowNotification";
import { colorClasses } from "@/pages/Wallet/colors";

type WebServerModalProps = {
  open: boolean;
  url: string;
  onClose: () => void;
};

export function WebServerModal({ open, url, onClose }: WebServerModalProps) {
  const [message, setMessage] = useState<string | null>(null);

  const closeAndStop = useCallback(() => {
    stopWebServer();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") closeAndStop();
    };
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
      <div className="absolute inset-0 bg-slate-700/50" aria-hidden="true" />
      {/* Centered dialog */}
      <div className="absolute inset-0 grid place-items-center ">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className={`inline-block w-fit rounded-xl ${colorClasses.zinc.bg} p-6 shadow-lg`}
        >
          <h1>
            <button
              disabled
              title="Cardano web ( CIP30 ) wallets must interact through a web browser. Visit the URL to interact with the dapp."
            >
              <CircleQuestionMark />
            </button>
          </h1>
          <h2 id="modal-title" className="mb-4 text-center">
            Web Server Is Live
          </h2>

          <p className="my-8 flex items-center justify-center gap-3">
            {/* Use Tauri opener so the link opens in the system browser */}
            <code className="pr-4 min-w-0 truncate">{url}</code>
            <button
              type="button"
              title={url}
              aria-label="Open local webserver"
              onClick={() => openUrl(url)}
              className="pr-4"
            >
              <Link />
            </button>
            <button
              type="button"
              title="Copy"
              aria-label="Copy URL"
              onClick={() => copy(url)}
              className=""
            >
              <Copy />
            </button>
          </p>

          <div className="flex justify-center">
            <button
              type="button"
              title="Stop the local web server"
              onClick={closeAndStop}
              className="rounded-xl border px-3 py-1.5"
            >
              Stop Web Server
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
