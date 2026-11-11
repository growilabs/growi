import { GroupType, type IPage, PageGrant } from '@growi/core';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import {
  VaultInstruction,
  type VaultInstructionDocument,
} from '../models/vault-instruction';
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

type WrittenInstruction = Pick<VaultInstructionDocument, 'op' | 'payload'>;

describe('createVaultPageUpdateHandler', () => {
  let handle: VaultPageUpdateHandler;
  // `[op, namespace]` of every instruction written to the outbox.
  let written: Array<[string, string | undefined]>;
  const writtenInstructions = (): Array<[string, string | undefined]> =>
    [...written].sort();

  const handleAndFlush = async (
    ...args: Parameters<VaultPageUpdateHandler>
  ): Promise<void> => {
    await handle(...args);
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    written = [];
    vi.mocked(VaultInstruction.create).mockImplementation(
      async (doc: WrittenInstruction) => {
        written.push([doc.op, doc.payload.namespace]);
        return mock<VaultInstructionDocument>();
      },
    );

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

  it('does not bring the page back to public when the grant changes right after a body save', async () => {
    const publicState = {
      previousGrant: PageGrant.GRANT_PUBLIC,
      previousGrantedGroups: [],
      previousGrantedUsers: [],
    };
    await handle(buildPage({ grant: PageGrant.GRANT_PUBLIC }), publicState);

    await handleAndFlush(
      buildPage({ grant: PageGrant.GRANT_OWNER, grantedUsers: [userA] }),
      publicState,
    );

    expect(written).toEqual([
      ['remove', 'public'],
      ['upsert', `user-${userA}-only-me`],
    ]);
  });

  it('only upserts when the event carries no previous grant state', async () => {
    const page = buildPage({ grant: PageGrant.GRANT_PUBLIC });

    await handleAndFlush(page, undefined);

    expect(writtenInstructions()).toEqual([['upsert', 'public']]);
  });
});
