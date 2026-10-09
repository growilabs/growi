import { GroupType, PageGrant } from '@growi/core';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import pageModelFactory from '~/server/models/page';
import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';

import {
  filterPagesForViewer,
  OVER_FETCH_FACTOR,
  overFetchCount,
  type ViewerFilterActor,
} from './viewer-page-filter';

// biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
const getUserModel = (): any => mongoose.model('User');
// biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
const getPageModel = (): any => mongoose.model('Page');

let seq = 0;

const createUser = () => {
  seq += 1;
  return getUserModel().create({
    name: `user ${seq}`,
    username: `user-${seq}`,
    email: `user-${seq}@example.com`,
    status: UserStatus.STATUS_ACTIVE,
  });
};

type PageAttrs = {
  path?: string;
  grant: number;
  grantedUsers?: mongoose.Types.ObjectId[];
  grantedGroups?: { type: string; item: mongoose.Types.ObjectId }[];
};

const createPage = (attrs: PageAttrs) => {
  seq += 1;
  return getPageModel().create({
    path: attrs.path ?? `/page-${seq}`,
    grant: attrs.grant,
    grantedUsers: attrs.grantedUsers ?? [],
    grantedGroups: attrs.grantedGroups ?? [],
  });
};

const anonymousActor: ViewerFilterActor = { user: null, userGroups: [] };

/**
 * The observable contract under test: given one candidate hit, does the page
 * survive the filter for this actor?
 */
const survives = async (
  // biome-ignore lint/suspicious/noExplicitAny: untyped Page document.
  page: any,
  actor: ViewerFilterActor,
): Promise<boolean> => {
  const kept = await filterPagesForViewer(
    [{ pageId: page._id.toString(), path: page.path }],
    actor,
    10,
  );
  return kept.length === 1;
};

