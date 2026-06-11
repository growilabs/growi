import { isAuditlogSuggestionField } from './activity';

describe('isAuditlogSuggestionField()', () => {
  it('should return true for "username"', () => {
    expect(isAuditlogSuggestionField('username')).toBe(true);
  });

  it('should return false for an unrecognized string', () => {
    expect(isAuditlogSuggestionField('foo')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isAuditlogSuggestionField('')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAuditlogSuggestionField(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAuditlogSuggestionField(undefined)).toBe(false);
  });
});
