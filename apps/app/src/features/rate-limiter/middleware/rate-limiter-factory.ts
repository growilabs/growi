import { connection } from 'mongoose';
import {
  type IRateLimiterMongoOptions,
  RateLimiterMongo,
} from 'rate-limiter-flexible';

import { DEFAULT_DURATION_SEC } from '../config';

class RateLimiterFactory {
  private rateLimiters: Map<string, RateLimiterMongo> = new Map();

  getOrCreateRateLimiter(key: string, maxRequests: number): RateLimiterMongo {
    const cachedRateLimiter = this.rateLimiters.get(key);
    if (cachedRateLimiter != null) {
      return cachedRateLimiter;
    }

    const opts: IRateLimiterMongoOptions = {
      storeClient: connection,
      duration: DEFAULT_DURATION_SEC,
      points: maxRequests,
    };

    const rateLimiter = new RateLimiterMongo(opts);
    this.rateLimiters.set(key, rateLimiter);

    return rateLimiter;
  }
}

export const rateLimiterFactory = new RateLimiterFactory();
