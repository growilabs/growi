/**
 * Client-side Diff Application Engine for GROWI Editor Assistant
 * Handles direct integration with browser-based editors (yText/CodeMirror)
 * Optimized for real-time application with undo/redo support
 */

import type { LlmEditorAssistantDiff } from '../../../interfaces/editor-assistant/llm-response-schemas';
import type {
  ProcessorConfig,
  SearchContext,
  SingleDiffResult,
} from '../../interfaces/types';
import { ClientErrorHandler } from './error-handling';
import { ClientFuzzyMatcher } from './fuzzy-matching';

// -----------------------------------------------------------------------------
// Client Diff Application Engine
// -----------------------------------------------------------------------------

export class ClientDiffApplicationEngine {
  private fuzzyMatcher: ClientFuzzyMatcher;

  private errorHandler: ClientErrorHandler;

  private config: Required<ProcessorConfig>;

  constructor(
    config: Partial<ProcessorConfig> = {},
    errorHandler?: ClientErrorHandler,
  ) {
    // Set defaults optimized for browser environment
    this.config = {
      fuzzyThreshold: config.fuzzyThreshold ?? 0.8,
      bufferLines: config.bufferLines ?? 40,
      preserveIndentation: config.preserveIndentation ?? true,
      stripLineNumbers: config.stripLineNumbers ?? true,
      enableAggressiveMatching: config.enableAggressiveMatching ?? false,
      maxDiffBlocks: config.maxDiffBlocks ?? 10,
    };

    this.fuzzyMatcher = new ClientFuzzyMatcher(this.config.fuzzyThreshold);
    this.errorHandler = errorHandler ?? new ClientErrorHandler();
  }

  /**
   * Apply a single diff to content with browser-optimized processing
   */
  applySingleDiff(
    content: string,
    diff: LlmEditorAssistantDiff,
    lineDelta = 0,
  ): SingleDiffResult {
    try {
      // Validate search content
      if (!diff.search.trim()) {
        return {
          success: false,
          error: this.errorHandler.createEmptySearchError(),
        };
      }

      const lines = content.split(/\r?\n/);

      // Calculate adjusted line numbers considering previous changes
      const searchContext = this.createSearchContext(diff, lineDelta);

      // Find the best match using fuzzy matching
      const matchResult = this.fuzzyMatcher.findBestMatch(
        content,
        diff.search,
        searchContext,
      );

      if (!matchResult.success) {
        return {
          success: false,
          error: this.errorHandler.createSearchNotFoundError(
            diff.search,
            matchResult,
            searchContext.startLine,
          ),
        };
      }

      // Apply the replacement with indentation preservation
      const replacementResult = this.applyReplacement(
        lines,
        { index: matchResult.index || 0, content: matchResult.content || '' },
        diff.replace,
      );

      return {
        success: true,
        updatedLines: replacementResult.lines,
        lineDelta: replacementResult.lineDelta,
      };
    } catch (error) {
      return {
        success: false,
        error: this.errorHandler.createContentError(
          error as Error,
          `Applying diff with search: "${diff.search.substring(0, 50)}..."`,
        ),
      };
    }
  }

  /**
   * Apply multiple diffs in sequence with proper delta tracking
   */
  applyMultipleDiffs(
    content: string,
    diffs: LlmEditorAssistantDiff[],
  ): {
    success: boolean;
    finalContent?: string;
    appliedCount: number;
    results: SingleDiffResult[];
    errors: SingleDiffResult[];
  } {
    const results: SingleDiffResult[] = [];
    const errors: SingleDiffResult[] = [];
    let currentContent = content;
    let totalLineDelta = 0;
    let appliedCount = 0;

    // Sort diffs by line number (if available) to apply from bottom to top
    const sortedDiffs = this.sortDiffsForApplication(diffs);

    for (const diff of sortedDiffs) {
      const result = this.applySingleDiff(currentContent, diff, totalLineDelta);
      results.push(result);

      if (result.success && result.updatedLines) {
        currentContent = result.updatedLines.join('\n');
        totalLineDelta += result.lineDelta || 0;
        appliedCount++;
      } else {
        errors.push(result);
      }
    }

    return {
      success: errors.length === 0,
      finalContent: appliedCount > 0 ? currentContent : undefined,
      appliedCount,
      results,
      errors,
    };
  }

