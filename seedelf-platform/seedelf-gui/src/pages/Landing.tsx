import { useState } from "react";
import { ShowNotification } from "@/components/ShowNotification";

export function LandingPage() {
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1>Welcome to Seedelf</h1>
      <button onClick={() => setSuccess("This is a success message.")} className="border px-3 py-1 rounded">
        Click me
      </button>
      <ShowNotification message={success} setMessage={setSuccess} variant="success" />
    </main>
  );
}
