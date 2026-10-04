// A message's full stop, in whichever of the wallet's languages wrote it. Two
// places used to test for English's alone: an error that ends in Japanese's
// 。 was given an ASCII "." as well ("…応答しませんでした。."), and a reason
// put inside another sentence kept its 。 there ("…除外されます: …。。").

/** What ends a sentence, Latin or full-width. */
const SENTENCE_END = /[.!?。！？]$/;

/** A full stop alone, Latin or full-width: a question or an exclamation is kept. */
const FULL_STOP = /[.。]$/;

/**
 * A message shown as a sentence on its own. The Rust core's reasons are
 * lower-case English fragments, so they get a capital and a full stop; a
 * message that already ends a sentence, in any language, is left as it is.
 */
export function asSentence(message: string): string {
  const text = `${message.charAt(0).toUpperCase()}${message.slice(1)}`;
  return SENTENCE_END.test(text) ? text : `${text}.`;
}

/** A reason from the worker put inside another sentence, which brings its own full stop. */
export const withoutStop = (reason: string): string => reason.trim().replace(FULL_STOP, "");

/**
 * A reason set mid-sentence that must end in a full stop of its own: the Rust
 * core's English fragment gets a ".", and one that already ends a sentence, in
 * any language, keeps its own — never "。.".
 */
export function withStop(reason: string): string {
  const text = reason.trim();
  return SENTENCE_END.test(text) ? text : `${text}.`;
}
