import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import express from 'express';
import type { HydratedDocument } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import { setup as setupPageRouter } from '~/server/routes/apiv3/page';
import { setup as setupPagesRouter } from '~/server/routes/apiv3/pages';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { setup as setupRevisionsRouter } from '~/server/routes/apiv3/revisions';

import type { ChangeProposalDocument } from '../../interfaces';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';

const TEST_IP = '10.0.0.186';
const PREFIX = '/cp-non-disclosure-revision-apis-integ';
const BACKGROUND = { kind: 'background' } as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MARK_FIELDS = ['proposalId', 'proposalOperationKey'];

type MarkedRevision = {
  readonly _id: string;
  readonly proposalId?: string | null;
  readonly proposalOperationKey?: string | null;
};

const keysDeep = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value == null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]);
};

// Any field naming a proposal beyond the two mark fields, or any order number.
const extraMarkFieldsOf = (body: unknown): string[] => [
  ...new Set(
    keysDeep(body).filter(
      (k) =>
        (/proposal/i.test(k) && !MARK_FIELDS.includes(k)) || /index/i.test(k),
    ),
  ),
];

describe('existing revision APIs carry only the key-based proposal mark', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpNdRevApisRequester',
      subscriber: 'cpNdRevApisViewer',
      other: 'cpNdRevApisOther',
    },
  });
  const { users } = kit;
  let pages: HydratedDocument<PageDocument>[];
  let humanRevisionIds: string[];
  let proposal: ChangeProposalDocument;

  const resultRevisionOf = (index: number): string => {
    const id = proposal.operations[index].resultRevisionId;
    if (id == null) throw new Error(`operation ${index} was not applied`);
    return id;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    pages = [
      await kit.createPage('日本語　ページ（甲）'),
      await kit.createPage('page-b'),
      await kit.createPage('page-c'),
    ];
    humanRevisionIds = pages.map((p) => getIdStringForRef(p.revision ?? ''));
    const stored = await kit.storeProposal(
      pages.map((page, i) => kit.editInput(page, `提案した本文 ${i}`)),
    );
    await kit.newApplier().apply(stored._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    proposal = await kit.reload(stored._id);
    expect(proposal.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);

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
    app.use('/_api/v3/revisions', setupRevisionsRouter(crowi));
    app.use('/_api/v3/pages', setupPagesRouter(crowi));
    app.use('/_api/v3/page', setupPageRouter(crowi));
  }, 120_000);

  beforeEach(() => {
    // A viewer other than the requester, who can see these public pages.
    currentUser = users.subscriber;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await kit.tearDown();
  }, 60_000);

  it('marks every operation with a random UUID key, never its order', () => {
    const keys = proposal.operations.map((op) => op.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(UUID_PATTERN);
    }
  });

  it('/revisions/list returns the mark on the proposal’s revision and nothing on a human one', async () => {
    const res = await request(app)
      .get('/_api/v3/revisions/list')
      .query({ pageId: pages[0]._id.toString() });

    expect(res.status).toBe(200);
    const revisions: MarkedRevision[] = res.body.revisions;
    const marked = revisions.find((r) => r._id === resultRevisionOf(0));
    const human = revisions.find((r) => r._id === humanRevisionIds[0]);
    expect(marked).toMatchObject({
      proposalId: proposal._id,
      proposalOperationKey: proposal.operations[0].key,
    });
    expect(human).toBeDefined();
    // Prisma reads an unset field as null.
    expect(human?.proposalId ?? null).toBeNull();
    expect(human?.proposalOperationKey ?? null).toBeNull();
    expect(extraMarkFieldsOf(res.body)).toEqual([]);
  });

  it('GET /page loads the revision with only the two mark fields, and the page itself has none', async () => {
    const res = await request(app)
      .get('/_api/v3/page')
      .query({ pageId: pages[1]._id.toString() });

    expect(res.status).toBe(200);
    const { page } = res.body;
    expect(page.revision).toMatchObject({
      _id: resultRevisionOf(1),
      proposalId: proposal._id,
      proposalOperationKey: proposal.operations[1].key,
    });
    expect(Object.keys(page).filter((k) => MARK_FIELDS.includes(k))).toEqual(
      [],
    );
    expect(extraMarkFieldsOf(res.body)).toEqual([]);
  });

  it('/pages/recent lists the pages with no proposal fields beyond the mark', async () => {
    const res = await request(app)
      .get('/_api/v3/pages/recent')
      .query({ limit: 100 });

    expect(res.status).toBe(200);
    const listed = res.body.pages.filter((p: { _id: string }) =>
      pages.some((page) => page._id.toString() === p._id),
    );
    expect(listed).toHaveLength(pages.length);
    for (const entry of listed) {
      // The listing leaves the revision unpopulated: only its id is returned.
      expect(entry.revision).toEqual(expect.any(String));
    }
    expect(extraMarkFieldsOf(res.body)).toEqual([]);
  });
});
