/**
 * Client-side Fuzzy Matching Engine for GROWI Editor Assistant
 * Optimized for browser environment with real-time processing
 * Compatible with roo-code's matching algorithms
 */

import { distance } from 'fastest-levenshtein';

import type { MatchResult, SearchContext } from '../../interfaces/types';
import { normalizeForBrowserFuzzyMatch } from './text-normalization';

// -----------------------------------------------------------------------------
// Browser-Optimized Similarity Calculation
// -----------------------------------------------------------------------------

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Compatible with roo-code's similarity calculation
 */
export function calculateSimilarity(original: string, search: string): number {
  // Empty searches are not supported
  if (search === '') {
    return 0;
  }

  // Exact match check first (fastest)
  if (original === search) {
    return 1;
  }

  // Length-based early filtering for performance
  const lengthRatio =
    Math.min(original.length, search.length) /
    Math.max(original.length, search.length);
  if (lengthRatio < 0.3) {
    return 0; // Too different in length
  }

  // Normalize both strings for comparison
  const normalizedOriginal = normalizeForBrowserFuzzyMatch(original);
  const normalizedSearch = normalizeForBrowserFuzzyMatch(search);

  // Exact match after normalization
  if (normalizedOriginal === normalizedSearch) {
    return 1;
  }

  // Calculate Levenshtein distance using fastest-levenshtein's distance function
  const dist = distance(normalizedOriginal, normalizedSearch);

  // Calculate similarity ratio (0 to 1, where 1 is an exact match)
  // This matches roo-code's calculation method
  const maxLength = Math.max(
    normalizedOriginal.length,
    normalizedSearch.length,
  );
  return 1 - dist / maxLength;
}

// -----------------------------------------------------------------------------
// Client Fuzzy Matcher Class
// -----------------------------------------------------------------------------

export class ClientFuzzyMatcher {
  private threshold: number;

  private readonly maxSearchTime: number; // Browser performance limit

  constructor(threshold = 0.85, maxSearchTimeMs = 1000) {
    this.threshold = threshold;
    this.maxSearchTime = maxSearchTimeMs;
  }

  /**
   * Try exact line match at the specified line
   */
  tryExactLineMatch(
    content: string,
    searchText: string,
    startLine: number,
  ): MatchResult {
    const lines = content.split('\n');

    if (startLine <= 0 || startLine > lines.length) {
      return { success: false, similarity: 0, error: 'Invalid line number' };
    }

    // Get line range for multi-line search
    const searchLines = searchText.split('\n');
    const endLine = Math.min(startLine + searchLines.length - 1, lines.length);

    if (endLine - startLine + 1 !== searchLines.length) {
      return {
        success: false,
        similarity: 0,
        error: 'Not enough lines for search',
      };
    }

    // Extract content from specified lines
    const targetContent = lines.slice(startLine - 1, endLine).join('\n');

    // Check for exact match first
    if (targetContent === searchText) {
      const startIndex =
        lines.slice(0, startLine - 1).join('\n').length +
        (startLine > 1 ? 1 : 0);
      const endIndex = startIndex + searchText.length;

      return {
        success: true,
        similarity: 1.0,
        matchedRange: {
          startIndex,
          endIndex,
          startLine,
          endLine,
        },
      };
    }

    // Check fuzzy match
    const similarity = calculateSimilarity(targetContent, searchText);
    if (similarity >= this.threshold) {
      const startIndex =
        lines.slice(0, startLine - 1).join('\n').length +
        (startLine > 1 ? 1 : 0);
      const endIndex = startIndex + targetContent.length;

      return {
        success: true,
        similarity,
        matchedRange: {
          startIndex,
          endIndex,
          startLine,
          endLine,
        },
      };
    }

    return { success: false, similarity, error: 'Similarity below threshold' };
  }

