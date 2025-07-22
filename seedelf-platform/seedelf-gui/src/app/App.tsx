import { LandingPage } from "@/pages/Landing";
import { NewWalletPage } from "@/pages/NewWallet";
import { WalletPage } from "@/pages/Wallet/WalletLayout";
import { useTauriReady } from "@/lib/useTauriReady";
import { Routes, Route } from "react-router"; 
import { Dashboard } from "@/pages/Wallet/Dashboard";
import { Manage } from "@/pages/Wallet/Manage";
import { Fund } from "@/pages/Wallet/Fund";
import { History } from "@/pages/Wallet/History";
import { Send } from "@/pages/Wallet/Send";
import { Receive } from "@/pages/Wallet/Receive";

function App() {
  const isTauriReady = useTauriReady();

  if (!isTauriReady) {
    return <div>Loading...</div>;
  }

  return (
    <Routes>
      <Route index element={<LandingPage />} />
      <Route path="/wallet/new" element={<NewWalletPage />} />
      <Route path="/wallet/" element={<WalletPage />} >
        <Route index element={<Dashboard />} />
        <Route path="fund" element={< Fund />} />
        <Route path="history" element={< History />} />
        <Route path="manage" element={< Manage />} />
        <Route path="receive" element={< Receive />} />
        <Route path="send" element={< Send />} />
      </Route>
      {/* wildcard falls back to landing; you can show a 404 instead */}
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
}

export default App;
