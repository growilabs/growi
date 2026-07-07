import { describe, expect, expectTypeOf, it } from 'vitest';

import type { activities, Prisma } from '~/generated/prisma/client';

/**
 * Type-level contract for the `activities` model generated from
 * prisma/schema.prisma.
 *
 * Legacy Mongoose-era Activity documents can lack `ip`/`endpoint` entirely
 * (the Mongoose schema never required them). Declaring them as required
 * `String` in schema.prisma makes Prisma throw
 * `Error converting field "endpoint" ... found incompatible value of "null"`
 * the moment a legacy document is read. These assertions are enforced by
 * `pnpm run lint:typecheck`: they stop compiling if schema.prisma reverts
 * `ip`/`endpoint` to required.
 */
describe('activities model (generated from schema.prisma)', () => {
  it('types endpoint as nullable on the read model (optional in schema)', () => {
    expectTypeOf<activities['endpoint']>().toEqualTypeOf<string | null>();
  });

  it('types ip as nullable on the read model (optional in schema)', () => {
    expectTypeOf<activities['ip']>().toEqualTypeOf<string | null>();
  });

  it('accepts a create input without ip/endpoint (backward compat)', () => {
    // Existing activity documents predate the ip/endpoint capture and may
    // carry neither field; a create input providing neither must stay valid
    // so that no destructive data migration is required.
    const minimalActivity: Prisma.activitiesCreateInput = {
      v: 0,
      action: 'LOGIN',
      createdAt: new Date(),
      snapshot: { id: '675547e97f208f8050a361d4', username: 'alice' },
    };
    expect(minimalActivity.ip).toBeUndefined();
    expect(minimalActivity.endpoint).toBeUndefined();
  });
});
