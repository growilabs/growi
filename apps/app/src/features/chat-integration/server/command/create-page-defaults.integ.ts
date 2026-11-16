// `create-page` through the endpoint against GROWI's real page creation: the
// page it makes is a published page with no auto-delete expiry, whose grant
// is inherited from the closest ancestor -- the defaults of
// `pageService.create`, untouched by the creation options the summary page
// passes to the same creation path.
//
// Requirements: 4.2.

import {
  type ChannelRef,
  type ChatAccountRef,
  type CommandRequest,
  toNativeChannelId,
} from '@growi/chat';
import { type IUser, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import { createCommandEndpoint } from './command-endpoint';

const RELATION_ID = 'relation-create-page-defaults';
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: toNativeChannelId('C0DEFAULTS'),
  channelName: 'defaults-channel',
  isPrivate: false,
};
const RUN = Date.now();

describe('create-page with real page creation', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let seq = 0;

  const createLinkedUser = async (
    actor: ChatAccountRef,
  ): Promise<HydratedDocument<IUser>> => {
    const user = await crowi.models.User.create({
      name: `defaults ${seq}`,
      username: `create-page-defaults-${RUN}-${seq}`,
      email: `create-page-defaults-${seq}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
    await ChatAccountLink.create({
      relationId: RELATION_ID,
      userId: user._id,
      platform: actor.platform,
      accountId: actor.accountId,
      linkedAt: new Date(),
    });
    return user;
  };

  const createPageRequest = (
    actor: ChatAccountRef,
    path: string,
  ): Extract<CommandRequest, { kind: 'create-page' }> => ({
    relationId: RELATION_ID,
    op: 'command',
    requestId: `req-defaults-${RUN}-${seq}`,
    actor,
    channel: CHANNEL,
    kind: 'create-page',
    path,
    body: 'created via chat',
  });

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    Page = mongoose.model<PageDocument, PageModel>('Page');

    vi.spyOn(crowi.pageService, 'createSubOperation').mockResolvedValue();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
    await ChatChannelPermission.create({
      relationId: RELATION_ID,
      commandName: 'create-page',
      allowedChannels: [CHANNEL.channelId],
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await Promise.all([
      ChatChannelPermission.deleteMany({ relationId: RELATION_ID }),
      ChatAccountLink.deleteMany({ relationId: RELATION_ID }),
    ]);
  });

  it('creates a published page with no expiry, inheriting the closest ancestor grant', async () => {
    seq += 1;
    const actor: ChatAccountRef = {
      platform: 'slack',
      accountId: `U0DEFAULTS-${seq}`,
      displayName: 'Defaults',
    };
    const user = await createLinkedUser(actor);
    const parentPath = `/create-page-defaults-${RUN}-${seq}`;
    const root = await Page.findOne({ path: '/' });
    await Page.create({
      path: parentPath,
      parent: root?._id,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [user._id],
      creator: user._id,
    });

    const response = await createCommandEndpoint(crowi).handle(
      createPageRequest(actor, `${parentPath}/child`),
      { requestArrivedAt: new Date() },
    );

    expect(response).toMatchObject({ kind: 'created' });
    const saved = await Page.findOne({ path: `${parentPath}/child` }).lean();
    expect(saved?.wip).toBeFalsy();
    expect(saved?.wipExpiredAt).toBeUndefined();
    expect(saved?.grant).toBe(PageGrant.GRANT_OWNER);
    expect(saved?.creator?.toString()).toBe(user._id.toString());
  });
});
