import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import type { PageDocument } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import type {
  ChangeProposalDocument,
  ChangeProposalSummaryView,
  ChangeProposalView,
} from '../../interfaces';
import { createChangeProposalService } from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.163';
const PREFIX = '/cp-read-routes-integ';
// loginRequired answers 403 (not a /login redirect) only under /_api/...
const MOUNT_PATH = '/_api/v3/change-proposals';
const BACKGROUND = { kind: 'background' } as const;
const JAPANESE_BODY = '日本語の本文　（全角スペース）と絵文字 🎉';

describe('change-proposal read routes', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpReadRoutesRequester',
      subscriber: 'cpReadRoutesViewer',
      other: 'cpReadRoutesOther',
    },
  });
  const { users } = kit;
  const READ_ONLY_USERNAME = 'cpReadRoutesReadOnly';
  let readOnlyUser: HydratedDocument<IUserHasId>;

  let publicPage: HydratedDocument<PageDocument>;
  let applied: ChangeProposalDocument;
  let appliedOlder: ChangeProposalDocument;
  let pending: ChangeProposalDocument;
  let hiddenApplied: ChangeProposalDocument;
  let appliedRevisionId: string;
  let hiddenRevisionId: string;
  let pageReadToken: string;
  let wrongScopeToken: string;

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const applyNow = async (
    proposal: ChangeProposalDocument,
  ): Promise<ChangeProposalDocument> => {
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const resultRevisionOf = (proposal: ChangeProposalDocument): string => {
    const op = proposal.operations[0];
    if (op.status !== 'applied' || op.resultRevisionId == null) {
      throw new Error(`operation of ${proposal._id} was not applied`);
    }
    return op.resultRevisionId;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    readOnlyUser = await mongoose.model<IUserHasId>('User').create({
      name: READ_ONLY_USERNAME,
      username: READ_ONLY_USERNAME,
      email: `${READ_ONLY_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      readOnly: true,
    });

    publicPage = await kit.createPage('日本語ページ');
    appliedOlder = await applyNow(
      await kit.storeProposal([kit.editInput(publicPage, 'older body')]),
    );
    publicPage = await kit.findPage(publicPage._id);
    applied = await applyNow(
      await kit.storeProposal([kit.editInput(publicPage, JAPANESE_BODY)]),
    );
    appliedRevisionId = resultRevisionOf(applied);
    publicPage = await kit.findPage(publicPage._id);
    pending = await kit.storeProposal([kit.editInput(publicPage)], {
      approve: false,
    });

    // Only the requester can view this page.
    const created = await crowi.pageService.create(
      kit.nextPath('private'),
      'private body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    const privatePage = await kit.findPage(created._id);
    hiddenApplied = await applyNow(
      await kit.storeProposal([kit.editInput(privatePage, 'secret body')]),
    );
    hiddenRevisionId = resultRevisionOf(hiddenApplied);

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    pageReadToken = (
      await AccessToken.generateToken(users.subscriber._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;
    wrongScopeToken = (
      await AccessToken.generateToken(users.subscriber._id, oneDayLater, [
        SCOPE.READ.USER_SETTINGS.INFO,
      ])
    ).token;

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

  beforeEach(() => {
    currentUser = undefined;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await AccessToken.deleteAllTokensByUserId(users.subscriber._id);
    await mongoose.model('User').deleteMany({ username: READ_ONLY_USERNAME });
    await kit.tearDown();
  }, 60_000);

  describe('GET /:id', () => {
    it('returns the whole proposal with the requester state to the requester', async () => {
      asUser(users.requester);

      const res = await request(app).get(`${MOUNT_PATH}/${applied._id}`);

      expect(res.status).toBe(200);
      const proposal: ChangeProposalView = res.body.proposal;
      expect(proposal.id).toBe(applied._id);
      expect(proposal.isRequester).toBe(true);
      expect(proposal.requesterState?.lifecycle).toBe('settled');
      expect(proposal.operations).toHaveLength(1);
      expect(proposal.operations[0]).toMatchObject({
        status: 'applied',
        proposedBody: JAPANESE_BODY,
        page: { id: publicPage._id.toString(), path: publicPage.path },
      });
      expect(publicPage.path).toContain('日本語ページ');
    });

    it('returns only what another viewer may see, without the requester state', async () => {
      asUser(users.subscriber);

      const res = await request(app).get(`${MOUNT_PATH}/${applied._id}`);

      expect(res.status).toBe(200);
      const proposal: ChangeProposalView = res.body.proposal;
      expect(proposal.isRequester).toBe(false);
      expect(proposal.requesterState).toBeUndefined();
      expect(proposal.operations[0].index).toBeUndefined();
      expect(proposal.operations[0].proposedBody).toBeUndefined();
    });

    it('lets a read-only user read', async () => {
      asUser(readOnlyUser);

      const res = await request(app).get(`${MOUNT_PATH}/${applied._id}`);

      expect(res.status).toBe(200);
      expect(res.body.proposal.id).toBe(applied._id);
    });

    it('accepts a Bearer access token with the page-read scope', async () => {
      const res = await request(app)
        .get(`${MOUNT_PATH}/${applied._id}`)
        .set('Authorization', `Bearer ${pageReadToken}`);

      expect(res.status).toBe(200);
      expect(res.body.proposal.id).toBe(applied._id);
    });

    it('answers a missing, malformed and invisible proposal with one identical 404', async () => {
      asUser(users.subscriber);
      const ids = [
        new Types.ObjectId().toString(),
        'not-an-object-id',
        pending._id,
        hiddenApplied._id,
      ];

      const responses = await Promise.all(
        ids.map((id) => request(app).get(`${MOUNT_PATH}/${id}`)),
      );

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
      expect(responses[0].body.errors[0].code).toBe('notfound');
    });

    it('rejects an anonymous caller and a token without the page-read scope', async () => {
      const anonymous = await request(app).get(`${MOUNT_PATH}/${applied._id}`);
      const wrongScope = await request(app)
        .get(`${MOUNT_PATH}/${applied._id}`)
        .set('Authorization', `Bearer ${wrongScopeToken}`);

      expect(anonymous.status).toBe(403);
      expect(wrongScope.status).toBe(403);
      expect(wrongScope.body.proposal).toBeUndefined();
    });
  });

  describe('GET /mine', () => {
    it('pages through the caller’s own proposals, newest first', async () => {
      asUser(users.requester);

      const first = await request(app)
        .get(`${MOUNT_PATH}/mine`)
        .query({ page: 1, limit: 2 });
      const second = await request(app)
        .get(`${MOUNT_PATH}/mine`)
        .query({ page: 2, limit: 2 });

      expect(first.status).toBe(200);
      expect(
        first.body.items.map((item: ChangeProposalSummaryView) => item.id),
      ).toEqual([hiddenApplied._id, pending._id]);
      expect(first.body.hasNext).toBe(true);
      expect(
        second.body.items.map((item: ChangeProposalSummaryView) => item.id),
      ).toEqual([applied._id, appliedOlder._id]);
      expect(second.body.hasNext).toBe(false);
    });

    it('uses the defaults when page and limit are omitted', async () => {
      asUser(users.requester);

      const res = await request(app).get(`${MOUNT_PATH}/mine`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(4);
      expect(res.body.hasNext).toBe(false);
    });

    it('never lists someone else’s proposals', async () => {
      asUser(users.subscriber);

      const res = await request(app).get(`${MOUNT_PATH}/mine`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], hasNext: false });
    });

    it.each([
      ['limit 0', { limit: 0 }],
      ['limit above 50', { limit: 51 }],
      ['non-numeric limit', { limit: 'abc' }],
      ['page 0', { page: 0 }],
      ['negative page', { page: -1 }],
      ['fractional page', { page: 1.5 }],
      ['page beyond the cap', { page: 10001 }],
      ['array page', { 'page[]': 1 }],
    ])('rejects %s with 400', async (_label, query) => {
      asUser(users.requester);

      const res = await request(app).get(`${MOUNT_PATH}/mine`).query(query);

      expect(res.status).toBe(400);
      expect(res.body.items).toBeUndefined();
    });

    it('rejects an anonymous caller', async () => {
      const res = await request(app).get(`${MOUNT_PATH}/mine`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /applied', () => {
    const listApplied = (query: Record<string, unknown>) =>
      request(app).get(`${MOUNT_PATH}/applied`).query(query);

    it('lists applied proposals the viewer may see, without the hidden one or a requester state', async () => {
      asUser(users.subscriber);

      const res = await listApplied({ limit: 50 });

      expect(res.status).toBe(200);
      const items: ChangeProposalSummaryView[] = res.body.items;
      const ids = items.map((item) => item.id);
      expect(ids).toEqual(
        expect.arrayContaining([applied._id, appliedOlder._id]),
      );
      expect(ids).not.toContain(hiddenApplied._id);
      expect(ids).not.toContain(pending._id);
      const mine = items.find((item) => item.id === applied._id);
      expect(mine?.requesterState).toBeUndefined();
      expect(mine?.pages).toEqual([
        { id: publicPage._id.toString(), path: publicPage.path },
      ]);
      expect(res.body).not.toHaveProperty('total');
    });

    it('continues from the returned cursor without repeating items', async () => {
      asUser(users.subscriber);

      const first = await listApplied({ limit: 1 });
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(1);
      expect(typeof first.body.nextCursor).toBe('string');

      const second = await listApplied({
        limit: 1,
        cursor: first.body.nextCursor,
      });

      expect(second.status).toBe(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
      expect([first.body.items[0].id, second.body.items[0].id]).toEqual([
        applied._id,
        appliedOlder._id,
      ]);
    });

    it.each([
      ['a malformed cursor', { cursor: 'not-a-cursor' }],
      ['a cursor with a bad id', { cursor: `1700000000000-${'z'.repeat(24)}` }],
      [
        'a cursor with too many digits',
        { cursor: `${'9'.repeat(16)}-${'a'.repeat(24)}` },
      ],
      ['an array cursor', { 'cursor[]': 'x' }],
      ['limit above 50', { limit: 51 }],
      ['limit 0', { limit: 0 }],
    ])('rejects %s with 400', async (_label, query) => {
      asUser(users.subscriber);

      const res = await listApplied(query);

      expect(res.status).toBe(400);
      expect(res.body.items).toBeUndefined();
    });

    it('rejects an anonymous caller', async () => {
      const res = await listApplied({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /revision-marks', () => {
    const postMarks = (body: object) =>
      request(app).post(`${MOUNT_PATH}/revision-marks`).send(body);

    it('returns marks only for revisions whose operation the viewer may see', async () => {
      asUser(users.subscriber);

      const res = await postMarks({
        revisionIds: [appliedRevisionId, hiddenRevisionId],
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        marks: [
          {
            revisionId: appliedRevisionId,
            proposalId: applied._id,
            isRevert: false,
          },
        ],
      });
    });

    it('returns the hidden page’s mark to the requester who can view it', async () => {
      asUser(users.requester);

      const res = await postMarks({ revisionIds: [hiddenRevisionId] });

      expect(res.status).toBe(200);
      expect(res.body.marks).toEqual([
        {
          revisionId: hiddenRevisionId,
          proposalId: hiddenApplied._id,
          isRevert: false,
        },
      ]);
    });

    it('answers an empty list with no marks', async () => {
      asUser(users.subscriber);

      const res = await postMarks({ revisionIds: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ marks: [] });
    });

    it('accepts exactly 100 ids', async () => {
      asUser(users.subscriber);
      const ids = Array.from({ length: 100 }, () =>
        new Types.ObjectId().toString(),
      );

      const res = await postMarks({ revisionIds: ids });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ marks: [] });
    });

    it.each([
      [
        'more than 100 ids',
        {
          revisionIds: Array.from({ length: 101 }, () =>
            new Types.ObjectId().toString(),
          ),
        },
      ],
      ['a missing list', {}],
      ['a non-array list', { revisionIds: '6512f0c0a1b2c3d4e5f60718' }],
      ['a non-string id', { revisionIds: [123] }],
      ['a malformed id', { revisionIds: ['not-an-object-id'] }],
      ['an object id', { revisionIds: [{ $ne: null }] }],
    ])('rejects %s with 400', async (_label, body) => {
      asUser(users.subscriber);

      const res = await postMarks(body);

      expect(res.status).toBe(400);
      expect(res.body.marks).toBeUndefined();
    });

    it('rejects an anonymous caller', async () => {
      const res = await postMarks({ revisionIds: [appliedRevisionId] });
      expect(res.status).toBe(403);
    });
  });

  describe('registration', () => {
    it('does not serve writes on the read paths', async () => {
      asUser(users.requester);

      const responses = await Promise.all([
        request(app).post(`${MOUNT_PATH}/mine`).send({}),
        request(app).delete(`${MOUNT_PATH}/${applied._id}`),
        request(app).get(`${MOUNT_PATH}/revision-marks`),
      ]);

      // GET /revision-marks falls through to /:id and is answered as unknown.
      expect(responses.map((res) => res.status)).toEqual([404, 404, 404]);
    });

    it('is mounted at /change-proposals in the production apiv3 router', () => {
      const source = readFileSync(
        path.resolve(
          import.meta.dirname,
          '../../../../server/routes/apiv3/index.js',
        ),
        'utf8',
      );
      expect(source).toContain(
        "router.use('/change-proposals', createChangeProposalRouter(crowi))",
      );
    });
  });
});
