import {
  type LlmEditorAssistantDiff,
  LlmEditorAssistantDiffSchema,
  type LlmEditorAssistantMessage,
  LlmEditorAssistantMessageSchema,
} from './llm-response-schemas';

describe('llm-response-schemas', () => {
  describe('LlmEditorAssistantMessageSchema', () => {
    test('should validate valid message objects', () => {
      const validMessage = {
        message:
          'I have successfully updated the function to include error handling.',
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe(validMessage.message);
      }
    });

    test('should validate empty message string', () => {
      const validMessage = {
        message: '',
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test('should validate message with special characters and unicode', () => {
      const validMessage = {
        message: 'ファイルを更新しました！ 🎉 Special chars: @#$%^&*()',
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test('should validate multiline messages', () => {
      const validMessage = {
        message: `Line 1: Updated function signature
Line 2: Added error handling
Line 3: Fixed indentation`,
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test('should fail when message field is missing', () => {
      const invalidMessage = {};

      const result = LlmEditorAssistantMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['message']);
      }
    });

    test('should fail when message is not a string', () => {
      const invalidMessage = {
        message: 123,
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
      }
    });

    test('should fail when message is null', () => {
      const invalidMessage = {
        message: null,
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
    });

    test('should allow extra unexpected fields (non-strict mode)', () => {
      const validMessage = {
        message: 'Valid message',
        extraField: 'unexpected',
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Valid message');
        // Extra fields are ignored in non-strict mode
        expect((result.data as any).extraField).toBeUndefined();
      }
    });
  });

  describe('LlmEditorAssistantDiffSchema', () => {
    test('should validate complete diff object with all fields', () => {
      const validDiff = {
        search: 'function oldName() {\n  return "old";\n}',
        replace: 'function newName() {\n  return "new";\n}',
        startLine: 5,
        endLine: 7,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.search).toBe(validDiff.search);
        expect(result.data.replace).toBe(validDiff.replace);
        expect(result.data.startLine).toBe(validDiff.startLine);
        expect(result.data.endLine).toBe(validDiff.endLine);
      }
    });

    test('should validate diff object without optional endLine', () => {
      const validDiff = {
        search: 'const value = 42;',
        replace: 'const value = 100;',
        startLine: 10,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endLine).toBeUndefined();
      }
    });

    test('should validate diff object with null endLine', () => {
      const validDiff = {
        search: 'console.log("test");',
        replace: 'console.log("updated");',
        startLine: 1,
        endLine: null,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endLine).toBeNull();
      }
    });

    test('should validate diff with whitespace and indentation in search/replace', () => {
      const validDiff = {
        search: '  if (condition) {\n    doSomething();\n  }',
        replace: '  if (newCondition) {\n    doSomethingElse();\n  }',
        startLine: 15,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
    });

    test('should validate diff with empty replace content', () => {
      const validDiff = {
        search: 'lineToDelete();',
        replace: '',
        startLine: 20,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
    });

    test('should validate diff with unicode and special characters', () => {
      const validDiff = {
        search: 'const message = "Hello";',
        replace: 'const message = "こんにちは 🌍";',
        startLine: 8,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
    });

    test('should fail when search field is missing', () => {
      const invalidDiff = {
        replace: 'new content',
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const searchError = result.error.issues.find((issue) =>
          issue.path.includes('search'),
        );
        expect(searchError).toBeDefined();
        expect(searchError?.code).toBe('invalid_type');
      }
    });

    test('should fail when replace field is missing', () => {
      const invalidDiff = {
        search: 'old content',
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const replaceError = result.error.issues.find((issue) =>
          issue.path.includes('replace'),
        );
        expect(replaceError).toBeDefined();
        expect(replaceError?.code).toBe('invalid_type');
      }
    });

    test('should fail when startLine field is missing', () => {
      const invalidDiff = {
        search: 'old content',
        replace: 'new content',
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const startLineError = result.error.issues.find((issue) =>
          issue.path.includes('startLine'),
        );
        expect(startLineError).toBeDefined();
        expect(startLineError?.code).toBe('invalid_type');
      }
    });

    test('should fail when search is empty string', () => {
      const invalidDiff = {
        search: '',
        replace: 'new content',
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const searchError = result.error.issues.find((issue) =>
          issue.path.includes('search'),
        );
        expect(searchError?.code).toBe('too_small');
      }
    });

    test('should fail when startLine is zero', () => {
      const invalidDiff = {
        search: 'content',
        replace: 'new content',
        startLine: 0,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const startLineError = result.error.issues.find((issue) =>
          issue.path.includes('startLine'),
        );
        expect(startLineError?.code).toBe('too_small');
      }
    });

    test('should fail when startLine is negative', () => {
      const invalidDiff = {
        search: 'content',
        replace: 'new content',
        startLine: -1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
    });

    test('should fail when startLine is not an integer', () => {
      const invalidDiff = {
        search: 'content',
        replace: 'new content',
        startLine: 1.5,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const startLineError = result.error.issues.find((issue) =>
          issue.path.includes('startLine'),
        );
        expect(startLineError?.code).toBe('invalid_type');
      }
    });

    test('should fail when endLine is zero', () => {
      const invalidDiff = {
        search: 'content',
        replace: 'new content',
        startLine: 1,
        endLine: 0,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const endLineError = result.error.issues.find((issue) =>
          issue.path.includes('endLine'),
        );
        expect(endLineError?.code).toBe('too_small');
      }
    });

    test('should fail when endLine is negative', () => {
      const invalidDiff = {
        search: 'content',
        replace: 'new content',
        startLine: 1,
        endLine: -1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
    });

    test('should fail when endLine is not an integer', () => {
      const invalidDiff = {
        search: 'content',
        replace: 'new content',
        startLine: 1,
        endLine: 2.7,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
    });

    test('should fail with non-string search content', () => {
      const invalidDiff = {
        search: 123,
        replace: 'new content',
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const searchError = result.error.issues.find((issue) =>
          issue.path.includes('search'),
        );
        expect(searchError?.code).toBe('invalid_type');
      }
    });

    test('should fail with non-string replace content', () => {
      const invalidDiff = {
        search: 'old content',
        replace: { content: 'new' },
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(invalidDiff);
      expect(result.success).toBe(false);
      if (!result.success) {
        const replaceError = result.error.issues.find((issue) =>
          issue.path.includes('replace'),
        );
        expect(replaceError?.code).toBe('invalid_type');
      }
    });

    test('should allow extra unexpected fields (non-strict mode)', () => {
      const validDiff = {
        search: 'content',
        replace: 'new content',
        startLine: 1,
        unexpectedField: 'value',
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(validDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.search).toBe('content');
        expect(result.data.replace).toBe('new content');
        expect(result.data.startLine).toBe(1);
        // Extra fields are ignored in non-strict mode
      }
    });
  });

  describe('Type inference', () => {
    test('LlmEditorAssistantMessage type should match schema', () => {
      const message: LlmEditorAssistantMessage = {
        message: 'Test message',
      };

      const result = LlmEditorAssistantMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    test('LlmEditorAssistantDiff type should match schema', () => {
      const diff: LlmEditorAssistantDiff = {
        search: 'old code',
        replace: 'new code',
        startLine: 1,
        endLine: 2,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(diff);
      expect(result.success).toBe(true);
    });

    test('LlmEditorAssistantDiff type should work without optional fields', () => {
      const diff: LlmEditorAssistantDiff = {
        search: 'old code',
        replace: 'new code',
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(diff);
      expect(result.success).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    test('should validate typical code replacement scenario', () => {
      const realWorldDiff = {
        search:
          'function getUserData(id) {\n  return users.find(u => u.id === id);\n}',
        // eslint-disable-next-line max-len, no-template-curly-in-string
        replace:
          'async function getUserData(id) {\n  const user = await userService.findById(id);\n  if (!user) {\n    throw new Error(`User not found: \\${id}`);\n  }\n  return user;\n}',
        startLine: 15,
        endLine: 17,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(realWorldDiff);
      expect(result.success).toBe(true);
    });

    test('should validate import statement replacement', () => {
      const importDiff = {
        search: "import { Component } from 'react';",
        replace: "import React, { Component } from 'react';",
        startLine: 1,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(importDiff);
      expect(result.success).toBe(true);
    });

    test('should validate comment addition', () => {
      const commentDiff = {
        search: 'const result = processData(input);',
        replace:
          '// Process the input data and return the result\nconst result = processData(input);',
        startLine: 42,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(commentDiff);
      expect(result.success).toBe(true);
    });

    test('should validate line deletion scenario', () => {
      const deletionDiff = {
        search: 'console.log("Debug message");',
        replace: '',
        startLine: 100,
      };

      const result = LlmEditorAssistantDiffSchema.safeParse(deletionDiff);
      expect(result.success).toBe(true);
    });
  });
});
