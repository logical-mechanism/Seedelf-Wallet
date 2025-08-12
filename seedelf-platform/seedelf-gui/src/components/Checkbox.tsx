import { InputHTMLAttributes } from "react";

type CheckboxProps = {
  label?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  baseColor: string;
  title: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange"
>;

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  baseColor,
  title,
  ...props
}: CheckboxProps) {
  return (
    <label
      className="inline-flex items-center gap-2 cursor-pointer select-none"
      title={title}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        {...props}
      />

      {/* Visual box */}
      <span
        className={[
          "grid h-5 w-5 place-items-center rounded border transition-all",
          "peer-focus:outline-none peer-focus:ring peer-focus:ring-offset-2",
          baseColor, // <-- your base color when unchecked
          // success state
          "peer-checked:bg-emerald-600 peer-checked:border-emerald-600 peer-checked:text-white",
        ].join(" ")}
        aria-hidden
      >
        {/* check icon */}
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 opacity-0 transition-opacity peer-checked:opacity-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 10l3 3 7-7" />
        </svg>
      </span>

      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}
