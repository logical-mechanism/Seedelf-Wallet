// A QR code drawn as inline SVG from uqr's module matrix (MIT; a port of
// Project Nayuki's generator). Dark on white whatever the theme, with the
// standard 4-module quiet zone and a whole number of pixels per module,
// because that's what phone scanners read most reliably.

import { useMemo } from "react";
import { encode } from "uqr";

/** `maxSize` is rounded down to a whole number of pixels per module. */
export function QrCode({ text, maxSize = 232, label }: { text: string; maxSize?: number; label: string }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 4 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, modules: qr.size };
  }, [text]);
  const size = Math.max(1, Math.floor(maxSize / modules)) * modules;

  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#011833" />
    </svg>
  );
}
