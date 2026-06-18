import { vi } from 'vitest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import { SearchDelegatorName } from '~/interfaces/named-query';
import type Crowi from '~/server/crowi';
import UserGroup from '~/server/models/user-group';
import { configManager } from '~/server/service/config-manager/config-manager';

import type { QueryTerms, SearchDelegator } from '../interfaces/search';
import NamedQuery from '../models/named-query';
import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

// Mock UserGroup
vi.mock('~/server/models/user-group', () => {
  const mockModel = {
    find: vi.fn(),
    findOne: vi.fn(),
  };

  return {
    default: mockModel,
    UserGroup: mockModel,
  };
});
vi.mock(
  '~/features/external-user-group/server/models/external-user-group',
  () => {
    const mockModel = {
      find: vi.fn(),
      findOne: vi.fn(),
    };

    return {
      default: mockModel,
      ExternalUserGroup: mockModel,
    };
  },
);

// Mock NamedQuery
vi.mock('~/server/models/named-query', () => {
  const mockModel = {
    findOne: vi.fn(),
  };
  return {
    NamedQuery: mockModel,
    default: mockModel,
  };
});

// Mock config manager
vi.mock('~/server/service/config-manager/config-manager', () => {
  return {
    default: {
      getConfig: vi.fn(),
    },
    configManager: {
      getConfig: vi.fn(),
    },
  };
});

class TestSearchService extends SearchService {
  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  override generateFullTextSearchDelegator(): ElasticsearchDelegator {
    return mock<ElasticsearchDelegator>();
  }

  override generateNQDelegators(): {
    [key in SearchDelegatorName]: SearchDelegator;
  } {
    return {
      [SearchDelegatorName.DEFAULT]: mock<SearchDelegator>(),
      [SearchDelegatorName.PRIVATE_LEGACY_PAGES]: mock<SearchDelegator>(),
    };
  }

  override registerUpdateEvent(): void {}

  override get isConfigured(): boolean {
    return false;
  }
}

describe('searchParseQuery()', () => {
  let searchService: TestSearchService;
  let mockCrowi: MockProxy<Crowi>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCrowi = mock<Crowi>();
    mockCrowi.configManager = configManager;
    searchService = new TestSearchService(mockCrowi);
  });

  it('should contain /user in the not_prefix query when user pages are disabled', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'security:disableUserPages') {
        return true;
      }

      return false;
    });

    const result = await searchService.parseSearchQuery('/user/settings', null);

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).toContain('/user');
    expect(result.terms.prefix).toHaveLength(0);
  });

  it('should contain /user in the not_prefix even when search query is not a user page', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'security:disableUserPages') {
        return true;
      }

      return false;
    });

    const result = await searchService.parseSearchQuery('/new-task', null);

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).toContain('/user');
    expect(result.terms.prefix).toHaveLength(0);
  });

  it('should add specific user prefixes in the query when user pages are enabled', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'security:disableUserPages') {
        return false;
      }

      return true;
    });

    const result = await searchService.parseSearchQuery('/user/settings', null);

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).not.toContain('/user');
    expect(result.terms.not_prefix).not.toContain('/user/settings');
    expect(result.terms.match).toContain('/user/settings');
  });

  it('should filter user pages even when resolved from a named query alias', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'security:disableUserPages') {
        return true;
      }

      return false;
    });

    const shortcutName = 'my-shortcut';
    const aliasPath = '/user/my-private-page';

    // Mock the DB response
    vi.mocked(NamedQuery.findOne).mockResolvedValue({
      name: shortcutName,
      aliasOf: aliasPath,
    });

    const result = await searchService.parseSearchQuery('dummy', shortcutName);

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).toContain('/user');
    expect(result.terms.match).toContain('/user/my-private-page');
  });
});

type MockGroupDoc = { id: string; name: string };

// Builds the find().select().exec() chain for both group models.
const mockGroupFinds = (
  internal: MockGroupDoc[],
  external: MockGroupDoc[],
): void => {
  vi.mocked(UserGroup.find).mockReturnValue({
    select: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(internal),
  } as unknown as ReturnType<typeof UserGroup.find>);

  vi.mocked(ExternalUserGroup.find).mockReturnValue({
    select: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(external),
  } as unknown as ReturnType<typeof ExternalUserGroup.find>);
};

