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
  '/login': {
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
  // Username suggestions, called on every keystroke burst in the search page's
  // author/editor fields. Each request walks index entries proportional to the
  // number of non-matching usernames it passes, so the global default of 500/min
  // is far more headroom than a typeahead needs: the input debounces for 400ms
  // and each keyword is fetched once and cached client-side, which puts real
  // sustained typing well inside this tier.
  // Unlike most entries here, every logged-in user hits this one, so the per-IP
  // allowance (maxRequests x usersPerIpProspection) has to assume a shared egress
  // IP: at the default of 5 a corporate NAT would share 500/min across everyone
  // behind it and start returning 429s to legitimate typing. Raised so the
  // per-user limit above stays the one that does the work.
  '/_api/v3/users/usernames': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
    usersPerIpProspection: 20,
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
