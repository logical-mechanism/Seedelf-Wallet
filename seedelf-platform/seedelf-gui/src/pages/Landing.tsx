import { useState, useEffect } from "react";
import { ShowNotification, NotificationVariant } from "@/components/ShowNotification";
import { invoke } from "@tauri-apps/api/core";
import { WalletExistsResult } from "@/types/wallet";

export function LandingPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("info");

  useEffect(() => {

    const checkWallet = async () => {
      const result = await invoke<WalletExistsResult>("check_if_wallet_exists");

      if (result) {
        setMessage(`Wallet Found: ${result}`);
        setVariant("success");
      } else {
        
      }
      console.log("check_if_wallet_exists", result);
    };
    checkWallet()
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1>Welcome to Seedelf</h1>
      <button onClick={() => setMessage("This is a message.")} className="border px-3 py-1 rounded">
        Click me
      </button>
      <ShowNotification message={message} setMessage={setMessage} variant={variant} />
    </main>
  );
}
