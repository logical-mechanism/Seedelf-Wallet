// src/pages/Wallet.tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PasswordField } from "@/components/PasswordField";
import {
    ShowNotification,
    NotificationVariant,
} from "@/components/ShowNotification";

export function WalletPage() {
    /* ---------------- state ---------------- */
    const [password, setPassword] = useState("");
    const [unlocking, setUnlocking] = useState(false);
    const [unlocked, setUnlocked] = useState(false);

    // toast
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [toastVariant, setToastVariant] =
        useState<NotificationVariant>("info");

    /* ---------------- actions ---------------- */
    const tryUnlock = async () => {
        setUnlocking(true);
        try {
            await invoke("load_wallet_session", { password });
            setUnlocked(true); // hide modal, show wallet
            setToastVariant("success");
            setToastMsg("Wallet unlocked");
        } catch (e) {
            setToastVariant("error");
            setToastMsg(e as string); // e comes from Err(String)
        } finally {
            setUnlocking(false);
            setPassword(""); // clear field for retry
        }
    };

    /* ---------------- ui ---------------- */
    return (
        <div className="h-full w-full">
            {/* global notifications */}
            <ShowNotification
                message={toastMsg}
                setMessage={setToastMsg}
                variant={toastVariant}
            />

            {/* password modal */}
            {!unlocked && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="w-full max-w-sm rounded-lg p-6 shadow-xl">
                        <h2 className="mb-4 text-lg font-semibold text-center">
                            Unlock Wallet
                        </h2>

                        <PasswordField
                            label="Wallet password"
                            value={password}
                            onChange={setPassword}
                        />

                        <button
                            onClick={tryUnlock}
                            className="mt-4 w-full rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
                            disabled={!password || unlocking}
                        >
                            {unlocking ? "Unlocking…" : "Unlock"}
                        </button>
                    </div>
                </div>
            )}

            {/* main wallet ui */}
            {unlocked && (
                <div className="p-6">
                    <h1 className="text-2xl font-bold">Seedelf Wallet</h1>
                    <p className="mt-4 text-gray-700">
                        ✅ Wallet successfully unlocked. Build balances, UTxOs, etc. here.
                    </p>
                </div>
            )}
        </div>
    );
}
