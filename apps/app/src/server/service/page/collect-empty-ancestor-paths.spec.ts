import { collectEmptyAncestorPaths } from './collect-empty-ancestor-paths';

describe('collectEmptyAncestorPaths', () => {
  it('returns the page itself when moving directly under it', () => {
    expect(collectEmptyAncestorPaths('/a', '/a/b')).toEqual(['/a']);
  });

  it('returns every ancestor down to the page itself, nearest first', () => {
    expect(collectEmptyAncestorPaths('/a', '/a/b/c/d')).toEqual([
      '/a/b/c',
      '/a/b',
      '/a',
    ]);
  });

  it('throws instead of looping forever when the destination is not under the page', () => {
    expect(() => collectEmptyAncestorPaths('/Foo', '/foo/bar')).toThrow();
    expect(() => collectEmptyAncestorPaths('/a', '/b/c')).toThrow();
  });
});
