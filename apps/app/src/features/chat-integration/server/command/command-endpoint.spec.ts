// Task 5.1's completion condition, proved directly: search / link-preview /
// help all answer without throwing, channel permission is judged before any
// actor resolution or search, a closed GROWI's read-denial short-circuits
// before the search runs, and a repeated `(relationId, requestId)` replays
// the stored response instead of recomputing it.

import type { ChannelRef, ChatAccountRef, CommandRequest } from '@growi/chat';
import { GroupType, PageGrant } from '@growi/core';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import '~/server/models/revision';

import pageModelFactory from '~/server/models/page';
import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatAccountLinkOrder } from '../account-link/models/chat-account-link-order';
import { buildHelpContent } from '../content';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import { createCommandEndpoint, resolvePageFromUrl } from './command-endpoint';
import * as resolveActorModule from './resolve-actor';

vi.mock('./resolve-actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolve-actor')>();
  return {
    ...actual,
    resolveActor: vi.fn(actual.resolveActor),
    resolveReadDenial: vi.fn(actual.resolveReadDenial),
  };
});

const RELATION_ID = 'relation-1';
const ACTOR: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U0ACCOUNT',
  displayName: 'Chatty Person',
};
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: 'C0GENERAL',
  channelName: 'general',
  isPrivate: false,
};

// biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
const getUserModel = (): any => mongoose.model('User');
// biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
const getPageModel = (): any => mongoose.model('Page');
const getRevisionModel = () => mongoose.model('Revision');

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

const linkActorTo = (userId: mongoose.Types.ObjectId) =>
  ChatAccountLink.create({
    relationId: RELATION_ID,
    userId,
    platform: ACTOR.platform,
    accountId: ACTOR.accountId,
    linkedAt: new Date(),
  });

const createPageWithRevision = async (attrs: {
  path: string;
  grant: number;
  body?: string;
  commentCount?: number;
  updatedAt?: Date;
  grantedUsers?: mongoose.Types.ObjectId[];
  grantedGroups?: { type: string; item: mongoose.Types.ObjectId }[];
}) => {
  const revision = await getRevisionModel().create({
    pageId: new mongoose.Types.ObjectId(),
    body: attrs.body ?? 'page body',
    format: 'markdown',
  });
  return getPageModel().create({
    path: attrs.path,
    grant: attrs.grant,
    revision: revision._id,
    commentCount: attrs.commentCount ?? 0,
    updatedAt: attrs.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
    grantedUsers: attrs.grantedUsers ?? [],
    grantedGroups: attrs.grantedGroups ?? [],
  });
};

const searchRequest = (
  overrides: Partial<CommandRequest> = {},
): CommandRequest =>
  ({
    relationId: RELATION_ID,
    op: 'command',
    requestId: 'req-search-0001',
    actor: ACTOR,
    channel: CHANNEL,
    kind: 'search',
    keyword: 'anything',
    limit: 10,
    ...overrides,
  }) as CommandRequest;

const linkPreviewRequest = (
  overrides: Partial<CommandRequest> = {},
): CommandRequest =>
  ({
    relationId: RELATION_ID,
    op: 'command',
    requestId: 'req-link-0001',
    actor: ACTOR,
    channel: CHANNEL,
    kind: 'link-preview',
    pageUrl: 'https://growi.example.test/page-a',
    ...overrides,
  }) as CommandRequest;

const helpRequest = (overrides: Partial<CommandRequest> = {}): CommandRequest =>
  ({
    relationId: RELATION_ID,
    op: 'command',
    requestId: 'req-help-0001',
    actor: ACTOR,
    channel: CHANNEL,
    kind: 'help',
    ...overrides,
  }) as CommandRequest;

const buildCrowi = (
  overrides: { isGuestAllowedToRead?: boolean; appTitle?: string } = {},
): Crowi =>
  mock<Crowi>({
    aclService: {
      isGuestAllowedToRead: vi.fn(() => overrides.isGuestAllowedToRead ?? true),
    },
    appService: {
      getAppTitle: vi.fn(() => overrides.appTitle ?? 'Test GROWI'),
    },
    searchService: {
      isReachable: true,
      searchKeyword: vi.fn(),
      formatSearchResult: vi.fn(),
    },
  });

