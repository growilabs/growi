/**
 * GET /_api/v3/search/attachments, through the factory's real auth chain
 * (accessTokenParser -> guest-allowed loginRequired -> feature gate).
 */

import type { IUserHasId } from '@growi/core';
import express from 'express';
import supertest from 'supertest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type { AttachmentSearchViewer } from '~/features/search-attachments/server/services/search-accessible-pages';
import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import type { AclService } from '~/server/service/acl';
import type SearchService from '~/server/service/search';

import { createSearchAttachmentsRouter } from './search-attachments';

const { featureEnabled } = vi.hoisted(() => ({
  featureEnabled: { value: true },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));
vi.mock('../../services/is-attachment-full-text-search-enabled', () => ({
  isAttachmentFullTextSearchEnabled: (isSearchServiceConfigured: boolean) =>
    isSearchServiceConfigured && featureEnabled.value,
}));

addCustomFunctionToResponse(express);

const MOUNT = '/_api/v3/search/attachments';
const oid = (i: number): string => i.toString(16).padStart(24, '0');

const guestViewer: AttachmentSearchViewer = { user: null, userGroups: null };

describe('GET /_api/v3/search/attachments', () => {
  let searchService: MockProxy<SearchService>;
  let aclService: MockProxy<AclService>;
  let resolveViewer: ReturnType<
    typeof vi.fn<
      (user: IUserHasId | null | undefined) => Promise<AttachmentSearchViewer>
    >
  >;
  let currentUser: IUserHasId | undefined;
  let app: express.Express;

  beforeEach(() => {
    featureEnabled.value = true;
    currentUser = undefined;
    searchService = mock<SearchService>({ isConfigured: true });
    searchService.resolveAttachmentSecondary.mockResolvedValue({
      facet: 'all',
      enrichments: {},
    });
    aclService = mock<AclService>();
    aclService.isGuestAllowedToRead.mockReturnValue(false);
    resolveViewer = vi.fn(async (user) =>
      user == null ? guestViewer : { user, userGroups: ['group-1'] },
    );

    const crowi = mock<Crowi>({ searchService, aclService });

    app = express();
    // the real app's body parser always sets req.body, which the token parser reads
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
      req.user = currentUser;
      next();
    });
    app.use(MOUNT, createSearchAttachmentsRouter(crowi, resolveViewer));
  });

  const get = (query: Record<string, unknown> | string) =>
    supertest(app).get(MOUNT).query(query);

  describe('authentication', () => {
    it('rejects a guest when guests may not read', async () => {
      const res = await get({ q: 'kw', pageIds: oid(1) });

      expect(res.status).toBe(403);
      expect(searchService.resolveAttachmentSecondary).not.toHaveBeenCalled();
    });

    it('rejects a guest before revealing whether the feature is enabled', async () => {
      featureEnabled.value = false;

      const res = await get({ q: 'kw', pageIds: oid(1) });

      expect(res.status).toBe(403);
    });

    it('searches as a guest when guests may read', async () => {
      aclService.isGuestAllowedToRead.mockReturnValue(true);

      const res = await get({ q: 'kw', pageIds: oid(1) });

      expect(res.status).toBe(200);
      expect(searchService.resolveAttachmentSecondary).toHaveBeenCalledWith(
        'kw',
        guestViewer,
        { primaryIds: [oid(1)] },
      );
    });

    it('searches as the logged-in user', async () => {
      currentUser = mock<IUserHasId>({ _id: 'user-1', status: 2 });

      const res = await get({ q: 'kw', pageIds: oid(1) });

      expect(res.status).toBe(200);
      expect(searchService.resolveAttachmentSecondary).toHaveBeenCalledWith(
        'kw',
        { user: currentUser, userGroups: ['group-1'] },
        { primaryIds: [oid(1)] },
      );
    });
  });

  describe('as a logged-in user', () => {
    beforeEach(() => {
      currentUser = mock<IUserHasId>({ _id: 'user-1', status: 2 });
    });

    it('answers 503 feature_disabled while the feature is disabled', async () => {
      featureEnabled.value = false;

      const res = await get({ q: 'kw', pageIds: oid(1) });

      expect(res.status).toBe(503);
      expect(res.body.errors[0].code).toBe('feature_disabled');
      expect(searchService.resolveAttachmentSecondary).not.toHaveBeenCalled();
    });

    it('returns the enrichments', async () => {
      const enrichments = { [oid(1)]: { attachmentHits: [] } };
      searchService.resolveAttachmentSecondary.mockResolvedValue({
        facet: 'all',
        enrichments,
      });

      const res = await get({ q: 'kw', pageIds: `${oid(1)},${oid(2)}` });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ facet: 'all', enrichments });
    });

    it('accepts repeated pageIds params and counts duplicates once', async () => {
      const ids = Array.from({ length: 20 }, (_, i) => oid(i));
      const query = [...ids, oid(0), oid(1)]
        .map((id) => `pageIds=${id}`)
        .join('&');

      const res = await get(`q=kw&${query}`);

      expect(res.status).toBe(200);
      expect(searchService.resolveAttachmentSecondary).toHaveBeenCalledWith(
        'kw',
        expect.anything(),
        { primaryIds: ids },
      );
    });

    it('searches with an empty keyword when q is omitted', async () => {
      const res = await get({ pageIds: oid(1) });

      expect(res.status).toBe(200);
      expect(searchService.resolveAttachmentSecondary).toHaveBeenCalledWith(
        '',
        expect.anything(),
        { primaryIds: [oid(1)] },
      );
    });

    it.each([
      { name: 'missing pageIds', query: { q: 'kw' } },
      { name: 'empty pageIds', query: { q: 'kw', pageIds: '' } },
      { name: 'only separators', query: { q: 'kw', pageIds: ',,' } },
      {
        name: 'more than 20 distinct ids',
        query: {
          q: 'kw',
          pageIds: Array.from({ length: 21 }, (_, i) => oid(i)).join(','),
        },
      },
      {
        name: 'an id that is not an ObjectId',
        query: { q: 'kw', pageIds: `${oid(1)},secret<script>` },
      },
      { name: 'an operator-shaped pageIds', query: 'q=kw&pageIds[$ne]=secret' },
      { name: 'an object-shaped pageIds', query: 'q=kw&pageIds[a]=secret' },
      {
        name: 'a repeated q',
        query: `q=secret&q=other&pageIds=${oid(1)}`,
      },
      {
        name: 'an object-shaped q',
        query: `q[$ne]=secret&pageIds=${oid(1)}`,
      },
    ])('rejects $name with 400 and a fixed message', async ({ query }) => {
      const res = await get(query);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toMatch(/^invalid_/);
      expect(res.text).not.toContain('secret');
      expect(searchService.resolveAttachmentSecondary).not.toHaveBeenCalled();
    });

    it('answers 500 with a fixed message when the search fails', async () => {
      searchService.resolveAttachmentSecondary.mockRejectedValue(
        new Error('secret internals'),
      );

      const res = await get({ q: 'kw', pageIds: oid(1) });

      expect(res.status).toBe(500);
      expect(res.text).not.toContain('secret');
    });
  });
});
