// `connection` is a getter on the mongoose instance, not a static export, so
// cjs-module-lexer cannot expose it as a named ESM export. Import the default
// (the mongoose instance) and read `.connection` off it instead.
import mongoose from 'mongoose';
import {
  type IRateLimiterMongoOptions,
  RateLimiterMongo,
} from 'rate-limiter-flexible';

import { DEFAULT_DURATION_SEC } from '~/features/rate-limiter/config';

class RateLimiterFactory {
  private rateLimiters: Map<string, RateLimiterMongo> = new Map();

  getOrCreateRateLimiter(key: string, maxRequests: number): RateLimiterMongo {
    const cachedRateLimiter = this.rateLimiters.get(key);
    if (cachedRateLimiter != null) {
      return cachedRateLimiter;
    }

    const opts: IRateLimiterMongoOptions = {
      storeClient: mongoose.connection,
      duration: DEFAULT_DURATION_SEC,
      points: maxRequests,
    };

    const rateLimiter = new RateLimiterMongo(opts);
    this.rateLimiters.set(key, rateLimiter);

    return rateLimiter;
  }
}

export const rateLimiterFactory = new RateLimiterFactory();
