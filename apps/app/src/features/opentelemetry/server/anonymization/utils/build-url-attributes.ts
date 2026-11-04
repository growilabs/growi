import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import {
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
} from '@opentelemetry/semantic-conventions';

import { ATTR_HTTP_URL } from '../../semconv';

/**
 * Whether OTEL_SEMCONV_STABILITY_OPT_IN makes the HTTP instrumentation emit
 * the stable URL attributes (url.path / url.query)
 */
export const isStableHttpSemconvEnabled = (
  optIn: string | undefined,
): boolean => {
  return (optIn ?? '')
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === 'http' || value === 'http/dup');
};

/**
 * Build every URL-bearing span attribute the HTTP instrumentation sets from
 * the raw request URL, using the anonymized target instead, so that none of
 * them keeps the original URL
 */
export const buildUrlAttributes = (
  request: IncomingMessage,
  anonymizedTarget: string,
  emitStableAttributes: boolean,
): Record<string, string> => {
  const { host } = request.headers;
  const scheme = request.socket instanceof TLSSocket ? 'https' : 'http';
  const httpUrl = host
    ? `${scheme}://${host}${anonymizedTarget}`
    : anonymizedTarget;

  if (!emitStableAttributes) {
    return { [ATTR_HTTP_URL]: httpUrl };
  }

  const [path, query] = anonymizedTarget.split(/\?(.*)/s, 2);
  return {
    [ATTR_HTTP_URL]: httpUrl,
    [ATTR_URL_PATH]: path,
    ...(query ? { [ATTR_URL_QUERY]: query } : {}),
  };
};
