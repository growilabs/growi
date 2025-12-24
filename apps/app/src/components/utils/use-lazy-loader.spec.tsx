import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearComponentCache, useLazyLoader } from './use-lazy-loader';

describe('useLazyLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the global component cache to ensure test isolation
    clearComponentCache();
  });

  describe('Basic functionality', () => {
    it('should load component when isActive is true', async () => {
      // Arrange
      const MockComponent = () => <div>Loaded</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act
      const { result } = renderHook(() =>
        useLazyLoader('test-key', mockImport, true),
      );

      // Assert
      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });
      expect(mockImport).toHaveBeenCalledTimes(1);
    });

    it('should not load component when isActive is false', () => {
      // Arrange
      const mockImport = vi.fn();

      // Act
      const { result } = renderHook(() =>
        useLazyLoader('test-key', mockImport, false),
      );

      // Assert
      expect(result.current).toBeNull();
      expect(mockImport).not.toHaveBeenCalled();
    });

    it('should return null initially and load component asynchronously', async () => {
      // Arrange
      const MockComponent = () => <div>Async Loaded</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act
      const { result } = renderHook(() =>
        useLazyLoader('async-key', mockImport, true),
      );

      // Assert - Initially null
      expect(result.current).toBeNull();

      // Assert - After loading
      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });
    });
  });

  describe('Cache functionality', () => {
    it('should use cache for the same importKey', async () => {
      // Arrange
      const MockComponent = () => <div>Cached</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act - First call
      const { result: result1 } = renderHook(() =>
        useLazyLoader('cached-key', mockImport, true),
      );

      await waitFor(() => {
        expect(result1.current).toBe(MockComponent);
      });

      // Act - Second call with same key
      const { result: result2 } = renderHook(() =>
        useLazyLoader('cached-key', mockImport, true),
      );

      await waitFor(() => {
        expect(result2.current).toBe(MockComponent);
      });

      // Assert - Import should be called only once
      expect(mockImport).toHaveBeenCalledTimes(1);
    });

    it('should not use cache for different importKeys', async () => {
      // Arrange
      const Component1 = () => <div>Component1</div>;
      const Component2 = () => <div>Component2</div>;
      const mockImport1 = vi.fn().mockResolvedValue({ default: Component1 });
      const mockImport2 = vi.fn().mockResolvedValue({ default: Component2 });

      // Act
      const { result: result1 } = renderHook(() =>
        useLazyLoader('key1', mockImport1, true),
      );

      const { result: result2 } = renderHook(() =>
        useLazyLoader('key2', mockImport2, true),
      );

      // Assert
      await waitFor(() => {
        expect(result1.current).toBe(Component1);
        expect(result2.current).toBe(Component2);
      });

      expect(mockImport1).toHaveBeenCalledTimes(1);
      expect(mockImport2).toHaveBeenCalledTimes(1);
    });
  });

  describe('State change functionality', () => {
    it('should load component when isActive changes from false to true', async () => {
      // Arrange
      const MockComponent = () => <div>Dynamic</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act - Initial render with isActive=false
      const { result, rerender } = renderHook(
        ({ isActive }) => useLazyLoader('dynamic-key', mockImport, isActive),
        { initialProps: { isActive: false } },
      );

      // Assert - Should not load initially
      expect(result.current).toBeNull();
      expect(mockImport).not.toHaveBeenCalled();

      // Act - Change isActive to true
      rerender({ isActive: true });

      // Assert - Should load component
      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });
      expect(mockImport).toHaveBeenCalledTimes(1);
    });

    it('should not reload component when isActive changes from true to false', async () => {
      // Arrange
      const MockComponent = () => <div>Persistent</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act - Initial render with isActive=true
      const { result, rerender } = renderHook(
        ({ isActive }) => useLazyLoader('persistent-key', mockImport, isActive),
        { initialProps: { isActive: true } },
      );

      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });

      // Act - Change isActive to false
      rerender({ isActive: false });

      // Assert - Component should remain loaded
      expect(result.current).toBe(MockComponent);
      expect(mockImport).toHaveBeenCalledTimes(1);
    });

    it('should not reload component on multiple isActive=true rerenders', async () => {
      // Arrange
      const MockComponent = () => <div>Stable</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act
      const { result, rerender } = renderHook(
        ({ isActive }) => useLazyLoader('stable-key', mockImport, isActive),
        { initialProps: { isActive: true } },
      );

      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });

      // Act - Multiple rerenders
      rerender({ isActive: true });
      rerender({ isActive: true });

      // Assert - Import should be called only once
      expect(mockImport).toHaveBeenCalledTimes(1);
    });
  });

  describe('Multiple instances', () => {
    it('should handle multiple instances with different keys independently', async () => {
      // Arrange
      const Component1 = () => <div>Component1</div>;
      const Component2 = () => <div>Component2</div>;
      const Component3 = () => <div>Component3</div>;
      const mockImport1 = vi.fn().mockResolvedValue({ default: Component1 });
      const mockImport2 = vi.fn().mockResolvedValue({ default: Component2 });
      const mockImport3 = vi.fn().mockResolvedValue({ default: Component3 });

      // Act
      const { result: result1 } = renderHook(() =>
        useLazyLoader('multi-key1', mockImport1, true),
      );

      const { result: result2 } = renderHook(() =>
        useLazyLoader('multi-key2', mockImport2, true),
      );

      const { result: result3 } = renderHook(() =>
        useLazyLoader('multi-key3', mockImport3, false),
      );

      // Assert
      await waitFor(() => {
        expect(result1.current).toBe(Component1);
        expect(result2.current).toBe(Component2);
      });

      expect(result3.current).toBeNull();
      expect(mockImport1).toHaveBeenCalledTimes(1);
      expect(mockImport2).toHaveBeenCalledTimes(1);
      expect(mockImport3).not.toHaveBeenCalled();
    });

    it('should handle concurrent loads with same key', async () => {
      // Arrange
      const MockComponent = () => <div>Concurrent</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act - Render two hooks with same key simultaneously
      const { result: result1 } = renderHook(() =>
        useLazyLoader('concurrent-key', mockImport, true),
      );

      const { result: result2 } = renderHook(() =>
        useLazyLoader('concurrent-key', mockImport, true),
      );

      // Assert - Both should resolve to same component
      await waitFor(() => {
        expect(result1.current).toBe(MockComponent);
        expect(result2.current).toBe(MockComponent);
      });

      // Import should be called only once due to caching
      expect(mockImport).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error handling', () => {
    it('should handle import failure gracefully', async () => {
      // Arrange
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const mockError = new Error('Import failed');
      const mockImport = vi.fn().mockRejectedValue(mockError);

      // Act
      const { result } = renderHook(() =>
        useLazyLoader('error-key', mockImport, true),
      );

      // Assert - Should remain null on error
      expect(result.current).toBeNull();

      // Wait for error to be processed
      await waitFor(() => {
        expect(mockImport).toHaveBeenCalledTimes(1);
      });

      // Component should still be null after error
      expect(result.current).toBeNull();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Type safety', () => {
    it('should work with components with props', async () => {
      // Arrange
      type TestProps = Record<string, unknown> & {
        title: string;
        count: number;
      };
      const MockComponentWithProps = ({ title, count }: TestProps) => (
        <div>
          {title}: {count}
        </div>
      );
      const mockImport = vi
        .fn()
        .mockResolvedValue({ default: MockComponentWithProps });

      // Act
      const { result } = renderHook(() =>
        useLazyLoader<TestProps>('typed-key', mockImport, true),
      );

      // Assert
      await waitFor(() => {
        expect(result.current).toBe(MockComponentWithProps);
      });
    });
  });

  describe('Edge cases and boundary values', () => {
    it('should handle empty string as importKey', async () => {
      // Arrange
      const MockComponent = () => <div>Empty Key</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act
      const { result } = renderHook(() => useLazyLoader('', mockImport, true));

      // Assert
      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });
      expect(mockImport).toHaveBeenCalledTimes(1);
    });

    it('should use first importFn when same key is used with different import functions', async () => {
      // Arrange
      const Component1 = () => <div>Component1</div>;
      const Component2 = () => <div>Component2</div>;
      const mockImport1 = vi.fn().mockResolvedValue({ default: Component1 });
      const mockImport2 = vi.fn().mockResolvedValue({ default: Component2 });

      // Act - First hook with Component1
      const { result: result1 } = renderHook(() =>
        useLazyLoader('duplicate-key', mockImport1, true),
      );

      await waitFor(() => {
        expect(result1.current).toBe(Component1);
      });

      // Act - Second hook with same key but different import function
      const { result: result2 } = renderHook(() =>
        useLazyLoader('duplicate-key', mockImport2, true),
      );

      await waitFor(() => {
        expect(result2.current).toBe(Component1); // Should still get Component1 from cache
      });

      // Assert - Only first import should be called
      expect(mockImport1).toHaveBeenCalledTimes(1);
      expect(mockImport2).not.toHaveBeenCalled();
    });

    it('should handle import function returning null', async () => {
      // Arrange
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const mockImport = vi.fn().mockResolvedValue(null);

      // Act
      const { result } = renderHook(() =>
        useLazyLoader('null-key', mockImport, true),
      );

      // Assert - Should remain null
      await waitFor(() => {
        expect(mockImport).toHaveBeenCalledTimes(1);
      });

      // Wait a bit to ensure state update attempts have been processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Component should be null since the import resolved to null
      expect(result.current).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Module or default export is missing'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle import function returning object without default property', async () => {
      // Arrange
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const mockImport = vi
        .fn()
        .mockResolvedValue({ notDefault: () => <div>Wrong</div> });

      // Act
      const { result } = renderHook(() =>
        useLazyLoader('no-default-key', mockImport, true),
      );

      // Assert - Should remain null since there's no default export
      await waitFor(() => {
        expect(mockImport).toHaveBeenCalledTimes(1);
      });

      // Wait a bit to ensure state update attempts have been processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result.current).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Module or default export is missing'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle rapid isActive toggling', async () => {
      // Arrange
      const MockComponent = () => <div>Toggled</div>;
      const mockImport = vi.fn().mockResolvedValue({ default: MockComponent });

      // Act
      const { result, rerender } = renderHook(
        ({ isActive }) => useLazyLoader('toggle-key', mockImport, isActive),
        { initialProps: { isActive: false } },
      );

      // Rapidly toggle isActive
      rerender({ isActive: true });
      rerender({ isActive: false });
      rerender({ isActive: true });
      rerender({ isActive: false });
      rerender({ isActive: true });

      // Assert
      await waitFor(() => {
        expect(result.current).toBe(MockComponent);
      });

      // Should only import once despite rapid toggling
      expect(mockImport).toHaveBeenCalledTimes(1);
    });

    it('should not call import function when isActive is false initially and remains false', async () => {
      // Arrange
      const mockImport = vi
        .fn()
        .mockResolvedValue({ default: () => <div>Test</div> });

      // Act
      const { result, rerender } = renderHook(
        ({ isActive }) => useLazyLoader('inactive-key', mockImport, isActive),
        { initialProps: { isActive: false } },
      );

      // Multiple rerenders with isActive=false
      rerender({ isActive: false });
      rerender({ isActive: false });
      rerender({ isActive: false });

      // Wait a bit to ensure no async operations are triggered
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(result.current).toBeNull();
      expect(mockImport).not.toHaveBeenCalled();
    });
  });
});
