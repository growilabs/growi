import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type {
  BasedOn,
  ChangeProposalDocument,
  ChangeProposalView,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.162';
const PREFIX = '/cp-service-get-links-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.getForViewer: links between proposals', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceGetLinksRequester',
      subscriber: 'cpServiceGetLinksViewer',
      other: 'cpServiceGetLinksOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const viewOf = (result: ServiceResult<ChangeProposalView>) => {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const linksByKey = (view: ChangeProposalView) =>
    Object.fromEntries(
      view.operations.map((op) => [op.key, op.linkedProposals ?? []]),
    );

  const applyAll = async (
    operations: readonly CreateOperationInput[],
    basedOn?: BasedOn,
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations, { basedOn });
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  // A base proposal with one applied operation on a shared page, one applied on a
  // page only the requester may view, and one failed create (no page at all).
  const createBase = async (label: string) => {
    const shared = await kit.createPage(`${label}-shared`);
    const hiddenPage = await crowi.pageService.create(
      kit.nextPath(`${label}-hidden`),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    const hidden = await kit.findPage(hiddenPage._id);
    const base = await applyAll([
      kit.editInput(shared),
      kit.editInput(hidden),
      { type: 'create', path: shared.path, body: 'occupied' },
    ]);
    expect(base.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
      'failed',
    ]);
    const [sharedKey, hiddenKey, failedKey] = base.operations.map(
      (op) => op.key,
    );
    return { base, sharedKey, hiddenKey, failedKey };
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
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await Page().deleteMany({ path: new RegExp(`^/trash${PREFIX}/`) });
    await kit.tearDown();
  });

  it('gives the requester every link, and another viewer only links to proposals they can open on operations they see', async () => {
    const { base, sharedKey, hiddenKey, failedKey } = await createBase('links');
    const followUpPage = await kit.createPage('links-follow-up');
    const reworkPage = await kit.createPage('links-rework');
    const followUp = await applyAll([kit.editInput(followUpPage)], {
      proposalId: base._id,
      relation: 'follow-up',
      operationKeys: [failedKey],
    });
    const pendingRework = await kit.storeProposal([kit.editInput(reworkPage)], {
      approve: false,
      basedOn: {
        proposalId: base._id,
        relation: 'rework',
        operationKeys: [sharedKey],
      },
    });
    const appliedRework = await applyAll(
      [kit.editInput(await kit.findPage(reworkPage._id))],
      {
        proposalId: base._id,
        relation: 'rework',
        operationKeys: [sharedKey, hiddenKey],
      },
    );

    const forRequester = viewOf(
      await service.getForViewer(base._id, users.requester),
    );
    const forViewer = viewOf(
      await service.getForViewer(base._id, users.subscriber),
    );

    expect(linksByKey(forRequester)).toEqual({
      [sharedKey]: [
        { proposalId: appliedRework._id, relation: 'rework' },
        { proposalId: pendingRework._id, relation: 'rework' },
      ],
      [hiddenKey]: [{ proposalId: appliedRework._id, relation: 'rework' }],
      [failedKey]: [{ proposalId: followUp._id, relation: 'follow-up' }],
    });
    expect(linksByKey(forViewer)).toEqual({
      [sharedKey]: [{ proposalId: appliedRework._id, relation: 'rework' }],
    });
  });

  it('narrows the link back to the base to the base operations the viewer sees', async () => {
    const { base, sharedKey, hiddenKey } = await createBase('narrow');
    const page = await kit.createPage('narrow-rework');
    const rework = await applyAll([kit.editInput(page)], {
      proposalId: base._id,
      relation: 'rework',
      operationKeys: [sharedKey, hiddenKey],
    });

    const forRequester = viewOf(
      await service.getForViewer(rework._id, users.requester),
    );
    const forViewer = viewOf(
      await service.getForViewer(rework._id, users.subscriber),
    );

    expect(forRequester.basedOn).toEqual({
      proposalId: base._id,
      relation: 'rework',
      operationKeys: [sharedKey, hiddenKey],
    });
    expect(forViewer.basedOn).toEqual({
      proposalId: base._id,
      relation: 'rework',
      operationKeys: [sharedKey],
    });
  });

  it('leaves out the link back to the base when none of its operations are returned to the viewer', async () => {
    const { base, failedKey, hiddenKey } = await createBase('omit');
    const followUpPage = await kit.createPage('omit-follow-up');
    const reworkPage = await kit.createPage('omit-rework');
    const followUp = await applyAll([kit.editInput(followUpPage)], {
      proposalId: base._id,
      relation: 'follow-up',
      operationKeys: [failedKey],
    });
    const rework = await applyAll([kit.editInput(reworkPage)], {
      proposalId: base._id,
      relation: 'rework',
      operationKeys: [hiddenKey],
    });

    const followUpView = viewOf(
      await service.getForViewer(followUp._id, users.subscriber),
    );
    const reworkView = viewOf(
      await service.getForViewer(rework._id, users.subscriber),
    );

    expect(followUpView).not.toHaveProperty('basedOn');
    expect(reworkView).not.toHaveProperty('basedOn');
    expect(JSON.stringify([followUpView, reworkView])).not.toContain(base._id);
  });

  it('leaves out the link back to a base the viewer cannot open at all', async () => {
    const hiddenPage = await crowi.pageService.create(
      kit.nextPath('closed-hidden'),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    const base = await applyAll([
      kit.editInput(await kit.findPage(hiddenPage._id)),
    ]);
    const page = await kit.createPage('closed-rework');
    const rework = await applyAll([kit.editInput(page)], {
      proposalId: base._id,
      relation: 'rework',
      operationKeys: [base.operations[0].key],
    });

    const view = viewOf(
      await service.getForViewer(rework._id, users.subscriber),
    );

    expect(view).not.toHaveProperty('basedOn');
  });

  it('checks the visibility of every page involved, including linked and base proposals, in one query', async () => {
    const { base, sharedKey } = await createBase('queries');
    const pages = await Promise.all(
      ['a', 'b', 'c'].map((label) => kit.createPage(`queries-${label}`)),
    );
    const middle = await applyAll(
      pages.slice(0, 2).map((p) => kit.editInput(p)),
      { proposalId: base._id, relation: 'rework', operationKeys: [sharedKey] },
    );
    await applyAll([kit.editInput(pages[2])], {
      proposalId: middle._id,
      relation: 'rework',
      operationKeys: middle.operations.map((op) => op.key),
    });
    const findByIdsAndViewer = vi.spyOn(Page(), 'findByIdsAndViewer');

    const view = viewOf(
      await service.getForViewer(middle._id, users.subscriber),
    );

    expect(view.basedOn?.proposalId).toBe(base._id);
    expect(
      view.operations.every((op) => op.linkedProposals?.length === 1),
    ).toBe(true);
    expect(findByIdsAndViewer).toHaveBeenCalledTimes(1);
  });
});
