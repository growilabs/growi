import { shouldSendPerPageNotifications } from './should-send-per-page-notifications';

describe('shouldSendPerPageNotifications', () => {
  it.each([
    { isEnabledBySettings: true, proposalValue: true, expected: true },
    { isEnabledBySettings: true, proposalValue: false, expected: false },
    { isEnabledBySettings: false, proposalValue: true, expected: false },
    { isEnabledBySettings: false, proposalValue: false, expected: false },
  ])('returns $expected when settings=$isEnabledBySettings and proposal=$proposalValue', ({
    isEnabledBySettings,
    proposalValue,
    expected,
  }) => {
    expect(
      shouldSendPerPageNotifications(isEnabledBySettings, proposalValue),
    ).toBe(expected);
  });
});
