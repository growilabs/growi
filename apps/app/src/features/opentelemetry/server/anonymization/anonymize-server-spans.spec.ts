import type { IncomingMessage } from 'node:http';
import { SpanKind } from '@opentelemetry/api';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { mock } from 'vitest-mock-extended';

import { httpInstrumentationConfig } from './anonymize-http-requests';
import { serverSpanAnonymizer } from './anonymize-server-spans';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [serverSpanAnonymizer, new SimpleSpanProcessor(exporter)],
});

type SpanOptions = {
  scope?: string;
  kind?: SpanKind;
};

const recordTarget = (
  target: string,
  { scope = 'next.js', kind = SpanKind.SERVER }: SpanOptions = {},
): unknown => {
  provider
    .getTracer(scope)
    .startSpan('GET', { kind, attributes: { 'http.target': target } })
    .end();
  const spans = exporter.getFinishedSpans();
  exporter.reset();
  expect(spans).toHaveLength(1);
  return spans[0].attributes['http.target'];
};

const hookTarget = (url: string): unknown =>
  httpInstrumentationConfig.startIncomingSpanHook?.(
    mock<IncomingMessage>({ url, headers: { host: 'wiki.example.com' } }),
  )['http.target'];

describe('serverSpanAnonymizer', () => {
  afterAll(async () => {
    await provider.shutdown();
  });

  it.each`
    description                   | url
    ${'page path'}                | ${'/secret/page'}
    ${'non-ASCII page path'}      | ${'/secret/%E6%97%A5%E6%9C%AC%E8%AA%9E'}
    ${'next data URL'}            | ${'/_next/data/BUILD/ja_JP/secret/page.json?path=%2Fsecret%2Fpage'}
    ${'sensitive query on a URL'} | ${'/_search?q=secret'}
  `(
    'should record the $description of a Next.js server span as the HTTP span does',
    ({ url }) => {
      const target = recordTarget(url);

      expect(target).not.toMatch(/secret/);
      expect(target).toBe(hookTarget(url));
    },
  );

  it('should keep a URL without user data unchanged', () => {
    expect(recordTarget('/_next/static/chunks/main.js')).toBe(
      '/_next/static/chunks/main.js',
    );
  });

  it('should not anonymize again a target the HTTP instrumentation hook already anonymized', () => {
    const anonymized = hookTarget('/secret/page');

    expect(
      recordTarget(String(anonymized), {
        scope: new HttpInstrumentation({ enabled: false }).instrumentationName,
      }),
    ).toBe(anonymized);
  });

  it('should leave a non-server span unchanged', () => {
    expect(recordTarget('/secret/page', { kind: SpanKind.INTERNAL })).toBe(
      '/secret/page',
    );
  });
});
