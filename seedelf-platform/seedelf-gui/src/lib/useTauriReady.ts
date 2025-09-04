import { useEffect, useState } from "react";

export function useTauriReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const isTauri =
        typeof window !== "undefined" &&
        ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

      if (!isTauri) {
        setReady(true);
        return;
      }

      const { listen } = await import("@tauri-apps/api/event");

      let resolved = false;
      const fallback = setTimeout(() => {
        if (!cancelled && !resolved) setReady(true);
      }, 1359);

      const unlisten = await listen("tauri://ready", () => {
        resolved = true;
        clearTimeout(fallback);
        if (!cancelled) setReady(true);
      });

      return () => {
        unlisten();
      };
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
