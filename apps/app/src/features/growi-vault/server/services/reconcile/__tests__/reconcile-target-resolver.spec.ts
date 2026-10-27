/**
 * reconcile-target-resolver.spec.ts
 *
 * Unit tests for resolveTarget (Task 2.1).
 * Pure function — no external I/O, no mocks required.
 */

import { describe, expect, it } from 'vitest';

import { resolveTarget } from '../reconcile-target-resolver';

// ---------------------------------------------------------------------------
// Helper: access the $regex value buried inside the $or query
// ---------------------------------------------------------------------------
function getSubtreeRegex(query: Record<string, unknown>): string {
  const or = (query as { $or: Array<Record<string, unknown>> }).$or;
  if (!or) throw new Error('Expected $or in query');
  const regexClause = or[1] as { path: { $regex: string } };
  return regexClause.path.$regex;
}

function getSubtreeExactPath(query: Record<string, unknown>): string {
  const or = (query as { $or: Array<Record<string, unknown>> }).$or;
  if (!or) throw new Error('Expected $or in query');
  const exactClause = or[0] as { path: string };
  return exactClause.path;
}

// ---------------------------------------------------------------------------
// 'page' target type
// ---------------------------------------------------------------------------

describe('resolveTarget — page type', () => {
  it('returns { ok: true, query: { path: targetPath } } for a valid path', () => {
    const result = resolveTarget('page', '/foo/bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({ path: '/foo/bar' });
  });

  it('returns exact path match query for root-level page', () => {
    const result = resolveTarget('page', '/top');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({ path: '/top' });
  });

  it('returns exact path match for deeply nested page', () => {
    const result = resolveTarget('page', '/a/b/c/d');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({ path: '/a/b/c/d' });
  });
});

// ---------------------------------------------------------------------------
// 'sub-tree' target type
// ---------------------------------------------------------------------------

describe('resolveTarget — sub-tree type', () => {
  it('returns { ok: true, query } with $or containing exact match and $regex', () => {
    const result = resolveTarget('sub-tree', '/foo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({
      $or: [{ path: '/foo' }, { path: { $regex: '^/foo/' } }],
    });
  });

  it('includes self (exact match) as first clause in $or', () => {
    const result = resolveTarget('sub-tree', '/parent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getSubtreeExactPath(result.query as Record<string, unknown>)).toBe(
      '/parent',
    );
  });

  it('includes descendants via $regex as second clause in $or', () => {
    const result = resolveTarget('sub-tree', '/parent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getSubtreeRegex(result.query as Record<string, unknown>)).toBe(
      '^/parent/',
    );
  });
});

// ---------------------------------------------------------------------------
// Regex metacharacter escaping
// ---------------------------------------------------------------------------

describe('resolveTarget — regex metacharacter escaping in sub-tree', () => {
  it('escapes dot in path', () => {
    const result = resolveTarget('sub-tree', '/foo.bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\.bar/');
  });

  it('escapes plus in path', () => {
    const result = resolveTarget('sub-tree', '/foo+bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\+bar/');
  });

  it('escapes asterisk in path', () => {
    const result = resolveTarget('sub-tree', '/foo*bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\*bar/');
  });

  it('escapes question mark in path', () => {
    const result = resolveTarget('sub-tree', '/foo?bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\?bar/');
  });

  it('escapes caret in path segment', () => {
    const result = resolveTarget('sub-tree', '/foo^bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\^bar/');
  });

  it('escapes dollar sign in path', () => {
    const result = resolveTarget('sub-tree', '/foo$bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\$bar/');
  });

  it('escapes curly braces in path', () => {
    const result = resolveTarget('sub-tree', '/foo{2}bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\{2\\}bar/');
  });

  it('escapes square brackets in path', () => {
    const result = resolveTarget('sub-tree', '/foo[bar]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\[bar\\]/');
  });

  it('escapes parentheses in path', () => {
    const result = resolveTarget('sub-tree', '/foo(bar)');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\(bar\\)/');
  });

  it('escapes pipe in path', () => {
    const result = resolveTarget('sub-tree', '/foo|bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\|bar/');
  });

  it('escapes backslash in path', () => {
    const result = resolveTarget('sub-tree', '/foo\\bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\\\bar/');
  });

  it('escapes multiple metacharacters in one path', () => {
    const result = resolveTarget('sub-tree', '/foo.bar+baz');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regex = getSubtreeRegex(result.query as Record<string, unknown>);
    expect(regex).toBe('^/foo\\.bar\\+baz/');
  });
});

// ---------------------------------------------------------------------------
// Invalid paths — empty string
// ---------------------------------------------------------------------------

describe('resolveTarget — invalid path: empty string', () => {
  it('rejects empty string for page type', () => {
    const result = resolveTarget('page', '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });

  it('rejects empty string for sub-tree type', () => {
    const result = resolveTarget('sub-tree', '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });
});

// ---------------------------------------------------------------------------
// Invalid paths — no leading slash
// ---------------------------------------------------------------------------

describe('resolveTarget — invalid path: no leading slash', () => {
  it('rejects path without leading slash for page type', () => {
    const result = resolveTarget('page', 'foo/bar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });

  it('rejects path without leading slash for sub-tree type', () => {
    const result = resolveTarget('sub-tree', 'foo');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });
});

// ---------------------------------------------------------------------------
// Invalid paths — consecutive slashes
// ---------------------------------------------------------------------------

describe('resolveTarget — invalid path: consecutive slashes', () => {
  it('rejects path with consecutive slashes for page type', () => {
    const result = resolveTarget('page', '/foo//bar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });

  it('rejects path with consecutive slashes for sub-tree type', () => {
    const result = resolveTarget('sub-tree', '/foo//bar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });

  it('rejects double-slash at root (//) for page type', () => {
    const result = resolveTarget('page', '//');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });
});

// ---------------------------------------------------------------------------
// Invalid paths — newline characters
// ---------------------------------------------------------------------------

describe('resolveTarget — invalid path: newline characters', () => {
  it('rejects path with \\n for page type', () => {
    const result = resolveTarget('page', '/foo\nbar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });

  it('rejects path with \\r for sub-tree type', () => {
    const result = resolveTarget('sub-tree', '/foo\rbar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });

  it('rejects path with \\r\\n for page type', () => {
    const result = resolveTarget('page', '/foo\r\nbar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-target');
  });
});

// ---------------------------------------------------------------------------
// Boundary: page type does NOT escape (exact match, not regex)
// ---------------------------------------------------------------------------

describe('resolveTarget — page type uses exact match (no regex)', () => {
  it('page query is simple { path } object, not a regex', () => {
    const result = resolveTarget('page', '/foo.bar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exact match — path contains the literal dot, no escaping needed
    expect(result.query).toEqual({ path: '/foo.bar' });
    // No $regex in page query
    expect(JSON.stringify(result.query)).not.toContain('$regex');
  });
});
