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
      <div className="flex flex-col items-center gap-2">
        <div className="h-12 w-12 rounded-xl border-4 border-white/30 border-t-white animate-[spin_1.359s_steps(4)_infinite]" />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
