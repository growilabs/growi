import { GroupType, type IPage, PageGrant } from '@growi/core';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { VaultInstruction } from '../models/vault-instruction';
import { COALESCE_WINDOW_MS, createVaultDispatcher } from './vault-dispatcher';
import { createVaultNamespaceMapper } from './vault-namespace-mapper';
import {
  createVaultPageUpdateHandler,
  type VaultPageUpdateHandler,
} from './vault-page-update-handler';

// The outbox collection is the boundary: what gets written there is the
// observable result of handling a page update.
vi.mock('../models/vault-instruction', () => ({
  VaultInstruction: { create: vi.fn() },
}));

vi.mock('~/server/models/user-group-relation', () => ({ default: {} }));
vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({ default: {} }),
);

type UpdatedPage = Parameters<VaultPageUpdateHandler>[0];

const pageId = new Types.ObjectId();
const revisionId = new Types.ObjectId();
const userA = new Types.ObjectId();
const userB = new Types.ObjectId();
const groupId = new Types.ObjectId();

const buildPage = (
  grantState: Pick<IPage, 'grant'> &
    Partial<Pick<IPage, 'grantedGroups' | 'grantedUsers'>>,
): UpdatedPage =>
  mock<UpdatedPage>({
    _id: pageId,
    path: '/handler-spec/page',
    revision: revisionId,
    grantedGroups: [],
    grantedUsers: [],
    ...grantState,
  });

/** `[op, namespace]` of every instruction written for the page, sorted. */
const writtenInstructions = (): Array<[string, string]> =>
  vi
    .mocked(VaultInstruction.create)
    .mock.calls.map(([doc]): [string, string] => {
      const { op, payload } = doc as {
        op: string;
        payload: { namespace: string };
      };
      return [op, payload.namespace];
    })
    .sort();

describe('createVaultPageUpdateHandler', () => {
  let handle: VaultPageUpdateHandler;

  const handleAndFlush = async (
    ...args: Parameters<VaultPageUpdateHandler>
  ): Promise<void> => {
    await handle(...args);
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(VaultInstruction.create).mockResolvedValue({} as never);

    const mapper = createVaultNamespaceMapper();
    handle = createVaultPageUpdateHandler(
      createVaultDispatcher(mapper),
      mapper,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('moves the page from public to the granted user when public becomes only-me', async () => {
    const page = buildPage({
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [userA],
    });

    await handleAndFlush(page, {
      previousGrant: PageGrant.GRANT_PUBLIC,
      previousGrantedGroups: [],
      previousGrantedUsers: [],
    });

    expect(writtenInstructions()).toEqual([
      ['remove', 'public'],
      ['upsert', `user-${userA}-only-me`],
    ]);
  });

  it('moves the page between users when the only-me owner changes', async () => {
    const page = buildPage({
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [userB],
    });

    await handleAndFlush(page, {
      previousGrant: PageGrant.GRANT_OWNER,
      previousGrantedGroups: [],
      previousGrantedUsers: [userA],
    });

    expect(writtenInstructions()).toEqual([
      ['remove', `user-${userA}-only-me`],
      ['upsert', `user-${userB}-only-me`],
    ]);
  });

  it('moves the page from the group to public when a group page becomes public', async () => {
    const page = buildPage({ grant: PageGrant.GRANT_PUBLIC });

    await handleAndFlush(page, {
      previousGrant: PageGrant.GRANT_USER_GROUP,
      previousGrantedGroups: [{ type: GroupType.userGroup, item: groupId }],
      previousGrantedUsers: [],
    });

    expect(writtenInstructions()).toEqual([
      ['remove', `group-${groupId}`],
      ['upsert', 'public'],
    ]);
  });

  it('only upserts when the update leaves the grant unchanged', async () => {
    const page = buildPage({
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [userA],
    });

    await handleAndFlush(page, {
      previousGrant: PageGrant.GRANT_OWNER,
      previousGrantedGroups: [],
      previousGrantedUsers: [userA],
    });

    expect(writtenInstructions()).toEqual([
      ['upsert', `user-${userA}-only-me`],
    ]);
  });

  it('keeps the page in a group it still belongs to when another group is dropped', async () => {
    const keptGroupId = new Types.ObjectId();
    const page = buildPage({
      grant: PageGrant.GRANT_USER_GROUP,
      grantedGroups: [{ type: GroupType.userGroup, item: keptGroupId }],
    });

    await handleAndFlush(page, {
      previousGrant: PageGrant.GRANT_USER_GROUP,
      previousGrantedGroups: [
        { type: GroupType.userGroup, item: keptGroupId },
        { type: GroupType.userGroup, item: groupId },
      ],
      previousGrantedUsers: [],
    });

    expect(writtenInstructions()).toEqual([
      ['remove', `group-${groupId}`],
      ['upsert', `group-${keptGroupId}`],
    ]);
  });

  it('only upserts when the event carries no previous grant state', async () => {
    const page = buildPage({ grant: PageGrant.GRANT_PUBLIC });

    await handleAndFlush(page, undefined);

    expect(writtenInstructions()).toEqual([['upsert', 'public']]);
  });
});
