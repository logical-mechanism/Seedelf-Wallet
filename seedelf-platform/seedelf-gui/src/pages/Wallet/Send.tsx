import { useState, useMemo } from "react";
import { useOutletContext } from "react-router";
import { CirclePlus } from "lucide-react";
import { ExplorerLinkModal } from "@/components/ExplorerLinkModal";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { SeedelfInputRow } from "@/components/SeedelfInputRow";
import { useNetwork } from "@/types/network";
import { OutletContextType } from "@/types/layout";
import { colorClasses } from "./colors";
import { sendSeedelf } from "./transactions";

const MAX_LOVELACE = 1_500_000;
const TMP_FEE = 250_000;

type ExtraRow = {
  id: string;
  seedelf: string;
  ada: number;
  exist: boolean;
};

export function Send() {
  const [extras, setExtras] = useState<ExtraRow[]>([]);

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

  const { allSeedelfs, lovelace } = useOutletContext<OutletContextType>();
  const [seedelfExist, setSeedelfExist] = useState<boolean>(false);

  const makeRow = (): ExtraRow => ({
    id: crypto.randomUUID(), // makes unique rows
    seedelf: "",
    ada: 0,
    exist: false,
  });

  const addRow = () => setExtras((prev) => [...prev, makeRow()]);

  const removeRow = (id: string) =>
    setExtras((prev) => prev.filter((r) => r.id !== id));

  const updateRow = (id: string, patch: Partial<ExtraRow>) =>
    setExtras((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const isSeedelfValid = (value: string) => {
    const validFormat = value.includes("5eed0e1f");
    const validLen = value.length === 64;
    const existsInIndex = allSeedelfs.includes(value);
    return !!(validFormat && validLen && existsInIndex);
  };

  const validateRowSeedelf = (id: string, value: string) => {
    updateRow(id, { exist: isSeedelfValid(value) });
  };

  const handleClear = () => {
    setSeedelf("");
    setSeedelfExist(false);
    setAda(0);
    setExtras([]);
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

    const cur_lovelace = ada * 1_000_000;
    const tot_lovelace = lovelace * 1_000_000;

    // lovelace checks; simple hardcore for now
    // this will need to be dynamic based off the tokens being sent later on
    if (cur_lovelace < MAX_LOVELACE)
      return setMessage(`Minimum is 1.5 ${network == "mainnet" ? "₳" : "t₳"}`);

    // should be good to run the build tx function now
    const rows = [{ seedelf, ada }, ...extras];
    const seedelfs = rows.map((r) => r.seedelf.trim());
    const lovelaces = rows.map((r) => Math.round(r.ada * 1_000_000));

    if (lovelaces.some((l) => l <= MAX_LOVELACE))
      return setMessage(`Minimum is 1.5 ${network == "mainnet" ? "₳" : "t₳"}`);
    if (
      lovelaces.reduce((sum, c) => sum + c, 0) >
      tot_lovelace - MAX_LOVELACE - TMP_FEE
    )
      return setMessage(`Not Enough Ada`);

    try {
      setVariant("info");
      setMessage("Building Send To Seedelf Transaction");

      const _txHash = await sendSeedelf(network, seedelfs, lovelaces);
      if (_txHash) {
        setTxHash(_txHash);
        setShowConfirmationModal(false);
        setShowExplorerLinkModal(true);
      } else {
        setShowConfirmationModal(false);
        setShowExplorerLinkModal(false);
      }
      handleClear();
    } catch (e: any) {
      setVariant("error");
      setMessage(e as string);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = useMemo(() => {
    const rows = [{ seedelf, ada }, ...extras];

    const isFilled = (r: { seedelf: string; ada: number }) =>
      r.seedelf.trim().length > 0 && r.ada > 0;
    const isEmpty = (r: { seedelf: string; ada: number }) =>
      r.seedelf.trim().length === 0 && r.ada === 0;

    // No partial rows ever
    if (rows.some((r) => !(isFilled(r) || isEmpty(r)))) return false;

    // If any extras exist, require ALL rows filled (no empties allowed)
    if (extras.length > 0 && rows.some(isEmpty)) return false;

    // Otherwise (single-row mode): require at least one filled row
    const active = rows.filter(isFilled);
    if (active.length === 0) return false;

    // Validate all filled rows
    return active.every((r) => isSeedelfValid(r.seedelf) && r.ada >= 1.5);
  }, [seedelf, ada, extras]);

  return (
    <div className="w-full p-6">
      <div className="flex items-center my-4 max-w-5/8 mx-auto w-full">
        <h1 className="text-xl font-semibold text-center flex items-center gap-2 mx-auto">
          Send To A Seedelf
        </h1>
        <button
          type="button"
          title="Add another seedelf output?"
          onClick={addRow}
          className={`ml-auto p-2 ${colorClasses.pink.text}`}
        >
          <CirclePlus />
        </button>
      </div>

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

      <SeedelfInputRow
        seedelf={seedelf}
        ada={ada}
        seedelfExist={seedelfExist}
        onSeedelfChange={setSeedelf}
        onAdaChange={setAda}
        onValidateSeedelf={handleSeedelfExist}
        onRemove={() => {}}
        colorClasses={colorClasses}
      />

      {/* extra rows */}
      {extras.map((row) => (
        <SeedelfInputRow
          key={row.id}
          seedelf={row.seedelf}
          ada={row.ada}
          seedelfExist={row.exist}
          onSeedelfChange={(next) => updateRow(row.id, { seedelf: next })}
          onValidateSeedelf={(next) => validateRowSeedelf(row.id, next)}
          onAdaChange={(n) => updateRow(row.id, { ada: n })}
          onRemove={() => removeRow(row.id)}
          colorClasses={colorClasses}
          hideDelete={false}
        />
      ))}

      <div className="flex items-center my-4 max-w-5/8 mx-auto w-full">
        {/* Middle buttons */}
        <div className="flex items-center gap-2 mx-auto">
          <button
            type="button"
            title="Send funds"
            onClick={() => {
              setShowConfirmationModal(true);
            }}
            className={`rounded-xl ${colorClasses.sky.bg} px-4 py-2 text-sm disabled:opacity-50`}
            disabled={submitting || !canSubmit || !confirm}
          >
            Send
          </button>

          {(seedelf.length !== 0 || ada > 0) && (
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
