import { describe, expect, test } from 'vitest';

import { generateGlobPatterns } from './generate-glob-patterns';

describe('generateGlobPatterns', () => {
  test('generates glob patterns for basic path with trailing slash', () => {
    const path = '/Sandbox/Bootstrap5/';
    const patterns = generateGlobPatterns(path);

    expect(patterns).toEqual(['/Sandbox/*', '/Sandbox/Bootstrap5/*']);
  });

  test('generates glob patterns for multi-level path with trailing slash', () => {
    const path = '/user/admin/memo/';
    const patterns = generateGlobPatterns(path);

    expect(patterns).toEqual([
      '/user/*',
      '/user/admin/*',
      '/user/admin/memo/*',
    ]);
  });

  test('generates glob patterns for path without trailing slash', () => {
    const path = '/path/to/directory';
    const patterns = generateGlobPatterns(path);

    expect(patterns).toEqual(['/path/*', '/path/to/*', '/path/to/directory/*']);
  });

  test('handles path with empty segments correctly', () => {
    const path = '/path//to///dir';
    const patterns = generateGlobPatterns(path);

    expect(patterns).toEqual(['/path/*', '/path/to/*', '/path/to/dir/*']);
  });
});
