import { describe, expect, it } from 'vitest';

import { computeShape, diffShapes } from './fixture-shape.ts';

describe('computeShape', () => {
  it('collapses primitives to their type name, never their value', () => {
    expect(computeShape('hello')).toEqual({ type: 'string' });
    expect(computeShape(42)).toEqual({ type: 'number' });
    expect(computeShape(true)).toEqual({ type: 'boolean' });
    expect(computeShape(null)).toEqual({ type: 'null' });
  });

  it('recurses into object keys', () => {
    expect(computeShape({ a: 'x', b: 1 })).toEqual({
      type: 'object',
      fields: { a: { type: 'string' }, b: { type: 'number' } },
    });
  });

  it("represents an array by only its first element's shape", () => {
    expect(computeShape([1, 2, 3])).toEqual({
      type: 'array',
      element: { type: 'number' },
    });
    // A 5-element array and a 1-element array of the same element type
    // must compute to the same shape (element count is not part of shape).
    expect(computeShape([1])).toEqual(computeShape([1, 2, 3, 4, 5]));
  });

  it('represents an empty array with a null element shape', () => {
    expect(computeShape([])).toEqual({ type: 'array', element: null });
  });

  it('recurses into nested objects and arrays of objects', () => {
    const value = {
      id: 1,
      items: [{ name: 'x', tags: ['a', 'b'] }],
    };
    expect(computeShape(value)).toEqual({
      type: 'object',
      fields: {
        id: { type: 'number' },
        items: {
          type: 'array',
          element: {
            type: 'object',
            fields: {
              name: { type: 'string' },
              tags: { type: 'array', element: { type: 'string' } },
            },
          },
        },
      },
    });
  });
});

describe('diffShapes', () => {
  it('reports a key that was added', () => {
    const a = computeShape({ id: 1 });
    const b = computeShape({ id: 1, title: 'x' });
    expect(diffShapes(a, b)).toContain('title');
  });

  it('reports a key that was removed', () => {
    const a = computeShape({ id: 1, title: 'x' });
    const b = computeShape({ id: 1 });
    expect(diffShapes(a, b)).toContain('title');
  });

  it('reports a key whose type changed', () => {
    const a = computeShape({ id: 1 });
    const b = computeShape({ id: 'one' });
    expect(diffShapes(a, b)).toContain('id');
  });

  it('reports a nested key path when the drift is inside a nested object', () => {
    const a = computeShape({ user: { id: 1 } });
    const b = computeShape({ user: { id: 1, name: 'x' } });
    expect(diffShapes(a, b)).toContain('user.name');
  });

  it('does not report an array element-count change as drift', () => {
    const a = computeShape({ items: [1] });
    const b = computeShape({ items: [1, 2, 3] });
    expect(diffShapes(a, b)).toEqual([]);
  });

  it('does not report a change in string content as drift', () => {
    const a = computeShape({ title: 'old title' });
    const b = computeShape({ title: 'a completely different title' });
    expect(diffShapes(a, b)).toEqual([]);
  });

  it('does not report a change in number value as drift', () => {
    const a = computeShape({ count: 1 });
    const b = computeShape({ count: 999999 });
    expect(diffShapes(a, b)).toEqual([]);
  });

  it('reports both value-preserving-and-not differences together: only the real drift surfaces', () => {
    const a = computeShape({ title: 'old', count: 1, items: [1] });
    const b = computeShape({
      title: 'new',
      count: 2,
      items: [1, 2],
      extra: true,
    });
    expect(diffShapes(a, b)).toEqual(['extra']);
  });

  it('diffShapes(a, a) is always empty, including for nested structures', () => {
    const shape = computeShape({
      id: 1,
      user: { name: 'x', roles: ['a', 'b'] },
      items: [{ id: 1 }, { id: 2 }],
    });
    expect(diffShapes(shape, shape)).toEqual([]);
  });
});
