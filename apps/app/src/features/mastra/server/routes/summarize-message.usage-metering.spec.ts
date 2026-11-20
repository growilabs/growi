import request from 'supertest';

import {
  buildStreamResult,
  MODEL_CALL_USAGE,
  type StreamOptions,
  shortPage,
  useSummarizeRoute,
  viewer,
} from './test-utils/summarize-message-harness';
import { mocks } from './test-utils/summarize-message-mocks';

const EXPECTED_RECORD = {
  userId: viewer._id.toString(),
  feature: 'summarize',
  modelKey: 'openai/test-model',
  calls: [MODEL_CALL_USAGE],
};

// A model call that finished before the run went wrong.
const callModelThen =
  (next: () => unknown) =>
  (_prompt: unknown, options: StreamOptions): Promise<unknown> => {
    options.requestContext.get('usageMeter')?.add(MODEL_CALL_USAGE);
    return Promise.resolve().then(next);
  };

describe('POST /summary — usage metering', () => {
  const route = useSummarizeRoute();

  const postSummary = (expectedStatus: number) =>
    request(route.app)
      .post('/summary')
      .send({ pageId: shortPage._id.toString() })
      .expect(expectedStatus);

  it('records a completed summary as one record of the summarize feature', async () => {
    await postSummary(200);

    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(EXPECTED_RECORD);
  });

  it('records the calls made before the stream failed', async () => {
    mocks.stream.mockImplementationOnce(
      callModelThen(() =>
        buildStreamResult(
          [{ type: 'start' }, { type: 'error', errorText: 'provider failed' }],
          'error',
        ),
      ),
    );

    await postSummary(200);

    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(EXPECTED_RECORD);
  });

  it('records the calls made before the stream failed to start', async () => {
    mocks.stream.mockImplementationOnce(
      callModelThen(() => {
        throw new Error('provider failed');
      }),
    );

    await postSummary(500);

    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(EXPECTED_RECORD);
  });
});
