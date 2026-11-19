import type { PageInfo } from '../../contract';
import { isBlank, LINE_END, LINE_START, stripChars } from './python-text';

const restored = (
  markdown: string,
  token: string,
  names: readonly (string | null)[],
): string =>
  markdown.replace(new RegExp(`ZZ${token}(\\d+)ZZ`, 'g'), (_marker, digits) => {
    const position = Number.parseInt(digits, 10);
    return position >= 1 && position <= names.length
      ? (names[position - 1] ?? '')
      : '';
  });

interface Heading {
  readonly position: number;
  readonly start: number;
  readonly end: number;
}

const headingsIn = (markdown: string, token: string): Heading[] =>
  Array.from(
    markdown.matchAll(
      new RegExp(`${LINE_START}## ZZ${token}(\\d+)ZZ${LINE_END}`, 'g'),
    ),
    (match) => ({
      position: Number.parseInt(match[1], 10),
      start: match.index,
      end: match.index + match[0].length,
    }),
  );

/** Why the headings cannot be trusted, or null when they explain the output. */
const fallbackReason = (
  markdown: string,
  token: string,
  headings: readonly Heading[],
  sheetCount: number,
): string | null => {
  const positions = headings.map((heading) => heading.position);
  if (markdown.split(token).length - 1 !== headings.length) {
    return 'a marker appears outside a sheet heading';
  }
  if (positions.some((position) => position < 1 || position > sheetCount)) {
    return 'a marker names no sheet';
  }
  if (positions.some((position, i) => i > 0 && position <= positions[i - 1])) {
    return 'markers are out of workbook order';
  }
  if (!isBlank(markdown.slice(0, headings[0]?.start ?? markdown.length))) {
    return 'text precedes the first sheet heading';
  }
  return null;
};

/**
 * Cuts anydoc's output at this call's marker headings: one element per sheet
 * with text, numbered by its position in workbook.xml. Output the markers
 * cannot explain comes back whole, as one unnumbered element.
 */
export const splitByMarkers = (
  markdown: string,
  token: string,
  names: readonly (string | null)[],
): PageInfo[] => {
  // anydoc prints no heading when the workbook lists one sheet.
  if (names.length === 1) {
    return [
      {
        pageNumber: 1,
        label: names[0],
        content: restored(markdown, token, names),
      },
    ];
  }
  const headings = headingsIn(markdown, token);
  if (fallbackReason(markdown, token, headings, names.length) != null) {
    return [
      {
        pageNumber: null,
        label: null,
        content: restored(markdown, token, names),
      },
    ];
  }
  return headings.flatMap((heading, index) => {
    const end = headings[index + 1]?.start ?? markdown.length;
    const content = stripChars(markdown.slice(heading.end, end), '\n');
    return content === ''
      ? []
      : [
          {
            pageNumber: heading.position,
            label: names[heading.position - 1],
            content,
          },
        ];
  });
};
