import { InputHTMLAttributes, ChangeEvent, useEffect, useState } from "react";

type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange">;

const DECIMALS = 6;
const MAX = 45_000_000_000;

const round6 = (n: number) =>
  Math.floor(n * Math.pow(10, DECIMALS)) / Math.pow(10, DECIMALS);
const clamp = (n: number) => Math.min(Math.max(n, 0), MAX);
const re = new RegExp(`^\\d*(?:\\.\\d{0,${DECIMALS}})?$`);

export function NumberField({
  label,
  value,
  onChange,
  ...props
}: NumberFieldProps) {
  const [raw, setRaw] = useState("");

  useEffect(() => {
    setRaw(value === 0 ? "" : String(round6(value)));
  }, [value]);

  const handleBeforeInput: React.FormEventHandler<HTMLInputElement> = (e) => {
    const input = e.currentTarget;
    const ie = e.nativeEvent as InputEvent;
    const data = ie.data;
    if (data == null) return;

    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const next = input.value.slice(0, start) + data + input.value.slice(end);

    if (!re.test(next)) e.preventDefault();
  };

  const handlePaste: React.ClipboardEventHandler<HTMLInputElement> = (e) => {
    const input = e.currentTarget;
    const text = e.clipboardData.getData("text");
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const next = input.value.slice(0, start) + text + input.value.slice(end);
    if (!re.test(next)) e.preventDefault();
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const s = e.target.value;
    if (s === "") {
      setRaw("");
      onChange(0);
      return;
    }
    if (!re.test(s)) return;

    const n = Number(s);
    if (Number.isFinite(n)) {
      const clamped = clamp(n);
      onChange(clamped);
      // If user exceeded MAX, snap display to MAX immediately
      if (clamped !== n) {
        setRaw(String(clamped));
        return;
      }
    }
    // For partial states like ".", "1.", keep the text
    setRaw(s);
  };

  const handleBlur = () => {
    let n = Number(raw || 0);
    if (!Number.isFinite(n)) n = 0;
    n = round6(clamp(n));
    onChange(n);
    setRaw(n === 0 ? "" : String(n));
  };

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="text"
        inputMode="decimal"
        pattern={`\\d*(\\.\\d{0,${DECIMALS}})?`}
        value={raw}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="0.000000"
        {...props}
      />
    </label>
  );
}
