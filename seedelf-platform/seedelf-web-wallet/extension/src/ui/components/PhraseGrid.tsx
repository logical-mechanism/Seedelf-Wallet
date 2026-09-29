// A recovery phrase as numbered words, dotted out until revealed: Create's
// first step, and Settings' Show recovery phrase.

export function PhraseGrid({ words, revealed = true }: { words: string[]; revealed?: boolean }) {
  return (
    <ol className="phrase-grid" data-testid="recovery-phrase" aria-hidden={!revealed}>
      {words.map((word, i) => (
        <li className="word word--static" key={i}>
          <span className="word__n">{i + 1}</span>
          <span className="word__text">{revealed ? word : "••••••"}</span>
        </li>
      ))}
    </ol>
  );
}
