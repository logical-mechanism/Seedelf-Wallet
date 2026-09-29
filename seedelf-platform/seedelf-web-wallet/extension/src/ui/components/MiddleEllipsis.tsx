// A long id on one line: whole when it fits, otherwise cut in the middle as
// the space narrows, keeping its last `tail` characters. The head gives way
// (text-overflow: ellipsis) and the tail never does, so no measuring is
// needed. The text is all there, for copying, screen readers and the title.

export function MiddleEllipsis({ text, tail = 6, testId }: { text: string; tail?: number; testId?: string }) {
  return (
    <span className="middle-ellipsis" title={text} data-testid={testId} data-value={text}>
      <span className="middle-ellipsis__head">{text.slice(0, -tail)}</span>
      <span className="middle-ellipsis__tail">{text.slice(-tail)}</span>
    </span>
  );
}
