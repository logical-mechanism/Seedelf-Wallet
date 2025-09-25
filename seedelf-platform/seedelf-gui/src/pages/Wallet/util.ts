/// store util functions here

export const display_ascii = (text: string) => {
  let hex = text.slice(8, 38);
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes.push(byte);
  }
  const printable = (b: number) => b >= 32 && b <= 126;

  const chars = bytes
    .filter(printable)
    .map((b) => String.fromCharCode(b))
    .join("");

  return chars;
};
