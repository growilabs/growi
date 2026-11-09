export interface ConcurrencySlots {
  /** A release function, or null at once when every slot is taken. */
  tryAcquire(): (() => void) | null;
}

export const createConcurrencySlots = (_max: number): ConcurrencySlots => {
  throw new Error(
    'not implemented: http/concurrency-slots.createConcurrencySlots',
  );
};
