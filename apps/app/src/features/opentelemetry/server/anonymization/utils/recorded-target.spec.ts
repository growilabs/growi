import { describe, expect, it } from 'vitest';

import { toRecordedTarget } from './recorded-target';

const parse = (raw: string): string => {
  const { pathname, search } = new URL(raw, 'http://localhost');
  return `${pathname}${search}`;
};

const ASCII = Array.from({ length: 128 }, (_, code) =>
  String.fromCharCode(code),
);
const SAMPLES = [...ASCII, 'é', '　', '日', '\uD800', '%2e', '%2E', '..'];
const TEMPLATES: readonly ((c: string) => string)[] = [
  (c) => `/a${c}b`,
  (c) => `/a?x${c}y`,
  (c) => `/a/${c}`,
  (c) => `/a/${c}${c}/b`,
  (c) => `/a/${c}${c}`,
  (c) => `/a${c}`,
  (c) => `${c}`,
  (c) => `${c}/a`,
  (c) => `/${c}a`,
  (c) => `/a?${c}`,
];

describe('toRecordedTarget', () => {
  it('returns what the WHATWG URL parser records for every ASCII and sample character in any position', () => {
    const mismatches = SAMPLES.flatMap((c) =>
      TEMPLATES.map((template) => template(c)),
    ).filter((raw) => toRecordedTarget(raw) !== parse(raw));

    expect(mismatches).toEqual([]);
  });

  it.each`
    raw                                  | expected
    ${'/wiki/page'}                      | ${'/wiki/page'}
    ${'/_api/v3/pages?limit=10&q=a%20b'} | ${'/_api/v3/pages?limit=10&q=a%20b'}
    ${'/a/../b'}                         | ${'/b'}
    ${'//host/path'}                     | ${'/path'}
    ${'http://host/path?q=1'}            | ${'/path?q=1'}
    ${'/a?'}                             | ${'/a'}
    ${'/a#b'}                            | ${'/a'}
  `('records $raw as $expected', ({ raw, expected }) => {
    expect(toRecordedTarget(raw)).toBe(expected);
  });

  it('throws when the URL cannot be parsed', () => {
    expect(() => toRecordedTarget('http://[bad')).toThrow(TypeError);
  });

  it.each`
    description               | raw
    ${'a plain path'}         | ${`/${'a'.repeat(16 * 1024)}`}
    ${'many dot-like starts'} | ${'/.'.repeat(8 * 1024)}
    ${'many "/" before "?"'}  | ${`${'/%2'.repeat(5 * 1024)}?`}
  `('handles a 16KB input with $description in linear time', ({ raw }) => {
    const start = performance.now();
    toRecordedTarget(raw);

    expect(performance.now() - start).toBeLessThan(50);
  });
});
