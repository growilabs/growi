import { describe, expect, it } from 'vitest';

import { Linker } from './linker';

describe('Linker.fromMarkdownString', () => {
  describe('pukiwiki link with label', () => {
    it('should parse [[label>link]] format', () => {
      const linker = Linker.fromMarkdownString('[[my label>my link]]');

      expect(linker.type).toBe(Linker.types.pukiwikiLink);
      expect(linker.label).toBe('my label');
      expect(linker.link).toBe('my link');
    });
  });

  describe('pukiwiki link without label', () => {
    it('should parse [[link]] format and use link as label', () => {
      const linker = Linker.fromMarkdownString('[[my link]]');

      expect(linker.type).toBe(Linker.types.pukiwikiLink);
      expect(linker.label).toBe('my link');
      expect(linker.link).toBe('my link');
    });
  });

  describe('markdown link', () => {
    it('should parse [label](link) format', () => {
      const linker = Linker.fromMarkdownString(
        '[my label](https://example.com)',
      );

      expect(linker.type).toBe(Linker.types.markdownLink);
      expect(linker.label).toBe('my label');
      expect(linker.link).toBe('https://example.com');
    });

    it('should parse [label](link) with empty label and fill label with link', () => {
      const linker = Linker.fromMarkdownString('[](https://example.com)');

      expect(linker.type).toBe(Linker.types.markdownLink);
      // label is filled with link when empty (see initWhenMarkdownLink)
      expect(linker.label).toBe('https://example.com');
      expect(linker.link).toBe('https://example.com');
    });

    it('should parse [label](link) with path', () => {
      const linker = Linker.fromMarkdownString('[page](/path/to/page)');

      expect(linker.type).toBe(Linker.types.markdownLink);
      expect(linker.label).toBe('page');
      expect(linker.link).toBe('/path/to/page');
    });
  });

  describe('non-matching string', () => {
    it('should create markdownLink with string as label when no pattern matches', () => {
      const linker = Linker.fromMarkdownString('plain text');

      expect(linker.type).toBe(Linker.types.markdownLink);
      expect(linker.label).toBe('plain text');
      expect(linker.link).toBe('');
    });

    it('should handle empty string', () => {
      const linker = Linker.fromMarkdownString('');

      expect(linker.type).toBe(Linker.types.markdownLink);
      expect(linker.label).toBe('');
      expect(linker.link).toBe('');
    });
  });
});
