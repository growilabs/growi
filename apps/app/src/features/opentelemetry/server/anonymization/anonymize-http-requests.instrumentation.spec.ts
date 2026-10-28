import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { diag } from '@opentelemetry/api';
import { getIncomingRequestAttributes } from '@opentelemetry/instrumentation-http/build/src/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpInstrumentationConfig } from './anonymize-http-requests';

type SemconvStability = Parameters<
  typeof getIncomingRequestAttributes
>[1]['semconvStability'];

const SEMCONV_DUPLICATE: SemconvStability = 3; // old and stable attributes
const HOST = 'wiki.example.com';
const URL_ATTRIBUTES = ['http.target', 'http.url', 'url.path', 'url.query'];

const createRequest = (url: string): IncomingMessage => {
  const request = new IncomingMessage(new Socket());
  request.url = url;
  request.method = 'GET';
  request.headers = { host: HOST };
  return request;
};

/** The span attributes the HTTP instrumentation records with the hook applied */
const recordAttributes = (url: string) => {
  const hook = httpInstrumentationConfig.startIncomingSpanHook;
  if (hook == null) {
    throw new Error('startIncomingSpanHook is not configured');
  }
  const hookAttributes = hook(createRequest(url));
  const recorded = getIncomingRequestAttributes(
    createRequest(url),
    {
      component: 'http',
      hookAttributes,
      semconvStability: SEMCONV_DUPLICATE,
      enableSyntheticSourceDetection: false,
    },
    diag,
  );
  return { hookAttributes, recorded };
};

const NORMALIZED_BY_THE_URL_PARSER = [
  '/a/../secret',
  '/a/%2e%2e/secret',
  '/a/./secret',
  '/a/%2E/secret',
  '/a\\secret',
  '//secret-host/secret',
  '//secret-host',
  'http://evil-host.example/secret/page',
  'HTTP://evil-host.example/secret/page',
  'http://evil-host.example/secret/page?q=secret',
  '/_api/v3/../../secret/page',
  '/Sandbox/secret 日本語',
  '/wiki/secret?',
  '?q=secret',
  'secret:443',
];

const ORDINARY = [
  '/',
  '/wiki/project/documentation',
  '/_api/v3/pages?limit=10',
  '/_api/v3/a%2Fb%20c',
  '/_api/v3/pages?tags[]=a&tags[]=b',
  '/_api/v3/pages?from=/.hidden',
  '/static/css/style.css',
  '/58a4569921a8424d00a1aa0e',
  '*',
];

describe('URL attributes recorded by the HTTP instrumentation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(
    [...NORMALIZED_BY_THE_URL_PARSER, ...ORDINARY].map((url) => [url]),
  )('records %s either as received or as the hook set it', (url) => {
    vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'http/dup');

    const { hookAttributes, recorded } = recordAttributes(url);

    expect(recorded['http.target']).toBe(hookAttributes['http.target'] ?? url);
    expect(recorded['http.url']).toBe(
      hookAttributes['http.url'] ?? `http://${HOST}${url}`,
    );
  });

  it.each(
    NORMALIZED_BY_THE_URL_PARSER.map((url) => [url]),
  )('records no part of the path, host or keyword of %s', (url) => {
    vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'http/dup');

    const { recorded } = recordAttributes(url);

    for (const name of URL_ATTRIBUTES) {
      expect(String(recorded[name] ?? '')).not.toMatch(
        /secret|evil|日本語|%E6%97%A5/i,
      );
    }
    expect(recorded['http.url']).toMatch(new RegExp(`^http://${HOST}/`));
  });
});
