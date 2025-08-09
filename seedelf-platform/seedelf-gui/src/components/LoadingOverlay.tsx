type LoadingOverlayProps = {
  show: boolean;
  label?: string; // screen reader text
};

export function LoadingOverlay({
  show,
  label = "Loading",
}: LoadingOverlayProps) {
  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
