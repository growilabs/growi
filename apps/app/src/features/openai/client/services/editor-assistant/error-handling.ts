/**
 * Client-side Error Handling for GROWI Editor Assistant
 * Optimized for browser environment with real-time feedback
 * Provides detailed error information and user-friendly suggestions
 */

import type { DiffError, MatchResult } from '../../interfaces/types';

// -----------------------------------------------------------------------------
// Client Error Types and Constants
// -----------------------------------------------------------------------------

export const CLIENT_ERROR_MESSAGES = {
  SEARCH_NOT_FOUND: 'Search content not found in the document',
  EMPTY_SEARCH: 'Search content cannot be empty',
  CONTENT_ERROR: 'Invalid or corrupted content',
  TIMEOUT_ERROR: 'Search operation timed out',
} as const;

export const CLIENT_SUGGESTIONS = {
  SEARCH_NOT_FOUND: [
    'Check for exact whitespace and formatting',
    'Try a smaller, more specific search pattern',
    'Verify line endings match your content',
    "Use the browser's search function to locate content first",
  ],
  EMPTY_SEARCH: [
    'Provide valid search content',
    'Check that your diff contains the search text',
  ],
  CONTENT_ERROR: [
    'Refresh the page and try again',
    'Check browser console for detailed errors',
    'Verify the document is properly loaded',
  ],
  TIMEOUT_ERROR: [
    'Try searching in a smaller section',
    'Reduce the document size if possible',
    'Check browser performance and memory usage',
  ],
} as const;

// -----------------------------------------------------------------------------
// Client Error Handler Class
// -----------------------------------------------------------------------------

export class ClientErrorHandler {
  private readonly enableConsoleLogging: boolean;

  private readonly enableUserFeedback: boolean;

  constructor(enableConsoleLogging = true, enableUserFeedback = true) {
    this.enableConsoleLogging = enableConsoleLogging;
    this.enableUserFeedback = enableUserFeedback;
  }

  /**
   * Create a detailed error for search content not found
   */
  createSearchNotFoundError(
    searchContent: string,
    matchResult?: MatchResult,
    startLine?: number,
  ): DiffError {
    const lineRange = startLine ? ` (starting at line ${startLine})` : '';
    const similarityInfo = matchResult?.similarity
      ? ` (closest match: ${Math.floor(matchResult.similarity * 100)}%)`
      : '';

    const error: DiffError = {
      type: 'SEARCH_NOT_FOUND',
      message: `${CLIENT_ERROR_MESSAGES.SEARCH_NOT_FOUND}${lineRange}${similarityInfo}`,
      line: startLine,
      details: {
        searchContent,
        bestMatch: matchResult?.content,
        similarity: matchResult?.similarity,
        suggestions: [...CLIENT_SUGGESTIONS.SEARCH_NOT_FOUND],
        lineRange: startLine
          ? `starting at line ${startLine}`
          : 'entire document',
      },
    };

    this.logError(error, 'Search content not found');
    return error;
  }

  /**
   * Create an error for empty search content
   */
  createEmptySearchError(): DiffError {
    const error: DiffError = {
      type: 'EMPTY_SEARCH',
      message: CLIENT_ERROR_MESSAGES.EMPTY_SEARCH,
      details: {
        searchContent: '',
        suggestions: [...CLIENT_SUGGESTIONS.EMPTY_SEARCH],
      },
    };

    this.logError(error, 'Empty search content');
    return error;
  }

  /**
   * Create an error for content/parsing issues
   */
  createContentError(originalError: Error, context?: string): DiffError {
    const error: DiffError = {
      type: 'CONTENT_ERROR',
      message: `${CLIENT_ERROR_MESSAGES.CONTENT_ERROR}: ${originalError.message}`,
      details: {
        searchContent: context || 'Unknown context',
        suggestions: [
          `Original error: ${originalError.message}`,
          ...CLIENT_SUGGESTIONS.CONTENT_ERROR,
        ],
      },
    };

    this.logError(error, 'Content processing error', originalError);
    return error;
  }

  /**
   * Create an error for browser timeout
   */
  createTimeoutError(searchContent: string, timeoutMs: number): DiffError {
    const error: DiffError = {
      type: 'CONTENT_ERROR', // Using CONTENT_ERROR as base type
      message: `${CLIENT_ERROR_MESSAGES.TIMEOUT_ERROR} (${timeoutMs}ms)`,
      details: {
        searchContent,
        suggestions: [
          `Search timed out after ${timeoutMs}ms`,
          ...CLIENT_SUGGESTIONS.TIMEOUT_ERROR,
        ],
      },
    };

    this.logError(error, 'Search timeout');
    return error;
  }

  // -----------------------------------------------------------------------------
  // Utility Methods
  // -----------------------------------------------------------------------------

  /**
   * Generate a suggested correct format based on the best match
   */
  private generateCorrectFormat(
    searchContent: string,
    bestMatch: string,
  ): string {
    // Simple diff-like format for user guidance
    const searchLines = searchContent.split('\n');
    const matchLines = bestMatch.split('\n');

    if (searchLines.length === 1 && matchLines.length === 1) {
      return `Try: "${bestMatch}" instead of "${searchContent}"`;
    }

    return `Expected format based on closest match:\n${bestMatch}`;
  }

  /**
   * Log error to console (if enabled) with contextual information
   */
  private logError(
    error: DiffError,
    context: string,
    originalError?: Error,
  ): void {
    if (!this.enableConsoleLogging) {
      return;
    }

    const logData = {
      context,
      type: error.type,
      message: error.message,
      line: error.line,
      similarity: error.details.similarity,
      searchLength: error.details.searchContent?.length || 0,
      suggestions: error.details.suggestions?.length || 0,
    };

    // eslint-disable-next-line no-console
    console.warn('[ClientErrorHandler]', logData);

    if (originalError) {
      // eslint-disable-next-line no-console
      console.error('[ClientErrorHandler] Original error:', originalError);
    }
  }

  /**
   * Format error for user display
   */
  formatErrorForUser(error: DiffError): string {
    const suggestions =
      error.details.suggestions?.slice(0, 3).join('\n• ') || '';

    return `❌ ${error.message}\n\n💡 Suggestions:\n• ${suggestions}`;
  }

  /**
   * Create a user-friendly summary of multiple errors
   */
  createErrorSummary(errors: DiffError[]): string {
    if (errors.length === 0) {
      return '✅ No errors found';
    }

    if (errors.length === 1) {
      return this.formatErrorForUser(errors[0]);
    }

    const summary = `❌ ${errors.length} issues found:\n\n`;
    const errorList = errors
      .slice(0, 5) // Limit to first 5 errors
      .map((error, index) => `${index + 1}. ${error.message}`)
      .join('\n');

    const moreErrors =
      errors.length > 5 ? `\n... and ${errors.length - 5} more issues` : '';

    return summary + errorList + moreErrors;
  }
}
