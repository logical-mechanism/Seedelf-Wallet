import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { stopWebServer } from "@pages/Wallet/webServer";
import {
  Link,
  CircleQuestionMark,
} from "lucide-react";

type WebServerModalProps = {
  open: boolean;
  url: string;
  onClose: () => void;
  title?: string;
};

export function WebServerModal({ open, url, onClose, title = "Starting Web Server At:" }: WebServerModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 ">
      {/* Gray overlay */}
      <div className="absolute inset-0 bg-gray-800/70" aria-hidden="true" />
      {/* Centered dialog */}
      <div className="absolute inset-0 grid place-items-center ">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="w-[90vw] max-w-md rounded-xl bg-gray-800 p-6 shadow-lg"
        >
          <h1><button disabled title="Cardano web wallets must interact through a web browser."><CircleQuestionMark /></button></h1>
          <h2 id="modal-title" className="mb-4 text-md font-semibold text-white text-center">
            {title}
          </h2>

          <p className="my-8 break-all text-center gap-2">
            {/* Use Tauri opener so the link opens in the system browser */}
            <button
                type="button"
                title="Link"
                aria-label="Open local webserver"
                onClick={() => openUrl(url)}
                className="hover:scale-105 pr-4 text-white text-2xl"
              >
                {url}
            </button>
            <button
              type="button"
              title="Link"
              aria-label="Open on Cardanoscan"
              onClick={() => openUrl(url)}
              className="hover:scale-105"
            >
              <Link />
            </button>
          </p>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={ () => {
                stopWebServer();
                onClose();
              }}
              className="rounded-md border px-3 py-1.5 transition hover:scale-105 text-white"
            >
              Stop Web Server
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
