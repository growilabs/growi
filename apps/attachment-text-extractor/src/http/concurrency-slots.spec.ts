import { createConcurrencySlots } from './concurrency-slots';

// Req 3.2: the slots never make a caller wait. With every slot taken the next
// caller is told at once (and answers 503); a released slot is reusable.
// Python test_limits.py TestAcquireSlot (its exception-path rows are the
// route's: extract-route.integ.ts checks the slot after a failing run).

describe('createConcurrencySlots', () => {
  it('hands out up to `max` slots, then none, without waiting', () => {
    const slots = createConcurrencySlots(3);

    const taken = [slots.tryAcquire(), slots.tryAcquire(), slots.tryAcquire()];

    expect(taken.every((release) => release !== null)).toBe(true);
    expect(slots.tryAcquire()).toBeNull();
  });

  it('with one slot, refuses the second caller', () => {
    const slots = createConcurrencySlots(1);

    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
  });

  it('a released slot can be taken again', () => {
    const slots = createConcurrencySlots(1);
    const release = slots.tryAcquire();

    release?.();

    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
  });

  it('releasing the same slot twice frees it only once', () => {
    const slots = createConcurrencySlots(2);
    const first = slots.tryAcquire();
    slots.tryAcquire();

    first?.();
    first?.();

    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
  });

  it('every release frees its own slot', () => {
    const slots = createConcurrencySlots(2);
    const releases = [slots.tryAcquire(), slots.tryAcquire()];

    for (const release of releases) release?.();

    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
  });
});
