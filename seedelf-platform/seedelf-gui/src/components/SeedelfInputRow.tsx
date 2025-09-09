import { TextField } from "@/components/TextField";
import { NumberField } from "@/components/NumberField";
import { SearchCheck, X } from "lucide-react";

type SeedelfInputRowProps = {
  seedelf: string;
  ada: number;
  seedelfExist: boolean;
  onSeedelfChange: (value: string) => void;
  onAdaChange: (value: number) => void;
  /** Optional: parent-side validation hook; called after onSeedelfChange */
  onValidateSeedelf?: (value: string) => void;
  /** Optional: show a remove button when provided */
  onRemove?: () => void;
  /** Optional wrapper class override */
  className?: string;
  colorClasses: any;
  hideDelete?: boolean;
};

export function SeedelfInputRow({
  seedelf,
  ada,
  seedelfExist,
  onSeedelfChange,
  onAdaChange,
  onValidateSeedelf,
  onRemove,
  className,
  colorClasses,
  hideDelete = true,
}: SeedelfInputRowProps) {
  return (
    <div className={`my-4 w-full ${className ?? ""}`}>
      <div className="mx-auto flex max-w-[62.5%] items-end gap-3 justify-between">
        {/* Fixed 64ch input */}
        <div className="flex items-center gap-2">
          <TextField
            label="Seedelf"
            title="Seedelf to pay"
            value={seedelf}
            onChange={(e) => {
              const next = e.target.value;
              onSeedelfChange(next);
              onValidateSeedelf?.(next);
            }}
            minLength={64}
            maxLength={64}
            size={64}
            className="font-mono"
          />

          <button
            type="button"
            title="Is the seedelf verified?"
            className={`flex items-center justify-center p-2 mt-6 ${
              seedelf
                ? seedelfExist
                  ? colorClasses.green.text
                  : colorClasses.red.text
                : ""
            }`}
            disabled
            aria-label="Seedelf verification status"
          >
            <SearchCheck />
          </button>
        </div>

        <NumberField
          label="Ada"
          value={ada}
          onChange={onAdaChange}
          min={0}
          className="flex-1 min-w-0 text-right rounded-xl border px-3 py-2 focus:outline-none focus:ring"
        />

        {onRemove && (
          <button
            type="button"
            title="Remove row"
            onClick={onRemove}
            className={`p-2 ${colorClasses.slate.text ?? ""} ${hideDelete ? "invisible" : ""}`}
          >
            <X />
          </button>
        )}
      </div>
    </div>
  );
}
