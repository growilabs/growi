import { createConcurrencySlots } from './concurrency-slots';

// The slots never make a caller wait. With every slot taken the next
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

describe('createConcurrencySlots usage and capacity', () => {
  it('inUse rises with each slot taken and falls with each release', () => {
    const slots = createConcurrencySlots(3);
    expect(slots.inUse()).toBe(0);

    const first = slots.tryAcquire();
    const second = slots.tryAcquire();
    expect(slots.inUse()).toBe(2);

    first?.();
    expect(slots.inUse()).toBe(1);
    second?.();
    expect(slots.inUse()).toBe(0);
  });

  it('a refused caller does not count as in use', () => {
    const slots = createConcurrencySlots(1);
    slots.tryAcquire();

    slots.tryAcquire();

    expect(slots.inUse()).toBe(1);
  });

  it('releasing the same slot twice lowers inUse only once', () => {
    const slots = createConcurrencySlots(2);
    const first = slots.tryAcquire();
    slots.tryAcquire();

    first?.();
    first?.();

    expect(slots.inUse()).toBe(1);
  });

  it.each([3, 1, 0, -2])('capacity is the configured value %i as is', (max) => {
    expect(createConcurrencySlots(max).capacity).toBe(max);
  });

  it.each([0, -2])('with capacity %i no slot is ever handed out', (max) => {
    const slots = createConcurrencySlots(max);

    expect(slots.tryAcquire()).toBeNull();
    expect(slots.inUse()).toBe(0);
  });
});
