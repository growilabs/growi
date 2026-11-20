import { resolveStepToolChoice } from './step-tool-choice';

const MAX_STEPS = 6;

describe('resolveStepToolChoice', () => {
  it('leaves tools available while budget remains', () => {
    expect(
      resolveStepToolChoice({ used: 59_999, limit: 60_000 }, 1, MAX_STEPS),
    ).toBeUndefined();
  });

  it('withdraws tools once the budget is spent', () => {
    expect(
      resolveStepToolChoice({ used: 60_000, limit: 60_000 }, 1, MAX_STEPS),
    ).toEqual({ toolChoice: 'none' });
  });

  it('withdraws tools on the last step even with budget left', () => {
    expect(
      resolveStepToolChoice(
        { used: 0, limit: 60_000 },
        MAX_STEPS - 1,
        MAX_STEPS,
      ),
    ).toEqual({ toolChoice: 'none' });
  });

  it('leaves tools available on the step before the last', () => {
    expect(
      resolveStepToolChoice(
        { used: 0, limit: 60_000 },
        MAX_STEPS - 2,
        MAX_STEPS,
      ),
    ).toBeUndefined();
  });
});