  // -----------------------------------------------------------------------------
  // Private Helper Methods
  // -----------------------------------------------------------------------------

  /**
   * Create search context with line adjustments
   */
  private createSearchContext(
    diff: LlmEditorAssistantDiff,
    lineDelta: number,
  ): SearchContext {
    return {
      startLine: diff.startLine ? diff.startLine + lineDelta : undefined,
      endLine: diff.endLine ? diff.endLine + lineDelta : undefined,
      bufferLines: this.config.bufferLines,
    };
  }

  /**
   * Apply replacement with indentation preservation
   */
  private applyReplacement(
    lines: string[],
    matchResult: { index: number; content: string },
    replaceText: string,
  ): { lines: string[]; lineDelta: number } {
    const startLineIndex = matchResult.index;
    const originalLines = matchResult.content.split('\n');
    const endLineIndex = startLineIndex + originalLines.length - 1;

    // Preserve indentation if enabled
    const processedReplaceText = this.config.preserveIndentation
      ? this.preserveIndentation(originalLines[0], replaceText)
      : replaceText;

    const replaceLines = processedReplaceText.split('\n');

    // Create new lines array with replacement
    const newLines = [
      ...lines.slice(0, startLineIndex),
      ...replaceLines,
      ...lines.slice(endLineIndex + 1),
    ];

    const lineDelta = replaceLines.length - originalLines.length;

    return {
      lines: newLines,
      lineDelta,
    };
  }

  /**
   * Preserve indentation pattern from original content
   */
  private preserveIndentation(
    originalLine: string,
    replaceText: string,
  ): string {
    // Extract indentation from the original line
    const indentMatch = originalLine.match(/^(\s*)/);
    const originalIndent = indentMatch ? indentMatch[1] : '';

    if (!originalIndent) {
      return replaceText;
    }

    // Apply the same indentation to all lines in replacement
    return replaceText
      .split('\n')
      .map((line, index) => {
        // Don't add indent to empty lines
        if (line.trim() === '') {
          return line;
        }
        // First line might already have partial indentation
        if (index === 0) {
          return originalIndent + line.replace(/^\s*/, '');
        }
        return originalIndent + line;
      })
      .join('\n');
  }

  /**
   * Sort diffs for optimal application order (bottom to top)
   */
  private sortDiffsForApplication(
    diffs: LlmEditorAssistantDiff[],
  ): LlmEditorAssistantDiff[] {
    return [...diffs].sort((a, b) => {
      // If both have line numbers, sort by line number (descending)
      if (a.startLine && b.startLine) {
        return b.startLine - a.startLine;
      }
      // If only one has line number, prioritize it
      if (a.startLine) return -1;
      if (b.startLine) return 1;
      // If neither has line number, keep original order
      return 0;
    });
  }

  // -----------------------------------------------------------------------------
  // Configuration and Utility Methods
  // -----------------------------------------------------------------------------

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ProcessorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.fuzzyMatcher.setThreshold(this.config.fuzzyThreshold);
  }

  /**
   * Validate diff before application
   */
  validateDiff(diff: LlmEditorAssistantDiff): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (!diff.search || !diff.search.trim()) {
      issues.push('Search content is empty');
    }

    if (diff.replace === undefined) {
      issues.push('Replace content is undefined');
    }

    if (diff.startLine && diff.endLine && diff.startLine > diff.endLine) {
      issues.push('Start line is greater than end line');
    }

    if (diff.search && diff.search.length > 10000) {
      issues.push('Search content is very large (>10k chars)');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
