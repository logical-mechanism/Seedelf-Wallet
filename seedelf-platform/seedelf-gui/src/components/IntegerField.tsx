import { InputHTMLAttributes, ChangeEvent } from "react";

type IntegerFieldProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange">;

export function IntegerField({
  label,
  value,
  onChange,
  ...props
}: IntegerFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") return onChange(0);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) onChange(parsed);
  };

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        step={1}
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        className="rounded border px-3 py-2 focus:outline-none focus:ring"
        {...props}
      />
    </label>
  );
}
