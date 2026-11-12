import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import { setup } from './comment';

describe('comments API with a revision id taken from a request', () => {
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
    )?.id as string;

  const call = async (
    handler: (req: unknown, res: unknown) => Promise<void>,
    req: Record<string, unknown>,
  ) => {
    const json = vi.fn();
    await handler(req, { json, locals: { activity: { _id: 'a' } } });
    return JSON.stringify(json.mock.calls[0]?.[0]);
  };

  let victim: HydratedDocument<IUserHasId>;
  let attacker: HydratedDocument<IUserHasId>;
  let secretPageId: string;
  let secretRevisionId: string;
  let attackerPageId: string;
  let attackerRevisionId: string;

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    vi.spyOn(crowi.events.activity, 'emit').mockReturnValue(true);

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    victim = await findOrCreateUser('commentBindVictim');
    attacker = await findOrCreateUser('commentBindAttacker');
    const secretPage = await createPage(
      '/comment-bind-secret',
      'secret',
      victim,
      {
        grant: PageGrant.GRANT_OWNER,
      },
    );
    secretPageId = secretPage._id.toString();
    secretRevisionId = await latestRevisionIdOf(secretPageId);
    await prisma.comments.add(
      secretPageId,
      victim._id.toString(),
      secretRevisionId,
      'SECRET COMMENT',
      -1,
    );

    const attackerPage = await createPage(
      '/comment-bind-attacker',
      'attacker body',
      attacker,
    );
    attackerPageId = attackerPage._id.toString();
    attackerRevisionId = await latestRevisionIdOf(attackerPageId);
    await prisma.comments.add(
      attackerPageId,
      attacker._id.toString(),
      attackerRevisionId,
      'attacker comment',
      -1,
    );
  });

  describe('comments.get', () => {
    it('returns the comments of the revision when it belongs to the page', async () => {
      const response = await call(setup(crowi, undefined).api.get, {
        query: { page_id: attackerPageId, revision_id: attackerRevisionId },
        user: attacker,
        isSharedPage: false,
      });

      expect(response).toContain('attacker comment');
    });

    it('does not return the comments of a revision that belongs to a page the viewer cannot see', async () => {
      const response = await call(setup(crowi, undefined).api.get, {
        query: { page_id: attackerPageId, revision_id: secretRevisionId },
        user: attacker,
        isSharedPage: false,
      });

      expect(response).not.toContain('SECRET COMMENT');
    });
  });

  describe('comments.add', () => {
    it('does not attach a comment to a revision of another page', async () => {
      const before = await prisma.comments.count({
        where: { revisionId: secretRevisionId },
      });

      // The test crowi has no commentService, so a handler that gets as far as notifying throws; only the stored rows matter here.
      await call(setup(crowi, undefined).api.add, {
        body: {
          commentForm: {
            page_id: attackerPageId,
            revision_id: secretRevisionId,
            comment: 'injected comment',
          },
        },
        user: attacker,
      }).catch(() => undefined);

      expect(
        await prisma.comments.count({
          where: { revisionId: secretRevisionId },
        }),
      ).toBe(before);
    });
  });

  describe('comments.update', () => {
    it('does not move a comment onto a revision of another page', async () => {
      const own = await prisma.comments.add(
        attackerPageId,
        attacker._id.toString(),
        attackerRevisionId,
        'to be edited',
        -1,
      );

      await call(setup(crowi, undefined).api.update, {
        body: {
          commentForm: {
            comment_id: own.id,
            comment: 'edited',
            revision_id: secretRevisionId,
          },
        },
        user: attacker,
      });

      const reloaded = await prisma.comments.findUnique({
        where: { id: own.id },
      });
      expect(reloaded?.revisionId).toBe(attackerRevisionId);
    });
  });
});
