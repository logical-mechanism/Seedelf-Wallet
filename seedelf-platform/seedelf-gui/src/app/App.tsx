import {LandingPage} from "@/pages/Landing";
import { useTauriReady } from "@/lib/useTauriReady";

function App() {
  const isTauriReady = useTauriReady();

  if (!isTauriReady) {
    return <div>Loading...</div>;
  }

  return <LandingPage />;
}

export default App;
