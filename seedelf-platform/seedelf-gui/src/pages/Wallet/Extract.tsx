import { useState } from "react";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { ExplorerLinkModal } from "@/components/ExplorerLinkModal";
import { useNetwork } from "@/types/network";
import { TextField } from "@/components/TextField";
import { NumberField } from "@/components/NumberField";
import { Checkbox } from "@/components/Checkbox";
import { SearchCheck } from "lucide-react";
import { extractSeedelf } from "./transactions";
import { colorClasses } from "./colors";
import { isNotAScript } from "./api";

import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";

export function Extract() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");

  const [address, setAddress] = useState("");
  const [ada, setAda] = useState(0);

  const { network } = useNetwork();
  const [addressValid, setAddressValid] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [isSendAll, setIsSendAll] = useState<boolean>(false);

  const { lovelace } = useOutletContext<OutletContextType>();

  const [txHash, setTxHash] = useState("");

  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showExplorerLinkModal, setShowExplorerLinkModal] =
    useState<boolean>(false);

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

  const handleClear = () => {
    setAddress("");
    setAddressValid(false);
    setAda(0);
    setIsSendAll(false);
  };

  const handleSubmit = async () => {
    setVariant("error");
    const lovelace = ada * 1_000_000;

    // should be good to run the build tx function now
    try {
      setVariant("info");
      setMessage("Building Extract Seedelf Transaction");
      const _txHash = await extractSeedelf(
        network,
        address,
        lovelace,
        isSendAll,
      );
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
    <div className="p-6 w-full">
      <h1 className="text-xl font-semibold text-center">
        Extract From A Seedelf
      </h1>

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

      <div className="my-4 max-w-5/8 mx-auto w-full">
        <NumberField
          label="Ada"
          value={ada}
          onChange={setAda}
          min={0}
          className="flex-1 min-w-0 text-center rounded border px-3 py-2 focus:outline-none focus:ring"
        />
      </div>

      <div className="grid grid-cols-3 items-center my-4 max-w-5/8 mx-auto w-full">
        <Checkbox
          label="Send All?"
          checked={isSendAll}
          onCheckedChange={() => {
            if (isSendAll) {
              setAddress("");
              setAddressValid(false);
              setIsSendAll(false);
            } else {
              setAddress(address);
              setAda(lovelace);
              setIsSendAll(true);
            }
          }}
          baseColor={colorClasses.green.text}
          title="Send all non-seedelf assets"
        />
        <div className="flex items-center justify-center gap-2 my-4 max-w-5/8 mx-auto w-full">
          <button
            type="button"
            title="Extract funds from the wallet"
            onClick={() => {
              setShowConfirmationModal(true);
            }}
            className={`rounded ${colorClasses.sky.bg} px-4 py-2 text-sm text-white disabled:opacity-50`}
            disabled={submitting || !address || !ada || !confirm}
          >
            Extract
          </button>

          {(address.length != 0 || ada > 0) && (
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
    </div>
  );
}
