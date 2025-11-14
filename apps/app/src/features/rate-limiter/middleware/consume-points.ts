import type { RateLimiterRes } from 'rate-limiter-flexible';

import { DEFAULT_MAX_REQUESTS, type IApiRateLimitConfig } from '../config';
import { rateLimiterFactory } from './rate-limiter-factory';

export const consumePoints = async (
  method: string,
  key: string | null,
  customizedConfig?: IApiRateLimitConfig,
  maxRequestsMultiplier?: number,
): Promise<RateLimiterRes | undefined> => {
  if (key == null) {
    return;
  }

  let maxRequests = DEFAULT_MAX_REQUESTS;

  // use customizedConfig
  if (
    customizedConfig != null &&
    (customizedConfig.method.includes(method) ||
      customizedConfig.method === 'ALL')
  ) {
    maxRequests = customizedConfig.maxRequests;
  }

  // multiply
  if (maxRequestsMultiplier != null) {
    maxRequests *= maxRequestsMultiplier;
  }

  const rateLimiter = rateLimiterFactory.getOrCreateRateLimiter(
    key,
    maxRequests,
  );

  const pointsToConsume = 1;
  const rateLimiterRes = await rateLimiter.consume(key, pointsToConsume);
  return rateLimiterRes;
};
