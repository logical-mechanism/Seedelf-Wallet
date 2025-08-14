import { useState } from "react";
import { ExplorerLinkModal } from "@/components/ExplorerLinkModal";
import { TextField } from "@/components/TextField";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { NumberField } from "@/components/NumberField";
import { useNetwork } from "@/types/network";
import { SearchCheck } from "lucide-react";
import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";
import { colorClasses } from "./colors";
import { sendSeedelf } from "./transactions";
import { ConfirmationModal } from "@/components/ConfirmationModal";

export function Send() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");

  const [seedelf, setSeedelf] = useState("");
  const [ada, setAda] = useState(0);

  const { network } = useNetwork();

  const [txHash, setTxHash] = useState("");

  const [showExplorerLinkModal, setShowExplorerLinkModal] =
    useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);

  const { allSeedelfs } = useOutletContext<OutletContextType>();
  const [seedelfExist, setSeedelfExist] = useState<boolean>(false);

  const handleClear = () => {
    setSeedelf("");
    setSeedelfExist(false);
    setAda(0);
  };

  const handleSeedelfExist = (s: string) => {
    setVariant("error");
    if (!s.trim()) return setMessage("Seedelf Is Required");
    if (!s.includes("5eed0e1f")) return setMessage("Incorrect Seedelf Format");
    if (s.length != 64) return setMessage("Incorrect Seedelf Length");
    if (allSeedelfs.includes(s)) {
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
    // seedelf checks
    if (!seedelf.trim()) return setMessage("Seedelf Is Required");
    if (!seedelf.includes("5eed0e1f"))
      return setMessage("Incorrect Seedelf Format");
    if (seedelf.length != 64) return setMessage("Incorrect Seedelf Length");

    const lovelace = ada * 1_000_000;

    // lovelace checks; simple hardcore for now
    // this will need to be dynamic based off the tokens being sent later on
    if (lovelace < 1_500_000)
      return setMessage(`Minimum is 1.5 ${network == "mainnet" ? "₳" : "t₳"}`);

    // should be good to run the build tx function now
    try {
      setVariant("info");
      setMessage("Building Send Seedelf Transaction");
      const _txHash = await sendSeedelf(network, [seedelf], [lovelace]);
      if (_txHash) {
        setTxHash(_txHash);
        setShowExplorerLinkModal(true);
        handleClear();
      }
    } catch (e: any) {
      setVariant("error");
      setMessage(e as string);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold text-center">Send To A Seedelf</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <ExplorerLinkModal
        open={showExplorerLinkModal}
        txHash={txHash}
        onClose={() => {
          setShowExplorerLinkModal(false);
        }}
      />

      <ConfirmationModal
        open={showConfirmationModal}
        onConfirm={() => {
          handleSubmit();
          setShowConfirmationModal(false);
        }}
        onCancel={() => {
          setShowConfirmationModal(false);
        }}
      />

      <div className="my-4 w-full">
        <div className="relative mx-auto w-full max-w-5/8">
          <TextField
            label="Seedelf"
            title="A seedelf token name"
            value={seedelf}
            onChange={(e) => {
              const next = e.target.value;
              setSeedelf(next);
              handleSeedelfExist(next);
            }}
            disabled={submitting}
            maxLength={64}
            minLength={64}
          />

          <button
            type="button"
            title="Verify the seedelf"
            className={`absolute bottom-0 right-0 translate-x-full ml-2 flex items-center justify-center p-2 ${seedelf ? (seedelfExist ? colorClasses.green.text : colorClasses.red.text) : ""}`}
            disabled
          >
            <SearchCheck />
          </button>
        </div>
      </div>

      <div className="my-4 max-w-5/8 mx-auto w-full">
        <NumberField label="Ada" value={ada} onChange={setAda} min={0} />
      </div>

      <div className="flex items-center justify-center gap-2 my-4 max-w-5/8 mx-auto w-full">
        <button
          type="button"
          title="Send funds to a seedelf"
          onClick={() => {
            setShowConfirmationModal(true);
          }}
          className={`rounded ${colorClasses.sky.bg} px-4 py-2 text-sm text-white disabled:opacity-50`}
          disabled={submitting || !seedelf || !ada || !confirm}
        >
          Send
        </button>

        {(seedelf.length != 0 || ada > 0) && (
          <button
            type="button"
            title="Clear all fields"
            onClick={handleClear}
            className={`rounded ${colorClasses.slate.bg} px-4 py-2 text-sm text-white disabled:opacity-50`}
            disabled={submitting || !confirm}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
