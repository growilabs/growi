export type IApiRateLimitConfig = {
  method: string;
  maxRequests: number;
  usersPerIpProspection?: number;
};
export type IApiRateLimitEndpointMap = {
  [endpoint: string]: IApiRateLimitConfig;
};

export const DEFAULT_MAX_REQUESTS = 500;
export const DEFAULT_DURATION_SEC = 60;
export const DEFAULT_USERS_PER_IP_PROSPECTION = 5;

const MAX_REQUESTS_TIER_1 = 5;
const MAX_REQUESTS_TIER_2 = 20;
const MAX_REQUESTS_TIER_3 = 50;
const MAX_REQUESTS_TIER_4 = 100;

// default config without reg exp
export const defaultConfig: IApiRateLimitEndpointMap = {
  '/_api/v3/healthcheck': {
    method: 'GET',
    maxRequests: 60,
    usersPerIpProspection: 1,
  },
  '/installer': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 1,
  },
  // Keys are matched as an exact `configWithoutRegExp[req.path]` lookup
  // (middleware/factory.ts), so they must be the FULLY-MOUNTED path. The legacy
  // `POST /login` route is gone and the live one is on apiV3AuthRouter, mounted at
  // '/_api/v3' (server/routes/index.js) — so the bare '/login' key matched nothing
  // and login ran at the permissive default (500 x 5 = 2500 req/min/IP). That only
  // became load-bearing when verification became scrypt (~128MiB, ~100ms on a libuv
  // thread per attempt).
  '/_api/v3/login': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 100,
  },
  '/invited': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_2,
  },
  '/register': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 20,
  },
  '/user-activation/register': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 20,
  },
  '/_api/login/testLdap': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_2,
    usersPerIpProspection: 1,
  },
  '/_api/check_username': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_3,
  },
};

const isDev = process.env.NODE_ENV === 'development';
const defaultConfigWithRegExpForDev: IApiRateLimitEndpointMap = isDev
  ? {
      '/__nextjs_original-stack-frame': {
        method: 'GET',
        maxRequests: Infinity,
      },
    }
  : {};

// default config with reg exp
export const defaultConfigWithRegExp: IApiRateLimitEndpointMap = {
  ...defaultConfigWithRegExpForDev,

  '/forgot-password/.*': {
    method: 'ALL',
    maxRequests: MAX_REQUESTS_TIER_1,
  },
  '/user-activation/.*': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_1,
  },
  '/attachment/[0-9a-z]{24}': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
  },
  '/download/[0-9a-z]{24}': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
  },
  '/share/[0-9a-z]{24}': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
  },
};
