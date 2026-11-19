// A recovery phrase as numbered words, dotted out until revealed: Create's
// first step, and Settings' Show recovery phrase.
//
// The words are marked not to translate, and are the only thing in the wallet
// that is: Chrome's Translate, on in a language the wallet doesn't speak, sent
// them to Google with the page and showed them translated, so a backup copied
// from Settings was the wrong words. The rest of the wallet translates,
// disclosed (the owner, 2026-11-18, B9, reversing the 2026-10-06 call, C22,
// for these 24 words alone; chunk 51).

export function PhraseGrid({ words, revealed = true }: { words: string[]; revealed?: boolean }) {
  return (
    <ol className="phrase-grid" data-testid="recovery-phrase" aria-hidden={!revealed} translate="no">
      {words.map((word, i) => (
        <li className="word word--static" key={i}>
          <span className="word__n">{i + 1}</span>
          <span className="word__text">{revealed ? word : "••••••"}</span>
        </li>
      ))}
    </ol>
  );
}
