import { validationResult } from 'express-validator';

import { expiredAtValidator } from './expired-at-validator';

const validate = async (expiredAt?: string | null) => {
  const req = { body: { expiredAt } };
  await expiredAtValidator().run(req);
  return validationResult(req).isEmpty();
};

describe('expiredAtValidator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts an omitted expiredAt', async () => {
    expect(await validate(undefined)).toBe(true);
    expect(await validate(null)).toBe(true);
  });

  it('accepts a future date and rejects a past date', async () => {
    expect(await validate('2026-01-11T00:00:00Z')).toBe(true);
    expect(await validate('2026-01-09T00:00:00Z')).toBe(false);
  });

  it('evaluates "now" per call, not once at import time', async () => {
    const expiredAt = '2026-01-11T00:00:00Z';
    expect(await validate(expiredAt)).toBe(true);

    vi.setSystemTime(new Date('2026-01-12T00:00:00Z'));
    expect(await validate(expiredAt)).toBe(false);
  });
});
