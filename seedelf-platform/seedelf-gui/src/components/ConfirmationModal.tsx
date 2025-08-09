import { useEffect, useRef } from "react";
import { colorClasses } from "@/pages/Wallet/colors";
type ConfirmationModalProps = {
  open: boolean;
  title?: string; // defaults to "Confirm?"
  confirmLabel?: string; // defaults to "Confirm"
  cancelLabel?: string; // defaults to "Cancel"
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmationModal({
  open,
  title = "Confirm?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50"
      aria-hidden={!open}
      onMouseDown={(e) => {
        // backdrop click (ignore clicks inside the panel)
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-800/70" />

      {/* Centered dialog */}
      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="w-full max-w-sm rounded-xl shadow-lg bg-gray-800"
        >
          <div className="p-5">
            <h2
              id="confirm-modal-title"
              className="text-lg font-semibold text-white"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm text-white">
              Are you sure you want to continue?
            </p>

            <div className="mt-5 flex justify-between gap-2">
              <button
                type="button"
                onClick={onCancel}
                className={`rounded-xl border border-gray-300 px-4 py-2 text-sm text-white`}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`rounded-xl px-4 py-2 text-sm text-white ${colorClasses.sky.bg} focus:outline-none`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