describe('viewer-page-filter', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_viewer_page_filter',
    ));
    // Both models are normally registered at boot by crowi. Nothing this
    // spec calls reaches the crowi instance.
    userModelFactory(null);
    pageModelFactory(null);
  });

  beforeEach(async () => {
    await Promise.all([
      getPageModel().deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('the five grant types, for a linked actor and an unlinked one', () => {
    it('keeps a GRANT_PUBLIC page for a linked actor and for an unlinked one', async () => {
      const viewer = await createUser();
      const page = await createPage({ grant: PageGrant.GRANT_PUBLIC });

      expect(await survives(page, { user: viewer, userGroups: [] })).toBe(true);
      expect(await survives(page, anonymousActor)).toBe(true);
    });

    it('keeps a GRANT_OWNER page only for its owner', async () => {
      const owner = await createUser();
      const other = await createUser();
      const page = await createPage({
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [owner._id],
      });

      expect(await survives(page, { user: owner, userGroups: [] })).toBe(true);
      expect(await survives(page, { user: other, userGroups: [] })).toBe(false);
      expect(await survives(page, anonymousActor)).toBe(false);
    });

    // The bug in `SearchService.canShowSnippet` this must not reproduce:
    // GRANT_SPECIFIED matches none of its branches and falls through to
    // `return true`, so a page restricted to named users passes for anyone.
    it('drops a GRANT_SPECIFIED page for a linked actor who is not among the granted users', async () => {
      const granted = await createUser();
      const other = await createUser();
      const page = await createPage({
        grant: PageGrant.GRANT_SPECIFIED,
        grantedUsers: [granted._id],
      });

      expect(await survives(page, { user: other, userGroups: [] })).toBe(false);
      expect(await survives(page, anonymousActor)).toBe(false);
      expect(await survives(page, { user: granted, userGroups: [] })).toBe(
        true,
      );
    });

    // The same function's bug in the opposite direction: it compares
    // `grantedGroups` -- whose elements are `{ type, item }` -- against plain
    // id strings, so it never matches and drops a genuine member.
    it('keeps a GRANT_USER_GROUP page for a member of the granted group', async () => {
      const member = await createUser();
      const groupId = new mongoose.Types.ObjectId();
      const page = await createPage({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ type: GroupType.userGroup, item: groupId }],
      });

      expect(
        await survives(page, { user: member, userGroups: [groupId] }),
      ).toBe(true);
    });

    // `resolveActor` merges both group sources, and `generateGrantCondition`
    // matches on `item` while ignoring `type`, so an externally-synced group
    // works the same way. Pinned rather than assumed: "correct by
    // construction" is exactly the reasoning under which `canShowSnippet`'s
    // group comparison stayed broken without anyone noticing.
    it('keeps a GRANT_USER_GROUP page for a member of a granted external user group', async () => {
      const member = await createUser();
      const groupId = new mongoose.Types.ObjectId();
      const page = await createPage({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ type: GroupType.externalUserGroup, item: groupId }],
      });

      expect(
        await survives(page, { user: member, userGroups: [groupId] }),
      ).toBe(true);
    });

    it('drops a GRANT_USER_GROUP page for a linked actor in no granted group, and for an unlinked one', async () => {
      const nonMember = await createUser();
      const groupId = new mongoose.Types.ObjectId();
      const otherGroupId = new mongoose.Types.ObjectId();
      const page = await createPage({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ type: GroupType.userGroup, item: groupId }],
      });

      expect(
        await survives(page, {
          user: nonMember,
          userGroups: [otherGroupId],
        }),
      ).toBe(false);
      expect(await survives(page, anonymousActor)).toBe(false);
    });

    // Guards the two-argument call: `generateGrantCondition`'s third
    // parameter (`includeAnyoneWithTheLink`) defaults to false, and
    // `Page.isAccessiblePageByViewer` passes true. Passing three arguments by
    // copying that reference implementation would put link-only pages into a
    // channel, and this assertion is what catches it.
    it('drops a GRANT_RESTRICTED (link-only) page for every actor', async () => {
      const viewer = await createUser();
      const page = await createPage({ grant: PageGrant.GRANT_RESTRICTED });

      expect(await survives(page, { user: viewer, userGroups: [] })).toBe(
        false,
      );
      expect(await survives(page, anonymousActor)).toBe(false);
    });
  });

  describe('count, order and rank', () => {
    it('exposes the over-fetch size the caller must request', () => {
      expect(OVER_FETCH_FACTOR).toBe(3);
      expect(overFetchCount(5)).toBe(15);
    });

    it('truncates to the requested count after dropping, and numbers the survivors from 1 with no gaps', async () => {
      const viewer = await createUser();
      const otherUser = await createUser();

      // 9 candidates (= 3 x limit) in relevance order; every other one is
      // owned by someone else. Only 5 survive, so taking the first 3 of the
      // raw hits would have yielded 2.
      const pages = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
          createPage({
            path: `/hit-${i}`,
            grant: i % 2 === 0 ? PageGrant.GRANT_PUBLIC : PageGrant.GRANT_OWNER,
            grantedUsers: i % 2 === 0 ? [] : [otherUser._id],
          }),
        ),
      );

      const kept = await filterPagesForViewer(
        pages.map((p) => ({ pageId: p._id.toString(), path: p.path })),
        { user: viewer, userGroups: [] },
        3,
      );

      expect(kept.map((k) => k.path)).toEqual(['/hit-0', '/hit-2', '/hit-4']);
      expect(kept.map((k) => k.rank)).toEqual([1, 2, 3]);
    });

    it('returns fewer than the requested count when not enough candidates survive', async () => {
      const viewer = await createUser();
      const otherUser = await createUser();
      const visible = await createPage({
        path: '/visible',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const hidden = await createPage({
        path: '/hidden',
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [otherUser._id],
      });

      const kept = await filterPagesForViewer(
        [visible, hidden].map((p) => ({
          pageId: p._id.toString(),
          path: p.path,
        })),
        { user: viewer, userGroups: [] },
        5,
      );

      expect(kept.map((k) => ({ path: k.path, rank: k.rank }))).toEqual([
        { path: '/visible', rank: 1 },
      ]);
    });

    it('keeps the relevance order it was given', async () => {
      const viewer = await createUser();
      const pages = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createPage({ path: `/o-${i}`, grant: PageGrant.GRANT_PUBLIC }),
        ),
      );
      // Deliberately not the insertion order: `$in` gives no order guarantee,
      // so an implementation that ranked the query results instead of the
      // candidates would scramble this.
      const shuffled = [pages[3], pages[0], pages[4], pages[1], pages[2]];

      const kept = await filterPagesForViewer(
        shuffled.map((p) => ({ pageId: p._id.toString(), path: p.path })),
        { user: viewer, userGroups: [] },
        5,
      );

      expect(kept.map((k) => k.path)).toEqual([
        '/o-3',
        '/o-0',
        '/o-4',
        '/o-1',
        '/o-2',
      ]);
    });

    it('returns nothing for an empty candidate list', async () => {
      expect(await filterPagesForViewer([], anonymousActor, 5)).toEqual([]);
    });
  });

  describe('the grant decision comes from the stored page, not from the candidate', () => {
    // The search index does not carry grant / grantedUsers / grantedGroups at
    // all, so an implementation that judged the candidate object would answer
    // from whatever the caller happened to attach. Here the candidate claims
    // to be public while the stored page belongs to someone else.
    it('drops a candidate that claims to be public when the stored page is owned by another user', async () => {
      const viewer = await createUser();
      const owner = await createUser();
      const page = await createPage({
        path: '/looks-public',
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [owner._id],
      });

      const kept = await filterPagesForViewer(
        [
          {
            pageId: page._id.toString(),
            path: page.path,
            grant: PageGrant.GRANT_PUBLIC,
            grantedUsers: [viewer._id],
          },
        ],
        { user: viewer, userGroups: [] },
        5,
      );

      expect(kept).toEqual([]);
    });

    it('drops a candidate whose page no longer exists', async () => {
      const viewer = await createUser();

      const kept = await filterPagesForViewer(
        [{ pageId: new mongoose.Types.ObjectId().toString(), path: '/gone' }],
        { user: viewer, userGroups: [] },
        5,
      );

      expect(kept).toEqual([]);
    });
  });
});
