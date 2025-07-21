import { InputHTMLAttributes } from "react";

export function TextField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        {...props}
        className="rounded border px-3 py-2 focus:outline-none focus:ring"
      />
    </label>
  );
}
