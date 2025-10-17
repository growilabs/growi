import { isCreatablePage } from './index';

describe('isCreatablePage', () => {
  describe('should return true for valid page paths', () => {
    it.each([
      '/path/to/page',
      '/hoge',
      '/meeting',
      '/meeting/x',
      '/_',
      '/_template',
    ])('should return true for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(true);
    });
  });

  describe('Japanese character support', () => {
    it('should handle Japanese characters correctly', () => {
      const japanesePath = '/path/to/ページ';
      const result = isCreatablePage(japanesePath);
      expect(result).toBe(true);
    });

    it('should handle full Japanese path', () => {
      const fullJapanesePath = '/ユーザー/プロジェクト';
      const result = isCreatablePage(fullJapanesePath);
      expect(result).toBe(true);
    });

    it('should handle mixed language path', () => {
      const mixedPath = '/project/プロジェクト/documentation';
      const result = isCreatablePage(mixedPath);
      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should allow user sub-pages but not user homepage', () => {
      expect(isCreatablePage('/user')).toBe(false); // User top page
      expect(isCreatablePage('/user/john')).toBe(false); // User homepage
      expect(isCreatablePage('/user/john/projects')).toBe(true); // User sub-page
    });

    it('should distinguish between me and meeting', () => {
      expect(isCreatablePage('/me')).toBe(false);
      expect(isCreatablePage('/meeting')).toBe(true);
    });
  });

  describe('should return false for invalid page paths', () => {
    it.each([
      '/user', // User top page
      '/user/john', // User homepage
      '/_api',
      '/_search',
      '/admin',
      '/login',
      '/hoge/file.md', // .md files
      '//multiple-slash', // Multiple slashes
      '/path/edit', // Edit paths
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });

  describe('special characters restriction', () => {
    it.each([
      '/path^with^caret', // ^ character
      '/path$with$dollar', // $ character
      '/path*with*asterisk', // * character
      '/path+with+plus', // + character
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });

  describe('URL patterns restriction', () => {
    it.each([
      '/http://example.com/page', // HTTP URL
      '/https://example.com/page', // HTTPS URL
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });

  describe('relative path restriction', () => {
    it.each([
      '/..', // Parent directory reference
      '/path/../other', // Relative path with parent reference
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });

  describe('backslash restriction', () => {
    it.each([
      '/path\\with\\backslash', // Backslash in path
      '/folder\\file', // Backslash separator
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });

  describe('space and slash restriction', () => {
    it.each([
      '/ path / with / spaces', // Spaces around slashes
      '/path / with / bad / formatting', // Mixed spacing
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });

  describe('system path restriction', () => {
    it.each([
      '/_r/some/path', // _r system path
      '/_private-legacy-pages/old', // Private legacy pages
    ])('should return false for "%s"', (path) => {
      expect(isCreatablePage(path)).toBe(false);
    });
  });
});
