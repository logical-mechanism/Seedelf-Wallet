// One box per recovery-phrase word, each with BIP39 autocomplete. Pasting a
// whole phrase into any box fills them all. Lace's and Eternl's restore
// screens are the reference for the behaviour, not the code.

import { useEffect, useId, useRef, useState } from "react";

import { wordlist } from "../background";

export const WORD_COUNTS = [12, 15, 24] as const;
export type WordCount = (typeof WORD_COUNTS)[number];

const MAX_SUGGESTIONS = 5;

/** The BIP39 list, loaded once from the worker; empty until it arrives. */
export function useWordlist(): string[] {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    wordlist().then((w) => live && setList(w), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** Splits pasted or typed text into lower-case words. */
export function splitWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

interface PhraseInputProps {
  words: string[];
  onChange: (words: string[]) => void;
  /** Called when a pasted phrase has a different supported length. */
  onCountChange?: (count: WordCount) => void;
  /** Only these (1-based) positions get a box; used to confirm a new phrase. */
  positions?: number[];
}

export function PhraseInput({ words, onChange, onCountChange, positions }: PhraseInputProps) {
  const list = useWordlist();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const shown = positions ?? words.map((_, i) => i + 1);

  function focusBox(slot: number) {
    const input = inputs.current[slot];
    if (input) {
      input.focus();
      input.select();
    }
  }

  function setWord(index: number, word: string) {
    const next = words.slice();
    next[index] = word;
    onChange(next);
  }

  function paste(text: string): boolean {
    const pasted = splitWords(text);
    if (pasted.length < 2 || positions) return false;
    let count = words.length;
    if ((WORD_COUNTS as readonly number[]).includes(pasted.length) && pasted.length !== count) {
      count = pasted.length;
      onCountChange?.(count as WordCount);
    }
    const next = Array.from({ length: count }, (_, i) => pasted[i] ?? "");
    onChange(next);
    // Don't leave the phrase sitting on the clipboard.
    navigator.clipboard?.writeText("").catch(() => undefined);
    setTimeout(() => focusBox(Math.min(pasted.length, count) - 1), 0);
    return true;
  }

  return (
    <ol className="phrase-grid" data-count={shown.length}>
      {shown.map((position, slot) => (
        <WordBox
          key={position}
          position={position}
          value={words[position - 1] ?? ""}
          list={list}
          inputRef={(el) => {
            inputs.current[slot] = el;
          }}
          onChange={(w) => setWord(position - 1, w)}
          onAccept={(w) => {
            setWord(position - 1, w);
            if (slot + 1 < shown.length) focusBox(slot + 1);
          }}
          onPaste={paste}
        />
      ))}
    </ol>
  );
}

interface WordBoxProps {
  position: number;
  value: string;
  list: string[];
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (word: string) => void;
  /** A word was chosen; move on to the next box. */
  onAccept: (word: string) => void;
  /** Returns true if the paste was handled as a whole phrase. */
  onPaste: (text: string) => boolean;
}

function WordBox({ position, value, list, inputRef, onChange, onAccept, onPaste }: WordBoxProps) {
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const exact = list.length > 0 && list.includes(value);
  const suggestions =
    focused && value && !exact ? list.filter((w) => w.startsWith(value)).slice(0, MAX_SUGGESTIONS) : [];
  const invalid = touched && !focused && value !== "" && list.length > 0 && !exact;
  const open = suggestions.length > 0;

  function accept(word: string) {
    setActive(0);
    onAccept(word);
  }

  return (
    <li className="word">
      <span className="word__n" aria-hidden="true">
        {position}
      </span>
      <input
        ref={inputRef}
        className="word__input"
        aria-label={`Word ${position}`}
        aria-invalid={invalid || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
        }}
        onChange={(e) => {
          setActive(0);
          setFocused(true);
          onChange(e.target.value.trim().toLowerCase());
        }}
        onPaste={(e) => {
          if (onPaste(e.clipboardData.getData("text"))) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (open && e.key === "ArrowDown") {
            e.preventDefault();
            setActive((active + 1) % suggestions.length);
          } else if (open && e.key === "ArrowUp") {
            e.preventDefault();
            setActive((active + suggestions.length - 1) % suggestions.length);
          } else if (open && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            accept(suggestions[active]!);
          } else if (e.key === " " || (e.key === "Enter" && exact)) {
            e.preventDefault();
            if (exact) accept(value);
            else if (suggestions.length === 1) accept(suggestions[0]!);
          } else if (e.key === "Escape") {
            setFocused(false);
          }
        }}
      />
      {open && (
        <ul className="suggestions" role="listbox" id={listId} aria-label={`Suggestions for word ${position}`}>
          {suggestions.map((word, i) => (
            <li
              key={word}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "suggestion suggestion--active" : "suggestion"}
              // mousedown, not click: keep focus in the input until the word is taken.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(word);
              }}
            >
              <strong>{word.slice(0, value.length)}</strong>
              {word.slice(value.length)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
