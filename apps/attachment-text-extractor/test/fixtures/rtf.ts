// Ported from `_rtf_escape` and the `rtf` fixture in the Python service's
// tests/fixture_files.py, so the bytes stay identical for BMP text. Outside the
// BMP this writes a surrogate pair, where the Python helper wrote one invalid
// \u value.

const ASCII_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '{': '\\{',
  '}': '\\}',
  '\n': '\\par\n',
};

// Non-ASCII is written as \uN? per UTF-16 code unit, N signed 16-bit as RTF
// requires; `?` is the fallback for readers without Unicode support.
const escapeCodeUnit = (unit: string): string => {
  const code = unit.charCodeAt(0);
  if (code < 128) {
    return ASCII_ESCAPES[unit] ?? unit;
  }
  return `\\u${code < 32768 ? code : code - 65536}?`;
};

const escapeRtf = (text: string): string =>
  Array.from({ length: text.length }, (_, i) => escapeCodeUnit(text[i])).join(
    '',
  );

/** An ASCII-only RTF document; each line of `text` is a paragraph. */
export const buildRtf = (text: string): Buffer =>
  Buffer.from(
    `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\uc1\\f0 ${escapeRtf(text)}\\par\n}`,
    'ascii',
  );
