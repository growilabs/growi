export interface ConcurrencySlots {
  /** A release function, or null at once when every slot is taken. */
  tryAcquire(): (() => void) | null;
  inUse(): number;
  /** The configured maximum as is; it may be 0 or negative. */
  readonly capacity: number;
}

export const createConcurrencySlots = (max: number): ConcurrencySlots => {
  let taken = 0;
  return {
    capacity: max,
    inUse: () => taken,
    tryAcquire: () => {
      if (taken >= max) return null;
      taken++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        taken--;
      };
    },
  };
};
