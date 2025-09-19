import type { NextFunction, Response } from 'express';
import createError from 'http-errors';

import type { RequestFromGrowi } from '../interfaces/request-between-growi-and-proxy';
import loggerFactory from '../utils/logger';

const logger = loggerFactory(
  '@growi/slack:middlewares:verify-growi-to-slack-request',
);

/**
 * Verify if the request came from slack
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export const verifyGrowiToSlackRequest = (
  req: RequestFromGrowi,
  _res: Response,
  next: NextFunction,
): void => {
  const str = req.headers['x-growi-gtop-tokens'];

  if (str == null) {
    const message =
      "The value of header 'x-growi-gtop-tokens' must not be empty.";
    logger.warn(message, { body: req.body });
    next(createError(400, message));
    return;
  }

  const tokens = str.split(',').map((value) => value.trim());
  if (tokens.length === 0) {
    const message =
      "The value of header 'x-growi-gtop-tokens' must include at least one or more tokens.";
    logger.warn(message, { body: req.body });
    next(createError(400, message));
    return;
  }

  req.tokenGtoPs = tokens;
  next();
};
