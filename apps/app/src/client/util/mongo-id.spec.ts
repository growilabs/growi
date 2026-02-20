import { describe, expect, it } from 'vitest';

import { isMongoId } from './mongo-id';

describe('isMongoId', () => {
  it('should return true for a valid 24-char lowercase hex string', () => {
    expect(isMongoId('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('should return true for a valid 24-char uppercase hex string', () => {
    expect(isMongoId('507F1F77BCF86CD799439011')).toBe(true);
  });

  it('should return true for mixed-case hex string', () => {
    expect(isMongoId('507f1F77bcF86cd799439011')).toBe(true);
  });

  it('should return false for a string shorter than 24 chars', () => {
    expect(isMongoId('507f1f77bcf86cd79943901')).toBe(false);
  });

  it('should return false for a string longer than 24 chars', () => {
    expect(isMongoId('507f1f77bcf86cd7994390111')).toBe(false);
  });

  it('should return false for a non-hex 24-char string', () => {
    expect(isMongoId('507f1f77bcf86cd79943901g')).toBe(false);
  });

  it('should return false for an empty string', () => {
    expect(isMongoId('')).toBe(false);
  });

  it('should return false for a path-like string', () => {
    expect(isMongoId('/Sandbox/test-page')).toBe(false);
  });
});
