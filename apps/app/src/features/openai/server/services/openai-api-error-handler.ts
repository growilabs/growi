import OpenAI from 'openai';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:openai');

// Error Code Reference
// https://platform.openai.com/docs/guides/error-codes/api-errors

// Error Handling Reference
// https://github.com/openai/openai-node/tree/d08bf1a8fa779e6a9349d92ddf65530dd84e686d?tab=readme-ov-file#handling-errors

type ErrorHandler = {
  notFoundError?: () => Promise<void>;
};

export const openaiApiErrorHandler = async (
  error: unknown,
  handler: ErrorHandler,
): Promise<void> => {
  if (!(error instanceof OpenAI.APIError)) {
    return;
  }

  logger.error(error);

  if (error.status === 404 && handler.notFoundError != null) {
    await handler.notFoundError();
    return;
  }
};
