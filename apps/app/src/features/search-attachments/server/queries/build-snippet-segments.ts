import type { ISnippetSegment } from '../../interfaces/attachment-search';

/**
 * Parses an ES highlighter fragment string into ISnippetSegment[].
 *
 * Only lowercase `<em>...</em>` tags mark highlighted text; everything else
 * (including `<script>`, `<img onerror=...>`, uppercase `<EM>`) is kept as
 * verbatim text in a plain segment. React text nodes auto-escape this content,
 * so consumers are XSS-safe as long as they never pass the text through
 * dangerouslySetInnerHTML.
 *
 * Algorithm (greedy, left-to-right):
 *  1. Find the next `<em>` in the remaining string.
 *  2. Everything before it → plain segment.
 *  3. Find the first `</em>` after that `<em>` → highlighted segment.
 *     If no `</em>` exists the opening `<em>` and everything after it
 *     is treated as plain text.
 *  4. Repeat with the remainder.
 *  5. Filter out zero-length segments.
 */
export function buildSnippetSegments(fragment: string): ISnippetSegment[] {
  const segments: ISnippetSegment[] = [];
  let remaining = fragment;

  while (remaining.length > 0) {
    const emStart = remaining.indexOf('<em>');

    if (emStart === -1) {
      // No more <em> tags — everything left is plain text.
      segments.push({ text: remaining, highlighted: false });
      break;
    }

    // Text before <em> → plain segment.
    if (emStart > 0) {
      segments.push({ text: remaining.slice(0, emStart), highlighted: false });
    }

    // Advance past the opening `<em>` (4 characters).
    const afterOpen = remaining.slice(emStart + 4);

    const emEnd = afterOpen.indexOf('</em>');

    if (emEnd === -1) {
      // No closing `</em>` — treat the whole `<em>...` as plain text.
      // Re-include the `<em>` tag so the content is not silently dropped.
      segments.push({ text: '<em>' + afterOpen, highlighted: false });
      break;
    }

    // Content between `<em>` and `</em>` → highlighted segment.
    const highlightedText = afterOpen.slice(0, emEnd);
    segments.push({ text: highlightedText, highlighted: true });

    // Advance past `</em>` (5 characters) and continue.
    remaining = afterOpen.slice(emEnd + 5);
  }

  // Drop zero-length segments that arise from adjacent <em> tags or boundary conditions.
  return segments.filter((s) => s.text.length > 0);
}
