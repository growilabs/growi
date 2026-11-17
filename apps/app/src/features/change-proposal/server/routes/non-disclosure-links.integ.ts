import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import type {
  BasedOn,
  ChangeProposalDocument,
  ChangeProposalView,
  OperationView,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import { createChangeProposalService } from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.185';
const PREFIX = '/cp-non-disclosure-links-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const BACKGROUND = { kind: 'background' } as const;

const leakedOf = (value: unknown, secrets: readonly string[]): string[] => {
  const json = JSON.stringify(value);
  return secrets.filter((secret) => json.includes(secret));
};

const linksOf = (proposal: ChangeProposalView) =>
  Object.fromEntries(
    proposal.operations.map((op: OperationView) => [
      op.key,
      op.linkedProposals ?? [],
    ]),
  );

describe('links between change proposals never disclose what a viewer cannot open', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpNdLinksRequester',
      subscriber: 'cpNdLinksPartial',
      other: 'cpNdLinksOther',
    },
  });
  const { users } = kit;
  let groupId: mongoose.Types.ObjectId;

  let base: ChangeProposalDocument;
  let key: Record<'shared' | 'secret' | 'stale', string>;
  // follow-up of the stale operation, on a page the partial viewer can open
  let followUp: ChangeProposalDocument;
  // reworks of the shared and the secret operation
  let reworkOnSecretPage: ChangeProposalDocument;
  let reworkOnSharedPage: ChangeProposalDocument;
  let pendingRework: ChangeProposalDocument;
  // rework of the secret operation only, on a page the partial viewer can open
  let reworkOfSecretOnly: ChangeProposalDocument;
  let secretPage: HydratedDocument<PageDocument>;

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const sharedPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      {
        grant: PageGrant.GRANT_USER_GROUP,
        grantUserGroupIds: [{ item: groupId, type: GroupType.userGroup }],
      },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const ownerOnlyPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const applyAll = async (
    operations: readonly CreateOperationInput[],
    basedOn?: BasedOn,
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations, { basedOn });
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const rework = (operationKeys: string[]): BasedOn => ({
    proposalId: base._id,
    relation: 'rework',
    operationKeys,
  });

  const getAs = async (
    user: IUserHasId,
    id: string,
  ): Promise<{ status: number; body: { proposal: ChangeProposalView } }> => {
    asUser(user);
    return await request(app).get(`${MOUNT_PATH}/${id}`);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    groupId = (await mongoose.model('UserGroup').create({ name: 'cpNdLinks' }))
      ._id;
    await mongoose.model('UserGroupRelation').insertMany(
      [users.requester, users.subscriber].map((u) => ({
        relatedGroup: groupId,
        relatedUser: u._id,
      })),
    );

    const shared = await sharedPage('shared');
    secretPage = await ownerOnlyPage('秘密　ページ（乙）');
    const stale = await sharedPage('stale');
    base = await applyAll([
      kit.editInput(shared),
      kit.editInput(secretPage),
      {
        type: 'edit',
        pageId: stale._id.toString(),
        baseRevisionId: new Types.ObjectId().toString(),
        body: 'stale body',
      },
    ]);
    expect(base.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
      'stale',
    ]);
    const [sharedKey, secretKey, staleKey] = base.operations.map(
      (op) => op.key,
    );
    key = { shared: sharedKey, secret: secretKey, stale: staleKey };

    followUp = await applyAll([kit.editInput(await kit.findPage(stale._id))], {
      proposalId: base._id,
      relation: 'follow-up',
      operationKeys: [key.stale],
    });
    reworkOnSecretPage = await applyAll(
      [kit.editInput(await kit.findPage(secretPage._id))],
      rework([key.shared, key.secret]),
    );
    reworkOnSharedPage = await applyAll(
      [kit.editInput(await kit.findPage(shared._id))],
      rework([key.shared, key.secret]),
    );
    reworkOfSecretOnly = await applyAll(
      [kit.editInput(await sharedPage('secret-rework-target'))],
      rework([key.secret]),
    );
    pendingRework = await kit.storeProposal(
      [kit.editInput(await kit.findPage(shared._id))],
      { approve: false, basedOn: rework([key.shared]) },
    );

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app = express();
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    app.use(
      MOUNT_PATH,
      createChangeProposalRouter(crowi, {
        service: createChangeProposalService(crowi, {
          applier: kit.newApplier(),
        }),
      }),
    );
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: groupId });
    await mongoose.model('UserGroup').deleteMany({ _id: groupId });
    await kit.tearDown();
  }, 60_000);

  it('gives the requester every link (positive control)', async () => {
    const res = await getAs(users.requester, base._id);

    expect(res.status).toBe(200);
    const links = linksOf(res.body.proposal);
    expect(links[key.shared].map((l) => l.proposalId)).toEqual(
      expect.arrayContaining([
        reworkOnSecretPage._id,
        reworkOnSharedPage._id,
        pendingRework._id,
      ]),
    );
    expect(links[key.secret].map((l) => l.proposalId)).toEqual(
      expect.arrayContaining([reworkOfSecretOnly._id]),
    );
    expect(links[key.stale]).toEqual([
      { proposalId: followUp._id, relation: 'follow-up' },
    ]);
  });

  it('links the partial viewer only to the rework they can open, with no stage, achievement or hidden key', async () => {
    const res = await getAs(users.subscriber, base._id);

    expect(res.status).toBe(200);
    const proposal = res.body.proposal;
    expect(proposal.requesterState).toBeUndefined();
    expect(proposal.status).toBe('applied');
    expect(linksOf(proposal)).toEqual({
      [key.shared]: [
        { proposalId: reworkOnSharedPage._id, relation: 'rework' },
      ],
    });
    expect(
      leakedOf(res.body, [
        reworkOnSecretPage._id,
        pendingRework._id,
        followUp._id,
        reworkOfSecretOnly._id,
        key.secret,
        key.stale,
        secretPage.path,
        secretPage._id.toString(),
      ]),
    ).toEqual([]);
  });

  it('narrows a rework’s base keys to the ones the partial viewer is given', async () => {
    const forPartial = await getAs(users.subscriber, reworkOnSharedPage._id);
    const forRequester = await getAs(users.requester, reworkOnSharedPage._id);

    expect(forPartial.body.proposal.basedOn).toEqual(rework([key.shared]));
    expect(forPartial.body.proposal.requesterState).toBeUndefined();
    expect(leakedOf(forPartial.body, [key.secret, key.stale])).toEqual([]);
    expect(forRequester.body.proposal.basedOn).toEqual(
      rework([key.shared, key.secret]),
    );
  });

  it('omits basedOn when none of the base keys would be given to the viewer', async () => {
    const cases = [
      [followUp, key.stale],
      [reworkOfSecretOnly, key.secret],
    ] as const;

    for (const [proposal, hiddenKey] of cases) {
      // biome-ignore lint/performance/noAwaitInLoops: one viewer request per case
      const forPartial = await getAs(users.subscriber, proposal._id);
      const forRequester = await getAs(users.requester, proposal._id);

      expect(forPartial.status).toBe(200);
      expect(forPartial.body.proposal).not.toHaveProperty('basedOn');
      expect(leakedOf(forPartial.body, [base._id, hiddenKey])).toEqual([]);
      expect(forRequester.body.proposal.basedOn?.operationKeys).toEqual([
        hiddenKey,
      ]);
    }
  });
});
