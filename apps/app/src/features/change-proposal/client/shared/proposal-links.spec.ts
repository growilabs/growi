import { buildProposalHref, formatProposalShortId } from './proposal-links';

describe('formatProposalShortId', () => {
  it('prefixes # to the last 8 characters of the id', () => {
    expect(formatProposalShortId('65f0c0ffee1234567890abcd')).toBe('#7890abcd');
  });

  it('keeps a short id whole', () => {
    expect(formatProposalShortId('abc')).toBe('#abc');
  });
});

describe('buildProposalHref', () => {
  it('returns the detail page URL under /me/change-proposals', () => {
    expect(buildProposalHref('65f0c0ffee1234567890abcd')).toBe(
      '/me/change-proposals/65f0c0ffee1234567890abcd',
    );
  });
});
