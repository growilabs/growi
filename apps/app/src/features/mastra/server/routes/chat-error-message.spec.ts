import { APICallError, NoSuchModelError } from 'ai';

import { resolveChatErrorMessage } from './chat-error-message';

describe('resolveChatErrorMessage', () => {
  it('forwards the provider message of an APICallError', () => {
    const error = new APICallError({
      message: 'model: claude-x_ was not found. Did you mean claude-x?',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 404,
    });

    expect(resolveChatErrorMessage(error)).toBe(
      'model: claude-x_ was not found. Did you mean claude-x?',
    );
  });

  it('forwards other AISDKError messages too', () => {
    expect(
      resolveChatErrorMessage(
        new NoSuchModelError({
          modelId: 'gpt-foo',
          modelType: 'languageModel',
        }),
      ),
    ).toContain('gpt-foo');
  });

  it('collapses newlines/whitespace so no pseudo-stack survives', () => {
    const error = new APICallError({
      message: 'boom\n    at file.js:1:1\n    at other.js:2:2',
      url: 'https://api.example.com',
      requestBodyValues: {},
    });

    const resolved = resolveChatErrorMessage(error);
    expect(resolved).not.toContain('\n');
    expect(resolved).toBe('boom at file.js:1:1 at other.js:2:2');
  });

  it('returns "unknown" for an AISDKError whose message is blank (nothing useful to show)', () => {
    const error = new APICallError({
      message: '   \n  ',
      url: 'https://api.example.com',
      requestBodyValues: {},
    });

    expect(resolveChatErrorMessage(error)).toBe('unknown');
  });

  it('returns "unknown" for a non-AISDK error or non-error value (never leaks a GROWI-internal message)', () => {
    expect(
      resolveChatErrorMessage(new Error('Mongo connect mongodb://secret@host')),
    ).toBe('unknown');
    expect(resolveChatErrorMessage('nope')).toBe('unknown');
    expect(resolveChatErrorMessage(undefined)).toBe('unknown');
  });
});
