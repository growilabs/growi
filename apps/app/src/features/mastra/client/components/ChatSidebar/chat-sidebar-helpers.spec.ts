import type { StorageThreadType } from '@mastra/core/memory';
import { mock } from 'vitest-mock-extended';

import {
  buildMessageRequestBody,
  createMastraChatTransport,
  resolveChatErrorDetail,
  resolveChatHeaderLabel,
} from './chat-sidebar-helpers';

const FALLBACK = 'New Chat';

const makeThread = (id: string, title?: string): StorageThreadType =>
  mock<StorageThreadType>({
    id,
    title,
    resourceId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe('buildMessageRequestBody', () => {
  it('carries the threadId and the modelId', () => {
    const body = buildMessageRequestBody('thread-abc', 'gpt-4o');

    expect(body).toEqual({ threadId: 'thread-abc', modelId: 'gpt-4o' });
  });

  it('does not include aiAssistantId', () => {
    const body = buildMessageRequestBody('thread-abc', 'gpt-4o');

    expect(body).not.toHaveProperty('aiAssistantId');
  });

  it('omits modelId when no model is given (server rounds to default)', () => {
    const body = buildMessageRequestBody('thread-abc');

    expect(body).toEqual({ threadId: 'thread-abc' });
  });
});

describe('resolveChatHeaderLabel', () => {
  it('returns the matching thread title when available', () => {
    const threads = [
      makeThread('thread-1', 'First chat'),
      makeThread('thread-2', 'Second chat'),
    ];

    expect(resolveChatHeaderLabel('thread-2', threads, FALLBACK)).toBe(
      'Second chat',
    );
  });

  it('falls back to the given label when the thread is not found', () => {
    const threads = [makeThread('thread-1', 'First chat')];

    expect(resolveChatHeaderLabel('unknown', threads, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the given label when the thread has no title', () => {
    const threads = [makeThread('thread-1', undefined)];

    expect(resolveChatHeaderLabel('thread-1', threads, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it('falls back to the given label for an empty title', () => {
    const threads = [makeThread('thread-1', '')];

    expect(resolveChatHeaderLabel('thread-1', threads, FALLBACK)).toBe(
      FALLBACK,
    );
  });
});

describe('resolveChatErrorDetail', () => {
  it('returns a (server-sanitized) provider message for display', () => {
    expect(
      resolveChatErrorDetail(
        new Error('model: claude-x_ was not found. Did you mean claude-x?'),
      ),
    ).toBe('model: claude-x_ was not found. Did you mean claude-x?');
  });

  it('trims surrounding whitespace (server already collapsed the message)', () => {
    expect(resolveChatErrorDetail(new Error('  hi  '))).toBe('hi');
  });

  it.each([
    ['the unknown sentinel', 'unknown'],
    ['an empty message', ''],
    ['a structured JSON body', '{"errors":[{"message":"nope"}]}'],
    ['an HTML body', '<!DOCTYPE html><html>...'],
  ])('returns undefined for %s (heading only)', (_label, msg) => {
    expect(resolveChatErrorDetail(new Error(msg))).toBeUndefined();
  });

  it('returns undefined when there is no error', () => {
    expect(resolveChatErrorDetail(undefined)).toBeUndefined();
  });
});

describe('createMastraChatTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // sendMessages only requires response.ok + a non-null body stream; it does not
  // consume the stream, so an immediately-closed one is enough.
  const stubFetch = (): ReturnType<typeof vi.fn> => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const REGEN = {
    trigger: 'regenerate-message' as const,
    chatId: 'thread-xyz',
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
  };

  // Guards the thread-duplication regression (#185056) AND Critical Issue 1: the
  // threadId + modelId must ride on EVERY request, including regenerate() (the
  // retry on error), which sends no per-call body. We exercise the REAL transport
  // with the regenerate trigger and a mocked fetch (the request boundary).
  it('sends the threadId and the current modelId in the POST body for the regenerate trigger (no per-call body)', async () => {
    const fetchMock = stubFetch();

    await createMastraChatTransport('thread-xyz', () => 'gpt-4o').sendMessages(
      REGEN,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/_api/v3/mastra/message');
    expect(JSON.parse(init.body)).toMatchObject({
      threadId: 'thread-xyz',
      modelId: 'gpt-4o',
      trigger: 'regenerate-message',
    });
  });

  // The model is read LIVE from the getter on each request, NOT pinned at
  // transport-creation time. This is the contract that makes the feature work
  // under @ai-sdk/react's useChat: useChat captures the transport when it creates
  // its internal Chat and only re-creates that Chat on a chat-id change — it
  // ignores a re-created transport. So a model switch (or a late /mastra/models
  // load) must reach the server on the next send WITHOUT a new transport.
  it('reads the current model from the getter on each request, so a model change applies without a new transport', async () => {
    const fetchMock = stubFetch();
    let currentModel: string | undefined = 'gpt-4o';
    const transport = createMastraChatTransport(
      'thread-xyz',
      () => currentModel,
    );

    await transport.sendMessages(REGEN);
    currentModel = 'o3';
    await transport.sendMessages(REGEN);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).modelId).toBe('gpt-4o');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).modelId).toBe('o3');
  });

  it('omits modelId when the getter returns undefined (server rounds to default)', async () => {
    const fetchMock = stubFetch();

    await createMastraChatTransport('thread-xyz', () => undefined).sendMessages(
      REGEN,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ threadId: 'thread-xyz' });
    expect(body).not.toHaveProperty('modelId');
  });
});
