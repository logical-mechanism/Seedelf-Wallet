import { useState } from "react";
import { useOutletContext } from "react-router";
import { Delete, SearchCheck } from "lucide-react";
import { OutletContextType } from "@/types/layout";
import { useNetwork } from "@/types/network";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { isNotAScript } from "./api";
import { TextField } from "@/components/TextField";
import { CreateRemoveToggle, ToggleMode } from "@/components/Toggle";
import { WebServerModal } from "@/components/WebServerModal";
import { ExplorerLinkModal } from "@/components/ExplorerLinkModal";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { createSeedelf, removeSeedelf } from "./transactions";
import { runWebServer } from "./webServer";
import { colorClasses } from "./colors";

export function Manage() {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [seedelf, setSeedelf] = useState("");

  const [txHash, setTxHash] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");

  const [submitting, setSubmitting] = useState(false);

  const [showWebServerModal, setShowWebServerModal] = useState<boolean>(false);
  const [showExplorerLinkModal, setShowExplorerLinkModal] =
    useState<boolean>(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [mode, setMode] = useState<ToggleMode>("Create");

  const { network } = useNetwork();
  const { allSeedelfs, ownedSeedelfs } = useOutletContext<OutletContextType>();
  const [addressValid, setAddressValid] = useState<boolean>(false);
  const [seedelfExist, setSeedelfExist] = useState<boolean>(false);

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

  const selectSeedelf = async (text: string) => {
    setVariant("info");
    setMessage(`${text} has been selected`);
    setSeedelf(text);
    handleSeedelfExist(text);
    // the list may be long so scroll back up to the inputs
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClear = () => {
    setAddress("");
    setSeedelf("");
    setLabel("");
  };

  const handleSubmit = async () => {
    setVariant("error");
    // Simple custom rules
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

    // start the subbit process
    setSubmitting(true);
    let success = false;
    try {
      // invoke the create or remove function
      if (mode == "Remove") {
        setVariant("info");
        setMessage("Building Remove Transaction");

        const _txHash = await removeSeedelf(network, address, seedelf);
        if (_txHash) {
          setTxHash(_txHash);
          setShowWebServerModal(false);
          setShowExplorerLinkModal(true);
        } else {
          setShowWebServerModal(false);
          setShowExplorerLinkModal(false);
          setVariant("error");
          setMessage("Transaction Failed To Build");
        }
        handleClear();
      } else {
        // create a seedelf
        setVariant("info");
        setMessage("Building Create Transaction");

        const txCbor = await createSeedelf(network, address, label);
        if (txCbor) {
          setShowExplorerLinkModal(false);
          setShowWebServerModal(true);
          await runWebServer(txCbor, network);
        } else {
          setShowExplorerLinkModal(false);
          setShowWebServerModal(false);
          setVariant("error");
          setMessage("Transaction Failed To Build");
        }
        handleClear();
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

      <WebServerModal
        open={showWebServerModal}
        url={"http://127.0.0.1:44203/"} // local web server url
        onClose={() => {
          setVariant("info");
          setMessage("Stopping Web Server..");
          setShowWebServerModal(false);
        }}
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

      <CreateRemoveToggle value={mode} onChange={setMode} />

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

      {mode == "Create" && (
        <div className="my-4 max-w-5/8 mx-auto w-full">
          <TextField
            label="Label (Optional)"
            title="An optional seedelf label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting}
            maxLength={15}
            size={15}
          />
        </div>
      )}

      {mode == "Remove" && (
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
      )}

      <div className="flex items-center justify-center my-4 gap-4">
        <button
          type="button"
          onClick={() => {
            if (mode == "Remove") {
              setShowConfirmationModal(true);
            } else {
              handleSubmit();
            }
          }}
          className={`rounded-xl ${colorClasses.sky.bg} px-4 py-2 text-sm disabled:opacity-50`}
          disabled={
            submitting ||
            !address ||
            (mode == "Remove" ? !seedelf : false) ||
            !confirm
          }
          title={`${mode} a seedelf`}
        >
          {mode}
        </button>

        {(address.length != 0 || seedelf.length != 0 || label.length != 0) && (
          <button
            type="button"
            onClick={handleClear}
            className={`rounded-xl ${colorClasses.slate.bg} px-4 py-2 text-sm disabled:opacity-50`}
            disabled={submitting || !confirm}
          >
            Clear
          </button>
        )}
      </div>

      <div
        className={`${ownedSeedelfs.length === 0 ? "" : `rounded-xl flex items-center justify-center max-w-1/2 mx-auto mt-12 + ${mode == "Remove" ? "border" : ""}`}`}
      >
        {ownedSeedelfs.length === 0 || mode == "Create" ? (
          <></>
        ) : (
          <ul className="space-y-3 m-4 w-full max-[960px]:hidden">
            {ownedSeedelfs.map((h) => (
              <li key={`${h}`} className="m-4 p-4">
                <div className="flex items-center gap-2 w-full min-w-0">
                  <code className="min-w-0 truncate font-bold pr-16">{h}</code>
                  <button
                    type="button"
                    title="Select this seedelf to delete"
                    aria-label="Delete Seedelf"
                    onClick={() => selectSeedelf(h)}
                    className=""
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
