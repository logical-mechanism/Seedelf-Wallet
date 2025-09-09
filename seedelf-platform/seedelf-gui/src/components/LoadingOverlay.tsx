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
            h-12 w-12 rounded-full border-[3px]
            border-neutral-200/20
            [border-top-color:transparent]
            [border-right-color:transparent]
            [border-bottom-color:transparent]
            [border-left-color:currentColor]
            text-[var(--seedelf-accent)]
            [transform:rotate(var(--r))_scale(var(--s))]
            will-change-transform
            animate-[spinVar_2.718s_linear_infinite,pulseVar_1.812s_ease-in-out_infinite,quadSweep_1.359s_steps(4)_infinite]
            drop-shadow-[0_0_8px_rgba(255,255,255,0.05)]
          "
        />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
