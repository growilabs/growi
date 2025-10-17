import type { NextFunction, Request, Response } from 'express';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { OpenaiServiceTypes } from '../../../interfaces/ai';

const logger = loggerFactory('growi:middlewares:certify-ai-service');

export const certifyAiService = (
  req: Request,
  res: Response & { apiv3Err },
  next: NextFunction,
): void => {
  const aiEnabled = configManager.getConfig('app:aiEnabled');

  if (!aiEnabled) {
    const message = 'AI_ENABLED is not true';
    logger.error(message);
    res.apiv3Err(message, 403);
    return;
  }

  const openaiServiceType = configManager.getConfig('openai:serviceType');
  if (
    openaiServiceType == null ||
    !OpenaiServiceTypes.includes(openaiServiceType)
  ) {
    const message = 'AI_SERVICE_TYPE is missing or contains an invalid value';
    logger.error(message);
    res.apiv3Err(message, 403);
    return;
  }

  next();
};
