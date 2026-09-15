// Task 5.5. One behavior is load-bearing here: **the order**.
//
// Every foreign key onto `relation` is `Restrict` (schema.prisma, task 1.4),
// so a wrong order is not untidy -- PostgreSQL rejects it. It is therefore
// asserted as one recorded sequence rather than as per-mock call counts: a set
// of `toHaveBeenCalled()` assertions passes for every permutation, including
// the ones a real database refuses (task 3.7's Implementation Note).
//
// `own_key` going FIRST is the part with a security meaning rather than a
// referential one. The private key is the one row that must not survive a
// half-finished removal, so every step that can still fail belongs after it --
// the mirror image of `pairing-service.ts` writing `own_key` first inside its
// transaction, so that the window a rollback has to clean up is real.
import { mock } from 'vitest-mock-extended';

import {
  deleteRelationCascade,
  type RelationCascadeRepositories,
} from './relation-cascade.js';

/**
 * Repositories whose every call appends a label to one shared array, so the
 * whole cascade reads back as a sequence. `calls` is the assertion surface;
 * the mocks exist only to feed it. Same shape as
 * `platform/installation-store.spec.ts`, which asserts the same sequence from
 * the other caller.
 */
const reposRecording = (calls: string[]): RelationCascadeRepositories => {
  const recordChild = (label: string) =>
    vi.fn((relationId: string) => {
      calls.push(`${label}:${relationId}`);
      return Promise.resolve(1);
    });

  return {
    relations: mock<RelationCascadeRepositories['relations']>({
      remove: vi.fn((relationId: string) => {
        calls.push(`relation.remove:${relationId}`);
        return Promise.resolve();
      }),
    }),
    ownKeys: mock<RelationCascadeRepositories['ownKeys']>({
      deleteByRelation: recordChild('ownKey'),
    }),
    peerKeys: mock<RelationCascadeRepositories['peerKeys']>({
      deleteByRelation: recordChild('peerKey'),
    }),
    channelPermissions: mock<RelationCascadeRepositories['channelPermissions']>(
      {
        deleteByRelation: recordChild('channelPermission'),
      },
    ),
    pendingCollections: mock<RelationCascadeRepositories['pendingCollections']>(
      {
        deleteByRelation: recordChild('pendingCollection'),
      },
    ),
    processedNotifications: mock<
      RelationCascadeRepositories['processedNotifications']
    >({
      deleteByRelation: recordChild('processedNotification'),
    }),
  };
};

describe('deleteRelationCascade', () => {
  it('deletes every child of the relation, then the relation row itself, in the order the foreign keys require', async () => {
    const calls: string[] = [];
    const repos = reposRecording(calls);

    await deleteRelationCascade(repos, 'rel-1');

    expect(calls).toEqual([
      'ownKey:rel-1',
      'peerKey:rel-1',
      'channelPermission:rel-1',
      'pendingCollection:rel-1',
      'processedNotification:rel-1',
      'relation.remove:rel-1',
    ]);
  });

  it('removes the private key before any step that can still fail', async () => {
    // Stated as its own case because the sequence above would also be
    // satisfied by an order that merely happens to work: this is the reason
    // `own_key` is first, and it is what "no private key is left behind"
    // rests on -- there is no return value to search for key material the way
    // `relation-key-service.spec.ts` does.
    const calls: string[] = [];
    const repos = reposRecording(calls);

    await deleteRelationCascade(repos, 'rel-1');

    expect(calls.indexOf('ownKey:rel-1')).toBe(0);
  });

  it('touches no installation-scoped table', async () => {
    // `installation_channel` must survive unpairing: it is per installation,
    // not per relation, so clearing it here would refuse the workspace's OTHER
    // GROWIs' notifications until the next refresh (design.md 「`installation_channel`
    // は消さない」). The real guard is structural -- `RelationCascadeRepositories`
    // has no channel repository to call -- and this asserts the observable
    // consequence, the same way task 3.7 asserts the absence of `request_nonce`.
    const calls: string[] = [];
    const repos = reposRecording(calls);

    await deleteRelationCascade(repos, 'rel-1');

    expect(calls.some((call) => call.startsWith('installationChannel'))).toBe(
      false,
    );
    expect(calls.some((call) => call.includes('nonce'))).toBe(false);
  });

  it('stops at the failing step and leaves the relation row in place', async () => {
    // `Restrict` means a half-finished cascade never orphans a row, and the
    // relation row still being there is what makes the operation addressable
    // again -- unpairing is retried by calling it once more.
    const calls: string[] = [];
    const repos: RelationCascadeRepositories = {
      ...reposRecording(calls),
      peerKeys: mock<RelationCascadeRepositories['peerKeys']>({
        deleteByRelation: () =>
          Promise.reject(new Error('peer_key delete failed')),
      }),
    };

    await expect(deleteRelationCascade(repos, 'rel-1')).rejects.toThrow(
      'peer_key delete failed',
    );

    expect(calls).toEqual(['ownKey:rel-1']);
  });
});
