import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import { setup } from './tag';

describe('tags.update', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUserHasId>;

  const findOrCreateUser = async (username: string) =>
    (await User.findOne({ username })) ??
    (await User.create({
      name: username,
      username,
      email: `${username}@example.com`,
    }));

  const createPage = async (
    path: string,
    body: string,
    user: HydratedDocument<IUserHasId>,
    options = {},
  ) => {
    const mockedCreateSubOperation = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());
    try {
      return await crowi.pageService.create(path, body, user, options);
    } finally {
      mockedCreateSubOperation.mockRestore();
    }
  };

  const callUpdate = async (
    user: HydratedDocument<IUserHasId>,
    body: Record<string, unknown>,
  ) => {
    const json = vi.fn();
    const { update } = setup(crowi, undefined).api;
    await update({ body, user }, { json, locals: { activity: { _id: 'a' } } });
    return JSON.stringify(json.mock.calls[0][0]);
  };

  const latestRevisionOf = (pageId: string) =>
    prisma.revisions.findFirst({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
    });

  const latestBodyOf = async (pageId: string) =>
    (await latestRevisionOf(pageId))?.body;

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();
    vi.spyOn(crowi.events.activity, 'emit').mockReturnValue(true);

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
  });

  it('keeps the page body when the revision of the same page is given', async () => {
    const user = await findOrCreateUser('tagUpdateOwnRevisionUser');
    const page = await createPage('/tag-update-own', 'own body', user);

    const response = await callUpdate(user, {
      pageId: page._id.toString(),
      tags: ['t1'],
      revisionId: (await latestRevisionOf(page._id.toString()))?.id,
    });

    expect(response).toContain('"ok":true');
    expect(await latestBodyOf(page._id.toString())).toBe('own body');
  });

  it('rejects a revision that belongs to a page the user cannot view and copies nothing', async () => {
    const victim = await findOrCreateUser('tagUpdateVictim');
    const attacker = await findOrCreateUser('tagUpdateAttacker');
    const secretPage = await createPage(
      '/tag-update-secret',
      'TOP SECRET BODY',
      victim,
      { grant: PageGrant.GRANT_OWNER },
    );
    const attackerPage = await createPage(
      '/tag-update-attacker',
      'attacker body',
      attacker,
    );
    expect(await Page.isAccessiblePageByViewer(secretPage._id, attacker)).toBe(
      false,
    );

    const response = await callUpdate(attacker, {
      pageId: attackerPage._id.toString(),
      tags: [],
      revisionId: (await latestRevisionOf(secretPage._id.toString()))?.id,
    });

    expect(response).not.toContain('TOP SECRET BODY');
    expect(await latestBodyOf(attackerPage._id.toString())).toBe(
      'attacker body',
    );
  });
});