describe('resolveFilterData()', () => {
  let searchService: TestSearchService;
  let mockCrowi: MockProxy<Crowi>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockCrowi = mock<Crowi>();
    mockCrowi.configManager = configManager;
    searchService = new TestSearchService(mockCrowi);
  });

  it('resolves the id for an existing group', async () => {
    mockGroupFinds(
      [{ id: 'id1', name: 'dev-1' }],
      [{ id: 'id2', name: 'admin-only' }],
    );

    const mockTerms: Partial<QueryTerms> = { group: ['dev-1'] };
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: ['id1'],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
  });

  it('resolves the ids for several existing groups', async () => {
    mockGroupFinds(
      [{ id: 'id1', name: 'dev-1' }],
      [{ id: 'id2', name: 'admin-only' }],
    );

    const mockTerms: Partial<QueryTerms> = { group: ['dev-1', 'admin-only'] };
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: ['id1', 'id2'],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
  });

  it('resolves to empty when the group is not among the users groups', async () => {
    mockGroupFinds([{ id: 'id1', name: 'other-group' }], []);

    const mockTerms: Partial<QueryTerms> = { group: ['dev-1'] };
    const userGroups = ['id1'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: [],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
    expect(UserGroup.find).toHaveBeenCalled();
    expect(ExternalUserGroup.find).toHaveBeenCalled();
  });

  it('returns early without querying when the user belongs to no groups', async () => {
    const mockTerms: Partial<QueryTerms> = { group: ['dev-1'] };
    const userGroups = [];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: [],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
    expect(UserGroup.find).not.toHaveBeenCalled();
    expect(ExternalUserGroup.find).not.toHaveBeenCalled();
  });

  it('does not resolve any ids on empty group terms', async () => {
    const mockTerms: Partial<QueryTerms> = { group: [] };
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: [],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
    expect(UserGroup.find).not.toHaveBeenCalled();
    expect(ExternalUserGroup.find).not.toHaveBeenCalled();
  });

  it('resolves the ids for not-groups', async () => {
    mockGroupFinds(
      [{ id: 'id1', name: 'dev-1' }],
      [{ id: 'id2', name: 'admin-only' }],
    );

    const mockTerms: Partial<QueryTerms> = {
      not_group: ['dev-1', 'admin-only'],
    };
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: [],
      notGroupIds: ['id1', 'id2'],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
  });

  it('resolves the ids for not-group combined with group', async () => {
    mockGroupFinds(
      [{ id: 'id1', name: 'dev-1' }],
      [{ id: 'id2', name: 'admin-only' }],
    );

    const mockTerms: Partial<QueryTerms> = {
      group: ['admin-only'],
      not_group: ['dev-1'],
    };
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: ['id2'],
      notGroupIds: ['id1'],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
  });

  it('returns early when no terms', async () => {
    const mockTerms: Partial<QueryTerms> = {};
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: [],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
    expect(UserGroup.find).not.toHaveBeenCalled();
    expect(ExternalUserGroup.find).not.toHaveBeenCalled();
  });

  it('returns early for a guest without querying groups (null userGroups)', async () => {
    const mockTerms: Partial<QueryTerms> = { not_group: ['dev-1'] };
    const userGroups = null;

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: [],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
    expect(UserGroup.find).not.toHaveBeenCalled();
    expect(ExternalUserGroup.find).not.toHaveBeenCalled();
  });

  it('resolves to correct ids when group names are identical', async () => {
    mockGroupFinds(
      [{ id: 'id1', name: 'dev-1' }],
      [{ id: 'id2', name: 'dev-1' }],
    );

    const mockTerms: Partial<QueryTerms> = {
      group: ['dev-1'],
      not_group: [],
    };
    const userGroups = ['id1', 'id2'];

    const resolvedIds = await searchService.resolveFilterData(
      mockTerms,
      userGroups,
    );

    const expectedResolvedIds = {
      groupIds: ['id1', 'id2'],
      notGroupIds: [],
    };

    expect(resolvedIds).toStrictEqual(expectedResolvedIds);
  });
});
