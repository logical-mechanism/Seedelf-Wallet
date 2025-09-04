import { Routes, Route, Navigate } from "react-router";
import { useTauriReady } from "@/lib/useTauriReady";
import { LandingPage } from "@/pages/Landing";
import { NewWalletPage } from "@/pages/NewWallet";
import { WalletLayout } from "@/pages/Wallet/WalletLayout";
import { Dashboard } from "@/pages/Wallet/Dashboard";
import { Manage } from "@/pages/Wallet/Manage";
import { Fund } from "@/pages/Wallet/Fund";
import { History } from "@/pages/Wallet/History";
import { Send } from "@/pages/Wallet/Send";
import { Receive } from "@/pages/Wallet/Receive";
import { Extract } from "@/pages/Wallet/Extract";

function App() {
  const isTauriReady = useTauriReady();

  if (!isTauriReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      {/**/}
      <Route index element={<LandingPage />} />
      {/* only shows if a wallet file does not exist */}
      <Route path="/wallet/new" element={<NewWalletPage />} />
      {/* wallet routes for existing wallets */}
      <Route path="/wallet" element={<WalletLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="manage" element={<Manage />} />
        <Route path="fund" element={<Fund />} />
        <Route path="send" element={<Send />} />
        <Route path="receive" element={<Receive />} />
        <Route path="extract" element={<Extract />} />
        <Route path="history" element={<History />} />
      </Route>
      {/* wildcard falls back to landing */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
