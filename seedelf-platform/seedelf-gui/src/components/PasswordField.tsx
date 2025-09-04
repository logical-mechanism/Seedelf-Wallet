import { colorClasses } from "@/pages/Wallet/colors";
import { useState } from "react";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function PasswordField({
  label,
  value,
  onChange,
  disabled,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [focused, setFocused] = useState(true);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsOn(e.getModifierState("CapsLock"));
  };

  const handleBlur = () => {
    setFocused(false);
  };

  const handleFocus = () => {
    setFocused(true);
  };

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <div className="relative">
        <input
          disabled={disabled}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          onKeyUp={handleKey}
          onBlur={handleBlur}
          onFocus={handleFocus}
          className="w-full rounded-xl border px-3 py-2 pr-10 focus:outline-none focus:ring"
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
      {focused && capsOn && (
        <span className={`mt-1 text-xs ${colorClasses.red.text}`}>
          Caps Lock is On
        </span>
      )}
    </label>
  );
}
