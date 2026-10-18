// Scripts written right to left. Tarab's library is often Arabic, with Persian, Urdu and Hebrew
// metadata close behind.
const RTL_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LETTER = /\p{L}/u;

/**
 * Direction of a text from its first strong letter (the rule `dir="auto"` uses), or null when it
 * has no letters (numbers, punctuation).
 */
export function textDirection(text: string | null | undefined): 'rtl' | 'ltr' | null {
  if (!text) return null;
  for (const char of text) {
    if (LETTER.test(char)) return RTL_LETTER.test(char) ? 'rtl' : 'ltr';
  }
  return null;
}
