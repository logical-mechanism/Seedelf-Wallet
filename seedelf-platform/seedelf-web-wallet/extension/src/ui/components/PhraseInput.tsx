// One box per recovery-phrase word, each with BIP39 autocomplete. Pasting a
// whole phrase into any box fills them all. Lace's and Eternl's restore
// screens are the reference for the behaviour, not the code.

import { useEffect, useId, useRef, useState } from "react";
import { t, useT } from "../../i18n";

import { wordlist } from "../background";
import { asSentence } from "../sentence";

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

/**
 * Why typed words the worker refused aren't a phrase, in the user's language: the first word off the BIP39 list,
 * by its number, or else that the words don't make one (the checksum, never named: chunk 23's second review,
 * FR-7). The worker's own reason, core's English, only when the list can't be had to tell which.
 */
export async function phraseProblem(words: string[], reason: string): Promise<string> {
  let list: string[];
  try {
    list = await wordlist();
  } catch {
    return asSentence(reason);
  }
  const unknown = words.findIndex((w) => !list.includes(w));
  return unknown >= 0 ? t("restore.warn.notAWord", { number: unknown + 1 }) : t("restore.warn.notAPhrase");
}

interface PhraseInputProps {
  words: string[];
  onChange: (words: string[]) => void;
  /** Called when a pasted phrase has a different supported length. */
  onCountChange?: (count: WordCount) => void;
  /** Only these (1-based) positions get a box; used to confirm a new phrase. */
  positions?: number[];
  /** Positions (1-based) whose word is known to be wrong: each box is outlined, as an unknown word's is. */
  wrong?: number[];
}

export function PhraseInput({ words, onChange, onCountChange, positions, wrong }: PhraseInputProps) {
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
          wrong={!!wrong?.includes(position)}
          // The confirm step's few boxes, one to a row, have room to name their word and say what's wrong with it.
          labelled={!!positions}
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
  /** Known to be wrong, though it may be on the list: a confirm word that doesn't match. */
  wrong: boolean;
  /** "Word 7" as a label over the box, and a word off the list said under it, rather than the number inside. */
  labelled: boolean;
  list: string[];
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (word: string) => void;
  /** A word was chosen; move on to the next box. */
  onAccept: (word: string) => void;
  /** Returns true if the paste was handled as a whole phrase. */
  onPaste: (text: string) => boolean;
}

function WordBox({ position, value, wrong, labelled, list, inputRef, onChange, onAccept, onPaste }: WordBoxProps) {
  const t = useT();
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const problemId = useId();

  const exact = list.length > 0 && list.includes(value);
  const matches = value && !exact ? list.filter((w) => w.startsWith(value)) : [];
  const suggestions = focused ? matches.slice(0, MAX_SUGGESTIONS) : [];
  // Off the list once it's left, or at once when no word starts with what's typed: "jokes" needn't wait for a blur
  // (chunk 23's second review, FR-6).
  const offList = value !== "" && list.length > 0 && !exact && (!matches.length || (touched && !focused));
  const invalid = wrong || offList;
  const open = suggestions.length > 0;
  const label = t("phrase.wordNumber", { number: position });

  function accept(word: string) {
    setActive(0);
    onAccept(word);
  }

  const box = (
    <>
      {!labelled && (
        <span className="word__n" aria-hidden="true">
          {position}
        </span>
      )}
      <input
        ref={inputRef}
        id={inputId}
        className="word__input"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={labelled && offList ? problemId : undefined}
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
        <ul className="suggestions" role="listbox" id={listId} aria-label={t("phrase.suggestions", { number: position })}>
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
    </>
  );

  if (!labelled) return <li className="word">{box}</li>;
  return (
    <li className="word-field">
      <label className="word-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="word">{box}</div>
      {offList && (
        <p className="word-field__error" id={problemId}>
          {t("phrase.notOnList")}
        </p>
      )}
    </li>
  );
}
