import { mock } from 'vitest-mock-extended';

import type { ESQueryTerms } from '~/server/interfaces/search';
import type { SocketIoService } from '~/server/service/socket-io';

import { configManager } from '../config-manager';
import ElasticsearchDelegator from './elasticsearch';

export const createMockESQueryTerms = (
  overrides: Partial<ESQueryTerms> = {},
): ESQueryTerms => {
  return {
    match: [],
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
    ...overrides,
  };
};

vi.mock('~/server/service/config-manager/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
  default: { getConfig: vi.fn() },
}));
const socket = mock<SocketIoService>();

let delegator: ElasticsearchDelegator;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
    return key === 'app:elasticsearchVersion' ? 9 : undefined;
  });

  delegator = new ElasticsearchDelegator(socket);
});

describe('appendCriteriaForQueryString()', () => {
  it('adds no filter clause when no author/editor terms are present', () => {
    const terms = createMockESQueryTerms();
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toEqual([]);
  });

  it('filters by author via a should (OR) clause', () => {
    const terms = createMockESQueryTerms({ author: ['dennis'] });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: { should: [{ term: { username: 'dennis' } }] },
    });
  });

  it('excludes the author via a must_not clause', () => {
    const terms = createMockESQueryTerms({ not_author: ['dennis'] });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: { must_not: [{ term: { username: 'dennis' } }] },
    });
  });

  it('filters by editor via a should (OR) clause', () => {
    const terms = createMockESQueryTerms({ editor: ['dennis'] });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: { should: [{ term: { last_update_username: 'dennis' } }] },
    });
  });

  it('excludes the editor via a must_not clause', () => {
    const terms = createMockESQueryTerms({ not_editor: ['alice'] });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: { must_not: [{ term: { last_update_username: 'alice' } }] },
    });
  });

  it('combines author and editor as separate AND-ed filter clauses', () => {
    const terms = createMockESQueryTerms({
      editor: ['dennis'],
      author: ['alice'],
    });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: { should: [{ term: { last_update_username: 'dennis' } }] },
    });
    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: { should: [{ term: { username: 'alice' } }] },
    });
  });

  it('combines two authors into a single OR (should) clause', () => {
    const terms = createMockESQueryTerms({ author: ['dennis', 'alice'] });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: {
        should: [
          { term: { username: 'dennis' } },
          { term: { username: 'alice' } },
        ],
      },
    });
  });

  it('combines two editors into a single OR (should) clause', () => {
    const terms = createMockESQueryTerms({ editor: ['dennis', 'alice'] });
    const query = delegator.createSearchQuery();

    delegator.appendCriteriaForQueryString(query, terms);

    expect(query.body?.query.bool?.filter).toContainEqual({
      bool: {
        should: [
          { term: { last_update_username: 'dennis' } },
          { term: { last_update_username: 'alice' } },
        ],
      },
    });
  });
});

describe('appendCriteriaForGroupFilter()', () => {
  it('filters by group via a terms filter clause', () => {
    const terms = createMockESQueryTerms({ group: ['dev-1'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: ['id1'],
      notGroupIds: [],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toContainEqual({
      terms: { granted_groups: ['id1'] },
    });
  });

  it('excludes the group via a must_not clause', () => {
    const terms = createMockESQueryTerms({ not_group: ['dev-1'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: [],
      notGroupIds: ['id1'],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.must_not).toContainEqual({
      terms: { granted_groups: ['id1'] },
    });
  });

  it('combines two groups into a single terms filter clause', () => {
    const terms = createMockESQueryTerms({ group: ['dev-1', 'dev-2'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: ['id1', 'id2'],
      notGroupIds: [],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toContainEqual({
      terms: { granted_groups: ['id1', 'id2'] },
    });
  });

  it('applies group as a filter clause and not-group as a must_not clause', () => {
    const terms = createMockESQueryTerms({
      group: ['dev-1'],
      not_group: ['dev-2'],
    });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: ['id1'],
      notGroupIds: ['id2'],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toContainEqual({
      terms: { granted_groups: ['id1'] },
    });
    expect(query.body?.query.bool?.must_not).toContainEqual({
      terms: { granted_groups: ['id2'] },
    });
  });

  it('keeps the positive group clause even when no group ids resolve (matching nothing)', () => {
    const terms = createMockESQueryTerms({ group: ['nonexistent'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: [],
      notGroupIds: [],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toContainEqual({
      terms: { granted_groups: [] },
    });
  });

  it('does nothing when resolvedFilterData is undefined', () => {
    const terms = createMockESQueryTerms({ group: ['dev-1'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = undefined;

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toBeUndefined();
    expect(query.body?.query.bool?.must_not).toBeUndefined();
  });

  it('keeps the negative group clause even when no not-group ids resolve (excluding nothing)', () => {
    const terms = createMockESQueryTerms({ not_group: ['nonexistent'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: [],
      notGroupIds: [],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.must_not).toContainEqual({
      terms: { granted_groups: [] },
    });
  });

  it('pushes no group clause when no group terms are present', () => {
    const terms = createMockESQueryTerms();
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: [],
      notGroupIds: [],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toEqual([]);
    expect(query.body?.query.bool?.must_not).toEqual([]);
  });
});

// Contract of dropping Elasticsearch 7 support: the delegator must be
// constructable only for the supported versions (8, 9) and must reject any
// other value of ELASTICSEARCH_VERSION with a clear error instead of silently
// falling back.
describe('ElasticsearchDelegator constructor — supported version gate', () => {
  // Use the same module-mocked configManager the rest of the file relies on
  // (a vi.spyOn + restoreAllMocks strategy here would clobber that module mock
  // and break the shared beforeEach for later tests).
  const stubElasticsearchVersion = (version: number | undefined) => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'app:elasticsearchVersion') return version;
      if (key === 'app:elasticsearchReindexOnBoot') return false;
      return undefined;
    });
  };

  it.each([8, 9])('accepts supported version %i', (version) => {
    stubElasticsearchVersion(version);
    expect(() => new ElasticsearchDelegator(socket)).not.toThrow();
  });

  it('rejects Elasticsearch 7 (support removed)', () => {
    stubElasticsearchVersion(7);
    expect(() => new ElasticsearchDelegator(socket)).toThrow(
      'Unsupported Elasticsearch version',
    );
  });

  it.each([
    6,
    10,
    undefined,
  ])('rejects unsupported/invalid version %s', (version) => {
    stubElasticsearchVersion(version);
    expect(() => new ElasticsearchDelegator(socket)).toThrow(
      'Unsupported Elasticsearch version',
    );
  });
});
