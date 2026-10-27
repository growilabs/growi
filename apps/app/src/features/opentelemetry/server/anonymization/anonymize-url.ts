import { AllLang } from '@growi/core';
import { diag } from '@opentelemetry/api';

import type {
  AnonymizationRules,
  PathAction,
  PathRule,
  RequestPath,
} from './rules/types';
import { anonymizeSearchParams } from './utils/anonymize-query-params';
import { decodePathname, hashPagePath } from './utils/hash-page-path';
import { redactPathParams } from './utils/path-pattern';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:anonymize-url',
});

const ANONYMIZATION_FAILED = '/[ANONYMIZATION_FAILED]';

const NEXT_DATA_PREFIX = '/_next/data/';
const NEXT_DATA_SUFFIX = '.json';
const LOCALES: ReadonlySet<string> = new Set(AllLang);

const toRequestPath = (raw: string): RequestPath => ({
  raw,
  decoded: decodePathname(raw),
});

/** @returns The anonymized path, or null when the hashed value equals the input */
const hashChanged = (decoded: string): string | null => {
  const hashed = hashPagePath(decoded);
  return hashed === decoded ? null : hashed;
};

/**
 * Re-apply the path rules to the page path inside `/_next/data/<buildId>/[<locale>/]<path>.json`.
 * The inner path is cut from the undecoded outer path (see design.md next-data rule).
 */
const unwrapNextData = (
  raw: string,
  pathRules: readonly PathRule[],
): string | null => {
  if (!raw.startsWith(NEXT_DATA_PREFIX) || !raw.endsWith(NEXT_DATA_SUFFIX)) {
    return null;
  }
  const body = raw.slice(
    NEXT_DATA_PREFIX.length,
    raw.length - NEXT_DATA_SUFFIX.length,
  );
  const buildIdEnd = body.indexOf('/');
  if (buildIdEnd <= 0) {
    return null;
  }

  let outer = `${NEXT_DATA_PREFIX}${body.slice(0, buildIdEnd)}`;
  let inner = body.slice(buildIdEnd);

  const localeEnd = inner.indexOf('/', 1);
  const firstSegment =
    localeEnd === -1 ? inner.slice(1) : inner.slice(1, localeEnd);
  if (LOCALES.has(firstSegment)) {
    outer = `${outer}/${firstSegment}`;
    inner = localeEnd === -1 ? '' : inner.slice(localeEnd);
  }

  // The top page carries no page path
  if (inner === '' || inner === '/') {
    return null;
  }

  const anonymizedInner = anonymizePath(toRequestPath(inner), pathRules, false);
  return anonymizedInner == null
    ? null
    : `${outer}${anonymizedInner}${NEXT_DATA_SUFFIX}`;
};

const applyAction = (
  action: PathAction,
  path: RequestPath,
  pathRules: readonly PathRule[],
  allowUnwrap: boolean,
): string | null => {
  switch (action.kind) {
    case 'keep':
      return null;
    case 'unwrap-next-data':
      // One level only (see design.md System Flows)
      return allowUnwrap ? unwrapNextData(path.raw, pathRules) : null;
    case 'redact-pattern-params': {
      for (const { pattern, params } of action.patterns) {
        const redacted = redactPathParams(pattern, path.raw, params);
        if (redacted !== path.raw) {
          return redacted;
        }
      }
      return null;
    }
    case 'hash-page-path':
      return hashChanged(path.decoded);
    case 'hash-page-path-with-suffix': {
      if (!path.decoded.endsWith(action.suffix)) {
        return null;
      }
      const hashed = hashChanged(
        path.decoded.slice(0, path.decoded.length - action.suffix.length),
      );
      return hashed == null ? null : `${hashed}${action.suffix}`;
    }
    case 'hash-page-path-under-prefix': {
      if (!path.decoded.startsWith(`${action.prefix}/`)) {
        return null;
      }
      const hashed = hashChanged(path.decoded.slice(action.prefix.length));
      return hashed == null ? null : `${action.prefix}${hashed}`;
    }
  }
};

/** @returns The anonymized path, or null when the path is left as-is */
const anonymizePath = (
  path: RequestPath,
  pathRules: readonly PathRule[],
  allowUnwrap: boolean,
): string | null => {
  const rule = pathRules.find((r) => r.matches(path));
  return rule == null
    ? null
    : applyAction(rule.action, path, pathRules, allowUnwrap);
};

/**
 * Anonymize a request URL (path + optional query) according to `rules`.
 * The path and the query are anonymized independently, so neither result
 * can undo the other.
 * @returns The anonymized `http.target`, or null when nothing changed
 */
export const anonymizeUrl = (
  url: string,
  rules: AnonymizationRules,
): string | null => {
  try {
    const queryStart = url.indexOf('?');
    const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
    const search = queryStart === -1 ? null : url.slice(queryStart + 1);

    const anonymizedPath = anonymizePath(
      toRequestPath(rawPath),
      rules.pathRules,
      true,
    );
    const anonymizedSearch =
      search == null
        ? null
        : anonymizeSearchParams(search, rules.sensitiveQueryParams);

    const searchChanged = search != null && anonymizedSearch !== search;
    if (anonymizedPath == null && !searchChanged) {
      return null;
    }

    const query = anonymizedSearch == null ? '' : `?${anonymizedSearch}`;
    return `${anonymizedPath ?? rawPath}${query}`;
  } catch (error) {
    // The URL is not logged because it may carry the very data being anonymized
    logger.warn(`Failed to anonymize the request URL: ${error}`);
    return ANONYMIZATION_FAILED;
  }
};
