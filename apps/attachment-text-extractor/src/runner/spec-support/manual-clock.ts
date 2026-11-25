/** A clock that moves only when a test moves it, in milliseconds. */
export interface ManualClock {
  readonly now: () => number;
  readonly advance: (ms: number) => void;
}

export const manualClock = (): ManualClock => {
  let current = 0;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
};
