import { InputHTMLAttributes } from "react";

export function TextField({
  label,
  title,
  size,
  ...props
}: {
  label: string;
  title: string;
  size: number;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm" title={title}>
      {label}
      <input
        {...props}
        size={size}
        className="rounded border px-3 py-2 focus:outline-none focus:ring"
      />
    </label>
  );
}
