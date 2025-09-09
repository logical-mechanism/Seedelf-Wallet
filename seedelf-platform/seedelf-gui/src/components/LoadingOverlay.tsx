type LoadingOverlayProps = {
  show: boolean;
  label?: string;
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
      aria-label={label}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm isolation-auto"
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="
            h-12 w-12 rounded-xl border-[3px]
            border-neutral-200/20
            [border-top-color:border-neutral-200]
            [border-right-color:border-neutral-200]
            [border-bottom-color:border-neutral-200]
            [border-left-color:currentColor]
            text-[var(--seedelf-accent)]
            [transform:rotate(var(--r))_scale(var(--s))]
            will-change-transform
            animate-[spinVar_2.718s_linear_infinite,pulseVar_2.718s_ease-in-out_infinite,quadSweep_2.718s_steps(4)_infinite]
            drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]
          "
        />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
