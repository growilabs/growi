import type { Text as YText } from 'yjs';

import { ClientFuzzyMatcher } from './fuzzy-matching';

/**
 * Perform search and replace operation on YText with fuzzy matching
 */
export function performSearchReplace(
  yText: YText,
  searchText: string,
  replaceText: string,
  startLine: number,
): boolean {
  const content = yText.toString();

  // 1. Start search from the specified line
  const fuzzyMatcher = new ClientFuzzyMatcher();
  const result = fuzzyMatcher.findBestMatch(content, searchText, {
    preferredStartLine: startLine,
    bufferLines: 20, // Search within a range of 20 lines before and after
  });

  if (result.success && result.matchedRange) {
    // 2. Replace the found location precisely
    const { startIndex, endIndex } = result.matchedRange;
    yText.delete(startIndex, endIndex - startIndex);
    yText.insert(startIndex, replaceText);
    return true;
  }

  return false; // Search failed
}

/**
 * Exact search without fuzzy matching for testing purposes
 */
export function performExactSearchReplace(
  yText: YText,
  searchText: string,
  replaceText: string,
  startLine?: number,
): boolean {
  const content = yText.toString();
  const lines = content.split('\n');

  // If startLine is specified, validate and calculate search position
  let searchStartIndex = 0;
  if (startLine != null) {
    // startLine is 1-based, so check if it's within valid range
    if (startLine < 1 || startLine > lines.length) {
      return false; // startLine is out of range
    }

    // Calculate starting position for the specified line (1-based)
    for (let i = 0; i < startLine - 1; i++) {
      searchStartIndex += lines[i].length + 1; // +1 for newline
    }
  }

  // Find the search text
  const searchIndex = content.indexOf(searchText, searchStartIndex);

  if (searchIndex !== -1) {
    // Replace the found text - first delete, then insert
    yText.delete(searchIndex, searchText.length);
    yText.insert(searchIndex, replaceText);
    return true;
  }

  return false;
}

/**
 * Helper function to get line information from content
 */
export function getLineFromIndex(
  content: string,
  index: number,
): { lineNumber: number; columnNumber: number } {
  const lines = content.substring(0, index).split('\n');
  const lineNumber = lines.length;
  const columnNumber = lines[lines.length - 1].length;

  return { lineNumber, columnNumber };
}

/**
 * Helper function to get content around a specific line for debugging
 */
export function getContextAroundLine(
  content: string,
  lineNumber: number,
  contextLines = 3,
): string {
  const lines = content.split('\n');

  // Handle edge cases for line numbers beyond content
  if (lineNumber > lines.length) {
    // Return the last few lines if requested line is beyond content
    const startLine = Math.max(0, lines.length - contextLines);
    return lines
      .slice(startLine)
      .map((line, index) => {
        const actualLineNumber = startLine + index + 1;
        return `  ${actualLineNumber}: ${line}`;
      })
      .join('\n');
  }

  const startLine = Math.max(0, lineNumber - contextLines - 1);
  const endLine = Math.min(lines.length, lineNumber + contextLines);

  return lines
    .slice(startLine, endLine)
    .map((line, index) => {
      const actualLineNumber = startLine + index + 1;
      const marker = actualLineNumber === lineNumber ? '→' : ' ';
      return `${marker} ${actualLineNumber}: ${line}`;
    })
    .join('\n');
}