describe('createCommandEndpoint (task 5.1)', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_command_endpoint',
    ));
    userModelFactory(null);
    pageModelFactory(null);
    // `growiInfoService.getSiteUrl()` (used by the search/link-preview
    // paths below) reads `configManager`, which throws "Config is not
    // loaded" until it has loaded both sources at least once.
    await configManager.loadConfigs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      ChatAccountLinkOrder.deleteMany({}),
      ChatChannelPermission.deleteMany({}),
      ChatProcessedRequest.deleteMany({}),
      getUserModel().deleteMany({}),
      getPageModel().deleteMany({}),
      getRevisionModel().deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('help', () => {
    it("answers this GROWI's real command list without resolving an actor (Requirement 14.2)", async () => {
      const crowi = buildCrowi();
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(helpRequest());

      expect(response).toEqual({
        kind: 'help',
        commands: buildHelpContent(),
      });
      expect(resolveActorModule.resolveActor).not.toHaveBeenCalled();
    });
  });

  describe('channel permission (Requirement 11.3)', () => {
    it('refuses a command not permitted in this channel BEFORE resolving the actor or searching', async () => {
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'search',
        allowedChannels: ['C0OTHER'],
      });
      const crowi = buildCrowi();
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(searchRequest());

      expect(response).toEqual({
        kind: 'error',
        code: 'not-permitted-in-channel',
        message: expect.any(String),
      });
      expect(resolveActorModule.resolveActor).not.toHaveBeenCalled();
      expect(crowi.searchService.searchKeyword).not.toHaveBeenCalled();
    });

    it("allows the command from a channel it was never listed in when the stored scope is 'all'", async () => {
      // "Allowed in every channel" is a value an administrator can save
      // (task 9.2). If this side read the row as its (empty) channel list
      // instead, a command allowed everywhere would be denied everywhere --
      // the exact opposite of what was configured.
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'search',
        channelScope: 'all',
        allowedChannels: [],
      });
      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [], meta: { total: 0, hitsCount: 0 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(searchRequest());

      expect(response.kind).toBe('search');
    });

    it("refuses the command from any channel when the stored scope is 'none'", async () => {
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'search',
        channelScope: 'none',
        allowedChannels: [],
      });
      const crowi = buildCrowi();
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(searchRequest());

      expect(response).toEqual({
        kind: 'error',
        code: 'not-permitted-in-channel',
        message: expect.any(String),
      });
      expect(crowi.searchService.searchKeyword).not.toHaveBeenCalled();
    });

    it('allows the command through when the channel is permitted', async () => {
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'search',
        allowedChannels: [CHANNEL.channelId],
      });
      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [], meta: { total: 0, hitsCount: 0 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(searchRequest());

      expect(response.kind).toBe('search');
      expect(crowi.searchService.searchKeyword).toHaveBeenCalled();
    });
  });

  describe('closed GROWI + unresolved actor (Requirement 3.7, 7.6)', () => {
    it('refuses search with account-link-required, without calling the search service', async () => {
      const crowi = buildCrowi({ isGuestAllowedToRead: false });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(searchRequest());

      expect(response.kind).toBe('account-link-required');
      if (response.kind === 'account-link-required') {
        expect(response.growiLabel).toBe('Test GROWI');
        expect(response.linkUrl).toContain('account-link');
      }
      expect(crowi.searchService.searchKeyword).not.toHaveBeenCalled();
    });

    it('refuses link-preview the same way, without resolving the page', async () => {
      await createPageWithRevision({
        path: '/page-a',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const crowi = buildCrowi({ isGuestAllowedToRead: false });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(linkPreviewRequest());

      expect(response.kind).toBe('account-link-required');
    });

    it('still allows an open GROWI to serve an unresolved (anonymous) searcher', async () => {
      const crowi = buildCrowi({ isGuestAllowedToRead: true });
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [], meta: { total: 0, hitsCount: 0 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(searchRequest());

      expect(response.kind).toBe('search');
      // Gen 1's flaw (task 3.3's hand-off note): an unresolved searcher must
      // reach `searchKeyword` as `userGroups: null`, never `[]`.
      expect(crowi.searchService.searchKeyword).toHaveBeenCalledWith(
        'anything',
        null,
        null,
        null,
        expect.anything(),
      );
    });
  });

  describe('search (Requirement 3.6, 3.9)', () => {
    it('drops a page the linked actor may not view and maps the rest to SearchResultItem', async () => {
      const user = await createUser();
      await linkActorTo(user._id);

      const visible = await createPageWithRevision({
        path: '/visible',
        grant: PageGrant.GRANT_PUBLIC,
        commentCount: 3,
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      const restricted = await createPageWithRevision({
        path: '/restricted',
        grant: PageGrant.GRANT_RESTRICTED,
      });

      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [{ _id: 'irrelevant' }], meta: { total: 2, hitsCount: 2 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [
          { data: { ...visible.toObject(), _id: visible._id } },
          { data: { ...restricted.toObject(), _id: restricted._id } },
        ],
        meta: { total: 2, hitsCount: 2 },
      });

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(searchRequest({ limit: 10 }));

      expect(response.kind).toBe('search');
      if (response.kind === 'search') {
        expect(response.items).toHaveLength(1);
        expect(response.items[0]).toMatchObject({
          rank: 1,
          path: '/visible',
          title: 'visible',
          commentCount: 3,
          updatedAt: '2026-02-01T00:00:00.000Z',
        });
        expect(response.appliedAs).toBe('linked-user');
      }
    });
  });

  // Task 10.1: confirms Requirement 3.6/3.7's whole path end to end for a
  // chat account that never linked -- `resolveActor` returning `user: null`,
  // `handleSearch`'s `null` (not `[]`) group list for `searchKeyword`, and
  // `filterPagesForViewer`'s real Mongo grant query -- reaching a genuine
  // command-endpoint response, not a direct call into the already-unit-tested
  // filter (`viewer-page-filter.spec.ts` covers that in isolation). The
  // search step itself is stood in for with real page documents, exactly
  // like the "search (Requirement 3.6, 3.9)" block above: this feature's
  // contract is what happens to a hit AFTER the search engine finds it, not
  // whether Elasticsearch's own relevance matching works (that is GROWI's
  // existing, separately-tested search engine).
  describe('unlinked actor -- permission filtering across grant types (Requirement 3.6, 3.7, task 10.1)', () => {
    const seedAllGrants = async () => {
      const otherUser = await createUser();
      const groupId = new mongoose.Types.ObjectId();

      const publicPage = await createPageWithRevision({
        path: '/public',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const restrictedPage = await createPageWithRevision({
        path: '/link-only',
        grant: PageGrant.GRANT_RESTRICTED,
      });
      const specifiedPage = await createPageWithRevision({
        path: '/specified-users-only',
        grant: PageGrant.GRANT_SPECIFIED,
        grantedUsers: [otherUser._id],
      });
      const ownerPage = await createPageWithRevision({
        path: '/owner-only',
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [otherUser._id],
      });
      const groupPage = await createPageWithRevision({
        path: '/group-only',
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ type: GroupType.userGroup, item: groupId }],
      });

      const allPages = [
        publicPage,
        restrictedPage,
        specifiedPage,
        ownerPage,
        groupPage,
      ];

      return { publicPage, allPages };
    };

    const mockSearchHits = (
      crowi: Crowi,
      // biome-ignore lint/suspicious/noExplicitAny: real Mongoose documents from the shared test helper above, same shape used by the existing "search" describe block.
      pages: any[],
    ): void => {
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        {
          data: pages.map((page) => ({ _id: page._id })),
          meta: { total: pages.length, hitsCount: pages.length },
        },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: pages.map((page) => ({
          data: { ...page.toObject(), _id: page._id },
        })),
        meta: { total: pages.length, hitsCount: pages.length },
      });
    };

    it('returns only the publicly-readable page on an open GROWI, dropping the user-, owner-, group- and link-restricted ones', async () => {
      const { publicPage, allPages } = await seedAllGrants();
      const crowi = buildCrowi({ isGuestAllowedToRead: true });
      mockSearchHits(crowi, allPages);

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(
        searchRequest({ limit: 10, keyword: 'anything' }),
      );

      expect(response.kind).toBe('search');
      if (response.kind === 'search') {
        expect(response.items).toHaveLength(1);
        expect(response.items[0]).toMatchObject({ path: publicPage.path });
        expect(response.appliedAs).toBe('anonymous');
      }
      // Gen 1's flaw (task 3.3's hand-off note), re-checked here with a
      // non-empty result set: an unresolved searcher must reach
      // `searchKeyword` as `userGroups: null`, never `[]`.
      expect(crowi.searchService.searchKeyword).toHaveBeenCalledWith(
        'anything',
        null,
        null,
        null,
        expect.anything(),
      );
    });

    it('returns nothing at all -- not even the public page -- when this GROWI shows nothing to a logged-out visitor', async () => {
      const { allPages } = await seedAllGrants();
      const crowi = buildCrowi({ isGuestAllowedToRead: false });
      mockSearchHits(crowi, allPages);

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(
        searchRequest({ limit: 10, keyword: 'anything' }),
      );

      expect(response.kind).toBe('account-link-required');
      expect(crowi.searchService.searchKeyword).not.toHaveBeenCalled();
    });
  });

  describe('link-preview (Requirement 6.2, 6.3)', () => {
    it('returns the full summary for a publicly-readable page on an open GROWI', async () => {
      await createPageWithRevision({
        path: '/public-page',
        grant: PageGrant.GRANT_PUBLIC,
        body: 'x'.repeat(50),
        commentCount: 2,
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi({ isGuestAllowedToRead: true });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(
        linkPreviewRequest({
          pageUrl: 'https://growi.example.test/public-page',
        }),
      );

      expect(response).toMatchObject({
        kind: 'link-preview',
        path: '/public-page',
        restricted: false,
        commentCount: 2,
      });
    });

    it('returns path-only for a page that is not publicly readable', async () => {
      await createPageWithRevision({
        path: '/private-page',
        grant: PageGrant.GRANT_RESTRICTED,
      });
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi({ isGuestAllowedToRead: true });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(
        linkPreviewRequest({
          pageUrl: 'https://growi.example.test/private-page',
        }),
      );

      expect(response).toEqual({
        kind: 'link-preview',
        path: '/private-page',
        restricted: true,
      });
    });

    it('answers a well-formed error, not a crash, for a URL matching no page', async () => {
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi();
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(
        linkPreviewRequest({
          pageUrl: 'https://growi.example.test/does-not-exist',
        }),
      );

      expect(response.kind).toBe('error');
    });

    it('answers a permalink to an existing but private page and a permalink to no page at all with the exact same response shape (Requirement 6.8)', async () => {
      const privatePage = await createPageWithRevision({
        path: '/private-permalink-target',
        grant: PageGrant.GRANT_RESTRICTED,
      });
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi({ isGuestAllowedToRead: true });
      const endpoint = createCommandEndpoint(crowi);

      const notFoundResponse = await endpoint.handle(
        linkPreviewRequest({
          requestId: 'req-link-permalink-not-found',
          pageUrl: `https://growi.example.test/${new mongoose.Types.ObjectId().toString()}`,
        }),
      );
      const foundButPrivateResponse = await endpoint.handle(
        linkPreviewRequest({
          requestId: 'req-link-permalink-private',
          pageUrl: `https://growi.example.test/${privatePage._id.toString()}`,
        }),
      );

      expect(notFoundResponse).toEqual(foundButPrivateResponse);
      expect(notFoundResponse).toMatchObject({
        kind: 'link-preview',
        restricted: true,
      });
    });

    it('returns the real path and a full summary for a permalink to a publicly-readable page (Requirement 6.6, 6.7)', async () => {
      const publicPage = await createPageWithRevision({
        path: '/public-permalink-target',
        grant: PageGrant.GRANT_PUBLIC,
        body: 'y'.repeat(50),
        commentCount: 3,
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      });
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi({ isGuestAllowedToRead: true });
      const endpoint = createCommandEndpoint(crowi);

      const response = await endpoint.handle(
        linkPreviewRequest({
          pageUrl: `https://growi.example.test/${publicPage._id.toString()}`,
        }),
      );

      expect(response).toMatchObject({
        kind: 'link-preview',
        path: '/public-permalink-target',
        restricted: false,
        commentCount: 3,
      });
    });
  });

  describe('resolvePageFromUrl -- permalink detection (Requirement 6.6, 6.8)', () => {
    it('marks a 24-hex-char permalink URL as isPermalink: true when the page is found', async () => {
      const page = await createPageWithRevision({
        path: '/permalink-target',
        grant: PageGrant.GRANT_PUBLIC,
      });

      const target = await resolvePageFromUrl(
        `https://growi.example.test/${page._id.toString()}`,
      );

      expect(target).not.toBeNull();
      expect(target?.isPermalink).toBe(true);
      expect(target?.page).not.toBeNull();
    });

    it('marks a 24-hex-char permalink URL as isPermalink: true even when no page matches it', async () => {
      const target = await resolvePageFromUrl(
        'https://growi.example.test/60f1a2b3c4d5e6f7a8b9c0d1',
      );

      expect(target).not.toBeNull();
      expect(target?.isPermalink).toBe(true);
      expect(target?.page).toBeNull();
    });

    it('marks a path-form URL as isPermalink: false when the page is found', async () => {
      await createPageWithRevision({
        path: '/path-target',
        grant: PageGrant.GRANT_PUBLIC,
      });

      const target = await resolvePageFromUrl(
        'https://growi.example.test/path-target',
      );

      expect(target).not.toBeNull();
      expect(target?.isPermalink).toBe(false);
      expect(target?.page).not.toBeNull();
    });

    it('marks a path-form URL as isPermalink: false when no page matches it', async () => {
      const target = await resolvePageFromUrl(
        'https://growi.example.test/does-not-exist',
      );

      expect(target).not.toBeNull();
      expect(target?.isPermalink).toBe(false);
      expect(target?.page).toBeNull();
    });

    it('returns top-level null only when the pathname cannot be extracted (invalid URL)', async () => {
      const target = await resolvePageFromUrl('not a url');

      expect(target).toBeNull();
    });
  });

  describe('idempotency (Requirement 10.4)', () => {
    it('replays the stored response for a repeated (relationId, requestId) instead of recomputing', async () => {
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [], meta: { total: 0, hitsCount: 0 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const endpoint = createCommandEndpoint(crowi);
      const request = searchRequest({ requestId: 'req-repeat-0001' });

      const first = await endpoint.handle(request);
      const second = await endpoint.handle(request);

      expect(second).toEqual(first);
      expect(crowi.searchService.searchKeyword).toHaveBeenCalledTimes(1);
    });

    it('round-trips a non-empty stored response through Mixed/.lean() unchanged', async () => {
      // The other replay test above stores `{ items: [] }` -- too trivial to
      // prove `chat_processed_requests.response` (`Schema.Types.Mixed`)
      // round-trips a populated payload (nested array, optional fields)
      // byte-for-byte through `.lean()`, not just an empty shell.
      const user = await createUser();
      await linkActorTo(user._id);
      const visible = await createPageWithRevision({
        path: '/visible',
        grant: PageGrant.GRANT_PUBLIC,
        commentCount: 3,
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [{ _id: 'irrelevant' }], meta: { total: 1, hitsCount: 1 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [{ data: { ...visible.toObject(), _id: visible._id } }],
        meta: { total: 1, hitsCount: 1 },
      });
      const endpoint = createCommandEndpoint(crowi);
      const request = searchRequest({ requestId: 'req-repeat-populated-0001' });

      const first = await endpoint.handle(request);
      const second = await endpoint.handle(request);

      expect(first.kind).toBe('search');
      if (first.kind === 'search') {
        expect(first.items).toHaveLength(1);
      }
      expect(second).toEqual(first);
      expect(crowi.searchService.searchKeyword).toHaveBeenCalledTimes(1);
    });

    it('treats a different requestId for the same relation as a fresh request', async () => {
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword).mockResolvedValue([
        { data: [], meta: { total: 0, hitsCount: 0 } },
        null,
      ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const endpoint = createCommandEndpoint(crowi);

      await endpoint.handle(searchRequest({ requestId: 'req-a' }));
      await endpoint.handle(searchRequest({ requestId: 'req-b' }));

      expect(crowi.searchService.searchKeyword).toHaveBeenCalledTimes(2);
    });

    it('does not persist a response caused by an unexpected failure, so a retry gets a fresh attempt', async () => {
      const user = await createUser();
      await linkActorTo(user._id);
      const crowi = buildCrowi();
      vi.mocked(crowi.searchService.searchKeyword)
        .mockRejectedValueOnce(new Error('transient search outage'))
        .mockResolvedValueOnce([
          { data: [], meta: { total: 0, hitsCount: 0 } },
          null,
        ]);
      vi.mocked(crowi.searchService.formatSearchResult).mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const endpoint = createCommandEndpoint(crowi);
      const request = searchRequest({ requestId: 'req-retry-0001' });

      const first = await endpoint.handle(request);
      expect(first.kind).toBe('error');

      const second = await endpoint.handle(request);
      expect(second.kind).toBe('search');
      expect(crowi.searchService.searchKeyword).toHaveBeenCalledTimes(2);
    });
  });
});
