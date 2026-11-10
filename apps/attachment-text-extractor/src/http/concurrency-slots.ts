export interface ConcurrencySlots {
  /** A release function, or null at once when every slot is taken. */
  tryAcquire(): (() => void) | null;
}

export const createConcurrencySlots = (max: number): ConcurrencySlots => {
  let inUse = 0;
  return {
    tryAcquire: () => {
      if (inUse >= max) return null;
      inUse++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inUse--;
      };
    },
  };
};
