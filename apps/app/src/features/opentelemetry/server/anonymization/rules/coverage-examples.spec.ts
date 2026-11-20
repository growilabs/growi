import { describe, expect, it } from 'vitest';

import { anonymizeUrl } from '../anonymize-url';
import { COVERAGE_EXAMPLES } from './coverage-examples';
import { ANONYMIZATION_RULES } from './index';

describe('COVERAGE_EXAMPLES', () => {
  it.each(
    COVERAGE_EXAMPLES.map((example) => [
      example.id,
      example.method ?? 'GET',
      example.url,
      example,
    ]),
  )('%s: %s %s', (_id, _method, url, example) => {
    expect(anonymizeUrl(url, ANONYMIZATION_RULES)).toBe(example.expectedTarget);
  });
});
