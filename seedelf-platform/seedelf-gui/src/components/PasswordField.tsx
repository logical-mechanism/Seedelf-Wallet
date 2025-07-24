import { useState } from "react";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function PasswordField({ label, value, onChange, disabled }: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <div className="relative">
        <input
          disabled={disabled}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-3 py-2 pr-10 focus:outline-none focus:ring"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShow((x) => !x)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}
