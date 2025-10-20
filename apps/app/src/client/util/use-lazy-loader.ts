import type React from 'react';
import { useState, useEffect, useCallback } from 'react';

type ComponentModule<T> = { default: React.ComponentType<T> };

// Global cache for dynamically loaded components
const componentCache = new Map<string, Promise<ComponentModule<unknown>>>();

const getCachedImport = <T>(
  key: string,
  importFn: () => Promise<ComponentModule<T>>,
): Promise<ComponentModule<T>> => {
  if (!componentCache.has(key)) {
    componentCache.set(key, importFn() as Promise<ComponentModule<unknown>>);
  }
  const cached = componentCache.get(key);
  if (cached == null) {
    throw new Error(`Failed to retrieve cached import for key: ${key}`);
  }
  return cached as Promise<ComponentModule<T>>;
};

/**
 * Clears the component cache. This is primarily intended for testing purposes.
 * In production, the cache persists for the lifetime of the application.
 *
 * @internal
 */
export const clearComponentCache = (): void => {
  componentCache.clear();
};

/**
 * Dynamically loads a component when it becomes active
 *
 * @param importKey - Unique identifier for the component (used for caching)
 * @param importFn - Function that returns a dynamic import promise
 * @param isActive - Whether the component should be loaded (e.g., modal open, tab selected, etc.)
 * @returns The loaded component or null if not yet loaded
 *
 * @example
 * // For modals
 * const Modal = useLazyLoader('my-modal', () => import('./MyModal'), isOpen);
 *
 * @example
 * // For tab content
 * const TabContent = useLazyLoader('tab-advanced', () => import('./AdvancedTab'), activeTab === 'advanced');
 *
 * @example
 * // For conditional panels
 * const AdminPanel = useLazyLoader('admin-panel', () => import('./AdminPanel'), isAdmin);
 */
export const useLazyLoader = <T extends Record<string, unknown>>(
  importKey: string,
  importFn: () => Promise<{ default: React.ComponentType<T> }>,
  isActive: boolean,
): React.ComponentType<T> | null => {
  const [Component, setComponent] = useState<React.ComponentType<T> | null>(null);

  const memoizedImportFn = useCallback(importFn, [importFn, importKey]);

  useEffect(() => {
    if (isActive && !Component) {
      getCachedImport(importKey, memoizedImportFn)
        .then((mod) => {
          if (mod?.default) {
            setComponent(() => mod.default);
          }
          else {
            // eslint-disable-next-line no-console
            console.error(`Failed to load component with key "${importKey}": Module or default export is missing`);
          }
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(`Failed to load component with key "${importKey}":`, error);
        });
    }
  }, [isActive, Component, importKey, memoizedImportFn]);

  return Component;
};
