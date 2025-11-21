import { type RefObject, useCallback, useEffect, useState } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import type { HtmlElementNode } from 'rehype-toc';

import type { generateTocOptions } from '~/client/services/renderer/renderer';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useCurrentPagePath } from '~/states/page';
import { useRendererConfig } from '~/states/server-configurations';
import { useNextThemes } from '~/stores-universal/use-next-themes';

// ============================================================================
// INTERNAL ATOMS (Implementation details, not exported)
// ============================================================================

/**
 * Internal atom: TOC node RefObject storage
 * Uses RefObject pattern for mutable DOM element references
 * This is an implementation detail and should not be used directly
 */
const tocNodeRefAtom = atom<RefObject<HtmlElementNode> | null>(null);

// ============================================================================
// PUBLIC ATOMS (Main API for TOC state management)
// ============================================================================

/**
 * Main TOC node atom: Extracts actual HtmlElementNode from RefObject
 * This is the primary atom for accessing the current TOC node
 */
export const tocNodeAtom = atom((get) => {
  const tocNodeRef = get(tocNodeRefAtom);
  return tocNodeRef?.current ?? null;
});

/**
 * Derived atom: TOC readiness check
 * Returns true when TOC node is available
 */
export const tocNodeReadyAtom = atom((get) => {
  const tocNode = get(tocNodeAtom);
  return tocNode != null;
});

// ============================================================================
// PERFORMANCE OPTIMIZATION
// ============================================================================

// Cache for dynamic import to avoid repeated loading
let generateTocOptionsCache: typeof generateTocOptions | null = null;

// ============================================================================
// PUBLIC HOOKS (API for components)
// ============================================================================

/**
 * Hook to get the current TOC node
 * Returns the HtmlElementNode if available, or null
 */
export const useTocNode = (): HtmlElementNode | null => {
  return useAtomValue(tocNodeAtom);
};

/**
 * Hook to set the current TOC node
 * Accepts HtmlElementNode and handles RefObject wrapping internally
 */
export const useSetTocNode = () => {
  const setTocNodeRef = useSetAtom(tocNodeRefAtom);

  const setTocNode = useCallback(
    (newNode: HtmlElementNode) => {
      // Create a RefObject wrapper for the HtmlElementNode
      const nodeRef: RefObject<HtmlElementNode> = { current: newNode };
      setTocNodeRef(nodeRef);
    },
    [setTocNodeRef],
  );

  return setTocNode;
};

/**
 * Core hook: TOC options with external dependencies
 * Uses dynamic import for better performance
 */
export const useTocOptions = () => {
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfig();
  const { isDarkMode } = useNextThemes();
  const tocNode = useAtomValue(tocNodeAtom);

  const [state, setState] = useState<{
    data?: RendererOptions;
    isLoading: boolean;
    error?: Error;
  }>({
    data: undefined,
    isLoading: false,
    error: undefined,
  });

  useEffect(() => {
    if (!currentPagePath || !rendererConfig) {
      setState({ data: undefined, isLoading: false, error: undefined });
      return;
    }

    if (!tocNode) {
      setState({ data: undefined, isLoading: true, error: undefined });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));

    (async () => {
      try {
        if (!generateTocOptionsCache) {
          const { generateTocOptions } = await import(
            '~/client/services/renderer/renderer'
          );
          generateTocOptionsCache = generateTocOptions;
        }

        const data = generateTocOptionsCache(
          { ...rendererConfig, isDarkMode },
          tocNode,
        );
        setState({ data, isLoading: false, error: undefined });
      } catch (err) {
        setState({
          data: undefined,
          isLoading: false,
          error:
            err instanceof Error
              ? err
              : new Error('TOC options generation failed'),
        });
      }
    })();
  }, [currentPagePath, rendererConfig, isDarkMode, tocNode]);

  return state;
};

/**
 * Hook for readiness check (combines atom + external deps)
 * Only use this if you need the full readiness check including external deps
 */
export const useTocOptionsReady = (): boolean => {
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfig();
  const tocNode = useAtomValue(tocNodeAtom);

  return !!(currentPagePath && rendererConfig && tocNode);
};
