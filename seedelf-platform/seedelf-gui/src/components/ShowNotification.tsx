import { useEffect, useState } from "react";

export type NotificationVariant = "success" | "error" | "info";

const VARIANT_STYLES: Record<NotificationVariant, string> = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-sky-600 text-white",
};

function ariaForVariant(v: NotificationVariant) {
  return v === "error"
    ? { role: "alert", ariaLive: "assertive" as const }
    : { role: "status", ariaLive: "polite" as const };
}

interface ShowSuccessProps {
  message: string | null;
  setMessage: (value: string | null) => void;
  variant?: NotificationVariant;
  duration?: number;
}

export function ShowNotification({
  message,
  setMessage,
  variant = "info",
  duration = 2718,
}: ShowSuccessProps) {
  const [show, setShow] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const [localVariant, setLocalVariant] =
    useState<NotificationVariant>(variant);

  useEffect(() => {
    if (message == null) return;
    setLocalMsg(message);
    setLocalVariant(variant);
    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      setMessage(null);
    }, duration);
    return () => clearTimeout(timer);
  }, [message, setMessage, duration]);

  if (!show || localMsg == null) return null;

  const { role, ariaLive } = ariaForVariant(localVariant);
  const variantClasses = VARIANT_STYLES[localVariant];

  return (
    <div
      className={`whitespace-pre-line fixed bottom-16 right-4 z-51 rounded shadow-lg px-4 py-3 flex items-center gap-2 transition-transform duration-150 ${variantClasses}`}
      role={role}
      aria-live={ariaLive}
    >
      <span>{localMsg}</span>
      <button
        onClick={() => {
          setShow(false);
          setMessage(null);
        }}
        className="ml-2 font-bold leading-none"
        aria-label="Dismiss"
      >
        ✖
      </button>
    </div>
  );
}
