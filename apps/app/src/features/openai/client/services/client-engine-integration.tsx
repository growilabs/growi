/**
 * Client Engine Integration for useEditorAssistant Hook
 * Provides seamless integration between existing SSE processing and new client-side engine
 */

import { useCallback, useMemo, useRef } from 'react';
import type { Text as YText } from 'yjs';

import type { SseDetectedDiff } from '../../interfaces/editor-assistant/sse-schemas';
import type { ProcessingResult } from '../interfaces/types';
import { ClientSearchReplaceProcessor } from './editor-assistant/processor';

// -----------------------------------------------------------------------------
// Integration Configuration
// -----------------------------------------------------------------------------

export interface ClientEngineConfig {
  /** Enable client-side processing */
  enableClientProcessing: boolean;
  /** Fallback to server processing on client errors */
  enableServerFallback: boolean;
  /** Log performance metrics for comparison */
  enablePerformanceMetrics: boolean;
  /** Maximum processing time before timeout (ms) */
  maxProcessingTime: number;
  /** Batch size for diff processing */
  batchSize: number;
}

export interface ProcessingMetrics {
  /** Processing method used */
  method: 'client' | 'server' | 'hybrid';
  /** Total processing time in milliseconds */
  processingTime: number;
  /** Number of diffs processed */
  diffsCount: number;
  /** Number of diffs successfully applied */
  appliedCount: number;
  /** Success rate as percentage */
  successRate: number;
  /** Error information if any */
  error?: string;
  /** Memory usage (if available) */
  memoryUsage?: number;
}

export interface ProcessingProgress {
  current: number;
  total: number;
  message: string;
  percentage: number;
}

// -----------------------------------------------------------------------------
// Client Engine Integration Hook
// -----------------------------------------------------------------------------

export function useClientEngineIntegration(
  config: Partial<ClientEngineConfig> = {},
): {
  processHybrid: (
    content: string,
    detectedDiffs: SseDetectedDiff[],
    serverProcessingFn: () => Promise<void>,
  ) => Promise<{
    success: boolean;
    method: 'client' | 'server';
    result?: ProcessingResult;
  }>;
  applyToYText: (yText: YText, processedContent: string) => boolean;
  isClientProcessingEnabled: boolean;
} {
  // Configuration with defaults
  const finalConfig: ClientEngineConfig = useMemo(
    () => ({
      enableClientProcessing: true,
      enableServerFallback: true,
      enablePerformanceMetrics: true,
      maxProcessingTime: 10000,
      batchSize: 5,
      ...config,
    }),
    [config],
  );

  // Client processor instance
  const clientProcessor = useRef<ClientSearchReplaceProcessor>();

  // Initialize client processor
  if (!clientProcessor.current && finalConfig.enableClientProcessing) {
    clientProcessor.current = new ClientSearchReplaceProcessor({
      fuzzyThreshold: 0.8,
      bufferLines: 30,
      maxDiffBlocks: 8,
    });
  }

  /**
   * Apply processed content to YText (CodeMirror integration)
   */
  const applyToYText = useCallback(
    (yText: YText, processedContent: string): boolean => {
      try {
        const currentContent = yText.toString();

        if (currentContent === processedContent) {
          // No changes needed
          return true;
        }

        // Apply changes in a transaction
        yText.doc?.transact(() => {
          // Clear existing content
          yText.delete(0, yText.length);
          // Insert new content
          yText.insert(0, processedContent);
        });

        return true;
      } catch (error) {
        return false;
      }
    },
    [],
  );

  /**
   * Hybrid processing: try client first, fallback to server
   */
  const processHybrid = useCallback(
    async (
      content: string,
      detectedDiffs: SseDetectedDiff[],
      serverProcessingFn: () => Promise<void>,
    ): Promise<{
      success: boolean;
      method: 'client' | 'server';
      result?: ProcessingResult;
    }> => {
      if (!finalConfig.enableClientProcessing || !clientProcessor.current) {
        // Client processing disabled, use server only
        await serverProcessingFn();
        return { success: true, method: 'server' };
      }

      try {
        // Convert SseDetectedDiff to LlmEditorAssistantDiff format
        const diffs = detectedDiffs
          .map((d) => d.diff)
          .filter((diff): diff is NonNullable<typeof diff> => diff != null);

        // Validate required fields for client processing
        for (const diff of diffs) {
          if (!diff.startLine || !diff.search) {
            throw new Error('Missing required fields for client processing');
          }
        }

        // Process with client engine
        const diffResult = await clientProcessor.current.processMultipleDiffs(
          content,
          diffs,
          {
            enableProgressCallbacks: true,
            batchSize: finalConfig.batchSize,
            maxProcessingTime: finalConfig.maxProcessingTime,
          },
        );

        // Convert DiffApplicationResult to ProcessingResult
        const processingTime = performance.now();
        const result: ProcessingResult = {
          success: diffResult.success,
          error: diffResult.failedParts?.[0],
          matches: [],
          appliedCount: diffResult.appliedCount,
          skippedCount: Math.max(0, diffs.length - diffResult.appliedCount),
          modifiedText: diffResult.content || content,
          processingTime,
        };

        if (result.success) {
          return { success: true, method: 'client', result };
        }

        // Client processing failed, fallback to server if enabled
        if (finalConfig.enableServerFallback) {
          await serverProcessingFn();
          return { success: true, method: 'server' };
        }

        // No fallback, return client error
        return { success: false, method: 'client', result };
      } catch (error) {
        // Fallback to server on error
        if (finalConfig.enableServerFallback) {
          await serverProcessingFn();
          return { success: true, method: 'server' };
        }

        return { success: false, method: 'client' };
      }
    },
    [finalConfig],
  );

  return {
    // Processing functions
    applyToYText,
    processHybrid,

    // Configuration
    isClientProcessingEnabled: finalConfig.enableClientProcessing,
  };
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Feature flag for enabling client processing
 */
export function shouldUseClientProcessing(): boolean {
  // This could be controlled by environment variables, user settings, etc.
  return (
    process.env.NODE_ENV === 'development' ||
    (typeof window !== 'undefined' &&
      (window as { __GROWI_CLIENT_PROCESSING_ENABLED__?: boolean })
        .__GROWI_CLIENT_PROCESSING_ENABLED__ === true)
  );
}

export default useClientEngineIntegration;
