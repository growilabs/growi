import { describe, expect, it } from 'vitest';

import { buildUnifiedDiff } from './diff-core';

describe('buildUnifiedDiff', () => {
  it('returns a unified diff for normal changes', () => {
    const result = buildUnifiedDiff(
      '/page/test',
      'line1\nline2\n',
      'line1\nmodified\n',
      3,
    );
    expect(result).toContain('-line2');
    expect(result).toContain('+modified');
  });

  it('returns the entire content as additions when fromBody is empty (baseline null)', () => {
    const result = buildUnifiedDiff('/page/test', '', 'new content\n', 3);
    expect(result).toContain('+new content');
    // No removal lines (lines starting with - that are not the header)
    expect(result).not.toMatch(/^-[^-]/m);
  });

  it('includes the specified number of context lines around changes', () => {
    const body =
      Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    const modified = body.replace('line10', 'changed');

    // context=1: only 1 line before/after the change
    const result1 = buildUnifiedDiff('/page/test', body, modified, 1);
    expect(result1).toContain('line9');
    expect(result1).toContain('line11');
    expect(result1).not.toContain('line8'); // beyond context

    // context=3: 3 lines before/after the change
    const result3 = buildUnifiedDiff('/page/test', body, modified, 3);
    expect(result3).toContain('line7');
    expect(result3).toContain('line13');
  });
});
