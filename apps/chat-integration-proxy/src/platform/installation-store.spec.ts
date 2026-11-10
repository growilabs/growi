// Task 3.7. Two behaviors are load-bearing here and nothing else in this file
// is worth pinning down:
//
//  1. **`save()` refreshes the channel inventory once, immediately.** Without
//     it the installation waits out the first refresh period with an empty
//     `installation_channel`, and every notification in the meantime is
//     refused (design.md: 「紐付けた直後の 10 分間、通知がすべて断られる」).
//     The failure path matters as much as the happy path: a refresh that
//     throws must not undo the installation, and must not be swallowed.
//  2. **`remove()` deletes children before parents, in one specific order.**
//     Every foreign key onto `installation` and onto `relation` is `Restrict`
//     (schema.prisma, task 1.4), so a wrong order is not a tidiness issue --
//     the database rejects the delete. The order is therefore asserted as a
//     single recorded sequence, not as per-mock call counts: a set of
//     `toHaveBeenCalled()` assertions passes for every permutation, including
//     the ones that cannot run against a real database.
import { mock } from 'vitest-mock-extended';

import type { Relation } from '../types/index.js';
import {
  createInstallationStore,
  type InstallationStoreDeps,
} from './installation-store.js';

const relationOf = (relationId: string): Relation => ({
  relationId,
  installationId: 'inst-1',
  growiUri: `https://growi.example/${relationId}`,
  growiLabel: relationId,
  searchWeight: 1,
  settingsVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

/**
 * Deps whose every storage call appends a label to one shared array, so the
 * whole removal reads back as a sequence. `calls` is the assertion surface;
 * the mocks exist only to feed it.
 */
const depsRecording = (
  calls: string[],
  relations: ReadonlyArray<Relation>,
): InstallationStoreDeps => {
  // `vi.fn` so a test can also check the arguments one specific call received;
  // the shared `calls` array stays the surface for order.
  const record = <T>(label: string, result: T) =>
    vi.fn(() => {
      calls.push(label);
      return Promise.resolve(result);
    });

  /** A per-relation delete: records which relation it was asked about. */
  const recordForRelation = (label: string) =>
    vi.fn((relationId: string) => {
      calls.push(`${label}:${relationId}`);
      return Promise.resolve(1);
    });

  return {
    installations: mock<InstallationStoreDeps['installations']>({
      save: record('installation.save', 'inst-1'),
      remove: record('installation.remove', undefined),
    }),
    relations: mock<InstallationStoreDeps['relations']>({
      listByInstallation: record('relation.list', relations),
      remove: vi.fn((relationId: string) => {
        calls.push(`relation.remove:${relationId}`);
        return Promise.resolve();
      }),
    }),
    ownKeys: mock<InstallationStoreDeps['ownKeys']>({
      deleteByRelation: recordForRelation('ownKey'),
    }),
    peerKeys: mock<InstallationStoreDeps['peerKeys']>({
      deleteByRelation: recordForRelation('peerKey'),
    }),
    channelPermissions: mock<InstallationStoreDeps['channelPermissions']>({
      deleteByRelation: recordForRelation('channelPermission'),
    }),
    pendingCollections: mock<InstallationStoreDeps['pendingCollections']>({
      deleteByRelation: recordForRelation('pendingCollection'),
    }),
    processedNotifications: mock<
      InstallationStoreDeps['processedNotifications']
    >({
      deleteByRelation: recordForRelation('processedNotification'),
    }),
    pairingOrders: mock<InstallationStoreDeps['pairingOrders']>({
      deleteByInstallation: record('pairingOrder.deleteByInstallation', 1),
    }),
    channels: mock<InstallationStoreDeps['channels']>({
      deleteByInstallation: record(
        'installationChannel.deleteByInstallation',
        1,
      ),
    }),
    refreshChannels: record('refreshChannels', undefined),
    onChannelRefreshFailed: () => {
      calls.push('onChannelRefreshFailed');
    },
  };
};

/** The per-relation children, in the order `remove()` deletes them. */
const childLabelsOf = (relationId: string) => [
  `ownKey:${relationId}`,
  `peerKey:${relationId}`,
  `channelPermission:${relationId}`,
  `pendingCollection:${relationId}`,
  `processedNotification:${relationId}`,
  `relation.remove:${relationId}`,
];

describe('installationStore.save', () => {
  it('stores the installation and answers its id', async () => {
    const calls: string[] = [];
    const deps = depsRecording(calls, []);
    const store = createInstallationStore(deps);

    await expect(
      store.save('slack', 'T0001', 'Acme', { slack: { botToken: 'xoxb-1' } }),
    ).resolves.toBe('inst-1');

    expect(deps.installations.save).toHaveBeenCalledWith(
      'slack',
      'T0001',
      'Acme',
      { slack: { botToken: 'xoxb-1' } },
    );
  });

  it('refreshes the new installation channel inventory once, after the installation exists', async () => {
    // The order is the point: refreshing before the row exists has nothing to
    // refresh, and `refreshChannelInventory` is addressed by installation id.
    const calls: string[] = [];
    const deps = depsRecording(calls, []);

    await createInstallationStore(deps).save('mattermost', 'T2', 'Team', {
      mattermost: { baseUrl: 'https://mm.example', botToken: 'mmbot' },
    });

    expect(calls).toEqual(['installation.save', 'refreshChannels']);
    expect(deps.refreshChannels).toHaveBeenCalledWith('inst-1');
  });

  it('keeps the installation and reports the failure when the immediate refresh throws', async () => {
    // design.md's safety net for a missed refresh is the periodic sweep, so
    // the installation must survive; what must NOT happen is the failure
    // disappearing silently.
    const error = new Error('conversations.list failed');
    const onChannelRefreshFailed = vi.fn();
    const deps: InstallationStoreDeps = {
      ...depsRecording([], []),
      refreshChannels: () => Promise.reject(error),
      onChannelRefreshFailed,
    };

    await expect(
      createInstallationStore(deps).save('slack', 'T3', 'Acme', {
        slack: { botToken: 'xoxb-3' },
      }),
    ).resolves.toBe('inst-1');

    expect(onChannelRefreshFailed).toHaveBeenCalledWith({
      installationId: 'inst-1',
      platform: 'slack',
      workspaceId: 'T3',
      error,
    });
  });
});

describe('installationStore.remove', () => {
  it('deletes one relation children, then the relation, then the installation-scoped rows, then the installation', async () => {
    const calls: string[] = [];
    const deps = depsRecording(calls, [relationOf('rel-1')]);

    await createInstallationStore(deps).remove('inst-1');

    expect(calls).toEqual([
      'relation.list',
      ...childLabelsOf('rel-1'),
      'pairingOrder.deleteByInstallation',
      'installationChannel.deleteByInstallation',
      'installation.remove',
    ]);
    // The recorded labels say nothing about arguments, so the calls that
    // could pass the wrong id and still produce this same sequence are
    // checked separately: relation.list must be scoped to the installation
    // (not e.g. an empty/wrong id, which would silently skip every relation
    // and still reach the same label sequence), and the two
    // installation-scoped deletions must not receive a relation id instead.
    expect(deps.relations.listByInstallation).toHaveBeenCalledWith('inst-1');
    expect(deps.pairingOrders.deleteByInstallation).toHaveBeenCalledWith(
      'inst-1',
    );
    expect(deps.channels.deleteByInstallation).toHaveBeenCalledWith('inst-1');
    expect(deps.installations.remove).toHaveBeenCalledWith('inst-1');
  });

  it('finishes each relation before starting the next one', async () => {
    // Two relations, because this is the only case that tells "each
    // relation's children, then that relation" apart from "all children of
    // all relations, then all relation rows" -- both pass with one relation,
    // and only the first is what `Restrict` requires per row.
    const calls: string[] = [];
    const deps = depsRecording(calls, [
      relationOf('rel-1'),
      relationOf('rel-2'),
    ]);

    await createInstallationStore(deps).remove('inst-1');

    expect(calls).toEqual([
      'relation.list',
      ...childLabelsOf('rel-1'),
      ...childLabelsOf('rel-2'),
      'pairingOrder.deleteByInstallation',
      'installationChannel.deleteByInstallation',
      'installation.remove',
    ]);
  });

  it('removes an installation with no relations', async () => {
    const calls: string[] = [];
    const deps = depsRecording(calls, []);

    await createInstallationStore(deps).remove('inst-1');

    expect(calls).toEqual([
      'relation.list',
      'pairingOrder.deleteByInstallation',
      'installationChannel.deleteByInstallation',
      'installation.remove',
    ]);
  });

  it('does not delete request_nonce rows explicitly (its foreign key cascades)', async () => {
    // Asserted as an absence on purpose: `request_nonce` is the one child of
    // `relation` declared `Cascade` (task 1.4, so an expiring nonce never
    // blocks a deletion), and adding a delete for it here would be a second
    // place that has to be kept in step with the schema.
    const calls: string[] = [];
    const deps = depsRecording(calls, [relationOf('rel-1')]);

    await createInstallationStore(deps).remove('inst-1');

    expect(calls.some((call) => call.includes('nonce'))).toBe(false);
  });

  it('stops at the failing step and leaves the installation row when a child deletion fails', async () => {
    // `Restrict` guarantees the half-removed state is never orphaned rows, so
    // the recovery is to call `remove()` again -- which is only possible while
    // the installation row is still there to be addressed.
    const calls: string[] = [];
    const deps: InstallationStoreDeps = {
      ...depsRecording(calls, [relationOf('rel-1')]),
      peerKeys: mock<InstallationStoreDeps['peerKeys']>({
        deleteByRelation: () =>
          Promise.reject(new Error('peer_key delete failed')),
      }),
    };

    await expect(
      createInstallationStore(deps).remove('inst-1'),
    ).rejects.toThrow('peer_key delete failed');

    expect(calls).toEqual(['relation.list', 'ownKey:rel-1']);
  });
});
