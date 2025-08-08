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
  getEverySeedelf,
} from "./api";
import { LoadingOverlay } from "@/components/LoadingOverlay";


export function WalletPage() {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null); // unix ms
  const [loading, setLoading] = useState(false);

  // wallet states
  const [lovelace, setLovelace] = useState<number>(0);
  const [allSeedelfs, setAllSeedelfs] = useState<string[]>([]);
  const [ownedSeedelfs, setOwnedSeedelfs] = useState<string[]>([]);
  const [history, setHistory] = useState<TxResponseWithSide[]>([]);

  // toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastDur, setToastDur] = useState<number>(2718);
  const [toastVariant, setToastVariant] = useState<NotificationVariant>("info");

  // network selector
  const [network, setNetwork] = useState<Network>(
    () => (localStorage.getItem("network") as Network) || "mainnet",
  );

  const gatherWalletInfo = async () => {
    // initalize stuff
    setLovelace(0);
    setOwnedSeedelfs([]);
    setHistory([]);

    // query stuff
    setLoading(true);
    setToastVariant("info");
    setToastDur(10000);
    setToastMsg("Getting Wallet History");
    // this takes a long time
    const _history = await getWalletHistory(network);
    setToastMsg("Querying Wallet UTxOs");
    // this takes a long time
    const _every_utxo = await getEveryUtxo(network);
    setToastMsg("Sorting Owned UTxOs");
    const _owned_utxo = await getOwnedUtxo(network, _every_utxo);
    setToastMsg("Sorting All Seedelfs");
    const _allSeedelfs = await getEverySeedelf(network, _every_utxo);
    setToastMsg("Sorting Owned Seedelfs");
    const _ownedSeedelfs = await getOwnedSeedelfs(network, _every_utxo);
    setToastMsg("Calculating Balance");
    const _lovelace = await getLovelaceBalance(_owned_utxo);
    setLoading(false);
    setToastVariant("success");
    setToastDur(2718);
    setToastMsg("Wallet Loaded");

    // set stuff
    setLovelace(_lovelace);
    setOwnedSeedelfs(_ownedSeedelfs);
    setAllSeedelfs(_allSeedelfs);
    setHistory(_history);

    // set last sync time
    if (unlocked) {
      setLastSync(Date.now());
    }
  };

  useEffect(() => {
    localStorage.setItem("network", network);
    if (unlocked) {
      setToastVariant("info");
      setToastMsg(`Loading Network: ${network}`);
      gatherWalletInfo();
    }
  }, [network, unlocked]);

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
        duration={toastDur}
      />

      <LoadingOverlay show={loading}/>

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
                setToastVariant("info");
                setToastMsg("Refreshing State");
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
                <Outlet
                  context={{ lovelace, allSeedelfs, ownedSeedelfs, history }}
                />
              </main>
            </div>
          </div>
        </NetworkContext.Provider>
      )}
    </div>
  );
}
