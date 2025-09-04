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
          "peer-checked:bg-green-600 peer-checked:border-white-600 peer-checked:text-white",
        ].join(" ")}
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}
