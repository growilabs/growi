import type { UseCodeMirrorEditor } from '@growi/editor/dist/client/services/use-codemirror-editor';

export type PageBodyContextResult = {
  content: string;
  isPartial: boolean;
  startIndex?: number; // Only present when partial
  endIndex?: number; // Only present when partial
  totalLength: number; // Total length of the original document
};

/**
 * Get page body text for AI context processing
 * @param codeMirrorEditor - CodeMirror editor instance
 * @param maxLengthBeforeCursor - Maximum number of characters to include before cursor position
 * @param maxLengthAfterCursor - Maximum number of characters to include after cursor position
 * @returns Page body context result with metadata, or undefined if editor is not available
 */
export const getPageBodyForContext = (
  codeMirrorEditor: UseCodeMirrorEditor | undefined,
  maxLengthBeforeCursor: number,
  maxLengthAfterCursor: number,
): PageBodyContextResult | undefined => {
  const doc = codeMirrorEditor?.getDoc();
  const length = doc?.length ?? 0;

  if (length === 0 || !doc) {
    return undefined;
  }

  const maxTotalLength = maxLengthBeforeCursor + maxLengthAfterCursor;

  if (length > maxTotalLength) {
    // Get cursor position
    const cursorPos = codeMirrorEditor?.view?.state.selection.main.head ?? 0;

    // Calculate how many characters are available before and after cursor
    const availableBeforeCursor = cursorPos;
    const availableAfterCursor = length - cursorPos;

    // Calculate actual chars to take before and after cursor
    const charsBeforeCursor = Math.min(
      maxLengthBeforeCursor,
      availableBeforeCursor,
    );
    const charsAfterCursor = Math.min(
      maxLengthAfterCursor,
      availableAfterCursor,
    );

    // Calculate shortfalls and redistribute
    const shortfallBefore = maxLengthBeforeCursor - charsBeforeCursor;
    const shortfallAfter = maxLengthAfterCursor - charsAfterCursor;

    // Redistribute shortfalls
    const finalCharsAfterCursor = Math.min(
      charsAfterCursor + shortfallBefore,
      availableAfterCursor,
    );
    const finalCharsBeforeCursor = Math.min(
      charsBeforeCursor + shortfallAfter,
      availableBeforeCursor,
    );

    // Calculate start and end positions
    const startPos = Math.max(cursorPos - finalCharsBeforeCursor, 0);
    const endPos = cursorPos + finalCharsAfterCursor;

    const content = doc.slice(startPos, endPos).toString();

    return {
      content,
      isPartial: true,
      startIndex: startPos,
      endIndex: endPos,
      totalLength: length,
    };
  }

  const content = codeMirrorEditor?.getDocString() ?? '';

  return {
    content,
    isPartial: false,
    totalLength: length,
  };
};
