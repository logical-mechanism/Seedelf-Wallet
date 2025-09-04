import { Plus, Trash2 } from "lucide-react";

export type ToggleMode = "Create" | "Remove";

interface CreateRemoveToggleProps {
  value: ToggleMode;
  onChange: (v: ToggleMode) => void;
  disabled?: boolean;
  leftOption?: string;
  rightOption?: string;
  className?: string;
}

export function CreateRemoveToggle({
  value,
  onChange,
  disabled,
  leftOption = "Create",
  rightOption = "Remove",
  className = "",
}: CreateRemoveToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Mode"
      className={`inline-flex items-center justify-center rounded-xl border p-1 ${className}`}
    >
      <button
        role="tab"
        aria-selected={value === "Create"}
        disabled={disabled}
        onClick={() => onChange("Create")}
        className={`flex items-center gap-1 rounded-xl px-3 py-1 text-sm
          ${value === "Create" ? "bg-teal-600 text-white" : "text-zinc-600 hover:bg-zinc-100"}
          disabled:opacity-50`}
      >
        <Plus className="h-4 w-4" />
        {leftOption}
      </button>

      <button
        role="tab"
        aria-selected={value === "Remove"}
        disabled={disabled}
        onClick={() => onChange("Remove")}
        className={`ml-1 flex items-center gap-1 rounded-xl px-3 py-1 text-sm
          ${value === "Remove" ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100"}
          disabled:opacity-50`}
      >
        <Trash2 className="h-4 w-4" />
        {rightOption}
      </button>
    </div>
  );
}
