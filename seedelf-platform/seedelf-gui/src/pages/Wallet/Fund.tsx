import { useState, useMemo } from "react";
import { useOutletContext } from "react-router";
import { SearchCheck } from "lucide-react";
import { WebServerModal } from "@/components/WebServerModal";
import { TextField } from "@/components/TextField";
import { NumberField } from "@/components/NumberField";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { Checkbox } from "@/components/Checkbox";
import { useNetwork } from "@/types/network";
import { OutletContextType } from "@/types/layout";
import { colorClasses } from "./colors";
import { isNotAScript } from "./api";
import { fundSeedelf } from "./transactions";
import { runWebServer } from "./webServer";

export function Fund() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");

  const [address, setAddress] = useState("");
  const [seedelf, setSeedelf] = useState("");
  const [ada, setAda] = useState(0);

  const { network } = useNetwork();

  const [showWebServerModal, setShowWebServerModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);

  const { allSeedelfs, ownedSeedelfs } = useOutletContext<OutletContextType>();
  const [seedelfExist, setSeedelfExist] = useState<boolean>(false);
  const [addressValid, setAddressValid] = useState<boolean>(false);
  const [isSelfSend, setIsSelfSend] = useState<boolean>(false);

  // randomly select a seedelf from the owned seedelfs.
  const selfSeedelf = useMemo(
    () => [...ownedSeedelfs].sort(() => Math.random() - 0.5).slice(0, 1),
    [ownedSeedelfs],
  )[0];

  const handleClear = () => {
    setAddress("");
    setSeedelf("");
    setSeedelfExist(false);
    setAda(0);
    setIsSelfSend(false);
  };

  const handleAddressValid = async (a: string) => {
    setVariant("error");

    if (!a.trim()) return setMessage("Wallet address is required.");

    if (network == "mainnet" && !a.includes("addr1"))
      return setMessage("Incorrect Mainnet Address Format");

    if (network == "preprod" && !a.includes("addr_test1"))
      return setMessage("Incorrect Pre-Production Address Format");

    const notScript = await isNotAScript(a);
    if (!notScript) return setMessage("Address Is A Script");

    setVariant("info");
    setMessage("Address is valid");
    setAddressValid(true);
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
      setMessage("Building Fund Seedelf Transaction");

      const txCbor = await fundSeedelf(network, address, seedelf, lovelace);
      if (txCbor) {
        setShowWebServerModal(true);
        await runWebServer(txCbor, network);
      } else {
        setShowWebServerModal(false);
        setVariant("error");
        setMessage("Transaction Failed To Build");
      }
      handleClear();
    } catch (e: any) {
      setVariant("error");
      setMessage(e as string);
    } finally {
      setSubmitting(false);
    }
  };

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

      <div className="my-4 w-full">
        <div className="relative mx-auto w-full max-w-5/8">
          <TextField
            label="Address"
            title="A CIP30 wallet address"
            value={address}
            onChange={(e) => {
              const next = e.target.value;
              setAddress(next);
              handleAddressValid(next);
            }}
            disabled={submitting}
            maxLength={108}
            size={108}
          />

          <button
            type="button"
            title="Verify the address"
            className={`absolute bottom-0 right-0 translate-x-full ml-2 flex items-center justify-center p-2 ${address ? (addressValid ? colorClasses.green.text : colorClasses.red.text) : ""}`}
            disabled
          >
            <SearchCheck />
          </button>
        </div>
      </div>

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
            size={64}
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
        <NumberField
          label="Ada"
          value={ada}
          onChange={setAda}
          min={0}
          className="flex-1 min-w-0 text-center rounded-xl border px-3 py-2 focus:outline-none focus:ring"
        />
      </div>

      <div className="grid grid-cols-3 items-center my-4 max-w-5/8 mx-auto w-full">
        <Checkbox
          label="Send To Self?"
          checked={isSelfSend}
          onCheckedChange={() => {
            if (isSelfSend) {
              setSeedelf("");
              setSeedelfExist(false);
              setIsSelfSend(false);
            } else {
              setSeedelf(selfSeedelf);
              setSeedelfExist(true);
              setIsSelfSend(true);
            }
          }}
          baseColor={colorClasses.green.text}
          title="Fund one of your existing seedelfs"
        />

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            title="Fund an existing seedelf"
            onClick={handleSubmit}
            className={`rounded-xl ${colorClasses.sky.bg} px-4 py-2 text-sm disabled:opacity-50`}
            disabled={submitting || !address || !seedelf || !ada || !confirm}
          >
            Fund
          </button>

          {(address.length != 0 || seedelf.length != 0 || ada > 0) && (
            <button
              type="button"
              title="Clear all fields"
              onClick={handleClear}
              className={`rounded-xl ${colorClasses.slate.bg} px-4 py-2 text-sm disabled:opacity-50`}
              disabled={submitting || !confirm}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
