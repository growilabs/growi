import type { OperationRecord } from '../../interfaces';
import { resolveAncestors, reviewScopeOf } from './review-scope';

const base = { index: 0, key: 'k', status: 'pending' as const };

describe('reviewScopeOf', () => {
  it('uses the target page of an edit (Req 16.2)', () => {
    const op: OperationRecord = {
      ...base,
      type: 'edit',
      pageId: 'p1',
      baseRevisionId: 'r1',
      body: 'b',
    };
    expect(reviewScopeOf(op)).toEqual({ pageIds: ['p1'], ancestorPaths: [] });
  });

  it('lists the parent candidates of a create, longest first, down to the root (Req 16.2)', () => {
    const op: OperationRecord = {
      ...base,
      type: 'create',
      path: '/a/b/c',
      body: 'b',
    };
    expect(reviewScopeOf(op)).toEqual({
      pageIds: [],
      ancestorPaths: ['/a/b', '/a', '/'],
    });
  });

  it('uses the root as the only parent candidate of a top-level create (Req 16.2)', () => {
    const op: OperationRecord = {
      ...base,
      type: 'create',
      path: '/top',
      body: 'b',
    };
    expect(reviewScopeOf(op)).toEqual({ pageIds: [], ancestorPaths: ['/'] });
  });

  it('has no parent candidates for a create at the root itself (Req 16.2)', () => {
    const op: OperationRecord = {
      ...base,
      type: 'create',
      path: '/',
      body: 'b',
    };
    expect(reviewScopeOf(op)).toEqual({ pageIds: [], ancestorPaths: [] });
  });

  it('uses the source page and the destination parent candidates of a move (Req 16.2, 19.6)', () => {
    const op: OperationRecord = {
      ...base,
      type: 'move',
      pageId: 'p9',
      fromPath: '/x/y',
      toPath: '/m/n/y',
    };
    expect(reviewScopeOf(op)).toEqual({
      pageIds: ['p9'],
      ancestorPaths: ['/m/n', '/m', '/'],
    });
  });

  it('returns the target page of a complete deletion, which never decides reviewers (Req 22.6)', () => {
    const op: OperationRecord = {
      ...base,
      type: 'delete-completely',
      pageId: 'p3',
      expectedRevisionId: 'r3',
    };
    expect(reviewScopeOf(op)).toEqual({ pageIds: ['p3'], ancestorPaths: [] });
  });
});

describe('resolveAncestors', () => {
  const candidates = ['/a/b', '/a', '/'];

  it('returns the nearest existing candidate (Req 16.2)', () => {
    expect(resolveAncestors(candidates, new Set(['/a/b', '/a', '/']))).toBe(
      '/a/b',
    );
  });

  it('skips candidates that are missing from the existing pages (Req 16.2)', () => {
    expect(resolveAncestors(candidates, new Set(['/a', '/']))).toBe('/a');
  });

  it('reaches a distant ancestor when the pages between do not exist (Req 16.2)', () => {
    expect(resolveAncestors(candidates, new Set(['/']))).toBe('/');
  });

  it('returns null when no candidate exists, including when there are no candidates', () => {
    expect(resolveAncestors(candidates, new Set(['/zzz']))).toBeNull();
    expect(resolveAncestors([], new Set(['/']))).toBeNull();
  });

  it('keeps the candidate order, not the set order (Req 16.2)', () => {
    expect(resolveAncestors(candidates, new Set(['/', '/a', '/a/b']))).toBe(
      '/a/b',
    );
  });
});
