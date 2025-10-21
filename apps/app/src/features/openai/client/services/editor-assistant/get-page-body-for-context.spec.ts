import { Text } from '@codemirror/state';
import type { UseCodeMirrorEditor } from '@growi/editor/dist/client/services/use-codemirror-editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { getPageBodyForContext } from './get-page-body-for-context';

describe('getPageBodyForContext', () => {
  let mockEditor: DeepMockProxy<UseCodeMirrorEditor>;

  // Helper function to create identifiable content where each character shows its position
  const createPositionalContent = (length: number): string => {
    return Array.from({ length }, (_, i) => (i % 10).toString()).join('');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor = mockDeep<UseCodeMirrorEditor>();
  });

  describe('Error handling and edge cases', () => {
    it('should return undefined when editor is undefined', () => {
      const result = getPageBodyForContext(undefined, 10, 10);
      expect(result).toBeUndefined();
    });

    it('should handle missing view state (defaults cursor to 0)', () => {
      const longContent = createPositionalContent(1000);
      const realDoc = Text.of([longContent]);

      mockEditor.getDoc.mockReturnValue(realDoc);
      mockEditor.view = undefined;

      const result = getPageBodyForContext(mockEditor, 100, 200);

      // Should default cursor position to 0
      // Available before cursor: 0 (cursor at start)
      // Shortfall before: 100 - 0 = 100
      // Chars after: 200 + 100 = 300
      // Expected: start=0, end=0+300=300
      const expectedContent = longContent.slice(0, 300);
      expect(result).toEqual({
        content: expectedContent,
        isPartial: true,
        startIndex: 0,
        endIndex: 300,
        totalLength: 1000,
      });
      expect(result?.content).toHaveLength(300);
    });
  });

  describe('Short document handling', () => {
    it('should return getDocString when document is short', () => {
      // Create a real Text instance with short content
      const shortText = 'short';
      const realDoc = Text.of([shortText]); // length: 5, shorter than maxTotalLength of 20

      mockEditor.getDoc.mockReturnValue(realDoc);
      mockEditor.getDocString.mockReturnValue(shortText);

      const result = getPageBodyForContext(mockEditor, 10, 10);

      expect(result).toEqual({
        content: shortText,
        isPartial: false,
        totalLength: 5,
      });
      expect(mockEditor.getDocString).toHaveBeenCalled();
    });

    it('should return full document when length equals max total length', () => {
      const exactLengthText = createPositionalContent(150); // exactly 150 chars
      const realDoc = Text.of([exactLengthText]);

      mockEditor.getDoc.mockReturnValue(realDoc);
      mockEditor.getDocString.mockReturnValue(exactLengthText);

      const result = getPageBodyForContext(mockEditor, 50, 100); // total: 150

      expect(result).toEqual({
        content: exactLengthText,
        isPartial: false,
        totalLength: 150,
      });
      expect(mockEditor.getDocString).toHaveBeenCalled();
    });

    it('should return full document when length is less than max total length', () => {
      const shortText = 'Short document'; // 14 chars
      const realDoc = Text.of([shortText]);

      mockEditor.getDoc.mockReturnValue(realDoc);
      mockEditor.getDocString.mockReturnValue(shortText);

      const result = getPageBodyForContext(mockEditor, 50, 100); // total: 150

      expect(result).toEqual({
        content: shortText,
        isPartial: false,
        totalLength: 14,
      });
    });
  });

  describe('Core shortfall compensation logic', () => {
    it('should extract correct range when cursor is in middle (no shortfall)', () => {
      const longContent = createPositionalContent(2000);
      const realDoc = Text.of([longContent]);
      const cursorPos = 1000;

      mockEditor.getDoc.mockReturnValue(realDoc);

      // Mock view with cursor at position 1000
      if (mockEditor.view?.state?.selection?.main) {
        Object.defineProperty(mockEditor.view.state.selection.main, 'head', {
          value: cursorPos,
        });
      }

      const result = getPageBodyForContext(mockEditor, 200, 300);

      // Expected: start=800, end=1300 (no shortfall needed)
      const expectedContent = longContent.slice(800, 1300);
      expect(result).toEqual({
        content: expectedContent,
        isPartial: true,
        startIndex: 800,
        endIndex: 1300,
        totalLength: 2000,
      });
      expect(result?.content).toHaveLength(500); // 1300 - 800 = 500
    });

    it('should compensate shortfall when cursor is near document end', () => {
      const longContent = createPositionalContent(1000);
      const realDoc = Text.of([longContent]);
      const cursorPos = 950; // Near end

      mockEditor.getDoc.mockReturnValue(realDoc);

      // Mock view with cursor at position 950
      if (mockEditor.view?.state?.selection?.main) {
        Object.defineProperty(mockEditor.view.state.selection.main, 'head', {
          value: cursorPos,
        });
      }

      const result = getPageBodyForContext(mockEditor, 100, 200);

      // Available after cursor: 1000 - 950 = 50
      // Shortfall: 200 - 50 = 150
      // Chars before: 100 + 150 = 250
      // Expected: start=max(0, 950-250)=700, end=950+50=1000
      const expectedContent = longContent.slice(700, 1000);
      expect(result).toEqual({
        content: expectedContent,
        isPartial: true,
        startIndex: 700,
        endIndex: 1000,
        totalLength: 1000,
      });
      expect(result?.content).toHaveLength(300); // 1000 - 700 = 300
    });

    it('should handle extreme case: cursor at document end', () => {
      const longContent = createPositionalContent(1000);
      const realDoc = Text.of([longContent]);
      const cursorPos = 1000; // At very end

      mockEditor.getDoc.mockReturnValue(realDoc);

      // Mock view with cursor at position 1000
      if (mockEditor.view?.state?.selection?.main) {
        Object.defineProperty(mockEditor.view.state.selection.main, 'head', {
          value: cursorPos,
        });
      }

      const result = getPageBodyForContext(mockEditor, 100, 200);

      // Available after cursor: 0
      // Shortfall: 200 - 0 = 200
      // Chars before: 100 + 200 = 300
      // Expected: start=max(0, 1000-300)=700, end=1000+0=1000
      const expectedContent = longContent.slice(700, 1000);
      expect(result).toEqual({
        content: expectedContent,
        isPartial: true,
        startIndex: 700,
        endIndex: 1000,
        totalLength: 1000,
      });
      expect(result?.content).toHaveLength(300); // 1000 - 700 = 300
    });

    it('should handle cursor at document start with startPos boundary', () => {
      const longContent = createPositionalContent(1000);
      const realDoc = Text.of([longContent]);
      const cursorPos = 0; // At start

      mockEditor.getDoc.mockReturnValue(realDoc);

      // Mock view with cursor at position 0
      if (mockEditor.view?.state?.selection?.main) {
        Object.defineProperty(mockEditor.view.state.selection.main, 'head', {
          value: cursorPos,
        });
      }

      const result = getPageBodyForContext(mockEditor, 100, 200);

      // Available before cursor: 0 (cursor at start)
      // Shortfall before: 100 - 0 = 100
      // Chars after: 200 + 100 = 300
      // Expected: start=0, end=0+300=300
      const expectedContent = longContent.slice(0, 300);
      expect(result).toEqual({
        content: expectedContent,
        isPartial: true,
        startIndex: 0,
        endIndex: 300,
        totalLength: 1000,
      });
      expect(result?.content).toHaveLength(300);
    });

    it('should handle truly extreme shortfall with cursor very near end', () => {
      const longContent = createPositionalContent(1000);
      const realDoc = Text.of([longContent]);
      const cursorPos = 995; // Very near end

      mockEditor.getDoc.mockReturnValue(realDoc);

      // Mock view with cursor at position 995
      if (mockEditor.view?.state?.selection?.main) {
        Object.defineProperty(mockEditor.view.state.selection.main, 'head', {
          value: cursorPos,
        });
      }

      const result = getPageBodyForContext(mockEditor, 50, 500); // Total: 550 < 1000

      // Available after cursor: 1000 - 995 = 5
      // Shortfall: 500 - 5 = 495
      // Chars before: 50 + 495 = 545
      // Expected: start=max(0, 995-545)=450, end=995+5=1000
      const expectedContent = longContent.slice(450, 1000);
      expect(result).toEqual({
        content: expectedContent,
        isPartial: true,
        startIndex: 450,
        endIndex: 1000,
        totalLength: 1000,
      });
      expect(result?.content).toHaveLength(550); // 1000 - 450 = 550
    });
  });
});
