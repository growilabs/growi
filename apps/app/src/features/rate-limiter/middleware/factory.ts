import type { IUserHasId } from '@growi/core';
import type { Handler, Request } from 'express';
import md5 from 'md5';
import type { RateLimiterRes } from 'rate-limiter-flexible';

import loggerFactory from '~/utils/logger';

import {
  DEFAULT_USERS_PER_IP_PROSPECTION,
  type IApiRateLimitConfig,
} from '../config';
import { generateApiRateLimitConfig } from '../utils/config-generator';
import { consumePoints } from './consume-points';

const logger = loggerFactory('growi:middleware:api-rate-limit');

const normalizeEndpointPath = (path: string): string => {
  let decodedPath = path;
  try {
    decodedPath = decodeURI(path);
  } catch {
    // Keep malformed paths distinct; routing may reject them later.
  }

  const normalizedPath = decodedPath.toLowerCase().replace(/\/{2,}/g, '/');
  return normalizedPath.length > 1
    ? normalizedPath.replace(/\/+$/, '')
    : normalizedPath;
};

// config sample
// API_RATE_LIMIT_010_FOO_ENDPOINT=/_api/v3/foo
// API_RATE_LIMIT_010_FOO_METHODS=GET,POST
// API_RATE_LIMIT_010_FOO_MAX_REQUESTS=10

// generate ApiRateLimitConfig for api rate limiter
const apiRateLimitConfig = generateApiRateLimitConfig();
const configWithoutRegExp = Object.fromEntries(
  Object.entries(apiRateLimitConfig.withoutRegExp).map(([path, config]) => [
    normalizeEndpointPath(path),
    config,
  ]),
);
const configWithRegExp = apiRateLimitConfig.withRegExp;
const allRegExp = new RegExp(Object.keys(configWithRegExp).join('|'), 'i');
const keysWithRegExp = Object.keys(configWithRegExp).map(
  (key) => new RegExp(`^${key}`, 'i'),
);
const valuesWithRegExp = Object.values(configWithRegExp);

/**
 * consume per user per endpoint
 * @param method
 * @param key
 * @param customizedConfig
 * @returns
 */
const consumePointsByUser = async (
  method: string,
  key: string | null,
  customizedConfig?: IApiRateLimitConfig,
): Promise<RateLimiterRes | undefined> => {
  return consumePoints(method, key, customizedConfig);
};

/**
 * consume per ip per endpoint
 * @param method
 * @param key
 * @param customizedConfig
 * @returns
 */
const consumePointsByIp = async (
  method: string,
  key: string | null,
  customizedConfig?: IApiRateLimitConfig,
): Promise<RateLimiterRes | undefined> => {
  const maxRequestsMultiplier =
    customizedConfig?.usersPerIpProspection ?? DEFAULT_USERS_PER_IP_PROSPECTION;
  return consumePoints(method, key, customizedConfig, maxRequestsMultiplier);
};

export const middlewareFactory = (): Handler => {
  return async (req: Request & { user?: IUserHasId }, res, next) => {
    const endpoint = normalizeEndpointPath(req.path);

    // determine keys
    const keyForUser: string | null =
      req.user != null
        ? md5(`${req.user._id}_${endpoint}_${req.method}`)
        : null;
    const keyForIp: string = md5(`${req.ip}_${endpoint}_${req.method}`);

    // determine customized config
    let customizedConfig: IApiRateLimitConfig | undefined;
    const configForEndpoint = configWithoutRegExp[endpoint];
    if (configForEndpoint) {
      customizedConfig = configForEndpoint;
    } else if (allRegExp.test(endpoint)) {
      keysWithRegExp.forEach((key, index) => {
        if (key.test(endpoint)) {
          customizedConfig = valuesWithRegExp[index];
        }
      });
    }

    // check for the current user
    if (req.user != null) {
      try {
        await consumePointsByUser(req.method, keyForUser, customizedConfig);
      } catch {
        logger.error(`${req.user._id}: too many request at ${endpoint}`);
        return res.sendStatus(429);
      }
    }

    // check for ip
    try {
      await consumePointsByIp(req.method, keyForIp, customizedConfig);
    } catch {
      logger.error(`${req.ip}: too many request at ${endpoint}`);
      return res.sendStatus(429);
    }

    return next();
  };
};
