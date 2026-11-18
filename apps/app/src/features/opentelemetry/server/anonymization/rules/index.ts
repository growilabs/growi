import { PATH_RULES } from './path-rules';
import { SENSITIVE_QUERY_PARAMS } from './sensitive-query-params';
import type { AnonymizationRules } from './types';

export const ANONYMIZATION_RULES: AnonymizationRules = {
  pathRules: PATH_RULES,
  sensitiveQueryParams: SENSITIVE_QUERY_PARAMS,
};
