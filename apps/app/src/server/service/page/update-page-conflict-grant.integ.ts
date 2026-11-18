import { getIdStringForRef, type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { RevisionConflictError } from '~/server/models/errors';
import type { PageDocument, PageModel } from '~/server/models/page';

describe('PageService.updatePage when the revision conflicts', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let user: HydratedDocument<IUserHasId>;

  const create = async (
    path: string,
    body: string,
    options = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const spy = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());
    const created = await crowi.pageService.create(path, body, user, options);
    const args = spy.mock.calls[0];
    spy.mockRestore();
    await crowi.pageService.createSubOperation(
      ...(args as Parameters<typeof crowi.pageService.createSubOperation>),
    );
    return created;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    Page = mongoose.model<PageDocument, PageModel>('Page');

    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();

    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    const username = 'updateConflictGrantUser';
    const User = mongoose.model<IUserHasId>('User');
    user =
      (await User.findOne({ username })) ??
      (await User.create({
        name: username,
        username,
        email: 'update-conflict-grant@example.com',
      }));
  });

  const revisionIdOf = (page: HydratedDocument<PageDocument>): string => {
    if (page.revision == null) throw new Error('fixture page has no revision');
    return getIdStringForRef(page.revision);
  };

  // Loads the page as the losing writer sees it, then lets another writer win.
  const loseRace = async (path: string, initialGrant: number) => {
    const created = await create(path, 'initial body', { grant: initialGrant });
    const staleRevisionId = revisionIdOf(created);
    const loserCopy = await Page.findById(created._id);
    if (loserCopy == null) {
      throw new Error('fixture page not found');
    }
    const winnerCopy = await Page.findById(created._id);
    if (winnerCopy == null) throw new Error('fixture page not found');
    await crowi.pageService.updatePage(
      winnerCopy,
      'winner body',
      'initial body',
      user,
      { expectedRevisionId: staleRevisionId },
    );
    return { pageId: created._id, loserCopy, staleRevisionId };
  };

  it.each([
    ['public to only-me', PageGrant.GRANT_PUBLIC, PageGrant.GRANT_OWNER],
    ['only-me to public', PageGrant.GRANT_OWNER, PageGrant.GRANT_PUBLIC],
  ])('keeps the stored grant when the save loses the race (%s)', async (_name, from, to) => {
    const { pageId, loserCopy, staleRevisionId } = await loseRace(
      `/update-conflict-grant-${from}-${to}`,
      from,
    );

    await expect(
      crowi.pageService.updatePage(
        loserCopy,
        'loser body',
        'initial body',
        user,
        {
          grant: to,
          expectedRevisionId: staleRevisionId,
        },
      ),
    ).rejects.toBeInstanceOf(RevisionConflictError);

    const stored = await Page.findById(pageId);
    expect(stored?.grant).toBe(from);
  });

  it('applies the grant together with the body when the save wins', async () => {
    const created = await create('/update-conflict-grant-win', 'initial body', {
      grant: PageGrant.GRANT_PUBLIC,
    });
    const copy = await Page.findById(created._id);
    if (copy == null) throw new Error('fixture page not found');

    await crowi.pageService.updatePage(
      copy,
      'next body',
      'initial body',
      user,
      {
        grant: PageGrant.GRANT_OWNER,
        expectedRevisionId: revisionIdOf(created),
      },
    );

    const stored = await Page.findById(created._id);
    expect(stored?.grant).toBe(PageGrant.GRANT_OWNER);
    expect(stored?.grantedUsers?.map(String)).toEqual([String(user._id)]);
  });

  it('clears wip together with the body when a save that publishes a wip page wins', async () => {
    const created = await create('/update-conflict-grant-wip', 'initial body', {
      wip: true,
    });
    expect(created.wip).toBe(true);
    const copy = await Page.findById(created._id);
    if (copy == null) throw new Error('fixture page not found');

    await crowi.pageService.updatePage(
      copy,
      'next body',
      'initial body',
      user,
      {
        wip: false,
        expectedRevisionId: revisionIdOf(created),
      },
    );

    const stored = await Page.findById(created._id);
    expect(stored?.wip).toBeUndefined();
    expect(stored?.wipExpiredAt).toBeUndefined();
  });
});
