import type { ItemInstance } from '@headless-tree/core';
import { renderHook } from '@testing-library/react';

import type { IPageForTreeItem } from '~/interfaces/page';

import {
  getAncestorPaths,
  isAncestorOf,
  useAutoExpandAncestors,
} from './use-auto-expand-ancestors';

/**
 * Create a mock item instance for testing
 */
const createMockItem = (
  path: string,
  options: {
    isFolder?: boolean;
    isExpanded?: boolean;
  } = {},
): ItemInstance<IPageForTreeItem> => {
  const { isFolder = true, isExpanded = false } = options;
  let expanded = isExpanded;

  return {
    getItemData: () => ({ path }) as IPageForTreeItem,
    isFolder: () => isFolder,
    isExpanded: () => expanded,
    expand: vi.fn(() => {
      expanded = true;
    }),
  } as unknown as ItemInstance<IPageForTreeItem>;
};

describe('use-auto-expand-ancestors', () => {
  describe('getAncestorPaths', () => {
    describe.each`
      targetPath                      | expected
      ${'/'}                          | ${[]}
      ${'/Sandbox'}                   | ${[]}
      ${'/Sandbox/Diagrams'}          | ${['/Sandbox']}
      ${'/Sandbox/Diagrams/figure-1'} | ${['/Sandbox', '/Sandbox/Diagrams']}
      ${'/a/b/c/d'}                   | ${['/a', '/a/b', '/a/b/c']}
    `('should return $expected', ({ targetPath, expected }) => {
      test(`when targetPath is '${targetPath}'`, () => {
        const result = getAncestorPaths(targetPath);
        expect(result).toEqual(expected);
      });
    });
  });

  describe('isAncestorOf', () => {
    describe('when itemPath is root "/"', () => {
      describe.each`
        targetPath                      | expected
        ${'/'}                          | ${false}
        ${'/Sandbox'}                   | ${true}
        ${'/Sandbox/Diagrams'}          | ${true}
        ${'/Sandbox/Diagrams/figure-1'} | ${true}
      `('should return $expected', ({ targetPath, expected }) => {
        test(`when targetPath is '${targetPath}'`, () => {
          const result = isAncestorOf('/', targetPath);
          expect(result).toBe(expected);
        });
      });
    });

    describe('when itemPath is "/Sandbox"', () => {
      describe.each`
        targetPath                      | expected
        ${'/'}                          | ${false}
        ${'/Sandbox'}                   | ${false}
        ${'/SandboxOther'}              | ${false}
        ${'/Sandbox/Diagrams'}          | ${true}
        ${'/Sandbox/Diagrams/figure-1'} | ${true}
      `('should return $expected', ({ targetPath, expected }) => {
        test(`when targetPath is '${targetPath}'`, () => {
          const result = isAncestorOf('/Sandbox', targetPath);
          expect(result).toBe(expected);
        });
      });
    });

    describe('when itemPath is "/Sandbox/Diagrams"', () => {
      describe.each`
        targetPath                      | expected
        ${'/'}                          | ${false}
        ${'/Sandbox'}                   | ${false}
        ${'/Sandbox/Diagrams'}          | ${false}
        ${'/Sandbox/DiagramsOther'}     | ${false}
        ${'/Sandbox/Diagrams/figure-1'} | ${true}
        ${'/Sandbox/Diagrams/a/b/c'}    | ${true}
      `('should return $expected', ({ targetPath, expected }) => {
        test(`when targetPath is '${targetPath}'`, () => {
          const result = isAncestorOf('/Sandbox/Diagrams', targetPath);
          expect(result).toBe(expected);
        });
      });
    });
  });

  describe('useAutoExpandAncestors', () => {
    describe('when items is empty', () => {
      test('should not call onExpanded', () => {
        const onExpanded = vi.fn();

        renderHook(() =>
          useAutoExpandAncestors({
            items: [],
            targetPath: '/Sandbox/Diagrams/figure-1',
            onExpanded,
          }),
        );

        expect(onExpanded).not.toHaveBeenCalled();
      });

      test('should call onExpanded when items become available on rerender', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/');

        // First render with empty items
        const { rerender } = renderHook(
          ({ items }) =>
            useAutoExpandAncestors({
              items,
              targetPath: '/Sandbox/Diagrams/figure-1',
              onExpanded,
            }),
          { initialProps: { items: [] as ItemInstance<IPageForTreeItem>[] } },
        );

        expect(onExpanded).not.toHaveBeenCalled();

        // Rerender with items
        rerender({ items: [rootItem] });

        expect(rootItem.expand).toHaveBeenCalled();
        expect(onExpanded).toHaveBeenCalledTimes(1);
      });
    });

    describe('when items contains ancestors that need to be expanded', () => {
      test('should expand ancestor items and call onExpanded', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/', { isExpanded: false });
        const sandboxItem = createMockItem('/Sandbox', { isExpanded: false });

        renderHook(() =>
          useAutoExpandAncestors({
            items: [rootItem, sandboxItem],
            targetPath: '/Sandbox/Diagrams/figure-1',
            onExpanded,
          }),
        );

        expect(rootItem.expand).toHaveBeenCalled();
        expect(sandboxItem.expand).toHaveBeenCalled();
        expect(onExpanded).toHaveBeenCalledTimes(1);
      });

      test('should not expand already expanded items', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/', { isExpanded: true });
        const sandboxItem = createMockItem('/Sandbox', { isExpanded: false });

        renderHook(() =>
          useAutoExpandAncestors({
            items: [rootItem, sandboxItem],
            targetPath: '/Sandbox/Diagrams/figure-1',
            onExpanded,
          }),
        );

        expect(rootItem.expand).not.toHaveBeenCalled();
        expect(sandboxItem.expand).toHaveBeenCalled();
        expect(onExpanded).toHaveBeenCalledTimes(1);
      });
    });

    describe('when not all ancestors are loaded yet', () => {
      test('should continue expanding as ancestors become available', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/', { isExpanded: false });

        // First render - only root is available
        const { rerender } = renderHook(
          ({ items }) =>
            useAutoExpandAncestors({
              items,
              targetPath: '/Sandbox/Diagrams/figure-1',
              onExpanded,
            }),
          { initialProps: { items: [rootItem] } },
        );

        expect(rootItem.expand).toHaveBeenCalled();
        expect(onExpanded).toHaveBeenCalledTimes(1);

        // Simulate async load - /Sandbox becomes available
        const sandboxItem = createMockItem('/Sandbox', { isExpanded: false });
        onExpanded.mockClear();

        rerender({ items: [rootItem, sandboxItem] });

        expect(sandboxItem.expand).toHaveBeenCalled();
        expect(onExpanded).toHaveBeenCalledTimes(1);

        // Simulate async load - /Sandbox/Diagrams becomes available
        const diagramsItem = createMockItem('/Sandbox/Diagrams', {
          isExpanded: false,
        });
        onExpanded.mockClear();

        rerender({ items: [rootItem, sandboxItem, diagramsItem] });

        expect(diagramsItem.expand).toHaveBeenCalled();
        expect(onExpanded).toHaveBeenCalledTimes(1);
      });
    });

    describe('when all ancestors are already expanded', () => {
      test('should not call onExpanded', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/', { isExpanded: true });
        const sandboxItem = createMockItem('/Sandbox', { isExpanded: true });
        const diagramsItem = createMockItem('/Sandbox/Diagrams', {
          isExpanded: true,
        });

        renderHook(() =>
          useAutoExpandAncestors({
            items: [rootItem, sandboxItem, diagramsItem],
            targetPath: '/Sandbox/Diagrams/figure-1',
            onExpanded,
          }),
        );

        expect(rootItem.expand).not.toHaveBeenCalled();
        expect(sandboxItem.expand).not.toHaveBeenCalled();
        expect(diagramsItem.expand).not.toHaveBeenCalled();
        expect(onExpanded).not.toHaveBeenCalled();
      });

      test('should not process again on rerender with same targetPath', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/', { isExpanded: true });
        const sandboxItem = createMockItem('/Sandbox', { isExpanded: true });
        const diagramsItem = createMockItem('/Sandbox/Diagrams', {
          isExpanded: true,
        });

        const { rerender } = renderHook(
          ({ items }) =>
            useAutoExpandAncestors({
              items,
              targetPath: '/Sandbox/Diagrams/figure-1',
              onExpanded,
            }),
          { initialProps: { items: [rootItem, sandboxItem, diagramsItem] } },
        );

        expect(onExpanded).not.toHaveBeenCalled();

        // Rerender with same props - should not process again
        rerender({ items: [rootItem, sandboxItem, diagramsItem] });

        expect(onExpanded).not.toHaveBeenCalled();
      });
    });

    describe('when item is not a folder', () => {
      test('should not expand non-folder items', () => {
        const onExpanded = vi.fn();
        const rootItem = createMockItem('/', { isExpanded: false });
        const sandboxItem = createMockItem('/Sandbox', {
          isFolder: false,
          isExpanded: false,
        });

        renderHook(() =>
          useAutoExpandAncestors({
            items: [rootItem, sandboxItem],
            targetPath: '/Sandbox/Diagrams/figure-1',
            onExpanded,
          }),
        );

        expect(rootItem.expand).toHaveBeenCalled();
        expect(sandboxItem.expand).not.toHaveBeenCalled();
      });
    });
  });
});
