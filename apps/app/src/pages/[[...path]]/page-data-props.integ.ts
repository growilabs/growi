import type { GetServerSidePropsContext } from 'next';
import type { IUser } from '@growi/core';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import { mockDeep } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

import { getPageDataForInitial } from './page-data-props';

// Wiring-level integration test for Requirement 6.2 / 6.3: getServerSideProps
// must advertise the page's Markdown alternate via the HTTP `Link` response
// header — for normal pages AND for empty (container) pages, whose props take
// an early "not found" return. The header assertion is what guards the
// ordering: moving the header block below the empty-page early return would
// silently drop the header for empty pages.
//
// Approach: real crowi + real Page/Revision models and the real viewer-aware
// finder; only the Next.js GSSP context is mocked (deep proxy), with the
// response header store implemented for real so getHeader/setHeader interplay
// (append-not-overwrite) is observable.

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE_SEGMENT = `mdprops-${WORKER_ID}`;
const BASE = `/${BASE_SEGMENT}`;

type RevisionDoc = {
  pageId: mongoose.Types.ObjectId;
  body: string;
  format: string;
  author: mongoose.Types.ObjectId;
};

type HeaderValue = number | string | string[];

function createMockContext(
  crowi: Crowi,
  user: HydratedDocument<IUser>,
  pathSegments: string[],
): { context: GetServerSidePropsContext; headers: Map<string, HeaderValue> } {
  const headers = new Map<string, HeaderValue>();

  const context = mockDeep<GetServerSidePropsContext>();
  context.query = { path: pathSegments };
  // getPageDataForInitial reads crowi/user/query from the request object.
  Object.assign(context.req, { crowi, user, query: {} });
  // A real header store behind the mocked ServerResponse, so the
  // append-not-overwrite behavior is observable through getHeader/setHeader.
  context.res.setHeader.mockImplementation((name, value) => {
    headers.set(String(name).toLowerCase(), value as HeaderValue);
    return context.res;
  });
  context.res.getHeader.mockImplementation((name) =>
    headers.get(String(name).toLowerCase()),
  );

  return { context, headers };
}

describe('getPageDataForInitial: Markdown alternate Link header (Requirement 6.2, 6.3)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUser>;
  let Revision: Model<RevisionDoc>;

  let testUser: HydratedDocument<IUser>;
  let normalId: string;
  let emptyId: string;

  const seededPaths = [`${BASE}/normal`, `${BASE}/emptydir`];

  beforeAll(async () => {
    crowi = await getInstance();

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');
    Revision = mongoose.model<RevisionDoc>('Revision');

    const name = `mdprops-user-${WORKER_ID}`;
    await User.deleteMany({ username: name });
    testUser = await User.create({
      name,
      username: name,
      email: `${name}@example.com`,
    });

    await Page.deleteMany({ path: { $in: seededPaths } });

    const normal = await Page.create({
      path: `${BASE}/normal`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: 0,
    });
    const revision = await Revision.create({
      pageId: normal._id,
      body: 'NORMAL-PAGE-BODY',
      format: 'markdown',
      author: testUser._id,
    });
    normal.revision = revision._id;
    await normal.save();

    // Empty container page: no revision; GSSP returns its props as "not found"
    // via an early return, but the Link header must be set before that.
    const empty = await Page.create({
      path: `${BASE}/emptydir`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      isEmpty: true,
      descendantCount: 0,
    });

    normalId = String(normal._id);
    emptyId = String(empty._id);
  }, 60_000);

  afterAll(async () => {
    try {
      await Page.deleteMany({ path: { $in: seededPaths } });
    } catch {
      // ignore
    }
    try {
      await User.deleteMany({ _id: testUser?._id });
    } catch {
      // ignore
    }
  }, 30_000);

  it('sets the pageId-form Link header for a normal page', async () => {
    const { context, headers } = createMockContext(crowi, testUser, [
      BASE_SEGMENT,
      'normal',
    ]);

    const result = await getPageDataForInitial(context);

    expect(headers.get('link')).toBe(
      `</${normalId}.md>; rel="alternate"; type="text/markdown"`,
    );
    // sanity: the page itself resolved (this is the normal-page shape)
    expect('props' in result && result.props).toMatchObject({
      isIdenticalPathPage: false,
    });
  });

  it('sets the Link header for an empty (container) page even though its props take the early "not found" return', async () => {
    const { context, headers } = createMockContext(crowi, testUser, [
      BASE_SEGMENT,
      'emptydir',
    ]);

    const result = await getPageDataForInitial(context);

    // The early return yields data:null props...
    expect('props' in result && result.props).toMatchObject({
      pageWithMeta: { data: null },
    });
    // ...but the Link header must already be set (ordering guard, 6.3).
    expect(headers.get('link')).toBe(
      `</${emptyId}.md>; rel="alternate"; type="text/markdown"`,
    );
  });

  it('appends to an existing Link header instead of overwriting it', async () => {
    const { context, headers } = createMockContext(crowi, testUser, [
      BASE_SEGMENT,
      'normal',
    ]);
    headers.set('link', '<https://example.com/other>; rel="preconnect"');

    await getPageDataForInitial(context);

    expect(headers.get('link')).toEqual([
      '<https://example.com/other>; rel="preconnect"',
      `</${normalId}.md>; rel="alternate"; type="text/markdown"`,
    ]);
  });
});
