import { LINE_END, LINE_START, PYTHON_NON_BLANK } from './python-text';

// PowerPoint writes generated alt text as "<description>\n\n<fixed
// sentence>"; anydoc folds each newline into a space, so a whole line of
// "<text>  <fixed sentence>" (two spaces) is that alt text. Author paragraphs
// ending in the same sentence lack the two-space join and are kept.
const FIXED_SENTENCES =
  'Description automatically generated(?: with (?:high|medium|low) confidence)?' +
  '|AI-generated content may be incorrect\\.' +
  '|自動的に生成された説明' +
  '|AI 生成コンテンツは誤りを含む可能性があります。';
const AUTO_ALT_TEXT_LINE = new RegExp(
  `${LINE_START}[^\\n]*${PYTHON_NON_BLANK}  (?:${FIXED_SENTENCES})[ \\t]*(?:\\n\\n?|(?![\\s\\S]))`,
  'g',
);
// anydoc marks a soft line break with a trailing backslash and escapes
// literal ones as "\\", so only an odd run of trailing backslashes ends in
// a marker.
const LINE_BREAK_MARKER = new RegExp(
  `(?<!\\\\)((?:\\\\\\\\)*)\\\\${LINE_END}`,
  'g',
);

/** pptx_split.py's _clean: drops generated alt text and soft line-break markers. */
export const cleanSlideText = (markdown: string): string =>
  markdown.replace(AUTO_ALT_TEXT_LINE, '').replace(LINE_BREAK_MARKER, '$1');
