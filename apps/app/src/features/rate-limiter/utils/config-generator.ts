import type { IApiRateLimitEndpointMap } from '../config';
import { defaultConfig, defaultConfigWithRegExp } from '../config';

const envVar = process.env;

// https://regex101.com/r/aNDjmI/1
const regExp = /^API_RATE_LIMIT_(\w+)_ENDPOINT(_WITH_REGEXP)?$/;

const generateApiRateLimitConfigFromEndpoint = (
  envVar: NodeJS.ProcessEnv,
  targets: string[],
  withRegExp: boolean,
): IApiRateLimitEndpointMap => {
  const apiRateLimitConfig: IApiRateLimitEndpointMap = {};
  targets.forEach((target) => {
    const endpointKey = withRegExp
      ? `API_RATE_LIMIT_${target}_ENDPOINT_WITH_REGEXP`
      : `API_RATE_LIMIT_${target}_ENDPOINT`;

    const endpoint = envVar[endpointKey];

    if (endpoint == null) {
      return;
    }
    const methodKey = `API_RATE_LIMIT_${target}_METHODS`;
    const maxRequestsKey = `API_RATE_LIMIT_${target}_MAX_REQUESTS`;
    const usersPerIpProspectionKey = `API_RATE_LIMIT_${target}_USERS_PER_IP`;
    const method = envVar[methodKey] ?? 'ALL';
    const maxRequests = Number(envVar[maxRequestsKey]);
    const usersPerIpProspection = Number(envVar[usersPerIpProspectionKey]);

    if (endpoint == null || maxRequests == null) {
      return;
    }

    const config = {
      method,
      maxRequests,
      usersPerIpProspection,
    };

    apiRateLimitConfig[endpoint] = config;
  });

  return apiRateLimitConfig;
};

type ApiRateLimitConfigResult = {
  withoutRegExp: IApiRateLimitEndpointMap;
  withRegExp: IApiRateLimitEndpointMap;
};

export const generateApiRateLimitConfig = (): ApiRateLimitConfigResult => {
  const apiRateConfigTargets: string[] = [];
  const apiRateConfigTargetsWithRegExp: string[] = [];
  Object.keys(envVar).forEach((key) => {
    const result = key.match(regExp);

    if (result == null) {
      return null;
    }

    const target = result[1];
    const isWithRegExp = result[2] != null;

    if (isWithRegExp) {
      apiRateConfigTargetsWithRegExp.push(target);
    } else {
      apiRateConfigTargets.push(target);
    }
  });

  // sort priority
  apiRateConfigTargets.sort();
  apiRateConfigTargetsWithRegExp.sort();

  // get config
  const apiRateLimitConfig = generateApiRateLimitConfigFromEndpoint(
    envVar,
    apiRateConfigTargets,
    false,
  );
  const apiRateLimitConfigWithRegExp = generateApiRateLimitConfigFromEndpoint(
    envVar,
    apiRateConfigTargetsWithRegExp,
    true,
  );

  const config = { ...defaultConfig, ...apiRateLimitConfig };
  const configWithRegExp = {
    ...defaultConfigWithRegExp,
    ...apiRateLimitConfigWithRegExp,
  };

  const result: ApiRateLimitConfigResult = {
    withoutRegExp: config,
    withRegExp: configWithRegExp,
  };

  return result;
};
