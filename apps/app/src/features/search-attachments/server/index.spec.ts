import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { AttachmentWithComputed } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import type SearchService from '~/server/service/search';
import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';

import { initAttachmentFullTextSearch } from './index';
import type { AttachmentSearchResultAggregator } from './services/attachment-search-result-aggregator';

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn().mockReturnValue(null),
  },
}));

// Only the HTTP call to the extractor service is replaced
vi.mock('./services/attachment-text-extractor', () => ({
  AttachmentTextExtractorService: class {
    extractAttachment = vi.fn().mockResolvedValue({
      kind: 'success',
      pages: [{ pageNumber: 1, label: '1', content: 'hello' }],
      mimeType: 'text/plain',
    });
  },
}));

type AttachHandler = (
  pageId: string | null,
  attachment: AttachmentWithComputed,
  file: Express.Multer.File,
) => Promise<void>;

const enableInConfig = () => {
  vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
    if (key === 'app:attachmentFullTextSearch:extractorUri')
      return 'http://extractor:8000';
    if (key === 'app:attachmentFullTextSearch:extractorToken') return 'token';
    return null;
  });
};

/** A crowi whose search service is backed by a stub ES 8 client. */
const makeCrowi = () => {
  const esClient = {
    delegatorVersion: 8,
    bulk: vi.fn().mockResolvedValue({ errors: false }),
    search: vi.fn().mockResolvedValue({ hits: { hits: [] } }),
  };
  const attachHandlers: AttachHandler[] = [];
  let aggregator: AttachmentSearchResultAggregator | undefined;
  const fullTextSearchDelegator = mock<ElasticsearchDelegator>();
  // The feature reads the delegator's private client at runtime
  Object.defineProperty(fullTextSearchDelegator, 'client', { value: esClient });
  // Only the services the feature wires itself into
  const crowi = mock<Crowi>({
    searchService: mock<SearchService>({
      isConfigured: true,
      fullTextSearchDelegator,
      setAttachmentSearchResultAggregator: (
        agg: AttachmentSearchResultAggregator,
      ) => {
        aggregator = agg;
      },
    }),
    attachmentService: {
      addAttachHandler: (handler: AttachHandler) =>
        attachHandlers.push(handler),
      addDetachHandler: vi.fn(),
    },
  });
  return {
    crowi,
    esClient,
    attachHandlers,
    getAggregator: () => aggregator,
  };
};

const attachment: AttachmentWithComputed = {
  id: 'att-1',
  _id: 'att-1',
  v: 0,
  __v: 0,
  pageId: 'page-1',
  creatorId: null,
  filePath: null,
  fileName: 'a.txt',
  originalName: 'a.txt',
  fileFormat: 'text/plain',
  fileSize: 5,
  attachmentType: 'attachment',
  temporaryUrlCached: null,
  temporaryUrlExpiredAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  filePathProxied: '/attachment/att-1',
  downloadPathProxied: '/download/att-1',
  getValidTemporaryUrl: () => null,
};

describe('initAttachmentFullTextSearch', () => {
  beforeEach(() => {
    vi.mocked(configManager.getConfig).mockReturnValue(null);
  });

  it('does not register handlers when searchService is not configured', () => {
    const addAttachHandler = vi.fn();
    const addDetachHandler = vi.fn();
    const fakeCrowi = mock<Crowi>({
      searchService: { isConfigured: false },
      attachmentService: { addAttachHandler, addDetachHandler },
    });

    initAttachmentFullTextSearch(fakeCrowi);

    expect(addAttachHandler).not.toHaveBeenCalled();
    expect(addDetachHandler).not.toHaveBeenCalled();
  });

  describe('when the feature is disabled at startup and enabled later in the config', () => {
    it('indexes an attachment uploaded after enabling', async () => {
      const { crowi, esClient, attachHandlers } = makeCrowi();
      initAttachmentFullTextSearch(crowi);
      enableInConfig();

      await Promise.all(
        attachHandlers.map((handler) =>
          handler('page-1', attachment, mock<Express.Multer.File>()),
        ),
      );

      expect(esClient.bulk).toHaveBeenCalledWith({
        operations: expect.arrayContaining([
          { index: { _index: 'attachments', _id: 'att-1_1' } },
        ]),
      });
    });

    it('searches the attachment index for facet=attachments', async () => {
      const { crowi, esClient, getAggregator } = makeCrowi();
      initAttachmentFullTextSearch(crowi);
      enableInConfig();

      await getAggregator()?.searchPrimary(
        {
          queryString: 'hello',
          terms: {
            match: ['hello'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
            author: [],
            not_author: [],
            editor: [],
            not_editor: [],
            group: [],
            not_group: [],
          },
          resolvedFilterData: { groupIds: [], notGroupIds: [] },
          viewer: { user: null, userGroups: null },
        },
        { facet: 'attachments', from: 0, size: 20 },
      );

      expect(esClient.search).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'attachments' }),
      );
    });
  });
});
