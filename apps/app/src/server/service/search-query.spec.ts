import { vi } from 'vitest';

import { configManager } from '~/server/service/config-manager/config-manager';

import NamedQuery from '../models/named-query';
import SearchService from './search';

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
  override generateFullTextSearchDelegator() {
    return { init: vi.fn() } as any;
  }
  override generateNQDelegators() {
    return {} as any;
  }
  override registerUpdateEvent() {}
  override get isConfigured() {
    return false;
  }
}

describe('searchParseQuery()', () => {
  let searchService: TestSearchService;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockCrowi = { configManager } as any;
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
