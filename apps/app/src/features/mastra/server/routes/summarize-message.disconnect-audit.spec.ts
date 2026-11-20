import request from 'supertest';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';

import {
  buildStreamResult,
  FINAL_TEXT,
  flushHandler,
  openSummaryRequest,
  ownerOnlyPage,
  parseSse,
  type StreamOptions,
  shortPage,
  textOf,
  useSummarizeRoute,
  viewer,
} from './test-utils/summarize-message-harness';
import { mocks } from './test-utils/summarize-message-mocks';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('POST /summary — disconnects and the audit log', () => {
  const route = useSummarizeRoute();

  describe('audit log', () => {
    it('emits PAGE_AI_SUMMARIZE once for the summarized page when the stream completes normally', async () => {
      await request(route.app)
        .post('/summary')
        .send({ pageId: shortPage._id.toString() })
        .expect(200);

      expect(mocks.emitActivity).toHaveBeenCalledTimes(1);
      expect(mocks.emitActivity).toHaveBeenCalledWith('update', 'activity-id', {
        action: SupportedAction.ACTION_PAGE_AI_SUMMARIZE,
        targetModel: SupportedTargetModel.MODEL_PAGE,
        target: expect.objectContaining({ _id: shortPage._id }),
        contributor: viewer,
      });
    });

    it('still streams the summary when activity tracking failed to begin', async () => {
      mocks.activityBegun = false;

      const response = await request(route.app)
        .post('/summary')
        .send({ pageId: shortPage._id.toString() })
        .expect(200);

      expect(textOf(parseSse(response.text))).toBe(FINAL_TEXT);
      expect(mocks.emitActivity).not.toHaveBeenCalled();
    });

    it('does not emit when generation fails before the stream starts', async () => {
      mocks.stream.mockRejectedValueOnce(new Error('boom'));

      await request(route.app)
        .post('/summary')
        .send({ pageId: shortPage._id.toString() })
        .expect(500);

      expect(mocks.emitActivity).not.toHaveBeenCalled();
    });

    it('does not emit when the viewer cannot see the page', async () => {
      await request(route.app)
        .post('/summary')
        .send({ pageId: ownerOnlyPage._id.toString() })
        .expect(404);

      expect(mocks.emitActivity).not.toHaveBeenCalled();
    });

    it('passes addActivity before rejecting an invalid body, so the failed attempt is audited', async () => {
      await request(route.app).post('/summary').send({}).expect(400);

      expect(mocks.addActivity).toHaveBeenCalledTimes(1);
    });
  });

  describe('client disconnect', () => {
    it('aborts the agent run and neither counts nor emits the late-finishing summary', async () => {
      const drained = deferred();
      mocks.stream.mockImplementationOnce(
        (_prompt: unknown, { abortSignal }: StreamOptions) => {
          const uiStream = new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'start' });
              // The agent still completes normally after the abort; the route
              // must not treat that completion as a delivered summary.
              abortSignal.addEventListener('abort', () => {
                controller.enqueue({ type: 'text-start', id: 'text-1' });
                controller.enqueue({
                  type: 'text-delta',
                  id: 'text-1',
                  delta: FINAL_TEXT,
                });
                controller.enqueue({ type: 'text-end', id: 'text-1' });
                controller.enqueue({ type: 'finish' });
                controller.close();
                drained.resolve();
              });
            },
          });
          return Promise.resolve({
            ...buildStreamResult([], 'stop'),
            uiStream,
          });
        },
      );

      const server = route.app.listen(0);
      try {
        const clientRequest = openSummaryRequest(server);
        await new Promise<void>((resolve) => {
          clientRequest.on('response', (response) => {
            response.once('data', () => {
              clientRequest.destroy();
              resolve();
            });
          });
        });

        await drained.promise;
        await new Promise(setImmediate);
      } finally {
        server.close();
      }

      expect(mocks.incrementCount).not.toHaveBeenCalled();
      expect(mocks.emitActivity).not.toHaveBeenCalled();
      expect(mocks.recordFailsafeAttempt).not.toHaveBeenCalled();
    });

    it('treats a disconnect while the agent is starting as a disconnect, not an error', async () => {
      const reachedStream = deferred();
      const rejected = deferred();
      mocks.stream.mockImplementationOnce(
        (_prompt: unknown, { abortSignal }: StreamOptions) =>
          new Promise((_resolve, reject) => {
            abortSignal.addEventListener('abort', () => {
              reject(new Error('aborted'));
              rejected.resolve();
            });
            reachedStream.resolve();
          }),
      );

      const server = route.app.listen(0);
      try {
        const clientRequest = openSummaryRequest(server);
        await reachedStream.promise;
        clientRequest.destroy();
        await rejected.promise;
        await flushHandler();
      } finally {
        server.close();
      }

      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('does not start the agent when the client left during the page lookup', async () => {
      const reachedLookup = deferred();
      const responseClosed = deferred();
      mocks.responseClosed.mockImplementationOnce(() =>
        responseClosed.resolve(),
      );
      mocks.pageLookup.mockImplementationOnce(async () => {
        reachedLookup.resolve();
        await responseClosed.promise;
      });

      const server = route.app.listen(0);
      try {
        const clientRequest = openSummaryRequest(server);
        await reachedLookup.promise;
        clientRequest.destroy();
        await responseClosed.promise;
        await flushHandler();
      } finally {
        server.close();
      }

      expect(mocks.stream).not.toHaveBeenCalled();
      expect(mocks.incrementCount).not.toHaveBeenCalled();
      expect(mocks.emitActivity).not.toHaveBeenCalled();
    });

    it('neither counts nor emits when the client leaves while the stream result settles', async () => {
      const responseClosed = deferred();
      mocks.responseClosed.mockImplementationOnce(() =>
        responseClosed.resolve(),
      );
      const settled = deferred();
      mocks.stream.mockResolvedValueOnce({
        ...buildStreamResult(
          [
            { type: 'start' },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: FINAL_TEXT },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish' },
          ],
          'stop',
        ),
        // Resolves only after the client has gone.
        finishReason: responseClosed.promise.then(() => {
          settled.resolve();
          return 'stop';
        }),
      });

      const server = route.app.listen(0);
      try {
        const clientRequest = openSummaryRequest(server);
        await new Promise<void>((resolve) => {
          clientRequest.on('response', (response) => {
            response.once('data', () => {
              clientRequest.destroy();
              resolve();
            });
          });
        });
        await settled.promise;
        await flushHandler();
      } finally {
        server.close();
      }

      expect(mocks.incrementCount).not.toHaveBeenCalled();
      expect(mocks.emitActivity).not.toHaveBeenCalled();
    });
  });
});
