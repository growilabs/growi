import type { IRevisionProposalMark, IUserHasId } from '@growi/core';
import { getIdStringForRef, Origin, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { RevisionConflictError } from '~/server/models/errors';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import type { IPageService } from '~/server/service/page/page-service';
import { prisma } from '~/utils/prisma';

import { HUMAN_SAVE_MAX_ATTEMPTS, updatePageBody } from './update-page-body';

const PREFIX = '/update-page-body-integ';
const USERNAME = 'updatePageBodyIntegUser';

describe('updatePageBody', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let user: HydratedDocument<IUserHasId>;
  let pageSeq = 0;

  const waitForPageOperationsToFinish = async (): Promise<void> => {
    await vi.waitFor(
      async () => {
        const remaining = await PageOperation.countDocuments({
          fromPath: new RegExp(`^${PREFIX}/`),
        });
        expect(remaining).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  };

  const findPage = async (
    pageId: mongoose.Types.ObjectId,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.findById(pageId);
    if (page == null) {
      throw new Error(`page ${pageId} not found`);
    }
    return page;
  };

  const latestRevisionOf = async (pageId: mongoose.Types.ObjectId) => {
    const page = await findPage(pageId);
    const revision = await prisma.revisions.findUnique({
      where: { id: page.revision?.toString() },
    });
    if (revision == null) {
      throw new Error(`latest revision of ${pageId} not found`);
    }
    return revision;
  };

  // Creates a page and, when given, a second revision with that origin so the
  // latest revision carries it.
  const createPage = async (
    latestOrigin?: Origin,
  ): Promise<HydratedDocument<PageDocument>> => {
    pageSeq += 1;
    const created = await crowi.pageService.create(
      `${PREFIX}/page-${pageSeq}`,
      'first body',
      user,
      {},
    );
    await waitForPageOperationsToFinish();
    if (latestOrigin != null) {
      await crowi.pageService.updatePage(
        await findPage(created._id),
        'second body',
        'first body',
        user,
        { origin: latestOrigin },
      );
      await waitForPageOperationsToFinish();
    }
    return findPage(created._id);
  };

  // Advances the page through another document, leaving any copy read before
  // this call stale.
  const saveCompetitor = async (
    pageId: mongoose.Types.ObjectId,
    origin: Origin | undefined,
  ): Promise<string> => {
    const updated = await crowi.pageService.updatePage(
      await findPage(pageId),
      'competitor body',
      null,
      user,
      { origin },
    );
    await waitForPageOperationsToFinish();
    return updated.revision == null ? '' : getIdStringForRef(updated.revision);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    await configManager.updateConfigs({ 'app:isV5Compatible': true });

    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    const User = mongoose.model<IUserHasId>('User');
    user = await User.create({
      name: USERNAME,
      username: USERNAME,
      email: 'update-page-body-integ@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
  });

  beforeEach(() => {
    // Page event listeners (search, vault, ...) are unrelated to what is under test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const pages = await Page.find({ path: new RegExp(`^${PREFIX}/`) });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pages.map((p) => p._id.toString()) } },
    });
    await Page.deleteMany({ _id: { $in: pages.map((p) => p._id) } });
    await mongoose.model('User').deleteMany({ username: USERNAME });
    await configManager.updateConfigs(
      { 'app:isV5Compatible': undefined },
      { removeIfUndefined: true },
    );
  });

  describe("mode 'human'", () => {
    it('saves on the first attempt and returns the previous revision when nothing raced', async () => {
      const page = await createPage();
      const firstRevisionId = page.revision?.toString();

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'human',
          page,
          body: 'my body',
          user,
          clientRevisionId: firstRevisionId,
          origin: undefined,
          options: {},
        },
      );

      expect(result.type).toBe('updated');
      if (result.type !== 'updated') return;
      expect(result.previousRevision?.body).toBe('first body');
      const latest = await latestRevisionOf(page._id);
      expect(latest.body).toBe('my body');
      expect(latest.proposalId ?? undefined).toBeUndefined();
      expect(latest.proposalOperationKey ?? undefined).toBeUndefined();
    });

    it('retries an editor save that lost the race when the check is skipped, keeping the competitor revision in history', async () => {
      const stalePage = await createPage(Origin.Editor);
      const competitorRevisionId = await saveCompetitor(
        stalePage._id,
        Origin.Editor,
      );

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'human',
          page: stalePage,
          body: 'my body',
          user,
          clientRevisionId: undefined,
          origin: Origin.Editor,
          options: {},
        },
      );

      expect(result.type).toBe('updated');
      const latest = await latestRevisionOf(stalePage._id);
      expect(latest.body).toBe('my body');
      expect(latest.origin).toBe(Origin.Editor);
      expect(
        await prisma.revisions.findUnique({
          where: { id: competitorRevisionId },
        }),
      ).toMatchObject({ body: 'competitor body' });
    });

    it('returns a conflict with the competitor revision and writes nothing when the re-check fails after losing the race', async () => {
      const stalePage = await createPage();
      const staleRevisionId = stalePage.revision?.toString();
      const competitorRevisionId = await saveCompetitor(
        stalePage._id,
        undefined,
      );

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'human',
          page: stalePage,
          body: 'my body',
          user,
          clientRevisionId: staleRevisionId,
          origin: undefined,
          options: {},
        },
      );

      expect(result).toEqual({
        type: 'conflict',
        latestRevisionId: competitorRevisionId,
      });
      expect((await findPage(stalePage._id)).revision?.toString()).toBe(
        competitorRevisionId,
      );
      expect(
        await prisma.revisions.count({
          where: { pageId: stalePage._id.toString(), body: 'my body' },
        }),
      ).toBe(0);
    });

    it('returns a conflict without writing when the first check fails', async () => {
      const page = await createPage();
      const latestRevisionId = page.revision?.toString();
      const pageService = mock<IPageService>();

      const result = await updatePageBody(
        { pageService },
        {
          mode: 'human',
          page,
          body: 'my body',
          user,
          clientRevisionId: new mongoose.Types.ObjectId().toString(),
          origin: undefined,
          options: {},
        },
      );

      expect(result).toEqual({ type: 'conflict', latestRevisionId });
      expect(pageService.updatePage).not.toHaveBeenCalled();
    });

    it(`gives up with a conflict after ${HUMAN_SAVE_MAX_ATTEMPTS} lost races`, async () => {
      const page = await createPage(Origin.Editor);
      const latestRevisionId = page.revision?.toString();
      const pageService = mock<IPageService>();
      pageService.updatePage.mockRejectedValue(
        new RevisionConflictError(page._id.toString(), 'whatever'),
      );

      const result = await updatePageBody(
        { pageService },
        {
          mode: 'human',
          page,
          body: 'my body',
          user,
          clientRevisionId: undefined,
          origin: Origin.Editor,
          options: {},
        },
      );

      expect(result).toEqual({ type: 'conflict', latestRevisionId });
      expect(pageService.updatePage).toHaveBeenCalledTimes(
        HUMAN_SAVE_MAX_ATTEMPTS,
      );
    });

    it('lets errors other than a revision conflict propagate', async () => {
      const page = await createPage();
      const pageService = mock<IPageService>();
      pageService.updatePage.mockRejectedValue(new Error('boom'));

      await expect(
        updatePageBody(
          { pageService },
          {
            mode: 'human',
            page,
            body: 'my body',
            user,
            clientRevisionId: page.revision?.toString(),
            origin: undefined,
            options: {},
          },
        ),
      ).rejects.toThrow('boom');
      expect(pageService.updatePage).toHaveBeenCalledTimes(1);
    });
  });

  describe("mode 'human' with a grant change", () => {
    // A restricted page is off the tree; a public child at a deeper path hangs
    // under an empty placeholder page at the same path.
    const createRestrictedPageWithChild = async () => {
      pageSeq += 1;
      const path = `${PREFIX}/restricted-${pageSeq}`;
      const created = await crowi.pageService.create(path, 'first body', user, {
        grant: PageGrant.GRANT_RESTRICTED,
      });
      await waitForPageOperationsToFinish();
      const child = await crowi.pageService.create(
        `${path}/child`,
        'child body',
        user,
        { grant: PageGrant.GRANT_PUBLIC },
      );
      await waitForPageOperationsToFinish();
      await crowi.pageService.updatePage(
        await findPage(created._id),
        'second body',
        'first body',
        user,
        { origin: Origin.Editor },
      );
      await waitForPageOperationsToFinish();
      return { path, child, page: await findPage(created._id) };
    };

    it('keeps the tree consistent when a save that moves a restricted page onto the tree races another save', async () => {
      const {
        path,
        child,
        page: stalePage,
      } = await createRestrictedPageWithChild();
      const placeholder = await Page.findOne({ path, isEmpty: true });
      expect(placeholder).not.toBeNull();
      expect((await findPage(child._id)).parent?.toString()).toBe(
        placeholder?._id.toString(),
      );
      await saveCompetitor(stalePage._id, Origin.Editor);

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'human',
          page: stalePage,
          body: 'my body',
          user,
          clientRevisionId: undefined,
          origin: Origin.Editor,
          options: { grant: PageGrant.GRANT_PUBLIC },
        },
      );
      await waitForPageOperationsToFinish();

      expect(result.type).toBe('updated');
      const pagesAtPath = await Page.find({ path });
      expect(pagesAtPath).toHaveLength(1);
      expect(pagesAtPath[0].isEmpty).toBeFalsy();
      expect(pagesAtPath[0]._id.toString()).toBe(stalePage._id.toString());
      expect((await findPage(child._id)).parent?.toString()).toBe(
        stalePage._id.toString(),
      );
      expect((await latestRevisionOf(stalePage._id)).body).toBe('my body');
    });

    it('still detects a lost race when the grant is sent without changing whether the page is restricted', async () => {
      const stalePage = await createPage();
      const staleRevisionId = stalePage.revision?.toString();
      const competitorRevisionId = await saveCompetitor(
        stalePage._id,
        undefined,
      );

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'human',
          page: stalePage,
          body: 'my body',
          user,
          clientRevisionId: staleRevisionId,
          origin: undefined,
          options: { grant: PageGrant.GRANT_PUBLIC },
        },
      );

      expect(result).toEqual({
        type: 'conflict',
        latestRevisionId: competitorRevisionId,
      });
      expect(
        await prisma.revisions.count({
          where: { pageId: stalePage._id.toString(), body: 'my body' },
        }),
      ).toBe(0);
    });
  });

  describe("mode 'proposal'", () => {
    const proposalMark: IRevisionProposalMark = {
      proposalId: new mongoose.Types.ObjectId().toString(),
      proposalOperationKey: 'op-edit-1',
    };

    it('writes a marked revision with an empty origin when the page is still at the base revision', async () => {
      const page = await createPage(Origin.Editor);

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'proposal',
          page,
          body: 'proposed body',
          user,
          expectedRevisionId: page.revision?.toString() ?? '',
          proposalMark,
        },
      );

      expect(result.type).toBe('updated');
      if (result.type !== 'updated') return;
      expect(result.previousRevision?.body).toBe('second body');
      const latest = await latestRevisionOf(page._id);
      expect(latest).toMatchObject({ body: 'proposed body', ...proposalMark });
      expect(latest.origin ?? undefined).toBeUndefined();
    });

    it('returns a conflict without retrying and leaves the page unchanged when the base revision is stale', async () => {
      const page = await createPage(Origin.Editor);
      const baseRevisionId = page.revision?.toString() ?? '';
      // Even an editor-origin competitor must not be overwritten by a proposal.
      const competitorRevisionId = await saveCompetitor(
        page._id,
        Origin.Editor,
      );
      const updatePageSpy = vi.spyOn(crowi.pageService, 'updatePage');

      const result = await updatePageBody(
        { pageService: crowi.pageService },
        {
          mode: 'proposal',
          page: await findPage(page._id),
          body: 'proposed body',
          user,
          expectedRevisionId: baseRevisionId,
          proposalMark,
        },
      );

      expect(result).toEqual({
        type: 'conflict',
        latestRevisionId: competitorRevisionId,
      });
      expect(updatePageSpy).toHaveBeenCalledTimes(1);
      expect((await latestRevisionOf(page._id)).body).toBe('competitor body');
      expect(
        await prisma.revisions.count({
          where: { pageId: page._id.toString(), body: 'proposed body' },
        }),
      ).toBe(0);
    });
  });
});
