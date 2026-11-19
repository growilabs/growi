// Python str semantics the splitters rely on, where JS differs.

// str.isspace(): JS \s adds U+FEFF and lacks U+001C-U+001F and U+0085.
const PYTHON_BLANK =
  '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const ALL_BLANK = new RegExp(`^[${PYTHON_BLANK}]*$`);

/** str.strip() leaves nothing. */
export const isBlank = (text: string): boolean => ALL_BLANK.test(text);

/** A character class matching what Python's \S matches. */
export const PYTHON_NON_BLANK = `[^${PYTHON_BLANK}]`;

// MULTILINE ^ and $ in Python break lines at '\n' only; JS's m flag also
// breaks at '\r', U+2028 and U+2029.
export const LINE_START = '(?<![^\\n])';
export const LINE_END = '(?![^\\n])';

/** str.strip(chars) for a set of single characters. */
export const stripChars = (text: string, chars: string): string => {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) {
    start++;
  }
  while (end > start && chars.includes(text[end - 1])) {
    end--;
  }
  return text.slice(start, end);
};
