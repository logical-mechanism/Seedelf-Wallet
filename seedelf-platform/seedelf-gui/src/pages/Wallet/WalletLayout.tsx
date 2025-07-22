// src/pages/Wallet.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PasswordField } from "@/components/PasswordField";
import {
    ShowNotification,
    NotificationVariant,
} from "@/components/ShowNotification";
import { TopNavBar } from "@/components/TopNavBar";
import { Network, NetworkContext } from "@/types/network";

export function WalletPage() {
    const [password, setPassword] = useState("");
    const [unlocking, setUnlocking] = useState(false);
    const [unlocked, setUnlocked] = useState(false);

    // network selector
    const [network, setNetwork] = useState<Network>(
        () => (localStorage.getItem("network") as Network) || "mainnet"
    );

    useEffect(() => {
        localStorage.setItem("network", network);
        setToastMsg(`Network: ${network}`);
        setToastVariant('info');
    }, [network]);

    // toast
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [toastVariant, setToastVariant] =
        useState<NotificationVariant>("info");

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


    return (
        <div className="h-full w-full">
            {/* global notifications */}
            <ShowNotification
                message={toastMsg}
                setMessage={setToastMsg}
                variant={toastVariant}
            />

            {!unlocked && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="w-full max-w-sm rounded-lg p-6 shadow-xl">
                        <h2 className="mb-4 text-lg font-semibold text-center">
                            Unlock Wallet
                        </h2>

                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                tryUnlock();
                            }}
                        >
                            <PasswordField
                                label="Wallet password"
                                value={password}
                                onChange={setPassword}
                            />

                            <button
                                type="submit"
                                className="mt-4 w-full rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
                                disabled={!password || unlocking}
                            >
                                {unlocking ? "Unlocking…" : "Unlock"}
                            </button>
                        </form>
                    </div>
                </div>
            )}


            {/* main wallet ui */}
            {unlocked && (
                <NetworkContext.Provider value={{ network, setNetwork }}>
                    <TopNavBar onLock={async () => {
                        await invoke("lock_wallet_session");
                        setUnlocked(false);
                    }} />
                </NetworkContext.Provider>
            )}
        </div>
    );
}
