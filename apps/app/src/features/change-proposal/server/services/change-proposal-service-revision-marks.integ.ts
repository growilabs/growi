import type { IUserHasId } from '@growi/core';
import { getIdStringForRef, PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.164';
const PREFIX = '/cp-service-revision-marks-integ';
const BACKGROUND = { kind: 'background' } as const;
const MAX_REVISION_IDS = 100;

describe('ChangeProposalService.getRevisionMarks', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceMarksRequester',
      subscriber: 'cpServiceMarksViewer',
      other: 'cpServiceMarksOther',
    },
  });
  const { users } = kit;

  const applyAll = async (
    operations: readonly CreateOperationInput[],
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    const stored = await kit.reload(proposal._id);
    expect(stored.operations.every((op) => op.status === 'applied')).toBe(true);
    return stored;
  };

  const resultRevisionOf = (proposal: ChangeProposalDocument): string => {
    const revisionId = proposal.operations[0].resultRevisionId;
    if (revisionId == null) throw new Error('no result revision');
    return revisionId;
  };

  const createPageAs = async (
    owner: IUserHasId,
    label: string,
    grant: PageGrant,
  ) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      owner,
      { grant },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const trashed = await mongoose
      .model('Page')
      .find({ path: new RegExp(`^/trash${PREFIX}/`) });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: trashed.map((p) => p._id.toString()) } },
    });
    await mongoose
      .model('Page')
      .deleteMany({ _id: { $in: trashed.map((p) => p._id) } });
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await kit.tearDown();
  });

  it('names the proposal behind each revision on a page the viewer can see, in the order asked', async () => {
    const first = await kit.createPage('日本語　ページ（一）');
    const second = await kit.createPage('marks-second');
    const proposalA = await applyAll([kit.editInput(first, '本文')]);
    const proposalB = await applyAll([kit.editInput(second)]);
    const revisionA = resultRevisionOf(proposalA);
    const revisionB = resultRevisionOf(proposalB);

    const marks = await service.getRevisionMarks(users.subscriber, [
      revisionB,
      revisionA,
      revisionB,
    ]);

    expect(marks).toEqual([
      { revisionId: revisionB, proposalId: proposalB._id, isRevert: false },
      { revisionId: revisionA, proposalId: proposalA._id, isRevert: false },
    ]);
  });

  it('tells a revision made by a revert apart from one made by the original proposal', async () => {
    const page = await kit.createPage('marks-revert');
    const original = await applyAll([kit.editInput(page)]);
    const reverted = await service.revert(
      original._id,
      users.requester,
      'all-visible',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    if (!reverted.ok || reverted.value.revertProposalId == null) {
      throw new Error('revert failed');
    }
    const revertProposal = await kit.reload(reverted.value.revertProposalId);
    const revertRevision = resultRevisionOf(revertProposal);

    const marks = await service.getRevisionMarks(users.subscriber, [
      resultRevisionOf(original),
      revertRevision,
    ]);

    expect(marks).toEqual([
      {
        revisionId: resultRevisionOf(original),
        proposalId: original._id,
        isRevert: false,
      },
      {
        revisionId: revertRevision,
        proposalId: revertProposal._id,
        isRevert: true,
      },
    ]);
  });

  it('returns no mark for a revision on a page the viewer cannot see or that only people with the link may view', async () => {
    const hidden = await createPageAs(
      users.requester,
      'marks-hidden',
      PageGrant.GRANT_OWNER,
    );
    const restricted = await createPageAs(
      users.requester,
      'marks-restricted',
      PageGrant.GRANT_RESTRICTED,
    );
    const onHidden = await applyAll([kit.editInput(hidden)]);
    const onRestricted = await applyAll([kit.editInput(restricted)]);
    const revisionIds = [
      resultRevisionOf(onHidden),
      resultRevisionOf(onRestricted),
    ];

    const forViewer = await service.getRevisionMarks(
      users.subscriber,
      revisionIds,
    );
    const forRequester = await service.getRevisionMarks(
      users.requester,
      revisionIds,
    );

    expect(forViewer).toEqual([]);
    expect(forRequester.map((mark) => mark.proposalId)).toEqual([
      onHidden._id,
      onRestricted._id,
    ]);
  });

  it('answers unknown, malformed and unmarked revisions the same way as hidden ones: with nothing', async () => {
    const page = await kit.createPage('marks-unmarked');
    if (page.revision == null) throw new Error('page has no revision');

    const marks = await service.getRevisionMarks(users.subscriber, [
      new mongoose.Types.ObjectId().toString(),
      'not-an-id',
      getIdStringForRef(page.revision),
    ]);

    expect(marks).toEqual([]);
  });

  it('looks at no more than the first 100 revision ids', async () => {
    const page = await kit.createPage('marks-limit');
    const proposal = await applyAll([kit.editInput(page)]);
    const filler = Array.from({ length: MAX_REVISION_IDS }, () =>
      new mongoose.Types.ObjectId().toString(),
    );

    const marks = await service.getRevisionMarks(users.subscriber, [
      ...filler,
      resultRevisionOf(proposal),
    ]);

    expect(marks).toEqual([]);
  });
});
