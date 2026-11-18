// The e2e suites share one PostgreSQL with every other run, so the rows the
// workspace helpers make must not outlive the test that made them -- not even
// when making them fails half-way.
import type { PlatformName } from '@growi/chat';
import { afterAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../db/index.js';
import type { SdkChannelRef } from '../types/index.js';
import {
  addChannel,
  openWorkspace,
  removeWorkspace,
} from './paired-workspace.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const db: PrismaClient = createPrismaClient(DATABASE_URL);
afterAll(() => db.$disconnect());

const rowsOf = async (installationId: string) => ({
  installation: await db.installation.count({ where: { id: installationId } }),
  channels: await db.installationChannel.count({ where: { installationId } }),
});

/** Removes a workspace the test did not expect to still exist. */
const removeIfLeft = async (installationId: string): Promise<void> => {
  if ((await rowsOf(installationId)).installation > 0) {
    await removeWorkspace(db, installationId);
  }
};

describe('openWorkspace', () => {
  it('leaves no row behind when its channel cannot be added', async () => {
    let savedInstallationId: string | null = null;
    const failure = new Error('the channel could not be stored');

    const outcome = await openWorkspace(db, 'slack', {
      addChannel: async (
        client: PrismaClient,
        installationId: string,
        platform: PlatformName,
      ): Promise<SdkChannelRef> => {
        savedInstallationId = installationId;
        // Stored first, so the removal has a child row to take with it.
        await addChannel(client, installationId, platform);
        throw failure;
      },
    }).then(
      (workspace) => ({ opened: workspace.installationId }),
      (error: unknown) => ({ failed: error }),
    );
    if ('opened' in outcome) await removeIfLeft(outcome.opened);
    if (savedInstallationId == null) {
      throw new Error('openWorkspace never tried to add a channel');
    }
    const rows = await rowsOf(savedInstallationId);
    await removeIfLeft(savedInstallationId);

    expect(outcome).toEqual({ failed: failure });
    expect(rows).toEqual({ installation: 0, channels: 0 });
  });

  it('makes a workspace that removeWorkspace takes away completely', async () => {
    const workspace = await openWorkspace(db, 'slack');
    try {
      expect(await rowsOf(workspace.installationId)).toEqual({
        installation: 1,
        channels: 1,
      });

      await removeWorkspace(db, workspace.installationId);

      expect(await rowsOf(workspace.installationId)).toEqual({
        installation: 0,
        channels: 0,
      });
    } finally {
      await removeIfLeft(workspace.installationId);
    }
  });
});
