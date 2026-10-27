/**
 * Unit tests for utils/prisma-connect.ts — boot-time Prisma warmup helper
 *
 * Contract under test:
 * - resolves and calls `$connect` exactly once on the injected client
 * - when `$connect` rejects, the error is rethrown (so boot aborts, mirroring
 *   how a mongoose connection failure aborts crowi `init()`)
 *
 * The client is always injected via `mock<...>()` — this spec never imports
 * or touches a live Prisma connection.
 */

import { mock } from 'vitest-mock-extended';

import type { PrismaClient } from './prisma';
import { connectPrismaAtBoot } from './prisma-connect';

describe('connectPrismaAtBoot', () => {
  it('resolves and calls $connect exactly once', async () => {
    const client = mock<Pick<PrismaClient, '$connect'>>();
    client.$connect.mockResolvedValue(undefined);

    await connectPrismaAtBoot(client);

    expect(client.$connect).toHaveBeenCalledTimes(1);
  });

  it('rethrows the error when $connect rejects', async () => {
    const client = mock<Pick<PrismaClient, '$connect'>>();
    const connectionError = new Error('connection refused');
    client.$connect.mockRejectedValue(connectionError);

    await expect(connectPrismaAtBoot(client)).rejects.toBe(connectionError);
  });
});
