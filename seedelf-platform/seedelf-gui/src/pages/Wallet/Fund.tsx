import { useState } from "react";
import { WebServerModal } from "@/components/WebServerModal";
import { TextField } from "@/components/TextField";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { NumberField } from "@/components/NumberField";
import { useNetwork } from "@/types/network";
import { isNotAScript } from "./api";
import {
  SearchCheck
} from "lucide-react";
import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";
import { colorClasses } from "./colors";



export function Fund() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");

  const [address, setAddress] = useState("");
  const [seedelf, setSeedelf] = useState("");
  const [ada, setAda] = useState(0);

  const { network } = useNetwork();

  const [showWebServerModal, setShowWebServerModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);

  const { seedelfs } = useOutletContext<OutletContextType>();
  const [seedelfExist, setSeedelfExist] = useState<boolean>(false);


  const handleClear = () => {
    setAddress("");
    setSeedelf("");
    setSeedelfExist(false);
    setAda(0);
  };

  const handleSeedelfExist = () => {
    if (!seedelf.trim()) return setMessage("Seedelf Is Required");
    if (!seedelf.includes("5eed0e1f")) return setMessage("Incorrect Seedelf Format");
    if (seedelf.length != 64) return setMessage("Incorrect Seedelf Length");
    if (seedelfs.includes(seedelf)) {
      setVariant("info");
      setMessage("Seedelf does exist");
      setSeedelfExist(true);
    } else {
      setVariant("error");
      setMessage("Seedelf does not exist");
      setSeedelfExist(false);

    }
  };

  const handleSubmit = async () => {
    setVariant("error");
    // address stuff
    if (!address.trim()) return setMessage("Wallet address is required.");
    if (network == "mainnet" && !address.includes("addr1"))
      return setMessage("Incorrect Mainnet Address Format");
    if (network == "preprod" && !address.includes("addr_test1"))
      return setMessage("Incorrect Pre-Production Address Format");
    const notScript = await isNotAScript(address);
    if (!notScript) return setMessage("Address Is A Script");
    
    // seedelf checks
    if (!seedelf.trim()) return setMessage("Seedelf Is Required");
    if (!seedelf.includes("5eed0e1f")) return setMessage("Incorrect Seedelf Format");
    if (seedelf.length != 64) return setMessage("Incorrect Seedelf Length");
    
    const lovelace = ada * 1_000_000;
    console.log(address);
    console.log(seedelf);
    console.log(lovelace);

    try {
      setVariant("info");
      setMessage("Building Fund Seedelf Transaction");
      handleClear();
    } catch (e: any) {
      setVariant("error");
      setMessage(e as string);
    } finally {
      setSubmitting(false);
    }

  }

  return (
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold text-center">Fund A Seedelf</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <WebServerModal
        open={showWebServerModal}
        url={"http://127.0.0.1:44203/"}
        onClose={() => {
          setVariant("info");
          setMessage("Stopping Web Server..");
          setShowWebServerModal(false);
        }}
      />

      <div className="my-4 max-w-5/8 mx-auto w-full">
        <TextField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={submitting}
          maxLength={108}
        />
      </div>

      <div className="my-4 w-full">
        <div className="relative mx-auto w-full max-w-5/8">
          <TextField
            label="Seedelf"
            value={seedelf}
            onChange={(e) => setSeedelf(e.target.value)}
            disabled={submitting}
            maxLength={64}
            minLength={64}
          />

          {/* sits just outside the right edge of the 5/8 box */}
          <button
            type="button"
            title="Verify the seedelf exists"
            className={`absolute bottom-0 right-0 translate-x-full ml-2 flex items-center justify-center p-2 ${seedelfExist ? colorClasses.green.text : ""}`}
            onClick={handleSeedelfExist}
            disabled={!confirm}
          >
            <SearchCheck />
          </button>
        </div>
      </div>

      <div className="my-4 max-w-5/8 mx-auto w-full">
        <NumberField
          label="Ada"
          value={ada}
          onChange={setAda}
          min={0}
        />
      </div>

      <div className="flex items-center justify-center my-4 gap-4">
        <button
          type="button"
          onClick={handleSubmit}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={submitting || !address || !seedelf || !ada || !confirm}
        >
          Fund
        </button>

        {(address.length != 0 || seedelf.length != 0 || ada > 0) && (
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
    </div>
  );
}