  /**
   * Perform buffered search around the preferred line
   */
  performBufferedSearch(
    content: string,
    searchText: string,
    preferredStartLine: number,
    bufferLines = 40,
  ): MatchResult {
    const lines = content.split('\n');
    const searchLines = searchText.split('\n');

    // Calculate search bounds
    const startBound = Math.max(1, preferredStartLine - bufferLines);
    const endBound = Math.min(lines.length, preferredStartLine + bufferLines);

    let bestMatch: MatchResult = {
      success: false,
      similarity: 0,
      error: 'No match found',
    };

    // Search within the buffer area
    for (
      let currentLine = startBound;
      currentLine <= endBound - searchLines.length + 1;
      currentLine++
    ) {
      const match = this.tryExactLineMatch(content, searchText, currentLine);

      if (match.success && match.similarity > bestMatch.similarity) {
        bestMatch = match;

        // Early exit for exact matches
        if (match.similarity === 1.0) {
          break;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Perform full search across entire content
   */
  performFullSearch(content: string, searchText: string): MatchResult {
    const lines = content.split('\n');
    const searchLines = searchText.split('\n');

    let bestMatch: MatchResult = {
      success: false,
      similarity: 0,
      error: 'No match found',
    };

    // Search entire content
    for (
      let currentLine = 1;
      currentLine <= lines.length - searchLines.length + 1;
      currentLine++
    ) {
      const match = this.tryExactLineMatch(content, searchText, currentLine);

      if (match.success && match.similarity > bestMatch.similarity) {
        bestMatch = match;

        // Early exit for exact matches
        if (match.similarity === 1.0) {
          break;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Find the best fuzzy match using middle-out search strategy
   * Optimized for browser environment with timeout protection
   */
  findBestMatch(
    content: string,
    searchText: string,
    context: SearchContext = {},
  ): MatchResult {
    const startTime = performance.now();

    // Early validation
    if (!searchText || searchText.trim() === '') {
      return this.createNoMatchResult('Empty search text');
    }

    const lines = this.splitLines(content);
    const searchLines = this.splitLines(searchText);
    const searchLength = searchLines.length;

    if (searchLength === 0) {
      return this.createNoMatchResult('Invalid search content');
    }

    // 指定行から優先検索
    if (context.preferredStartLine) {
      const exactMatch = this.tryExactLineMatch(
        content,
        searchText,
        context.preferredStartLine,
      );
      if (exactMatch.success) {
        return exactMatch;
      }

      // 指定行周辺でfuzzy検索
      return this.performBufferedSearch(
        content,
        searchText,
        context.preferredStartLine,
        context.bufferLines || 40,
      );
    }

    // Calculate search bounds with buffer
    const bounds = this.calculateSearchBounds(lines.length, context);

    // Middle-out search with browser timeout protection
    return this.performMiddleOutSearch(lines, searchLines, bounds, startTime);
  }

  /**
   * Middle-out search algorithm optimized for browser performance
   */
  private performMiddleOutSearch(
    lines: string[],
    searchLines: string[],
    bounds: { startIndex: number; endIndex: number },
    startTime: number,
  ): MatchResult {
    const { startIndex, endIndex } = bounds;
    const searchLength = searchLines.length;
    const searchChunk = searchLines.join('\n');

    // Early bounds checking
    if (endIndex - startIndex < searchLength) {
      return this.createNoMatchResult('Search area too small');
    }

    const actualEndIndex = endIndex - searchLength + 1;
    const centerIndex = Math.floor((startIndex + actualEndIndex) / 2);

    let bestScore = 0;
    let bestMatchIndex = -1;
    let bestMatchContent = '';

    // Start from center and expand outward
    let leftIndex = centerIndex;
    let rightIndex = centerIndex + 1;

    while (leftIndex >= startIndex || rightIndex <= actualEndIndex) {
      // Browser timeout protection
      if (performance.now() - startTime > this.maxSearchTime) {
        // eslint-disable-next-line no-console
        console.warn('Fuzzy matching timeout, returning best result found');
        break;
      }

      // Search left side
      if (leftIndex >= startIndex) {
        const result = this.checkMatch(
          lines,
          leftIndex,
          searchLength,
          searchChunk,
        );
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMatchIndex = leftIndex;
          bestMatchContent = result.content;

          // Early exit for exact matches
          if (bestScore === 1.0) {
            break;
          }
        }
        leftIndex--;
      }

      // Search right side
      if (rightIndex <= actualEndIndex) {
        const result = this.checkMatch(
          lines,
          rightIndex,
          searchLength,
          searchChunk,
        );
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMatchIndex = rightIndex;
          bestMatchContent = result.content;

          // Early exit for exact matches
          if (bestScore === 1.0) {
            break;
          }
        }
        rightIndex++;
      }
    }

    return {
      success: bestScore >= this.threshold,
      similarity: bestScore,
      index: bestMatchIndex,
      content: bestMatchContent,
      searchTime: performance.now() - startTime,
    };
  }

  /**
   * Check similarity at a specific position with performance optimization
   */
  private checkMatch(
    lines: string[],
    startIndex: number,
    length: number,
    searchChunk: string,
  ): { score: number; content: string } {
    const chunk = lines.slice(startIndex, startIndex + length).join('\n');
    const similarity = calculateSimilarity(chunk, searchChunk);

    return {
      score: similarity,
      content: chunk,
    };
  }

  /**
   * Calculate search bounds considering buffer lines and browser limitations
   */
  private calculateSearchBounds(
    totalLines: number,
    context: SearchContext,
  ): { startIndex: number; endIndex: number } {
    const bufferLines = context.bufferLines ?? 40; // Default browser-optimized buffer

    let startIndex = 0;
    let endIndex = totalLines;

    // Apply user-specified line range (convert from 1-based to 0-based)
    if (context.startLine !== undefined) {
      startIndex = Math.max(0, context.startLine - 1);
    }

    if (context.endLine !== undefined) {
      endIndex = Math.min(totalLines, context.endLine);
    }

    // Apply buffer lines for expanded search context
    const bufferStart = Math.max(0, startIndex - bufferLines);
    const bufferEnd = Math.min(totalLines, endIndex + bufferLines);

    return {
      startIndex: bufferStart,
      endIndex: bufferEnd,
    };
  }

  /**
   * Create a "no match found" result with reason
   */
  private createNoMatchResult(reason = 'No match found'): MatchResult {
    return {
      success: false,
      similarity: 0,
      index: -1,
      content: '',
      searchTime: 0,
      error: reason,
    };
  }

  /**
   * Split content into lines (browser-optimized)
   */
  private splitLines(content: string): string[] {
    return content.split(/\r?\n/);
  }

  // -----------------------------------------------------------------------------
  // Configuration Methods
  // -----------------------------------------------------------------------------

  /**
   * Update the similarity threshold
   */
  setThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be between 0.0 and 1.0');
    }
    this.threshold = threshold;
  }

  /**
   * Get current threshold
   */
  getThreshold(): number {
    return this.threshold;
  }

  /**
   * Get maximum search time limit
   */
  getMaxSearchTime(): number {
    return this.maxSearchTime;
  }
}

// -----------------------------------------------------------------------------
// Browser Utility Functions
// -----------------------------------------------------------------------------

/**
 * Split content into lines while preserving line endings (browser-optimized)
 */
export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

/**
 * Join lines with appropriate line ending (browser-optimized)
 */
export function joinLines(lines: string[], originalContent?: string): string {
  // Detect line ending from original content or default to \n
  const lineEnding = originalContent?.includes('\r\n') ? '\r\n' : '\n';
  return lines.join(lineEnding);
}

/**
 * Browser performance measurement helper
 */
export function measurePerformance<T>(
  operation: () => T,
  label = 'Fuzzy matching operation',
): { result: T; duration: number } {
  const start = performance.now();
  const result = operation();
  const duration = performance.now() - start;

  if (duration > 100) {
    // eslint-disable-next-line no-console
    console.warn(`${label} took ${duration.toFixed(2)}ms (slow)`);
  }

  return { result, duration };
}
