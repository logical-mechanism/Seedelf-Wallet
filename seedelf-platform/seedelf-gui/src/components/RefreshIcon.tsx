interface RefreshIconProps {
  size?: number;
  className?: string;
  spin?: boolean;
}

export function RefreshIcon({
  size = 20,
  className = "",
  spin = false,
}: RefreshIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${spin ? "animate-spin" : ""} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.13-3.36L23 10M1 14l5.37 5.37A9 9 0 0020.49 15" />
    </svg>
  );
}
