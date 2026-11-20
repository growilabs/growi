import request from 'supertest';

import {
  activityContext,
  buildStreamResult,
  parseSse,
  shortPage,
  useSummarizeRoute,
} from './test-utils/summarize-message-harness';
import { mocks } from './test-utils/summarize-message-mocks';

const textChunks = (delta: string): unknown[] => [
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', delta },
  { type: 'text-end', id: 'text-1' },
];

const ERROR_CHUNKS = [
  { type: 'start' },
  { type: 'error', errorText: 'model test-model was not found.' },
];

describe('POST /summary — stream completion', () => {
  const route = useSummarizeRoute();

  const postSummary = () =>
    request(route.app)
      .post('/summary')
      .send({ pageId: shortPage._id.toString() })
      .expect(200);

  const expectFailedAttempt = (): void => {
    expect(mocks.incrementCount).not.toHaveBeenCalled();
    expect(mocks.emitActivity).not.toHaveBeenCalled();
    expect(mocks.recordFailsafeAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailsafeAttempt).toHaveBeenCalledWith(
      'activity-id',
      activityContext,
    );
  };

  it('counts a stop with summary text as a completed summary', async () => {
    await postSummary();

    expect(mocks.incrementCount).toHaveBeenCalledTimes(1);
    expect(mocks.emitActivity).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailsafeAttempt).not.toHaveBeenCalled();
  });

  it('reports the finish reason to the client', async () => {
    const response = await postSummary();

    const finishMetadata = parseSse(response.text).find(
      (chunk) =>
        chunk.type === 'message-metadata' &&
        (chunk.messageMetadata as { finishReason?: string }).finishReason !=
          null,
    );
    expect(finishMetadata?.messageMetadata).toEqual({ finishReason: 'stop' });
  });

  it.each([
    ['tool-calls', 'maxSteps ran out while still calling tools'],
    ['length', 'the output was truncated'],
  ])('treats finishReason %s (%s) as a failed attempt, not a summary', async (finishReason) => {
    mocks.stream.mockResolvedValueOnce(
      buildStreamResult(
        [{ type: 'start' }, ...textChunks('Partial sum'), { type: 'finish' }],
        finishReason,
      ),
    );

    await postSummary();

    expectFailedAttempt();
  });

  it('treats a stop with no summary text as a failed attempt', async () => {
    mocks.stream.mockResolvedValueOnce(
      buildStreamResult([{ type: 'start' }, { type: 'finish' }], 'stop'),
    );

    await postSummary();

    expectFailedAttempt();
  });

  it('treats a stop whose final step has no text as a failed attempt, even after earlier-step text', async () => {
    mocks.stream.mockResolvedValueOnce(
      buildStreamResult(
        [
          { type: 'start' },
          { type: 'start-step' },
          ...textChunks('Reading the page.'),
          {
            type: 'tool-input-available',
            toolCallId: 'call-0',
            toolName: 'getPageContentTool',
            input: {},
          },
          { type: 'finish-step' },
          { type: 'start-step' },
          { type: 'finish-step' },
          { type: 'finish' },
        ],
        'stop',
      ),
    );

    await postSummary();

    expectFailedAttempt();
  });

  it('treats a stream that ends with an error chunk as a failed attempt', async () => {
    mocks.stream.mockResolvedValueOnce(
      buildStreamResult(ERROR_CHUNKS, 'error'),
    );

    const response = await postSummary();

    expect(parseSse(response.text).map((chunk) => chunk.type)).toContain(
      'error',
    );
    expectFailedAttempt();
  });

  it('sends a single error chunk when the stream promises reject after an error chunk', async () => {
    const providerError = new Error('provider failed');
    mocks.stream.mockResolvedValueOnce({
      ...buildStreamResult(ERROR_CHUNKS, 'error'),
      get usage() {
        return Promise.reject(providerError);
      },
      get finishReason() {
        return Promise.reject(providerError);
      },
    });

    const response = await postSummary();

    const errorChunks = parseSse(response.text).filter(
      (chunk) => chunk.type === 'error',
    );
    expect(errorChunks).toHaveLength(1);
    expect(mocks.recordFailsafeAttempt).toHaveBeenCalledTimes(1);
  });

  it('records a failed attempt when the stream throws after it has started', async () => {
    mocks.stream.mockResolvedValueOnce({
      ...buildStreamResult([{ type: 'start' }], 'stop'),
      // Lazy, like Mastra's DelayedPromise, so the rejection is observed.
      get finishReason() {
        return Promise.reject(new Error('provider failed'));
      },
    });

    await postSummary();

    expectFailedAttempt();
  });
});
