import { useState } from "react";
import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { isNotAScript } from "./api";
import { TextField } from "@/components/TextField";
import { CreateRemoveToggle, ToggleMode } from "@/components/Toggle";
import { useNetwork } from "@/types/network";
import { Delete } from "lucide-react";
import { createSeedelf } from "./transactions";

export function Manage() {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [seedelf, setSeedelf] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<ToggleMode>("Create");
  const { network } = useNetwork();
  const { seedelfs } = useOutletContext<OutletContextType>();

  const selectSeedelf = async (text: string) => {
    setVariant("info");
    setMessage(`${text} has been selected`);
    setSeedelf(text);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClear = () => {
    setAddress("");
    setSeedelf("");
    setLabel("");
  };

  const handleSubmit = async () => {
    setVariant("error");
    // Simple custom rules – adjust as needed
    if (!address.trim()) return setMessage("Wallet address is required.");
    if (network == "mainnet" && !address.includes("addr1"))
      return setMessage("Incorrect Mainnet Address Format");
    if (network == "preprod" && !address.includes("addr_test1"))
      return setMessage("Incorrect Pre-Production Address Format");
    const notScript = await isNotAScript(address);
    if (!notScript) return setMessage("Address Is A Script");

    if (mode == "Remove") {
      if (!seedelf.trim()) return setMessage("Seedelf Is Required");
      if (!seedelf.includes("5eed0e1f")) setMessage("Incorrect Seedelf Format");
      if (seedelf.length != 64) setMessage("Incorrect Seedelf Length");
    }
    // spaces should be underscores

    setSubmitting(true);
    let success = false;
    try {
      // invoke the create or remove function
      let tx_cbor;
      if (mode == "Remove") {} else {
        tx_cbor = await createSeedelf(network, address, label);
        // this needs to trigger some modal that shows the link to the web server
        // then a button that closes the web server
        setMessage(tx_cbor);
      }
    } catch (e: any) {
      setVariant("error");
      setMessage(e as string);
    } finally {
      if (!success) setSubmitting(false);
    }
  };

  return (
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold text-center">{mode} A Seedelf</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <CreateRemoveToggle value={mode} onChange={setMode} />

      <div className="my-4 max-w-5/8 mx-auto w-full">
        <TextField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={submitting}
          maxLength={108}
        />
      </div>
      {mode == "Create" && (
        <div className="my-4 max-w-5/8 mx-auto w-full">
          <TextField
            label="Label (Optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting}
            maxLength={15}
          />
        </div>
      )}

      {mode == "Remove" && (
        <div className="my-4 max-w-5/8 mx-auto w-full">
          <TextField
            label="Seedelf"
            value={seedelf}
            onChange={(e) => setSeedelf(e.target.value)}
            disabled={submitting}
            maxLength={64}
            minLength={64}
          />
        </div>
      )}

      <div className="flex items-center justify-center my-4 gap-4">
        <button
          type="button"
          onClick={handleSubmit}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={submitting || !address || !confirm}
        >
          {mode}
        </button>

        {(address.length != 0 || seedelf.length != 0 || label.length != 0) && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded bg-slate-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={submitting || !confirm}
          >
            Clear
          </button>
        )}
      </div>

      <div
        className={`${seedelfs.length === 0 ? "" : "rounded flex items-center justify-center max-w-1/2 mx-auto mt-8"}`}
      >
        {seedelfs.length === 0 || mode == "Create" ? (
          <></>
        ) : (
          <ul className="space-y-3 text-white m-4 w-full max-[960px]:hidden">
            {seedelfs.map((h) => (
              <li key={`${h}`} className="m-4 p-4">
                <div className="flex items-center gap-2 w-full min-w-0">
                  <code className="min-w-0 truncate font-bold pr-16">{h}</code>
                  <button
                    type="button"
                    title="Delete"
                    aria-label="Delete Seedelf"
                    onClick={() => selectSeedelf(h)}
                    className="hover:scale-105"
                  >
                    <Delete />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
