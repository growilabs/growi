import type { MastraModelConfig } from '@mastra/core/llm';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

import type { TokenUsage } from '~/features/ai-usage/server/services/token-usage';
import loggerFactory from '~/utils/logger';

import {
  fromLanguageModelUsage,
  type LanguageModelV3,
  type LanguageModelV3Usage,
} from './from-language-model-usage';

const logger = loggerFactory('growi:service:mastra:usage-metering');

type StreamPart =
  Awaited<
    ReturnType<LanguageModelV3['doStream']>
  >['stream'] extends ReadableStream<infer T>
    ? T
    : never;

export type OnCall = (usage: TokenUsage) => void | PromiseLike<void>;

const isLanguageModelV3 = (
  model: MastraModelConfig,
): model is LanguageModelV3 =>
  typeof model === 'object' &&
  'specificationVersion' in model &&
  model.specificationVersion === 'v3';

const describeModel = (model: MastraModelConfig): string => {
  if (typeof model === 'string') {
    return model;
  }
  if ('provider' in model) {
    return `${model.provider}/${model.modelId}`;
  }
  if ('providerId' in model) {
    return `${model.providerId}/${model.modelId}`;
  }
  return model.id;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value != null &&
  'then' in value &&
  typeof value.then === 'function';

const createReporter =
  (modelName: string, onCall: OnCall) =>
  (usage: LanguageModelV3Usage): void => {
    const logFailure = (err: unknown): void => {
      logger.error(
        { model: modelName, err },
        'Failed to hand over the LLM call usage',
      );
    };
    try {
      const result = onCall(fromLanguageModelUsage(usage));
      if (isPromiseLike(result)) {
        Promise.resolve(result).catch(logFailure);
      }
    } catch (err) {
      logFailure(err);
    }
  };

/**
 * Wrap a model so that `onCall` receives the usage of every model call
 * (one agent step = one call). A call that ends without a `finish` part
 * (stream error or abort) reports nothing; calls completed before it were
 * already reported.
 */
export const withUsageMetering = (
  model: MastraModelConfig,
  onCall: OnCall,
): MastraModelConfig => {
  if (!isLanguageModelV3(model)) {
    logger.warn(
      { model: describeModel(model) },
      'Usage is not metered for this model: it is not an AI SDK v3 language model',
    );
    return model;
  }

  const report = createReporter(describeModel(model), onCall);

  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      report(result.usage);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const meteredStream = stream.pipeThrough(
        new TransformStream<StreamPart, StreamPart>({
          transform(part, controller) {
            if (part.type === 'finish') {
              report(part.usage);
            }
            controller.enqueue(part);
          },
        }),
      );
      return { ...rest, stream: meteredStream };
    },
  };

  return wrapLanguageModel({ model, middleware });
};
