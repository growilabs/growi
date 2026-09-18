import { PageStatus } from '@growi/core';
import { Types } from 'mongoose';

import { deriveLinkTargetState } from './link-target-state';

describe('deriveLinkTargetState', () => {
  const target = new Types.ObjectId();

  it('reports an unresolved row as broken', () => {
    expect(deriveLinkTargetState(null, null)).toBe('broken');
  });

  it('reports a resolved row whose target is in the trash as trashed', () => {
    expect(deriveLinkTargetState(target, PageStatus.STATUS_DELETED)).toBe(
      'trashed',
    );
  });

  it('reports a resolved row whose target is published as normal', () => {
    expect(deriveLinkTargetState(target, PageStatus.STATUS_PUBLISHED)).toBe(
      'normal',
    );
  });

  // A v4-era page has no `status` field, and the trashed filter counts that as published.
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats a %s status as normal, not trashed', (_label, status) => {
    expect(deriveLinkTargetState(target, status)).toBe('normal');
  });

  // A stale status from a caller must not turn a broken row into a trashed one.
  it('reports broken even when a target status is supplied', () => {
    expect(deriveLinkTargetState(null, PageStatus.STATUS_DELETED)).toBe(
      'broken',
    );
  });
});
