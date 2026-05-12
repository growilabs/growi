import { describe, expect, it } from 'vitest';

describe('empty-module', () => {
  it('should have a default export', async () => {
    const mod = await import('./empty-module');
    expect(mod).toHaveProperty('default');
  });

  it('should export an empty object as default', async () => {
    const mod = await import('./empty-module');
    expect(mod.default).toEqual({});
  });
});
