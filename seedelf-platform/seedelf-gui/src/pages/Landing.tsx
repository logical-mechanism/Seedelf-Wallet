import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { invoke } from "@tauri-apps/api/core";
import { WalletExistsResult } from "@/types/wallet";

export function LandingPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("info");
  const navigate = useNavigate();

  useEffect(() => {
    const checkWallet = async () => {
      const walletExists = await invoke<WalletExistsResult>(
        "check_if_wallet_exists",
      );

      if (walletExists) {
        setMessage(`Loading Found Wallet: ${walletExists}`);
        setVariant("success");
        setTimeout(() => navigate("/wallet/"), 2718);
      } else {
        setMessage(`Creating New Wallet`);
        setVariant("info");
        setTimeout(() => navigate("/wallet/new"), 2718);
      }
    };
    checkWallet();
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1>Welcome to Seedelf</h1>
      <h2>A Cardano Stealth Wallet</h2>
      <br />
      <footer>Created By Logical Mechanism LLC</footer>
      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />
    </main>
  );
}
