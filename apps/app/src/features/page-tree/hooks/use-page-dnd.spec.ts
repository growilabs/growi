import { describe, expect, it } from 'vitest';

import {
  getNewPathAfterMoved,
  hasAncestorDescendantRelation,
} from './use-page-dnd';

describe('getNewPathAfterMoved', () => {
  it('should return correct path when moving to root', () => {
    expect(getNewPathAfterMoved('/A/B', '/')).toBe('/B');
  });

  it('should return correct path when moving to nested parent', () => {
    expect(getNewPathAfterMoved('/A/B', '/C/D')).toBe('/C/D/B');
  });

  it('should handle page with special characters in name', () => {
    expect(getNewPathAfterMoved('/A/Page Name', '/B')).toBe('/B/Page Name');
  });

  it('should handle deeply nested paths', () => {
    expect(getNewPathAfterMoved('/A/B/C/D', '/X/Y')).toBe('/X/Y/D');
  });

  it('should handle moving from root child to another location', () => {
    expect(getNewPathAfterMoved('/PageA', '/Folder')).toBe('/Folder/PageA');
  });

  it('should handle Japanese characters in page name', () => {
    expect(getNewPathAfterMoved('/A/ページ名', '/B')).toBe('/B/ページ名');
  });
});

describe('hasAncestorDescendantRelation', () => {
  // Helper to create mock item instances
  const createMockItem = (path: string | null) => ({
    getItemData: () => ({ path }),
  });

  it('should return true when parent and child are selected', () => {
    const items = [createMockItem('/A'), createMockItem('/A/B')];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(true);
  });

  it('should return true when grandparent and grandchild are selected', () => {
    const items = [createMockItem('/A'), createMockItem('/A/B/C')];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(true);
  });

  it('should return true when child and parent are in reverse order', () => {
    const items = [createMockItem('/A/B'), createMockItem('/A')];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(true);
  });

  it('should return false when siblings are selected', () => {
    const items = [createMockItem('/A'), createMockItem('/B')];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(false);
  });

  it('should return false for single item', () => {
    const items = [createMockItem('/A')];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(hasAncestorDescendantRelation([])).toBe(false);
  });

  it('should return false when paths are similar but not ancestor-descendant', () => {
    // /A and /AB are not ancestor-descendant
    const items = [createMockItem('/A'), createMockItem('/AB')];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(false);
  });

  it('should handle items with null paths', () => {
    const items = [createMockItem('/A'), createMockItem(null)];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(false);
  });

  it('should return false when multiple siblings are selected', () => {
    const items = [
      createMockItem('/A/B'),
      createMockItem('/A/C'),
      createMockItem('/A/D'),
    ];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(false);
  });

  it('should return true when one item is ancestor of another in multiple selection', () => {
    const items = [
      createMockItem('/X'),
      createMockItem('/A/B'),
      createMockItem('/A/B/C'),
    ];
    expect(hasAncestorDescendantRelation(items as never[])).toBe(true);
  });
});
