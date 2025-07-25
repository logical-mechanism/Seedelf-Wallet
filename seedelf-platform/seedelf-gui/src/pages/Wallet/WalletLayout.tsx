import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { PasswordField } from "@/components/PasswordField";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { TopNavBar } from "@/components/TopNavBar";
import { Network, NetworkContext } from "@/types/network";
import { TxResponseWithSide } from "@/types/wallet";
import { Sidebar } from "./Sidebar";
import {
  getLovelaceBalance,
  getWalletHistory,
  getEveryUtxo,
  getOwnedUtxo,
  getOwnedSeedelfs,
} from "./api";

export function WalletPage() {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null); // unix ms

  // wallet states
  const [lovelace, setLovelace] = useState<number>(0);
  const [seedelfs, setSeedelfs] = useState<string[]>([]);
  const [history, setHistory] = useState<TxResponseWithSide[]>([]);

  // network selector
  const [network, setNetwork] = useState<Network>(
    () => (localStorage.getItem("network") as Network) || "mainnet",
  );

  const gatherWalletInfo = async () => {
    // initalize stuff
    setLovelace(0);
    setSeedelfs([]);
    setHistory([]);

    // query stuff
    const _history = await getWalletHistory(network);
    const _every_utxo = await getEveryUtxo(network);

    const _owned_utxo = await getOwnedUtxo(network, _every_utxo);
    const _seedelfs = await getOwnedSeedelfs(network, _every_utxo);

    const _lovelace = await getLovelaceBalance(_owned_utxo);

    // set stuff
    setLovelace(_lovelace);
    setSeedelfs(_seedelfs);
    setHistory(_history);

    // set last sync time
    if (unlocked) {
        setLastSync(Date.now());
    }
  };

  useEffect(() => {
    localStorage.setItem("network", network);
    if (unlocked) {
      setToastMsg(`Loading Network: ${network}`);
      setToastVariant("info");
    }

    gatherWalletInfo();
  }, [network, unlocked]);

  // toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<NotificationVariant>("info");

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
          <div className="flex flex-col hscreen">
            <TopNavBar
              lastSync={lastSync}
              lovelace={lovelace}
              onRefresh={async () => {
                setToastMsg("Refreshing State");
                setToastVariant("info");
                gatherWalletInfo();
              }}
              onLock={async () => {
                await invoke("lock_wallet_session");
                setUnlocked(false);
              }}
            />

            <div className="flex h-full">
              <aside className="w-48 shrink-0 border-r">
                <Sidebar />
              </aside>
              <main className="flex-1 min-w-0 overflow-auto">
                <Outlet context={{ lovelace, seedelfs, history }} />
              </main>
            </div>
          </div>
        </NetworkContext.Provider>
      )}
    </div>
  );
}
