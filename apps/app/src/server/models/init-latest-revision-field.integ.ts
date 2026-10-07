import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

describe('Page#initLatestRevisionField with a revision id taken from a request', () => {
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

  const latestRevisionIdOf = async (pageId: string) =>
    (
      await prisma.revisions.findFirst({
        where: { pageId },
        orderBy: { createdAt: 'desc' },
      })
    )?.id;

  const showRevision = async (
    pageId: string,
    viewer: HydratedDocument<IUserHasId>,
    revisionId: string | undefined,
  ) => {
    const page = await Page.findByIdAndViewer(pageId, viewer);
    expect(page).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    await page!.initLatestRevisionField(revisionId);
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    return page!.populateDataToShowRevision();
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
  });

  it('shows the requested revision when it belongs to the page', async () => {
    const user = await findOrCreateUser('initRevOwnUser');
    const page = await createPage('/init-rev-own', 'first body', user);
    const firstRevisionId = await latestRevisionIdOf(page._id.toString());
    await crowi.pageService.updatePage(
      page,
      'second body',
      'first body',
      user,
      {},
    );

    const shown = await showRevision(
      page._id.toString(),
      user,
      firstRevisionId,
    );

    expect(shown.revision?.body).toBe('first body');
  });

  it('keeps showing the latest revision when the requested revision belongs to a page the viewer cannot see', async () => {
    const victim = await findOrCreateUser('initRevVictim');
    const attacker = await findOrCreateUser('initRevAttacker');
    const secretPage = await createPage(
      '/init-rev-secret',
      'TOP SECRET BODY',
      victim,
      { grant: PageGrant.GRANT_OWNER },
    );
    const attackerPage = await createPage(
      '/init-rev-attacker',
      'attacker body',
      attacker,
    );
    const secretRevisionId = await latestRevisionIdOf(
      secretPage._id.toString(),
    );

    const shown = await showRevision(
      attackerPage._id.toString(),
      attacker,
      secretRevisionId,
    );

    expect(shown.revision?.body).toBe('attacker body');
  });
});
