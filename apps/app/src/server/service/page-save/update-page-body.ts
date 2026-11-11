import type { IRevisionProposalMark, IUserHasId, Origin } from '@growi/core';
import { getIdStringForRef, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { revisions } from '~/generated/prisma/client';
import type { IOptionsForUpdate } from '~/interfaces/page';
import { RevisionConflictError } from '~/server/models/errors';
import type { PageDocument, PageModel } from '~/server/models/page';
import type { IPageService } from '~/server/service/page/page-service';
import { isRevisionOfPage } from '~/server/util/is-revision-of-page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:service:page-save:update-page-body');

export const HUMAN_SAVE_MAX_ATTEMPTS = 3;

export type UpdatePageBodyHumanOptions = Omit<
  IOptionsForUpdate,
  'expectedRevisionId' | 'proposalMark' | 'origin'
>;

export type UpdatePageBodyInput =
  | {
      readonly mode: 'human';
      readonly page: HydratedDocument<PageDocument>;
      readonly body: string;
      readonly user: IUserHasId;
      readonly clientRevisionId: string | undefined;
      readonly origin: Origin | undefined;
      readonly options: UpdatePageBodyHumanOptions;
    }
  | {
      readonly mode: 'proposal';
      readonly page: HydratedDocument<PageDocument>;
      readonly body: string;
      readonly user: IUserHasId;
      readonly expectedRevisionId: string;
      readonly proposalMark: IRevisionProposalMark;
    };

export type UpdatePageBodyResult =
  | {
      readonly type: 'updated';
      readonly page: HydratedDocument<PageDocument>;
      readonly previousRevision: revisions | null;
    }
  | {
      readonly type: 'conflict';
      readonly latestRevisionId: string | undefined;
    };

type UpdatePageBodyDeps = { readonly pageService: IPageService };

type HumanInput = Extract<UpdatePageBodyInput, { mode: 'human' }>;
type ProposalInput = Extract<UpdatePageBodyInput, { mode: 'proposal' }>;

const revisionIdOf = (
  page: HydratedDocument<PageDocument>,
): string | undefined =>
  page.revision == null ? undefined : getIdStringForRef(page.revision);

const findRevision = async (
  revisionId: string,
  page: HydratedDocument<PageDocument>,
  logMessage: string,
): Promise<revisions | null> => {
  try {
    return await prisma.revisions.findUnique({ where: { id: revisionId } });
  } catch (err) {
    logger.error({ revisionId, pageId: page._id, err }, logMessage);
    return null;
  }
};

// The client's revisionId is preferred for the diff; the page's own revision
// is the fallback (see the page-save-origin-semantics skill).
const findPreviousRevision = async (
  page: HydratedDocument<PageDocument>,
  pageRevisionId: string | undefined,
  clientRevisionId: string | undefined,
): Promise<revisions | null> => {
  if (clientRevisionId != null) {
    const revision = await findRevision(
      clientRevisionId,
      page,
      'Failed to fetch previousRevision by revisionId',
    );
    if (isRevisionOfPage(revision, page._id)) {
      return revision;
    }
  }
  if (pageRevisionId != null) {
    return findRevision(
      pageRevisionId,
      page,
      'Failed to fetch previousRevision by currentPageRevisionId',
    );
  }
  return null;
};

const rereadPage = async (
  page: HydratedDocument<PageDocument>,
  user: IUserHasId,
): Promise<HydratedDocument<PageDocument>> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const reread = await Page.findByIdAndViewer(page._id, user);
  if (reread == null) {
    throw new Error(`Page('${page._id}') is not found or forbidden`);
  }
  return reread;
};

// updatePage saves the tree move (parent, placeholder swap) before the conditional
// revision write, and a retry from the re-read page would skip the rest of that
// move. Such saves keep the unconditional write they always had.
const movesBetweenTreeAndRestricted = (
  page: HydratedDocument<PageDocument>,
  options: UpdatePageBodyHumanOptions,
): boolean =>
  ((options.grant ?? page.grant) === PageGrant.GRANT_RESTRICTED) !==
  (page.grant === PageGrant.GRANT_RESTRICTED);

const updateAsHuman = async (
  deps: UpdatePageBodyDeps,
  input: HumanInput,
): Promise<UpdatePageBodyResult> => {
  const { body, user, clientRevisionId, origin, options } = input;
  let page = input.page;

  for (let attempt = 1; ; attempt++) {
    // Read before isUpdatable, which replaces page.revision with a partial populate.
    const pageRevisionId = revisionIdOf(page);
    // biome-ignore lint/performance/noAwaitInLoops: each retry depends on the previous attempt's outcome
    if (!(await page.isUpdatable(clientRevisionId, origin))) {
      return { type: 'conflict', latestRevisionId: pageRevisionId };
    }

    const previousRevision = await findPreviousRevision(
      page,
      pageRevisionId,
      clientRevisionId,
    );
    const isConditional = !movesBetweenTreeAndRestricted(page, options);

    try {
      const updatedPage = await deps.pageService.updatePage(
        page,
        body,
        previousRevision?.body ?? null,
        user,
        {
          ...options,
          origin,
          expectedRevisionId: isConditional ? pageRevisionId : undefined,
        },
      );
      return { type: 'updated', page: updatedPage, previousRevision };
    } catch (err) {
      if (!isConditional || !(err instanceof RevisionConflictError)) {
        throw err;
      }
      // The lost attempt may already have saved wip/grant on the old document; always continue from a fresh read.
      page = await rereadPage(page, user);
      if (attempt >= HUMAN_SAVE_MAX_ATTEMPTS) {
        logger.warn(
          { pageId: page._id, attempts: attempt },
          'Gave up saving a page after repeated revision conflicts',
        );
        return { type: 'conflict', latestRevisionId: revisionIdOf(page) };
      }
    }
  }
};

const updateAsProposal = async (
  deps: UpdatePageBodyDeps,
  input: ProposalInput,
): Promise<UpdatePageBodyResult> => {
  const { page, body, user, expectedRevisionId, proposalMark } = input;

  const previousRevision = await findRevision(
    expectedRevisionId,
    page,
    'Failed to fetch the expected revision',
  );

  try {
    const updatedPage = await deps.pageService.updatePage(
      page,
      body,
      previousRevision?.body ?? null,
      user,
      { expectedRevisionId, proposalMark },
    );
    return { type: 'updated', page: updatedPage, previousRevision };
  } catch (err) {
    if (!(err instanceof RevisionConflictError)) {
      throw err;
    }
    const Page = mongoose.model<PageDocument, PageModel>('Page');
    const latest = await Page.findById(page._id, { revision: 1 });
    return {
      type: 'conflict',
      latestRevisionId: latest == null ? undefined : revisionIdOf(latest),
    };
  }
};

// Contract and retry policy: design.md "PageSave Core".
export const updatePageBody = (
  deps: UpdatePageBodyDeps,
  input: UpdatePageBodyInput,
): Promise<UpdatePageBodyResult> =>
  input.mode === 'human'
    ? updateAsHuman(deps, input)
    : updateAsProposal(deps, input);
