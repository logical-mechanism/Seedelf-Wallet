import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export function useTauriReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let resolved = false;

    const unlistenPromise = listen("tauri://ready", () => {
      resolved = true;
      setReady(true);
    });

    setTimeout(() => {
      if (!resolved) setReady(true);
    }, 0);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return ready;
}
