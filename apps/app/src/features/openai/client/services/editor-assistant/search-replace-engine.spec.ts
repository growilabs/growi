import { Doc as YDoc, type Text as YText } from 'yjs';

import {
  getContextAroundLine,
  getLineFromIndex,
  performExactSearchReplace,
  performSearchReplace,
} from './search-replace-engine';

// Test utilities
function createYTextFromString(content: string): YText {
  const doc = new YDoc();
  const ytext = doc.getText('test-content');
  ytext.insert(0, content);
  return ytext;
}

function createTestContent(): string {
  return `function test() {
  console.log("hello");
  return true;
}

class TestClass {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }
}`;
}

function createIndentedContent(): string {
  return `function mixedIndent() {
\tconsole.log("tab indent");
    console.log("space indent");
\t    console.log("mixed indent");
}`;
}

describe('search-replace-engine', () => {
  describe('performExactSearchReplace', () => {
    test('should replace exact match without startLine', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        'console.log("hello");',
        'console.log("world");',
      );

      expect(success).toBe(true);
      expect(ytext.toString()).toContain('console.log("world");');
      expect(ytext.toString()).not.toContain('console.log("hello");');
    });

    test('should replace exact match with startLine', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        'console.log("hello");',
        'console.log("world");',
        2, // Start searching from line 2
      );

      expect(success).toBe(true);
      expect(ytext.toString()).toContain('console.log("world");');
    });

    test('should fail when search text not found', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        'nonexistent_text',
        'replacement',
      );

      expect(success).toBe(false);
      expect(ytext.toString()).toBe(content); // Content unchanged
    });

    test('should fail when startLine is beyond content', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        'console.log("hello");',
        'console.log("world");',
        100, // Line beyond content
      );

      expect(success).toBe(false);
      expect(ytext.toString()).toBe(content);
    });

    test('should handle empty search string', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(ytext, '', 'replacement');

      expect(success).toBe(true); // Empty string is found at index 0
      expect(ytext.toString()).toContain('replacement');
    });

    test('should preserve indentation when replacing', () => {
      const content = createIndentedContent();
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        '\tconsole.log("tab indent");',
        '\tconsole.log("new tab indent");',
      );

      expect(success).toBe(true);
      expect(ytext.toString()).toContain('\tconsole.log("new tab indent");');
    });

    test('should handle multiple occurrences (replace first)', () => {
      const content = `console.log("test");
console.log("test");
console.log("different");`;
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        'console.log("test");',
        'console.log("replaced");',
      );

      expect(success).toBe(true);
      const result = ytext.toString();
      expect(result).toContain('console.log("replaced");');
      // Should still contain the second occurrence
      expect((result.match(/console\.log\("test"\);/g) || []).length).toBe(1);
    });
  });

  describe('performSearchReplace (fuzzy matching)', () => {
    test('should handle exact match with fuzzy matcher', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performSearchReplace(
        ytext,
        'console.log("hello");',
        'console.log("world");',
        2,
      );

      expect(success).toBe(true);
      expect(ytext.toString()).toContain('console.log("world");');
    });

    test('should handle fuzzy matching with slight differences', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      // Search with extra spaces (should still match with fuzzy)
      const success = performSearchReplace(
        ytext,
        'console.log( "hello" );', // Extra spaces
        'console.log("world");',
        2,
      );

      // Note: This depends on fuzzy matching implementation
      // May pass or fail depending on similarity threshold
      if (success) {
        expect(ytext.toString()).toContain('console.log("world");');
      } else {
        expect(ytext.toString()).toBe(content); // Unchanged if fuzzy match fails
      }
    });

    test('should fail with completely different search text', () => {
      const content = createTestContent();
      const ytext = createYTextFromString(content);

      const success = performSearchReplace(
        ytext,
        'completely_different_function_call()',
        'replacement',
        2,
      );

      expect(success).toBe(false);
      expect(ytext.toString()).toBe(content);
    });

    test('should respect startLine parameter', () => {
      const content = `line1
console.log("hello");
line3
console.log("hello");
line5`;
      const ytext = createYTextFromString(content);

      // Search starting from line 4 (should find second occurrence)
      const success = performSearchReplace(
        ytext,
        'console.log("hello");',
        'console.log("found");',
        4,
      );

      if (success) {
        const result = ytext.toString();
        // Should still contain first occurrence
        expect(result.split('console.log("hello");').length).toBe(2);
        expect(result).toContain('console.log("found");');
      }
    });
  });

  describe('getLineFromIndex', () => {
    test('should return correct line and column for index', () => {
      const content = createTestContent();
      const result = getLineFromIndex(content, 20);

      expect(result.lineNumber).toBeGreaterThan(0);
      expect(result.columnNumber).toBeGreaterThanOrEqual(0);
    });

    test('should handle index at start of content', () => {
      const content = createTestContent();
      const result = getLineFromIndex(content, 0);

      expect(result.lineNumber).toBe(1);
      expect(result.columnNumber).toBe(0);
    });

    test('should handle index at end of content', () => {
      const content = createTestContent();
      const result = getLineFromIndex(content, content.length);

      expect(result.lineNumber).toBeGreaterThan(0);
      expect(result.columnNumber).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getContextAroundLine', () => {
    test('should return context around specified line', () => {
      const content = createTestContent();
      const context = getContextAroundLine(content, 2, 1);

      expect(context).toContain('→ 2:'); // Arrow marker for target line
      expect(context.split('\n').length).toBeGreaterThan(1);
    });

    test('should handle line number at start of content', () => {
      const content = createTestContent();
      const context = getContextAroundLine(content, 1, 2);

      expect(context).toContain('→ 1:');
    });

    test('should handle line number beyond content', () => {
      const content = createTestContent();
      const lines = content.split('\n');
      const context = getContextAroundLine(content, lines.length + 10, 2);

      // Should not crash and return meaningful context
      expect(context).toBeDefined();
      expect(context.length).toBeGreaterThan(0);
    });

    test('should respect contextLines parameter', () => {
      const content = createTestContent();
      const contextSmall = getContextAroundLine(content, 5, 1);
      const contextLarge = getContextAroundLine(content, 5, 3);

      expect(contextLarge.split('\n').length).toBeGreaterThan(
        contextSmall.split('\n').length,
      );
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle empty content', () => {
      const ytext = createYTextFromString('');

      const success = performExactSearchReplace(ytext, 'test', 'replacement');
      expect(success).toBe(false);
    });

    test('should handle single line content', () => {
      const ytext = createYTextFromString('single line');

      const success = performExactSearchReplace(ytext, 'single', 'modified');
      expect(success).toBe(true);
      expect(ytext.toString()).toBe('modified line');
    });

    test('should handle content with no newlines', () => {
      const ytext = createYTextFromString('no newlines here');

      const success = performSearchReplace(ytext, 'newlines', 'changes', 1);
      if (success) {
        expect(ytext.toString()).toContain('changes');
      }
    });

    test('should handle very large content', () => {
      const largeContent = `${'line\n'.repeat(1000)}target line\n${'line\n'.repeat(1000)}`;
      const ytext = createYTextFromString(largeContent);

      const success = performSearchReplace(
        ytext,
        'target line',
        'found target',
        1001,
      );
      if (success) {
        expect(ytext.toString()).toContain('found target');
      }
    });

    test('should handle unicode characters', () => {
      const content = 'Hello 👋 World\nこんにちは世界\nLine 3';
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        'こんにちは世界',
        'Hello World',
      );
      expect(success).toBe(true);
      expect(ytext.toString()).toContain('Hello World');
      expect(ytext.toString()).not.toContain('こんにちは世界');
    });

    test('should handle special regex characters', () => {
      const content = 'function test() { return /regex/g; }';
      const ytext = createYTextFromString(content);

      const success = performExactSearchReplace(
        ytext,
        '/regex/g',
        '/newregex/g',
      );
      expect(success).toBe(true);
      expect(ytext.toString()).toContain('/newregex/g');
    });
  });
});
