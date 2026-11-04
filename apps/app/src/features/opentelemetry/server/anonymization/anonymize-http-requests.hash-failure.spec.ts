import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { httpInstrumentationConfig } from './anonymize-http-requests';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    createHash: () => {
      throw new Error('hash unavailable');
    },
  };
});

describe('httpInstrumentationConfig.startIncomingSpanHook when anonymization fails', () => {
  it('records the fixed failure value in every URL attribute instead of the plaintext URL', () => {
    const hook = httpInstrumentationConfig.startIncomingSpanHook;
    if (hook == null) {
      throw new Error('startIncomingSpanHook is not configured');
    }

    const attributes = hook(
      mock<IncomingMessage>({
        url: '/wiki/secret-page',
        headers: { host: 'wiki.example.com' },
      }),
    );

    expect(attributes['http.target']).toBe('/[ANONYMIZATION_FAILED]');
    expect(attributes['http.url']).toBe(
      'http://wiki.example.com/[ANONYMIZATION_FAILED]',
    );
  });
});
