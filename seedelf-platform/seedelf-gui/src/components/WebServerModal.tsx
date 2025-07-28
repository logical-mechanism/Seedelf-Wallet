import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { stopWebServer } from "@pages/Wallet/webServer";

type WebServerModalProps = {
  open: boolean;
  url: string;
  onClose: () => void;
  title?: string;
};

export function WebServerModal({ open, url, onClose, title = "Open link" }: WebServerModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Gray overlay */}
      <div className="absolute inset-0 bg-gray-800/70" aria-hidden="true" />
      {/* Centered dialog */}
      <div className="absolute inset-0 grid place-items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="w-[90vw] max-w-md rounded-xl bg-gray-100 p-6 shadow-lg"
        >
          <h2 id="modal-title" className="mb-4 text-lg font-semibold text-black">
            {title}
          </h2>

          <p className="mb-6 break-all">
            {/* Use Tauri opener so the link opens in the system browser */}
            <button
                type="button"
                title="Link"
                aria-label="Open local webserver"
                onClick={() => openUrl(url)}
                className="hover:scale-105 pr-4 text-black"
              >
                {url}
            </button>
          </p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={ () => {
                stopWebServer();
                onClose();
              }}
              className="rounded-md border px-3 py-1.5 transition hover:scale-105 text-black"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
