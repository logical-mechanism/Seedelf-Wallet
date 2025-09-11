import { useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { TextField } from "@/components/TextField";
import { PasswordField } from "@/components/PasswordField";
import { WalletExistsResult } from "@/types/wallet";
import { MoveLeft } from "lucide-react";

export function NewWalletPage() {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async () => {
    // spaces should be underscores
    const walletName: string = name.trim().replace(/\s+/g, "_");

    // force users to use some kind of complex password here
    const isStrong = await invoke<boolean>("check_password_complexity", {
      password: pw,
    });
    if (!isStrong) {
      setVariant("error");
      return setMessage(`Passwords Must Contain The Following:
                         Minimum Length: At Least 14 Characters
                         Uppercase Letter: Requires At Least One Uppercase Character
                         Lowercase Letter: Requires At Least One Lowercase Character
                         Number: Requires At Least One Digit
                         Special Character: Requires At Least One Special Symbol`);
    }
    if (pw !== confirm) {
      setVariant("error");
      return setMessage("Passwords do not match.");
    }

    setSubmitting(true);
    let success = false;
    try {
      await invoke("create_new_wallet", {
        walletName: walletName,
        password: pw,
      });
      const walletExists = await invoke<WalletExistsResult>(
        "check_if_wallet_exists",
      );
      if (walletExists) {
        success = true;
        setVariant("success");
        setMessage(`Wallet Created`);
        setTimeout(() => navigate("/wallet/"), 2718);
      } else {
        setVariant("error");
        setMessage(`Error Creating Wallet`);
        setTimeout(() => navigate("/wallet/new"), 2718);
      }
    } catch (e: any) {
      setMessage(e as string);
    } finally {
      if (!success) setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-semibold text-center">
        Create A Seedelf Wallet
      </h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <TextField
        label="Wallet name"
        title="The name for the wallet file, e.g. file_name.wallet."
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={submitting}
        size={64}
      />

      <PasswordField
        label="Password"
        title="The wallet file will be encrypted with this password."
        value={pw}
        onChange={setPw}
        disabled={submitting}
      />
      <PasswordField
        label="Confirm password"
        value={confirm}
        onChange={setConfirm}
        disabled={submitting}
      />

      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/")} className="rounded-xl px-3 py-2">
          <MoveLeft />
        </button>

        <button
          onClick={handleSubmit}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm disabled:opacity-50"
          disabled={submitting || !name || !pw || !confirm}
          title="Create a wallet file inside the $HOME/.seedelf folder."
        >
          Create
        </button>
      </div>
    </div>
  );
}
