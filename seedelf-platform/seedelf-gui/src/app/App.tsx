import { LandingPage } from "@/pages/Landing";
import { NewWalletPage } from "@/pages/NewWallet";
import { WalletPage } from "@/pages/Wallet/WalletLayout";
import { useTauriReady } from "@/lib/useTauriReady";
import { Routes, Route } from "react-router"; 

function App() {
  const isTauriReady = useTauriReady();

  if (!isTauriReady) {
    return <div>Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/wallet/new" element={<NewWalletPage />} />
      <Route path="/wallet/" element={<WalletPage />} />
      {/* wildcard falls back to landing; you can show a 404 instead */}
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
  return <LandingPage />;
}

export default App;
