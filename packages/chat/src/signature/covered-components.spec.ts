import { describe, expect, it } from 'vitest';

import { COVERED_COMPONENTS } from './covered-components.js';

describe('COVERED_COMPONENTS', () => {
  it('covers the method, the content type and the body digest, in that order', () => {
    expect([...COVERED_COMPONENTS]).toEqual([
      '@method',
      'content-type',
      'content-digest',
    ]);
  });

  it('covers no component that carries the destination URL or path', () => {
    // An intermediary (a TLS-terminating reverse proxy, a path-rewriting
    // `proxy_pass`) rewrites these between the sender and the receiver, so a
    // signature covering them would reject legitimate requests purely because
    // of the routing topology (design.md, requirement 10.1).
    for (const forbidden of [
      '@target-uri',
      '@authority',
      '@path',
      '@query',
      '@query-param',
      '@scheme',
      '@request-target',
      'host',
    ]) {
      expect(COVERED_COMPONENTS).not.toContain(forbidden);
    }
  });
});
