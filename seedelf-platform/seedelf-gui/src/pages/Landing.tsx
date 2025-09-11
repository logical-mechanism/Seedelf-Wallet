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
        setVariant("success");
        setMessage(`Found Wallet: ${walletExists}`);
        setTimeout(() => navigate("/wallet/"), 2718);
      } else {
        setVariant("info");
        setMessage(`Creating New Wallet`);
        setTimeout(() => navigate("/wallet/new"), 2718);
      }
    };
    checkWallet();
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
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
