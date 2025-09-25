// components/ToTopButton.tsx
import { useEffect, useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";

export function ToTopButton() {
  const [show, setShow] = useState(false);
  const prefersReduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setShow(window.scrollY > 150);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      onClick={() =>
        window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" })
      }
      className="fixed bottom-6 right-6 z-50 rounded-xl p-3 border bg-black/60 text-white backdrop-blur shadow-lg hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <ArrowUp className="h-5 w-5" />
      <span className="sr-only">Back to top</span>
    </button>
  );
}
