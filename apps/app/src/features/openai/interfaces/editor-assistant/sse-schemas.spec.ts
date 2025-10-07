import {
  type EditRequestBody,
  EditRequestBodySchema,
  type SseDetectedDiff,
  SseDetectedDiffSchema,
  type SseFinalized,
  SseFinalizedSchema,
  type SseMessage,
  SseMessageSchema,
} from './sse-schemas';

describe('sse-schemas', () => {
  describe('SseMessageSchema', () => {
    test('should validate valid SSE message', () => {
      const validMessage = {
        appendedMessage: 'Processing your request...',
      };

      const result = SseMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.appendedMessage).toBe(validMessage.appendedMessage);
      }
    });

    test('should validate empty appended message', () => {
      const validMessage = {
        appendedMessage: '',
      };

      const result = SseMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test('should validate multiline appended message', () => {
      const validMessage = {
        appendedMessage:
          'Step 1: Analyzing code\nStep 2: Preparing changes\nStep 3: Applying diff',
      };

      const result = SseMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test('should validate unicode and special characters', () => {
      const validMessage = {
        appendedMessage: 'コードを更新中... 🚀 Progress: 75%',
      };

      const result = SseMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test('should fail when appendedMessage field is missing', () => {
      const invalidMessage = {};

      const result = SseMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['appendedMessage']);
      }
    });

    test('should fail when appendedMessage is not a string', () => {
      const invalidMessage = {
        appendedMessage: 123,
      };

      const result = SseMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
    });

    test('should fail when appendedMessage is null', () => {
      const invalidMessage = {
        appendedMessage: null,
      };

      const result = SseMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
    });

    test('should allow extra fields (non-strict mode)', () => {
      const validMessage = {
        appendedMessage: 'Valid message',
        extraField: 'ignored',
      };

      const result = SseMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });
  });

  describe('SseDetectedDiffSchema', () => {
    test('should validate detected diff with complete diff object', () => {
      const validDetectedDiff = {
        diff: {
          search: 'function oldCode() {',
          replace: 'function newCode() {',
          startLine: 10,
          endLine: 12,
        },
      };

      const result = SseDetectedDiffSchema.safeParse(validDetectedDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.diff.search).toBe(validDetectedDiff.diff.search);
        expect(result.data.diff.replace).toBe(validDetectedDiff.diff.replace);
        expect(result.data.diff.startLine).toBe(
          validDetectedDiff.diff.startLine,
        );
        expect(result.data.diff.endLine).toBe(validDetectedDiff.diff.endLine);
      }
    });

    test('should validate detected diff without optional endLine', () => {
      const validDetectedDiff = {
        diff: {
          search: 'const value = 42;',
          replace: 'const value = 100;',
          startLine: 5,
        },
      };

      const result = SseDetectedDiffSchema.safeParse(validDetectedDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.diff.endLine).toBeUndefined();
      }
    });

    test('should validate diff with empty replace content', () => {
      const validDetectedDiff = {
        diff: {
          search: 'lineToDelete();',
          replace: '',
          startLine: 20,
        },
      };

      const result = SseDetectedDiffSchema.safeParse(validDetectedDiff);
      expect(result.success).toBe(true);
    });

    test('should fail when diff field is missing', () => {
      const invalidDetectedDiff = {};

      const result = SseDetectedDiffSchema.safeParse(invalidDetectedDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['diff']);
      }
    });

    test('should fail when diff has invalid structure', () => {
      const invalidDetectedDiff = {
        diff: {
          search: 'valid search',
          replace: 'valid replace',
          // missing required startLine
        },
      };

      const result = SseDetectedDiffSchema.safeParse(invalidDetectedDiff);
      expect(result.success).toBe(false);
    });

    test('should fail when diff search is empty', () => {
      const invalidDetectedDiff = {
        diff: {
          search: '',
          replace: 'replacement',
          startLine: 1,
        },
      };

      const result = SseDetectedDiffSchema.safeParse(invalidDetectedDiff);
      expect(result.success).toBe(false);
    });

    test('should allow extra fields in detected diff', () => {
      const validDetectedDiff = {
        diff: {
          search: 'code',
          replace: 'new code',
          startLine: 1,
        },
        extraField: 'ignored',
      };

      const result = SseDetectedDiffSchema.safeParse(validDetectedDiff);
      expect(result.success).toBe(true);
    });
  });

  describe('SseFinalizedSchema', () => {
    test('should validate finalized response with success true', () => {
      const validFinalized = {
        success: true,
      };

      const result = SseFinalizedSchema.safeParse(validFinalized);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(true);
      }
    });

    test('should validate finalized response with success false', () => {
      const validFinalized = {
        success: false,
      };

      const result = SseFinalizedSchema.safeParse(validFinalized);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(false);
      }
    });
  });

  describe('EditRequestBodySchema', () => {
    test('should validate valid edit request body with all required fields', () => {
      const validRequest = {
        threadId: 'thread-123',
        userMessage: 'Please update this code',
        pageBody: 'function example() { return true; }',
      };

      const result = EditRequestBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.threadId).toBe(validRequest.threadId);
        expect(result.data.userMessage).toBe(validRequest.userMessage);
        expect(result.data.pageBody).toBe(validRequest.pageBody);
      }
    });

    test('should validate edit request with optional fields', () => {
      const validRequest = {
        threadId: 'thread-456',
        aiAssistantId: 'assistant-789',
        userMessage: 'Add logging functionality',
        pageBody: 'const data = getData();',
        selectedText: 'const data',
        selectedPosition: 5,
        isPageBodyPartial: true,
        partialPageBodyStartIndex: 10,
      };

      const result = EditRequestBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aiAssistantId).toBe(validRequest.aiAssistantId);
        expect(result.data.selectedText).toBe(validRequest.selectedText);
        expect(result.data.selectedPosition).toBe(
          validRequest.selectedPosition,
        );
        expect(result.data.isPageBodyPartial).toBe(
          validRequest.isPageBodyPartial,
        );
        expect(result.data.partialPageBodyStartIndex).toBe(
          validRequest.partialPageBodyStartIndex,
        );
      }
    });

    test('should fail when threadId is missing', () => {
      const invalidRequest = {
        userMessage: 'Update code',
        pageBody: 'code here',
      };

      const result = EditRequestBodySchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['threadId']);
      }
    });

    test('should fail when userMessage is missing', () => {
      const invalidRequest = {
        threadId: 'thread-123',
        pageBody: 'code here',
      };

      const result = EditRequestBodySchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['userMessage']);
      }
    });

    test('should fail when pageBody is missing', () => {
      const invalidRequest = {
        threadId: 'thread-123',
        userMessage: 'Update code',
      };

      const result = EditRequestBodySchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['pageBody']);
      }
    });

    test('should validate when optional fields are omitted', () => {
      const validRequest = {
        threadId: 'thread-123',
        userMessage: 'Simple update',
        pageBody: 'function test() {}',
      };

      const result = EditRequestBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aiAssistantId).toBeUndefined();
        expect(result.data.selectedText).toBeUndefined();
        expect(result.data.selectedPosition).toBeUndefined();
        expect(result.data.isPageBodyPartial).toBeUndefined();
        expect(result.data.partialPageBodyStartIndex).toBeUndefined();
      }
    });

    test('should allow extra fields (non-strict mode)', () => {
      const validRequest = {
        threadId: 'thread-123',
        userMessage: 'Update code',
        pageBody: 'code here',
        extraField: 'ignored',
      };

      const result = EditRequestBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
  });

  describe('Type inference', () => {
    test('EditRequestBody type should match schema', () => {
      const editRequest: EditRequestBody = {
        threadId: 'thread-123',
        userMessage: 'Test message',
        pageBody: 'const test = true;',
      };

      const result = EditRequestBodySchema.safeParse(editRequest);
      expect(result.success).toBe(true);
    });

    test('SseMessage type should match schema', () => {
      const message: SseMessage = {
        appendedMessage: 'Test message',
      };

      const result = SseMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    test('SseDetectedDiff type should match schema', () => {
      const detectedDiff: SseDetectedDiff = {
        diff: {
          search: 'old',
          replace: 'new',
          startLine: 1,
        },
      };

      const result = SseDetectedDiffSchema.safeParse(detectedDiff);
      expect(result.success).toBe(true);
    });

    test('SseFinalized type should match schema', () => {
      const finalized: SseFinalized = {
        success: true,
      };

      const result = SseFinalizedSchema.safeParse(finalized);
      expect(result.success).toBe(true);
    });
  });
});
